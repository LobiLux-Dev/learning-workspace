import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  MAX_ASSET_FILE_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_TEXT_FILE_BYTES,
  SNAPSHOT_DIGEST_ALGORITHM,
  SNAPSHOT_DIGEST_PREFIX,
  ValidationError,
  compareSnapshotPaths,
  computeSnapshotDigest,
  parseInventory,
  serializeInventory,
} from '../dist/index.js';
import type { InventoryRow, SnapshotEntry } from '../dist/index.js';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const fixture = (name: string): Uint8Array => readFileSync(new URL(`../../../fixtures/content/${name}`, import.meta.url));

const expectCode = (code: string, run: () => unknown): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ValidationError, String(error));
    assert.equal(error.code, code);
    return true;
  });
};

test('digest constants are literal', () => {
  assert.equal(SNAPSHOT_DIGEST_ALGORITHM, 'snapshot-sha256-v1');
  assert.equal(SNAPSHOT_DIGEST_PREFIX, 'learning-snapshot-v1\n');
  assert.equal(SNAPSHOT_DIGEST_PREFIX.charCodeAt(SNAPSHOT_DIGEST_PREFIX.length - 1), 0x0a);
});

test('vector 0: empty snapshot', () => {
  const result = computeSnapshotDigest([]);
  assert.equal(result.digest, '9c6a5a9b2f046c0a1f97def3e3879f6fcc20ba613988f7cbd0b19f8244374416');
  assert.equal(decode(result.canonicalInventory), '[]');
  assert.deepEqual(result.inventory, []);
  // the domain prefix really is hashed: digest of the inventory alone differs
  assert.notEqual(result.digest, sha256('[]'));
});

