import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson, computeSnapshotDigest, parseInventory } from '@learning-workspace/core';
import { canonicalJson, inventoryBytes, snapshotContentDigest } from '@learning-workspace/schemas';

test('snapshot APIs match independently computed Python vectors, including UTF8 and CRLF', () => {
  const vectors = [
    {
      entries: [],
      expected: '9c6a5a9b2f046c0a1f97def3e3879f6fcc20ba613988f7cbd0b19f8244374416',
    },
    {
      entries: [
        { path: 'resources/ohms-law.md', bytes: Buffer.from('# Ohm\r\nV = I * R\r\n') },
        { path: 'index.md', bytes: Buffer.from('# Electronics\n') },
      ],
      expected: 'c76c8820b0dd997ef5e0521559293a1ac56de7b179f1008b63f54a3a59844bee',
    },
    {
      entries: [
        { path: 'resources/ley-de-Ohm.md', bytes: Buffer.from('# Ley de Ohm\nTensión = corriente × resistencia\n') },
        { path: 'índice.md', bytes: Buffer.from('# Electrónica\n') },
      ],
      expected: '423daf9633f069fc92d9b54751b231a63d1ffa2d46fd62bf5a2e514fb0f981c4',
    },
  ];
  for (const { entries, expected } of vectors) {
    const snapshot = computeSnapshotDigest(entries);
    assert.equal(snapshot.digest, expected);
    assert.equal(snapshotContentDigest(snapshot.inventory), expected);
    assert.deepEqual(Buffer.from(inventoryBytes(snapshot.inventory)), Buffer.from(snapshot.canonicalInventory));
  }
});

test('schemas and core cannot disagree on invalid inventory metadata', () => {
  const row = { path: 'index.md', size: 0, sha256: '0'.repeat(64) };
  const invalidRows = [
    [{ ...row, path: '../escape.md' }],
    [{ ...row, path: '/absolute.md' }],
    [{ ...row, path: 'o\u0301hmica.md' }],
    [{ ...row, size: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...row, extra: 'must-not-be-ignored' }],
    [row, row],
    [{ ...row, path: 'strasse.md' }, { ...row, path: 'straße.md' }],
  ];
  for (const rows of invalidRows) {
    assert.throws(() => parseInventory(rows));
    assert.throws(() => inventoryBytes(rows));
    assert.throws(() => snapshotContentDigest(rows));
  }
});

test('schemas and core use compatible strict RFC8785 canonicalization', () => {
  const valid = [null, 0, -0, [true, 'á', 1e30], { z: 1, a: { value: 'e\u0301' } }];
  for (const value of valid) assert.equal(canonicalJson(value), canonicalizeJson(value));
  const numericArrayExtra = [1];
  Object.defineProperty(numericArrayExtra, '4294967295', { value: 2, enumerable: true });
  const invalid = [
    numericArrayExtra,
    '\ud800',
    JSON.parse('{"\\ud800":1}') as unknown,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
    new Date('2026-10-25T00:00:00.000Z'),
    new RegExp('not-json'),
    { value: undefined },
  ];
  for (const value of invalid) {
    assert.throws(() => canonicalJson(value));
    assert.throws(() => canonicalizeJson(value));
  }
});
