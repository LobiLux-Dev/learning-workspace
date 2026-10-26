import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateResourceSet, validateLinkClosure } from '../dist/index.js';

test('virtual resource validation enforces quotas before decoding or AST analysis', () => {
  const oversizedText = new Uint8Array(2 * 1024 * 1024 + 1);
  const oversizedAsset = new Uint8Array(10 * 1024 * 1024 + 1);
  for (const [path, bytes] of [['large.yaml', oversizedText], ['large.png', oversizedAsset]] as const) {
    const resources = new Map<string, Uint8Array>([['index.md', Buffer.from('# Index\n')], [path, bytes]]);
    const result = validateResourceSet(resources);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((issue) => issue.code === 'FILE_SIZE_LIMIT'));
    assert.equal(result.documents.size, 0);
    assert.equal(validateLinkClosure({ resources, entry: 'index.md' }).ok, false);
  }
});

test('virtual resource validation rejects 2001 files without parsing them', () => {
  const resources = new Map(Array.from({ length: 2001 }, (_, index) => [`file-${index}.md`, '# text\n'] as const));
  const result = validateResourceSet(resources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.code === 'SNAPSHOT_FILE_LIMIT'));
  assert.equal(result.documents.size, 0);
});

test('virtual resource validation counts total bytes including unreachable files', () => {
  const bytes = new Uint8Array(10 * 1024 * 1024);
  const resources = new Map<string, Uint8Array | string>([['index.md', '# index\n']]);
  for (let index = 0; index < 10; index += 1) resources.set(`image-${index}.png`, bytes);
  const result = validateResourceSet(resources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.code === 'SNAPSHOT_SIZE_LIMIT'));
  assert.equal(result.documents.size, 0);
});
