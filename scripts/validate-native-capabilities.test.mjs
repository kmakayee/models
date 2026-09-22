import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function fixture(t, mutate, mutateDeclaration) {
  const dir = await mkdtemp(join(tmpdir(), 'native-capabilities-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts'));
  for (const file of ['models.json', 'codex_client_models.json', 'native-capabilities-evidence.json', 'gemini-native-search-declaration.json', 'scripts/validate-native-capabilities.mjs', 'scripts/apply-gemini-search-declaration.mjs']) {
    await copyFile(new URL(file, root), join(dir, file));
  }
  const models = JSON.parse(await readFile(join(dir, 'models.json'), 'utf8'));
  mutate?.(models);
  await writeFile(join(dir, 'models.json'), JSON.stringify(models));
  const declarationPath = join(dir, 'gemini-native-search-declaration.json');
  const declaration = JSON.parse(await readFile(declarationPath, 'utf8'));
  mutateDeclaration?.(declaration);
  await writeFile(declarationPath, JSON.stringify(declaration));
  const run = () => execFileSync(process.execPath, [join(dir, 'scripts/validate-native-capabilities.mjs')], { encoding: 'utf8', stdio: 'pipe' });
  run.apply = () => execFileSync(process.execPath, [join(dir, 'scripts/apply-gemini-search-declaration.mjs')], { encoding: 'utf8', stdio: 'pipe' });
  run.readModels = async () => JSON.parse(await readFile(join(dir, 'models.json'), 'utf8'));
  return run;
}

test('validates the curated catalog', async (t) => {
  const run = await fixture(t);
  assert.match(run(), /Validated \d+ native web-search annotations/);
});

test('rejects non-boolean declarations', async (t) => {
  const run = await fixture(t, (models) => {
    models.claude.find((model) => model.id === 'claude-opus-5').native_capabilities.web_search = 'true';
  });
  assert.throws(run, /web_search must be boolean/);
});

test('rejects contradicting exact Codex evidence', async (t) => {
  const run = await fixture(t, (models) => {
    models['codex-free'].find((model) => model.id === 'gpt-5.5').native_capabilities.web_search = false;
  });
  assert.throws(run, /does not match Codex client metadata/);
});

for (const value of [true, false]) {
  test(`rejects unsupported assertions for an unknown model (${value})`, async (t) => {
    const run = await fixture(t, (models) => {
      models.claude.push({ id: 'unverified-test-model', native_capabilities: { web_search: value } });
    });
    assert.throws(run, /must match exact documented model evidence or maintainer declaration, or remain unknown/);
  });
}

test('does not borrow evidence from another provider', async (t) => {
  const run = await fixture(t, (models) => {
    models.xai.push({ id: 'claude-opus-5', native_capabilities: { web_search: true } });
  });
  assert.throws(run, /must match exact documented model evidence or maintainer declaration, or remain unknown/);
});

test('declares all 61 existing Gemini entries including images and aliases', async () => {
  const models = JSON.parse(await readFile(new URL('models.json', root), 'utf8'));
  const declaration = JSON.parse(await readFile(new URL('gemini-native-search-declaration.json', root), 'utf8'));
  assert.equal(declaration.kind, 'maintainer-declaration');
  const expectedCounts = { gemini: 14, vertex: 16, 'gemini-cli': 7, aistudio: 16, antigravity: 8 };
  for (const [provider, count] of Object.entries(expectedCounts)) {
    assert.equal(declaration.models[provider].length, count);
    for (const id of declaration.models[provider]) {
      assert.equal(models[provider].find((model) => model.id === id)?.native_capabilities?.web_search, true);
    }
  }
});

for (const value of [undefined, false]) {
  test(`rejects missing or contradictory Gemini annotations (${value})`, async (t) => {
    const run = await fixture(t, (models) => {
      const model = models.gemini.find((model) => model.id === 'gemini-2.5-flash');
      if (value === undefined) delete model.native_capabilities;
      else model.native_capabilities.web_search = value;
    });
    assert.throws(run, /must match exact documented model evidence or maintainer declaration/);
  });
}

for (const value of [true, false]) {
  test(`does not infer capabilities for future Gemini IDs (${value})`, async (t) => {
    const run = await fixture(t, (models) => {
      models.gemini.push({ id: 'gemini-unverified-future', native_capabilities: { web_search: value } });
    });
    assert.throws(run, /must match exact documented model evidence or maintainer declaration/);
  });
}

test('does not borrow Gemini declarations across providers', async (t) => {
  const run = await fixture(t, (models) => {
    models.claude.push({ id: 'gemini-2.5-flash', native_capabilities: { web_search: true } });
  });
  assert.throws(run, /must match exact documented model evidence or maintainer declaration/);
});

test('rejects declarations for missing catalog models', async (t) => {
  const run = await fixture(t, undefined, (declaration) => {
    declaration.models.gemini.push('gemini-unverified-future');
  });
  assert.throws(run, /declaration must match exactly one catalog model/);
});

test('rejects duplicate declarations', async (t) => {
  const run = await fixture(t, undefined, (declaration) => {
    declaration.models.gemini.push(declaration.models.gemini[0]);
  });
  assert.throws(run, /duplicate Gemini declarations/);
});

test('applies only exact declarations, preserves other fields, and is idempotent', async (t) => {
  const run = await fixture(t, (models) => {
    const model = models.gemini.find((entry) => entry.id === 'gemini-2.5-flash');
    model.native_capabilities = { other_capability: true };
    models.gemini.push({ id: 'gemini-unverified-future', description: 'Remain unknown' });
  });
  const before = await run.readModels();
  assert.match(run.apply(), /Applied 61 Gemini native web-search declarations/);
  const after = await run.readModels();
  before.gemini.find((model) => model.id === 'gemini-2.5-flash').native_capabilities.web_search = true;
  assert.deepEqual(after, before);
  assert.match(run(), /Validated \d+ native web-search annotations/);
  run.apply();
  assert.deepEqual(await run.readModels(), after);
});

test('leaves unverified model IDs unknown', async (t) => {
  const run = await fixture(t, (models) => {
    models.claude.push({ id: 'unverified-test-model' });
  });
  assert.match(run(), /Validated \d+ native web-search annotations/);
});