test('vector 1: single ASCII file', () => {
  const bytes = new TextEncoder().encode('hello\n');
  const result = computeSnapshotDigest([{ path: 'index.md', bytes }]);
  const canonical =
    '[{"path":"index.md","size":6,"sha256":"5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"}]';
  assert.equal(result.digest, 'ed7e0327da791baa6bf5cb29561bffbed18d6c0963d3e471689e05f3c4f5e503');
  assert.equal(decode(result.canonicalInventory), canonical);
  assert.deepEqual(result.inventory, [
    { path: 'index.md', size: 6, sha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03' },
  ]);
  // independent recomputation from the literal prefix
  assert.equal(result.digest, sha256(`learning-snapshot-v1\n${canonical}`));
});

test('vector 2: input order does not change the digest; CRLF and binary bytes are preserved', () => {
  const index = new TextEncoder().encode('# Índice\n');
  const crlf = fixture('digest/crlf.md');
  const png = fixture('mini/assets/circuito-01.png');

  // fixture bytes are exact: CRLF line endings, UTF-8 content
  assert.equal(crlf.length, 54);
  assert.equal(
    decode(crlf),
    '# Vector CRLF\r\n\r\nContenido UTF-8: Índice, Ohm × R.\r\n',
  );
  assert.ok(crlf.includes(0x0d));
  assert.equal(png.length, 70);
  assert.equal(sha256(png), '4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5');

  const entries: SnapshotEntry[] = [
    { path: 'resources/ohms-law.md', bytes: crlf },
    { path: 'assets/circuito-01.png', bytes: png },
    { path: 'index.md', bytes: index },
  ];
  const result = computeSnapshotDigest(entries);
  const canonical =
    '[{"path":"assets/circuito-01.png","size":70,"sha256":"4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5"},' +
    '{"path":"index.md","size":10,"sha256":"db48a003266f09ff3ecfdb7877ff9324e14ab558fbd699a7ccd12c02b5f18dfe"},' +
    '{"path":"resources/ohms-law.md","size":54,"sha256":"b60601910c0082197067fc7a9df6c73b12842b29fc8a160d049c20637d23300c"}]';
  assert.equal(result.digest, '839eed34700a1c4c552a283fe8ba59954293692da53785a5c1f4dbb8b08a9464');
  assert.equal(decode(result.canonicalInventory), canonical);

  const sizes = new Map(result.inventory.map((row) => [row.path, row.size]));
  assert.equal(sizes.get('resources/ohms-law.md'), 54); // bytes, CRLF untouched
  assert.equal(sizes.get('index.md'), 10); // UTF-8 bytes, not 9 characters

  // same bytes in any read order → same digest
  const reversed = computeSnapshotDigest([...entries].reverse());
  assert.equal(reversed.digest, result.digest);
  assert.equal(decode(reversed.canonicalInventory), canonical);
});

test('vector 3: NFC UTF-8 path and multibyte content', () => {
  const bytes = new TextEncoder().encode('V = I × R\n');
  const result = computeSnapshotDigest([{ path: 'recursos/óhmica.md', bytes }]);
  const canonical =
    '[{"path":"recursos/óhmica.md","size":11,"sha256":"e85eb61eb35bb9a2d094821f973b246f1a2015df373fb1f13bd4b6ec3b4dfb2a"}]';
  assert.equal(result.digest, 'dfd32bc5bf2005a2ae030efce37101964ae2a9ab77377a19f51c1b7c8ca55f80');
  assert.equal(decode(result.canonicalInventory), canonical);
  assert.equal(result.inventory[0]?.size, 11); // bytes, not the 10 UTF-16 code units
  // decomposed (NFD) variant of the same visible name is a different, invalid path
  expectCode('INVALID_PATH', () =>
    computeSnapshotDigest([{ path: 'recursos/o\u0301hmica.md', bytes }]),
  );
});

test('digest rejects duplicates, case-fold collisions and non-portable paths', () => {
  const bytes = new TextEncoder().encode('x\n');
  expectCode('PATH_COLLISION', () =>
    computeSnapshotDigest([
      { path: 'strasse.md', bytes },
      { path: 'straße.md', bytes },
    ]),
  );
  expectCode('PATH_COLLISION', () =>
    computeSnapshotDigest([
      { path: 'a.md', bytes },
      { path: 'a.md', bytes },
    ]),
  );
  expectCode('INVALID_PATH', () => computeSnapshotDigest([{ path: '../escape.md', bytes }]));
});

test('parseInventory accepts only exactly-keyed canonical rows', () => {
  const rows: unknown = JSON.parse(
    '[{"path":"index.md","size":6,"sha256":"5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"}]',
  );
  const parsed = parseInventory(rows);
  assert.deepEqual(parsed, computeSnapshotDigest([{ path: 'index.md', bytes: new TextEncoder().encode('hello\n') }]).inventory);
  // round trip is byte-exact
  assert.equal(decode(serializeInventory(parsed)), JSON.stringify(rows));

  const hex = '0'.repeat(64);
  expectCode('INVALID_INVENTORY', () => parseInventory('[]'));
  expectCode('INVALID_INVENTORY', () => parseInventory({}));
  expectCode('INVALID_INVENTORY', () => parseInventory([{}]));
  expectCode('INVALID_INVENTORY', () => parseInventory(['x']));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 1 }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 1, sha256: hex, mode: 0o644 }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 1.5, sha256: hex }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: -1, sha256: hex }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 2 ** 53, sha256: hex }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: '6', sha256: hex }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 1, sha256: ('abcdef0123456789'.repeat(4)).toUpperCase() }]));
  expectCode('INVALID_INVENTORY', () => parseInventory([{ path: 'a.md', size: 1, sha256: 'abc' }]));
  expectCode('INVALID_PATH', () => parseInventory([{ path: 'a/../b.md', size: 1, sha256: hex }]));
  expectCode('INVALID_INVENTORY', () =>
    parseInventory([
      { path: 'a.md', size: 1, sha256: hex },
      { path: 'b.md', size: 1, sha256: hex, extra: true },
    ]),
  );
  expectCode('PATH_COLLISION', () =>
    parseInventory([
      { path: 'strasse.md', size: 1, sha256: hex },
      { path: 'straße.md', size: 1, sha256: hex },
    ]),
  );
  expectCode('INVALID_INVENTORY_ORDER', () =>
    parseInventory([
      { path: 'b.md', size: 1, sha256: hex },
      { path: 'a.md', size: 1, sha256: hex },
    ]),
  );
});

test('serializeInventory emits exact canonical bytes and enforces order', () => {
  const hex = 'a'.repeat(64);
  const rows: InventoryRow[] = [
    { path: 'a.md', size: 3, sha256: hex },
    { path: 'sub/b.md', size: 4, sha256: hex },
  ];
  const bytes = serializeInventory(rows);
  assert.equal(decode(bytes), '[{"path":"a.md","size":3,"sha256":"' + hex + '"},{"path":"sub/b.md","size":4,"sha256":"' + hex + '"}]');
  assert.equal(bytes[bytes.length - 1], 0x5d); // ends with "]", no trailing newline
  expectCode('INVALID_INVENTORY_ORDER', () =>
    serializeInventory([
      { path: 'sub/b.md', size: 4, sha256: hex },
      { path: 'a.md', size: 3, sha256: hex },
    ]),
  );
});

