import {
  compareUtf8Bytes,
  enforceSnapshotLimits,
  inventoryBytes,
  InventoryError,
  sha256Hex,
  snapshotContentDigest,
  validateInventoryEntries,
} from '@learning-workspace/schemas/canonical';
import {
  MAX_ASSET_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_TEXT_FILE_BYTES,
  SNAPSHOT_DIGEST_ALGORITHM,
  SNAPSHOT_DIGEST_PREFIX,
} from '@learning-workspace/schemas/constants';
import { ValidationError } from './errors.js';

export {
  MAX_ASSET_BYTES as MAX_ASSET_FILE_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_TEXT_FILE_BYTES,
  SNAPSHOT_DIGEST_ALGORITHM,
  SNAPSHOT_DIGEST_PREFIX,
};

export interface SnapshotEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}
export interface InventoryRow {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}
export interface SnapshotDigest {
  readonly digest: string;
  readonly inventory: readonly InventoryRow[];
  readonly canonicalInventory: Uint8Array;
}

function adapt<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof InventoryError) throw new ValidationError(error.code, error.message, error.path);
    throw error;
  }
}

export function compareSnapshotPaths(a: string, b: string): number {
  return compareUtf8Bytes(a, b);
}

/** Quotas run before hashing/decoding; the same authority serves every F0 entry point. */
export function enforceInventoryLimits(rows: readonly { readonly path: string; readonly size: number }[]): void {
  adapt(() => enforceSnapshotLimits(rows));
}

/** Loading an inventory requires its existing canonical order, never silent repair. */
export function parseInventory(value: unknown): readonly InventoryRow[] {
  return adapt(() => Object.freeze(validateInventoryEntries(value, { requireSorted: true }).map((row) => Object.freeze({ ...row }))));
}

export function serializeInventory(rows: readonly InventoryRow[]): Uint8Array {
  return adapt(() => inventoryBytes(validateInventoryEntries(rows, { requireSorted: true })));
}

/** Pure byte hashing. It does not install, publish, validate image signatures or persist anything. */
export function computeSnapshotDigest(entries: readonly SnapshotEntry[]): SnapshotDigest {
  if (!Array.isArray(entries)) throw new ValidationError('INVALID_ENTRY', 'entries must be an array');
  if (entries.length > MAX_SNAPSHOT_FILES) throw new ValidationError('SNAPSHOT_FILE_LIMIT', `snapshot exceeds ${MAX_SNAPSHOT_FILES} files`);
  const checked = Array.from(entries, (entry) => {
    if (typeof entry !== 'object' || entry === null || typeof entry.path !== 'string' || !(entry.bytes instanceof Uint8Array)) {
      throw new ValidationError('INVALID_ENTRY', 'each entry must contain a path string and Uint8Array bytes');
    }
    return entry;
  });
  enforceInventoryLimits(checked.map((entry) => ({ path: entry.path, size: entry.bytes.byteLength })));
  return adapt(() => {
    const rows = checked.map((entry) => ({ path: entry.path, size: entry.bytes.byteLength, sha256: sha256Hex(entry.bytes) }));
    rows.sort((a, b) => compareSnapshotPaths(a.path, b.path));
    const inventory = parseInventory(rows);
    return Object.freeze({
      digest: snapshotContentDigest(inventory),
      inventory,
      canonicalInventory: inventoryBytes(inventory),
    });
  });
}
