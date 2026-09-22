#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const catalogUrl = new URL('models.json', root);
const models = JSON.parse(await readFile(catalogUrl, 'utf8'));
const declaration = JSON.parse(
  await readFile(new URL('gemini-native-search-declaration.json', root), 'utf8'),
);

assert.equal(declaration.kind, 'maintainer-declaration');
assert.equal(declaration.web_search, true);
assert.equal(declaration.protocol, 'gemini');
assert.equal(declaration.tool, 'googleSearch');

let updated = 0;
for (const [provider, ids] of Object.entries(declaration.models)) {
  assert.ok(Array.isArray(ids), `${provider}: expected explicit model IDs`);
  assert.equal(new Set(ids).size, ids.length, `${provider}: duplicate model IDs`);
  for (const id of ids) {
    const matches = models[provider]?.filter((model) => model.id === id) ?? [];
    assert.equal(matches.length, 1, `${provider}/${id}: expected exactly one catalog model`);
    const model = matches[0];
    model.native_capabilities = { ...model.native_capabilities, web_search: true };
    updated += 1;
  }
}

// Only explicitly declared provider/model pairs are changed. Future models do
// not inherit search support merely because their IDs contain "gemini".
await writeFile(catalogUrl, `${JSON.stringify(models, null, 2)}\n`);
console.log(`Applied ${updated} Gemini native web-search declarations.`);
