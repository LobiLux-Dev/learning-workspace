/**
 * Digestos canónicos §3.2 y §6.2 con la autoridad única de `canonical.ts`:
 * guard estricto (`JSON_*`), `json-canonicalize` y metadatos de inventario.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CANONICAL_JSON_ERROR_CODES,
  canonicalDigest,
  canonicalJson,
  CanonicalJsonError,
  compareUtf8Bytes,
  INVENTORY_ERROR_CODES,
  inventoryBytes,
  InventoryError,
  sha256Hex,
  snapshotContentDigest,
  validateInventoryEntries,
  type CanonicalJsonErrorCode,
  type InventoryErrorCode,
  type SnapshotInventoryEntry,
} from '../dist/index.js';
import { fixturesDir, readFixture, readFixtureJson } from './helpers.ts';

type CanonicalVector = { name: string; input: unknown; expected: string };

function rejection(fn: () => unknown): { code: CanonicalJsonErrorCode; path: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof CanonicalJsonError) return { code: error.code, path: error.path };
    throw error;
  }
  throw new Error('expected a CanonicalJsonError');
}

function inventoryRejection(fn: () => unknown): { code: InventoryErrorCode; path: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof InventoryError) return { code: error.code, path: error.path };
    throw error;
  }
  throw new Error('expected an InventoryError');
}

test('JSON canónico RFC 8785 contra los vectores publicados', () => {
  const vectors = readFixtureJson<CanonicalVector[]>('vectors/canonical-vectors.json');
  assert.ok(vectors.length >= 8);
  for (const vector of vectors) {
    assert.equal(canonicalJson(vector.input), vector.expected, `vector: ${vector.name}`);
  }
});

test('el guard estricto rechaza todo lo que no es JSON con código y path estables', () => {
  assert.deepEqual(rejection(() => canonicalJson('\ud800')), { code: 'JSON_LONE_SURROGATE', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(JSON.parse('{"\\ud800": 1}'))), {
    code: 'JSON_LONE_SURROGATE',
    path: '$',
  });
  assert.deepEqual(rejection(() => canonicalJson(Number.NaN)), { code: 'JSON_NON_FINITE', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(Infinity)), { code: 'JSON_NON_FINITE', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(undefined)), { code: 'JSON_UNDEFINED', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(new Date('2026-10-25T00:00:00.000Z'))), {
    code: 'JSON_NOT_PLAIN',
    path: '$',
  });
  assert.deepEqual(rejection(() => canonicalJson(new RegExp('no-json'))), { code: 'JSON_NOT_PLAIN', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson({ value: undefined })), { code: 'JSON_UNDEFINED', path: '$.value' });
  assert.deepEqual(rejection(() => canonicalJson([undefined])), { code: 'JSON_UNDEFINED', path: '$[0]' });
  assert.deepEqual(rejection(() => canonicalJson(10n)), { code: 'JSON_BIGINT', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(Symbol('s'))), { code: 'JSON_SYMBOL', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson(() => 1)), { code: 'JSON_FUNCTION', path: '$' });
  assert.deepEqual(rejection(() => canonicalJson({ a: Number.POSITIVE_INFINITY })), {
    code: 'JSON_NON_FINITE',
    path: '$.a',
  });

  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.deepEqual(rejection(() => canonicalJson(cyclic)), { code: 'JSON_CYCLE', path: '$.self' });

  let deep: unknown = 'leaf';
  for (let index = 0; index < 500; index += 1) deep = [deep];
  const tooDeep = rejection(() => canonicalJson(deep));
  assert.equal(tooDeep.code, 'JSON_TOO_DEEP');
  assert.match(tooDeep.path, /^\$(\[\d+\])+$/);

  assert.deepEqual(rejection(() => canonicalJson(JSON.parse('{"__proto__": {"x": 1}}'))), {
    code: 'JSON_PROTO_KEY',
    path: '$',
  });

  const symbolKey: Record<string, unknown> = { ok: 1 };
  Object.defineProperty(symbolKey, Symbol('hidden'), { value: 2, enumerable: true });
  assert.deepEqual(rejection(() => canonicalJson(symbolKey)), { code: 'JSON_SYMBOL_KEY', path: '$' });

  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, 'hidden', { value: 1, enumerable: false });
  assert.deepEqual(rejection(() => canonicalJson(nonEnumerable)), { code: 'JSON_NON_ENUMERABLE', path: '$' });

  const hole: unknown[] = [1];
  hole.length = 3;
  assert.deepEqual(rejection(() => canonicalJson(hole)), { code: 'JSON_ARRAY_HOLE', path: '$' });

  const extra: unknown[] = [1];
  (extra as unknown as Record<string, unknown>)['extra'] = 2;
  assert.deepEqual(rejection(() => canonicalJson(extra)), { code: 'JSON_ARRAY_EXTRA_KEY', path: '$' });

  class SubArray extends Array<number> {}
  assert.deepEqual(rejection(() => canonicalJson(new SubArray(1, 2))), {
    code: 'JSON_ARRAY_PROTOTYPE',
    path: '$',
  });

  // Los getters se rechazan sin ejecutarlos jamás.
  let invoked = false;
  const withGetter = {
    get boom(): number {
      invoked = true;
      return 1;
    },
  };
  assert.deepEqual(rejection(() => canonicalJson(withGetter)), { code: 'JSON_ACCESSOR', path: '$' });
  assert.equal(invoked, false, 'el getter no se ejecutó');
});

test('acepta exactamente JSON: planos, prototipo nulo y valores compartidos', () => {
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson(-0), '0');
  assert.equal(canonicalJson([true, 'á', 1e30]), '[true,"á",1e+30]');
  const nullPrototype = Object.assign(Object.create(null) as object, { b: 1, a: 2 });
  assert.equal(canonicalJson(nullPrototype), '{"a":2,"b":1}');
  const shared = { x: 1 };
  assert.equal(canonicalJson({ first: shared, second: shared }), '{"first":{"x":1},"second":{"x":1}}');
  assert.equal(canonicalDigest({ a: 1 }), sha256Hex(canonicalJson({ a: 1 })));
});

test('validateInventoryEntries valida metadatos y conserva el orden de entrada', () => {
  const rows: Array<Record<string, unknown>> = [
    { path: 'z.md', size: 1, sha256: 'a'.repeat(64) },
    { path: 'a.md', size: 2, sha256: 'b'.repeat(64) },
    { path: 'm.md', size: 3, sha256: 'c'.repeat(64) },
  ];
  const validated = validateInventoryEntries(rows);
  assert.deepEqual(
    validated.map((row) => row.path),
    ['z.md', 'a.md', 'm.md'],
    'el orden original se conserva para que Core exija él el orden estricto',
  );
  // ... pero con requireSorted se puede exigir orden canónico.
  assert.equal(inventoryRejection(() => validateInventoryEntries(rows, { requireSorted: true })).code, 'INVALID_INVENTORY_ORDER');
  assert.deepEqual(
    validateInventoryEntries(rows, { requireSorted: false }).map((row) => row.path),
    ['z.md', 'a.md', 'm.md'],
  );

  const exact: SnapshotInventoryEntry = { path: 'index.md', size: 0, sha256: '0'.repeat(64) };
  assert.equal(inventoryRejection(() => validateInventoryEntries([exact, { ...exact, extra: 'x' }])).code, 'INVALID_INVENTORY');
  assert.equal(inventoryRejection(() => validateInventoryEntries('nope')).code, 'INVALID_INVENTORY');
  assert.equal(inventoryRejection(() => validateInventoryEntries([null])).code, 'INVALID_INVENTORY');
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, path: 42 }])).code, 'INVALID_INVENTORY');
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, size: -1 }])).code, 'INVALID_INVENTORY');
  assert.equal(
    inventoryRejection(() => validateInventoryEntries([{ ...exact, size: Number.MAX_SAFE_INTEGER + 1 }])).code,
    'INVALID_INVENTORY',
  );
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, sha256: 'ABC' }])).code, 'INVALID_INVENTORY');
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, path: '' }])).code, 'INVALID_PATH');
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, path: '../escape.md' }])).code, 'INVALID_PATH');
  assert.equal(inventoryRejection(() => validateInventoryEntries([{ ...exact, path: '/absolute.md' }])).code, 'INVALID_PATH');
  assert.equal(
    inventoryRejection(() => validateInventoryEntries([{ ...exact, path: 'o\u0301hmica.md' }])).code,
    'INVALID_PATH',
    'paths en NFD no son portables',
  );
  assert.equal(inventoryRejection(() => validateInventoryEntries([exact, exact])).code, 'PATH_COLLISION');
  assert.equal(
    inventoryRejection(() =>
      validateInventoryEntries([
        { ...exact, path: 'strasse.md' },
        { ...exact, path: 'straße.md' },
      ]),
    ).code,
    'PATH_COLLISION',
    'case-fold Unicode',
  );
});

test('validateInventoryEntries aplica los límites normativos de §3.2', () => {
  const many = Array.from({ length: 2001 }, (_, index) => ({
    path: `f${index}.md`,
    size: 0,
    sha256: '0'.repeat(64),
  }));
  assert.equal(inventoryRejection(() => validateInventoryEntries(many)).code, 'SNAPSHOT_FILE_LIMIT');

  const bigText: SnapshotInventoryEntry = { path: 'big.md', size: 2 * 1024 * 1024 + 1, sha256: '0'.repeat(64) };
  assert.equal(inventoryRejection(() => validateInventoryEntries([bigText])).code, 'FILE_SIZE_LIMIT');
  const bigImage: SnapshotInventoryEntry = { path: 'big.png', size: 10 * 1024 * 1024 + 1, sha256: '0'.repeat(64) };
  assert.equal(inventoryRejection(() => validateInventoryEntries([bigImage])).code, 'FILE_SIZE_LIMIT');
  const okText: SnapshotInventoryEntry = { path: 'ok.md', size: 2 * 1024 * 1024, sha256: '0'.repeat(64) };
  assert.equal(validateInventoryEntries([okText]).length, 1, 'exactamente en el límite');

  // Formatos sin límite propio aquí: solo mandan recuento y total.
  const unknownFormat: SnapshotInventoryEntry = { path: 'data.bin', size: 30 * 1024 * 1024, sha256: '0'.repeat(64) };
  assert.equal(validateInventoryEntries([unknownFormat]).length, 1);

  const total: SnapshotInventoryEntry[] = Array.from({ length: 5 }, (_, index) => ({
    path: `blob-${index}.bin`,
    size: 21 * 1024 * 1024,
    sha256: '0'.repeat(64),
  }));
  assert.equal(inventoryRejection(() => validateInventoryEntries(total)).code, 'SNAPSHOT_SIZE_LIMIT');
});

test('inventoryBytes ordena solo por bytes UTF-8 y serializa claves exactas', () => {
  const raw = readFixture('vectors/snapshot-inventory.json');
  const inventory = JSON.parse(raw) as SnapshotInventoryEntry[];
  assert.ok(inventory.length >= 5);

  const bytes = inventoryBytes(inventory);
  assert.equal(bytes.toString('utf8'), raw, 'bytes idénticos a los publicados');

  const shuffled = [...inventory].reverse();
  assert.equal(inventoryBytes(shuffled).toString('utf8'), raw);
  assert.equal(snapshotContentDigest(shuffled), snapshotContentDigest(inventory));

  assert.ok(compareUtf8Bytes('a.md', 'b.md') < 0);
  assert.ok(compareUtf8Bytes('Z.md', 'a.md') < 0, 'Z (0x5A) < a (0x61) en bytes');
  assert.ok(compareUtf8Bytes('é.md', 'z.md') > 0);
  assert.equal(compareUtf8Bytes('a', 'a'), 0);

  // Lo que no puede entrar por metadatos tampoco puede serializarse.
  assert.throws(() => inventoryBytes([{ path: '../x.md', size: 0, sha256: '0'.repeat(64) }]), InventoryError);
  const withExtra = { path: 'a.md', size: 0, sha256: '0'.repeat(64), extra: 1 } as unknown as SnapshotInventoryEntry;
  assert.throws(() => inventoryBytes([withExtra]), InventoryError);
});

test('content_digest coincide con el valor calculado con sha256sum', () => {
  const vector = readFixtureJson<{
    prefix: string;
    inventoryBytesUtf8: string;
    expectedContentDigest: string;
    inventory: SnapshotInventoryEntry[];
  }>('vectors/snapshot-digest.json');

  assert.equal(vector.prefix, 'learning-snapshot-v1\n');
  assert.equal(
    sha256Hex(`${vector.prefix}${vector.inventoryBytesUtf8}`),
    vector.expectedContentDigest,
    'el prefijo + inventario publicado producen el digest esperado',
  );
  assert.equal(snapshotContentDigest(vector.inventory), vector.expectedContentDigest);
  assert.equal(inventoryBytes(vector.inventory).toString('utf8'), vector.inventoryBytesUtf8);
});

test('el inventario publicado describe realmente los bytes del fixture', () => {
  const vector = readFixtureJson<{ inventory: SnapshotInventoryEntry[] }>('vectors/snapshot-digest.json');
  for (const entry of vector.inventory) {
    const file = path.join(fixturesDir, 'notebooks/electronics', entry.path);
    const bytes = readFileSync(file);
    assert.equal(bytes.length, entry.size, `tamaño real de ${entry.path}`);
    assert.equal(sha256Hex(bytes), entry.sha256, `hash real de ${entry.path}`);
  }
});

test('los códigos exportados de ambas autoridades son estables', () => {
  const canonicalCodes: readonly string[] = CANONICAL_JSON_ERROR_CODES;
  for (const code of [
    'JSON_CYCLE',
    'JSON_NOT_PLAIN',
    'JSON_PROTO_KEY',
    'JSON_TOO_DEEP',
    'JSON_LONE_SURROGATE',
    'JSON_NON_FINITE',
    'JSON_UNDEFINED',
    'JSON_BIGINT',
    'JSON_SYMBOL',
    'JSON_FUNCTION',
    'JSON_ACCESSOR',
    'JSON_NON_ENUMERABLE',
    'JSON_ARRAY_HOLE',
  ]) {
    assert.ok(canonicalCodes.includes(code), `${code} debe seguir siendo código estable`);
  }
  const inventoryCodes: readonly string[] = INVENTORY_ERROR_CODES;
  for (const code of ['INVALID_INVENTORY', 'INVALID_PATH', 'PATH_COLLISION', 'SNAPSHOT_FILE_LIMIT', 'FILE_SIZE_LIMIT', 'SNAPSHOT_SIZE_LIMIT']) {
    assert.ok(inventoryCodes.includes(code), `${code} debe seguir siendo código estable`);
  }
});

test('snapshotContentDigest coincide con los vectores publicados por Python', () => {
  const vectors: Array<{ entries: Array<{ path: string; bytes: string }>; expected: string }> = [
    { entries: [], expected: '9c6a5a9b2f046c0a1f97def3e3879f6fcc20ba613988f7cbd0b19f8244374416' },
    {
      entries: [
        { path: 'resources/ohms-law.md', bytes: '# Ohm\r\nV = I * R\r\n' },
        { path: 'index.md', bytes: '# Electronics\n' },
      ],
      expected: 'c76c8820b0dd997ef5e0521559293a1ac56de7b179f1008b63f54a3a59844bee',
    },
    {
      entries: [
        { path: 'resources/ley-de-Ohm.md', bytes: '# Ley de Ohm\nTensión = corriente × resistencia\n' },
        { path: 'índice.md', bytes: '# Electrónica\n' },
      ],
      expected: '423daf9633f069fc92d9b54751b231a63d1ffa2d46fd62bf5a2e514fb0f981c4',
    },
  ];
  for (const vector of vectors) {
    const entries = vector.entries.map((entry) => ({
      path: entry.path,
      size: Buffer.byteLength(entry.bytes, 'utf8'),
      sha256: sha256Hex(entry.bytes),
    }));
    assert.equal(snapshotContentDigest(entries), vector.expected, vector.entries.map((entry) => entry.path).join(','));
    // ... y el orden de llegada no cambia el resultado.
    assert.equal(snapshotContentDigest([...entries].reverse()), vector.expected);
  }
});
