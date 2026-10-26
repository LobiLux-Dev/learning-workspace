/**
 * Autoridad única de JSON canónico e inventario de snapshot (spec §3.2, §6.2).
 *
 * - JSON canónico RFC 8785 producido por `json-canonicalize` (la misma librería
 *   que Core), **precedido** de un guard estricto que la librería no hace:
 *   profundidad acotada, números finitos, strings y claves bien formados (sin
 *   surrogates sin pareja), arrays densos sin propiedades extra, objetos planos
 *   (prototipo `Object.prototype` o `null`), claves de prototipo rechazadas y
 *   símbolos/getters/no-enumerables rechazados **sin ejecutarlos**, ciclos
 *   rechazados. Los códigos `JSON_*` coinciden con los de Core para que su
 *   wrapper pueda delegar aquí sin cambiar su API pública.
 * - Inventario `{path,size,sha256}` con validación de metadatos (`validateInventoryEntries`),
 *   serialización con las claves exactas en ese orden y digest
 *   `SHA256(UTF8("learning-snapshot-v1\n") || inventory_bytes)`.
 *
 * No persiste ni evalúa mastery: solo transforma datos contractuales.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import {
  MAX_ASSET_BYTES,
  MAX_CANONICAL_JSON_DEPTH,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_TEXT_FILE_BYTES,
  SNAPSHOT_DIGEST_PREFIX,
} from './constants.js';
import { caseFoldPath, hasLoneSurrogate, portablePathProblem } from './paths.js';

/** Entrada de inventario de snapshot. `path` es relativa POSIX, UTF-8 NFC, ≤ 240 bytes. */
export type SnapshotInventoryEntry = {
  path: string;
  size: number;
  sha256: string;
};

/* ------------------------------------------------------------------ *
 * JSON canónico estricto
 * ------------------------------------------------------------------ */

export const CANONICAL_JSON_ERROR_CODES = [
  'JSON_ACCESSOR',
  'JSON_ARRAY_EXTRA_KEY',
  'JSON_ARRAY_HOLE',
  'JSON_ARRAY_PROTOTYPE',
  'JSON_BIGINT',
  'JSON_CYCLE',
  'JSON_FUNCTION',
  'JSON_LONE_SURROGATE',
  'JSON_NON_ENUMERABLE',
  'JSON_NON_FINITE',
  'JSON_NOT_PLAIN',
  'JSON_PROTO_KEY',
  'JSON_SYMBOL',
  'JSON_SYMBOL_KEY',
  'JSON_TOO_DEEP',
  'JSON_UNDEFINED',
] as const;

export type CanonicalJsonErrorCode = (typeof CANONICAL_JSON_ERROR_CODES)[number];

/**
 * Error de la autoridad canónica. `code` y `path` son estables: Core los
 * reutiliza tal cual en su fachada pública (CF05).
 */
export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;
  /** Ubicación legible del valor, p. ej. `$.items[3]`. */
  readonly path: string;

  constructor(code: CanonicalJsonErrorCode, path: string, detail: string) {
    super(`invalid JSON value at ${path}: ${detail}`);
    this.name = 'CanonicalJsonError';
    this.code = code;
    this.path = path;
  }
}

const PROTOTYPE_POLLUTION_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

function reject(code: CanonicalJsonErrorCode, path: string, detail: string): never {
  throw new CanonicalJsonError(code, path, detail);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateArray(value: unknown[], path: string, depth: number, seen: Set<object>): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    reject('JSON_ARRAY_PROTOTYPE', path, 'only plain arrays are accepted; subclassed or tampered array prototypes are rejected');
  }
  const symbols = Object.getOwnPropertySymbols(value);
  const firstSymbol = symbols[0];
  if (firstSymbol !== undefined) {
    reject('JSON_SYMBOL_KEY', path, `own symbol key ${String(firstSymbol)} would be silently dropped`);
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === 'length') continue;
    if (!/^(?:0|[1-9][0-9]*)$/.test(name) || !Number.isSafeInteger(Number(name)) || Number(name) >= value.length) {
      reject('JSON_ARRAY_EXTRA_KEY', path, `array has own property "${name}" beyond its indices`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      reject('JSON_ARRAY_HOLE', path, `array has a hole at index ${index}; holes would silently become null`);
    }
    if (!('value' in descriptor)) {
      reject('JSON_ACCESSOR', path, `array index ${index} is an accessor property; getters are never executed`);
    }
    if (!descriptor.enumerable) {
      reject('JSON_NON_ENUMERABLE', path, `array index ${index} is non-enumerable and would serialize differently`);
    }
    validateJson(descriptor.value, `${path}[${index}]`, depth + 1, seen);
  }
}