test('path ordering follows UTF-8 bytes (code point order), not UTF-16 code units', () => {
  assert.ok(compareSnapshotPaths('B.md', 'a.md') < 0); // 0x42 < 0x61
  assert.ok(compareSnapshotPaths('z.md', 'ä.md') < 0); // 0x7A < 0xC3
  assert.ok(compareSnapshotPaths('ä.md', 'z.md') > 0);
  assert.equal(compareSnapshotPaths('a.md', 'a.md'), 0);
  // astral character (surrogate pair in UTF-16) must sort after U+E000, unlike code-unit comparison
  assert.ok(compareSnapshotPaths('x\uE000.md', 'x😀.md') < 0);
});

test('enforces the normative 2000-file limit before hashing', () => {
  const zero = new Uint8Array(0);
  const tooMany: SnapshotEntry[] = Array.from({ length: MAX_SNAPSHOT_FILES + 1 }, (_, index) => ({
    path: `f${index}.md`,
    bytes: zero,
  }));
  expectCode('SNAPSHOT_FILE_LIMIT', () => computeSnapshotDigest(tooMany));

  const atLimit: SnapshotEntry[] = Array.from({ length: MAX_SNAPSHOT_FILES }, (_, index) => ({
    path: `f${index}.md`,
    bytes: zero,
  }));
  const result = computeSnapshotDigest(atLimit);
  assert.equal(result.inventory.length, MAX_SNAPSHOT_FILES);

  const rows: unknown = Array.from({ length: MAX_SNAPSHOT_FILES + 1 }, (_, index) => ({
    path: `f${index}.md`,
    size: 0,
    sha256: '0'.repeat(64),
  }));
  expectCode('SNAPSHOT_FILE_LIMIT', () => parseInventory(rows));
});

test('enforces per-file size limits (2 MiB text, 10 MiB assets)', () => {
  expectCode('FILE_SIZE_LIMIT', () =>
    computeSnapshotDigest([{ path: 'big.md', bytes: new Uint8Array(MAX_TEXT_FILE_BYTES + 1) }]),
  );
  expectCode('FILE_SIZE_LIMIT', () =>
    computeSnapshotDigest([{ path: 'big.png', bytes: new Uint8Array(MAX_ASSET_FILE_BYTES + 1) }]),
  );
  // exactly at the limit is accepted
  const edge = computeSnapshotDigest([{ path: 'edge.md', bytes: new Uint8Array(MAX_TEXT_FILE_BYTES) }]);
  assert.equal(edge.inventory[0]?.size, MAX_TEXT_FILE_BYTES);
  // formats without a v0.1 per-file limit here are not rejected by the digest
  // (extension allowlisting is installer policy, not digest validation)
  const noLimit = computeSnapshotDigest([{ path: 'data.bin', bytes: new Uint8Array(MAX_TEXT_FILE_BYTES + 1) }]);
  assert.equal(noLimit.inventory[0]?.size, MAX_TEXT_FILE_BYTES + 1);
  // inventory form: same limits through parseInventory
  expectCode('FILE_SIZE_LIMIT', () =>
    parseInventory([{ path: 'big.md', size: MAX_TEXT_FILE_BYTES + 1, sha256: '0'.repeat(64) }]),
  );
});

test('enforces the normative 100 MiB total snapshot limit', () => {
  const chunk = 60 * 1024 * 1024;
  expectCode('SNAPSHOT_SIZE_LIMIT', () =>
    computeSnapshotDigest([
      { path: 'a.bin', bytes: new Uint8Array(chunk) },
      { path: 'b.bin', bytes: new Uint8Array(chunk) },
    ]),
  );
  expectCode('SNAPSHOT_SIZE_LIMIT', () =>
    parseInventory([
      { path: 'a.bin', size: chunk, sha256: '0'.repeat(64) },
      { path: 'b.bin', size: chunk, sha256: '0'.repeat(64) },
    ]),
  );
});
