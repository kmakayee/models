#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const models = JSON.parse(await readFile(new URL('models.json', root), 'utf8'));
const codexClient = JSON.parse(
  await readFile(new URL('codex_client_models.json', root), 'utf8'),
);

const officialEvidence = JSON.parse(
  await readFile(new URL('native-capabilities-evidence.json', root), 'utf8'),
);

const geminiDeclaration = JSON.parse(
  await readFile(new URL('gemini-native-search-declaration.json', root), 'utf8'),
);
assert.equal(geminiDeclaration.kind, 'maintainer-declaration');
assert.equal(geminiDeclaration.web_search, true);
assert.equal(geminiDeclaration.protocol, 'gemini');
assert.equal(geminiDeclaration.tool, 'googleSearch');
assert.ok(typeof geminiDeclaration.evidence === 'string' && geminiDeclaration.evidence.trim());
assert.ok(typeof geminiDeclaration.verification === 'string' && geminiDeclaration.verification.trim());

const declaredGeminiModels = new Map();
for (const [provider, ids] of Object.entries(geminiDeclaration.models)) {
  assert.ok(Array.isArray(ids), `${provider}: expected explicit Gemini model IDs`);
  assert.equal(new Set(ids).size, ids.length, `${provider}: duplicate Gemini declarations`);
  for (const id of ids) {
    assert.ok(typeof id === 'string' && id.startsWith('gemini-'), `${provider}/${id}: invalid Gemini declaration`);
    assert.equal(models[provider]?.filter((model) => model.id === id).length, 1, `${provider}/${id}: declaration must match exactly one catalog model`);
    const documented = officialEvidence[provider]?.[id]?.web_search;
    assert.ok(documented === undefined || documented === true, `${provider}/${id}: declaration contradicts documented evidence`);
  }
  declaredGeminiModels.set(provider, new Set(ids));
}

const clientSearchBySlug = new Map(
  codexClient.models
    .filter((model) => typeof model.supports_search_tool === 'boolean')
    .map((model) => [model.slug, model.supports_search_tool]),
);

let annotated = 0;
for (const [provider, entries] of Object.entries(models)) {
  assert.ok(Array.isArray(entries), `${provider} must contain a model array`);

  for (const model of entries) {
    const capabilities = model.native_capabilities;
    if (capabilities !== undefined) {
      assert.equal(
        capabilities !== null &&
          typeof capabilities === 'object' &&
          !Array.isArray(capabilities),
        true,
        `${provider}/${model.id}: native_capabilities must be an object`,
      );
      if ('web_search' in capabilities) {
        assert.equal(
          typeof capabilities.web_search,
          'boolean',
          `${provider}/${model.id}: web_search must be boolean`,
        );
        annotated += 1;
      }
    }

    if (!provider.startsWith('codex-')) {
      const expected = officialEvidence[provider]?.[model.id]?.web_search ??
        (declaredGeminiModels.get(provider)?.has(model.id) ? true : undefined);
      assert.equal(
        capabilities?.web_search,
        expected,
        `${provider}/${model.id}: must match exact documented model evidence or maintainer declaration, or remain unknown`,
      );
      continue;
    }

    const expected = clientSearchBySlug.get(model.id);
    if (expected === undefined) {
      assert.equal(
        capabilities?.web_search,
        undefined,
        `${provider}/${model.id}: no exact Codex client slug evidence`,
      );
    } else {
      assert.equal(
        capabilities?.web_search,
        expected,
        `${provider}/${model.id}: does not match Codex client metadata`,
      );
    }
  }
}

for (const [provider, entries] of Object.entries(officialEvidence)) {
  for (const [id, evidence] of Object.entries(entries)) {
    assert.equal(typeof evidence.web_search, 'boolean', `${provider}/${id}: invalid evidence value`);
    assert.equal(new URL(evidence.source).protocol, 'https:', `${provider}/${id}: expected official HTTPS source`);
    assert.ok(models[provider]?.some((model) => model.id === id), `${provider}/${id}: evidence has no catalog model`);
  }
}

console.log(`Validated ${annotated} native web-search annotations.`);