function validateContainer(value: object, path: string, depth: number, seen: Set<object>): void {
  if (seen.has(value)) reject('JSON_CYCLE', path, 'circular reference');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      validateArray(value, path, depth, seen);
      return;
    }
    if (!isPlainObject(value)) {
      reject('JSON_NOT_PLAIN', path, 'only plain objects, arrays and primitives are accepted');
    }
    const symbols = Object.getOwnPropertySymbols(value);
    const firstSymbol = symbols[0];
    if (firstSymbol !== undefined) {
      reject('JSON_SYMBOL_KEY', path, `own symbol key ${String(firstSymbol)} would be silently dropped`);
    }
    // Los descriptores se leen directamente: los getters se rechazan sin
    // invocarlos y las propiedades no enumerables se rechazan en vez de
    // descartarse en silencio.
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!('value' in descriptor)) {
        reject('JSON_ACCESSOR', path, `accessor property "${key}" is rejected; getters are never executed`);
      }
      if (!descriptor.enumerable) {
        reject('JSON_NON_ENUMERABLE', path, `non-enumerable property "${key}" would be silently dropped`);
      }
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
        reject('JSON_PROTO_KEY', path, `key "${key}" is rejected to prevent prototype pollution`);
      }
      if (hasLoneSurrogate(key)) {
        reject('JSON_LONE_SURROGATE', path, `object key contains an unpaired surrogate: ${JSON.stringify(key)}`);
      }
      validateJson(descriptor.value, `${path}.${key}`, depth + 1, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function validateJson(value: unknown, path: string, depth: number, seen: Set<object>): void {
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    reject('JSON_TOO_DEEP', path, `nesting exceeds ${MAX_CANONICAL_JSON_DEPTH} levels`);
  }
  if (value === null) return;
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) reject('JSON_LONE_SURROGATE', path, 'string contains an unpaired surrogate');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('JSON_NON_FINITE', path, `number is ${String(value)}`);
    return;
  }
  if (typeof value === 'boolean') return;
  if (typeof value === 'object') {
    validateContainer(value, path, depth, seen);
    return;
  }
  if (typeof value === 'undefined') reject('JSON_UNDEFINED', path, 'undefined is not JSON data');
  if (typeof value === 'bigint') reject('JSON_BIGINT', path, 'bigint is not JSON data');
  if (typeof value === 'symbol') reject('JSON_SYMBOL', path, 'symbols are not JSON data');
  reject('JSON_FUNCTION', path, 'functions are not JSON data');
}

/**
 * Comprueba que `value` es JSON estricto (ver cabecera) lanzando
 * {@link CanonicalJsonError}. Nunca ejecuta getters ni accede a símbolos.
 */
export function assertStrictJson(value: unknown): void {
  validateJson(value, '$', 0, new Set<object>());
}

/** `true` cuando `value` es JSON estricto aceptable por la autoridad. */
export function isStrictJson(value: unknown): boolean {
  try {
    assertStrictJson(value);
    return true;
  } catch (error) {
    if (error instanceof CanonicalJsonError) return false;
    throw error;
  }
}

/** SHA-256 en hex minúsculo de bytes o texto UTF-8. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Serializa un valor JSON a su forma canónica RFC 8785 usando
 * `json-canonicalize` **después** del guard estricto. Lanza
 * {@link CanonicalJsonError} con `code` y `path` estables.
 */
export function canonicalJson(value: unknown): string {
  assertStrictJson(value);
  return canonicalize(value);
}

/** Digest canónico RFC 8785 de un valor (hash de input de comando o de rúbrica). */
export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/* ------------------------------------------------------------------ *
 * Inventario de snapshot
 * ------------------------------------------------------------------ */

export const INVENTORY_ERROR_CODES = [
  'FILE_SIZE_LIMIT',
  'INVALID_INVENTORY',
  'INVALID_INVENTORY_ORDER',
  'INVALID_PATH',
  'PATH_COLLISION',
  'SNAPSHOT_FILE_LIMIT',
  'SNAPSHOT_SIZE_LIMIT',
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

/** Error de metadatos de inventario con `code` y `path` estables para Core. */
export class InventoryError extends Error {
  readonly code: InventoryErrorCode;
  /** `inventory`, `inventory[i]` o la ruta afectada. */
  readonly path: string;

  constructor(code: InventoryErrorCode, path: string, detail: string) {
    super(`${code} at ${path}: ${detail}`);
    this.name = 'InventoryError';
    this.code = code;
    this.path = path;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.yaml', '.yml', '.txt']);
const ASSET_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function fileExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

/** Límite por archivo de la norma §3.2, o `undefined` para formatos sin límite propio aquí. */
function fileByteLimit(path: string): number | undefined {
  const extension = fileExtension(path);
  if (TEXT_EXTENSIONS.has(extension)) return MAX_TEXT_FILE_BYTES;
  if (ASSET_EXTENSIONS.has(extension)) return MAX_ASSET_BYTES;
  return undefined;
}

function invalidInventory(where: string, detail: string): InventoryError {
  return new InventoryError('INVALID_INVENTORY', where, detail);
}

function toEntry(item: unknown, where: string): SnapshotInventoryEntry {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw invalidInventory(where, 'must be an object with exactly the keys path,size,sha256');
  }
  const keys = Reflect.ownKeys(item);
  if (keys.length !== 3 || keys.some((key) => typeof key !== 'string' || !['path', 'size', 'sha256'].includes(key))) {
    throw invalidInventory(where, 'must have exactly the own keys path,size,sha256');
  }
  const fields = new Map<string, unknown>();
  for (const key of ['path', 'size', 'sha256']) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw invalidInventory(where, 'inventory properties must be enumerable data properties, never accessors');
    }
    fields.set(key, descriptor.value);
  }
  if (fields.size !== 3 || !fields.has('path') || !fields.has('size') || !fields.has('sha256')) {
    const found = [...fields.keys()].sort().join(',') || 'none';
    throw invalidInventory(where, `must have exactly the keys path,size,sha256 (found: ${found})`);
  }
  const path = fields.get('path');
  const size = fields.get('size');
  const sha256 = fields.get('sha256');
  if (typeof path !== 'string') throw invalidInventory(where, 'field "path" must be a string');
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw invalidInventory(where, 'field "size" must be a non-negative safe integer (byte length)');
  }
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    throw invalidInventory(where, 'field "sha256" must be 64 lowercase hexadecimal characters');
  }
  const problem = portablePathProblem(path);
  if (problem !== null) throw new InventoryError('INVALID_PATH', path, problem);
  return { path, size, sha256 };
}

/**
 * Valida entradas de inventario sin ordenarlas: claves exactas
 * `path,size,sha256`, paths portables compartidos, sin duplicados ni colisiones
 * por case-fold Unicode, tamaños enteros seguros, límites normativos
 * (≤ 2000 archivos, ≤ 100 MiB en total, ≤ 2 MiB por texto y ≤ 10 MiB por asset)
 * y opcionalmente orden estricto por bytes UTF-8.
 *
 * El orden de entrada se **conserva** para que Core pueda exigir él mismo el
 * orden estricto de una carga (`requireSorted`).
 */
export function validateInventoryEntries(
  value: unknown,
  options: { requireSorted?: boolean } = {},
): readonly SnapshotInventoryEntry[] {
  if (!Array.isArray(value)) throw invalidInventory('inventory', 'must be an array');
  if (value.length > MAX_SNAPSHOT_FILES) {
    throw new InventoryError('SNAPSHOT_FILE_LIMIT', 'inventory', `snapshot exceeds the limit of ${MAX_SNAPSHOT_FILES} files: ${value.length}`);
  }

  const entries: SnapshotInventoryEntry[] = Array.from(value, (item, index) => toEntry(item, `inventory[${index}]`));
  enforceSnapshotLimits(entries);

  const folded = new Map<string, string>();
  for (const entry of entries) {
    const existing = folded.get(caseFoldPath(entry.path));
    if (existing !== undefined) {
      throw new InventoryError('PATH_COLLISION', entry.path, `collides with ${JSON.stringify(existing)} (duplicate or case-fold collision)`);
    }
    folded.set(caseFoldPath(entry.path), entry.path);
  }

  if (options.requireSorted === true) {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (previous === undefined || current === undefined) continue;
      if (compareUtf8Bytes(previous.path, current.path) >= 0) {
        throw new InventoryError(
          'INVALID_INVENTORY_ORDER',
          current.path,
          `inventory rows must be strictly sorted by UTF-8 bytes of path (row ${index})`,
        );
      }
    }
  }

  return Object.freeze(entries);
}

/** Shared quota precheck for metadata, byte inputs and virtual resource sets. */
export function enforceSnapshotLimits(rows: readonly { readonly path: string; readonly size: number }[]): void {
  if (rows.length > MAX_SNAPSHOT_FILES) {
    throw new InventoryError('SNAPSHOT_FILE_LIMIT', 'inventory', `snapshot exceeds ${MAX_SNAPSHOT_FILES} files`);
  }
  let total = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.size) || row.size < 0) throw invalidInventory(row.path, 'size must be a non-negative safe integer');
    const limit = fileByteLimit(row.path);
    if (limit !== undefined && row.size > limit) {
      throw new InventoryError('FILE_SIZE_LIMIT', row.path, `file exceeds the ${limit} byte limit for its format: ${row.size} bytes`);
    }
    total += row.size;
    if (total > MAX_SNAPSHOT_BYTES) {
      throw new InventoryError('SNAPSHOT_SIZE_LIMIT', 'inventory', `snapshot exceeds the ${MAX_SNAPSHOT_BYTES} byte (100 MiB) limit`);
    }
  }
}

/** Orden por bytes UTF-8 de `path` (spec §3.2.4), no por código UTF-16. */
export function compareUtf8Bytes(a: string, b: string): number {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] as number) - (right[i] as number);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/**
 * Serializa el inventario con las claves exactamente en orden `path,size,sha256`,
 * ordenado por bytes UTF-8 de `path`, JSON compacto y sin salto final.
 * Las dos lecturas de un mismo contenido producen idénticos bytes.
 */
export function inventoryBytes(entries: readonly SnapshotInventoryEntry[]): Buffer {
  const validated = validateInventoryEntries(entries);
  const sorted = [...validated].sort((a, b) => compareUtf8Bytes(a.path, b.path));
  const parts = sorted.map(
    (entry) =>
      `{"path":${JSON.stringify(entry.path)},"size":${String(entry.size)},"sha256":"${entry.sha256}"}`,
  );
  return Buffer.from(`[${parts.join(',')}]`, 'utf8');
}

/** `content_digest = SHA256(UTF8("learning-snapshot-v1\\n") || inventory_bytes)`. */
export function snapshotContentDigest(entries: readonly SnapshotInventoryEntry[]): string {
  const payload = Buffer.concat([Buffer.from(SNAPSHOT_DIGEST_PREFIX, 'utf8'), inventoryBytes(entries)]);
  return createHash('sha256').update(payload).digest('hex');
}
