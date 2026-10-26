import { caseFold } from 'unicode-case-folding';
import { z } from 'zod';

/**
 * Portable snapshot path rules (spec §3.2.3).
 *
 * A portable path is a relative POSIX path whose UTF-8 NFC encoding is at most
 * {@link MAX_PORTABLE_PATH_BYTES} bytes and whose segments:
 *
 * - contain no control characters and none of `:`, `\`, `%`, `<`, `>`, `"`,
 *   `|`, `?`, `*` (Windows forbids these in file names);
 * - are not empty, `.`, `..`, and do not end with a dot or a space;
 * - do not have a basename that ends with a space before the extension
 *   (`NUL .txt` normalizes to the reserved `NUL` device on Windows);
 * - are not Windows reserved device names: `CON`, `PRN`, `AUX`, `NUL`,
 *   `COM1`–`COM9`, `LPT1`–`LPT9`, the superscript forms `COM¹`–`COM³` /
 *   `LPT¹`–`LPT³`, and `CONIN$` / `CONOUT$`, with or without extension.
 *
 * Case-fold collisions between *different* paths are rejected separately by
 * {@link assertNoPortablePathCollisions} using full Unicode case folding (never
 * `String.prototype.toLowerCase`). Names that are not NFC are rejected first,
 * as `INVALID_PATH`, before any collision logic runs — e.g. a raw U+212A
 * KELVIN SIGN is not NFC (its NFC form is `K`).
 */

/** Maximum length of a portable relative path, in UTF-8 bytes (spec §3.2.3). */
export const MAX_PORTABLE_PATH_BYTES = 240;

/** Windows device names reserved at the start of a segment, before any extension. */
const WINDOWS_RESERVED_BASENAMES: readonly string[] = [
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
  // Superscript digit forms (U+00B9/U+00B2/U+00B3) do NOT case-fold to ASCII
  // digits, so they must be listed explicitly.
  'com¹',
  'com²',
  'com³',
  'lpt¹',
  'lpt²',
  'lpt³',
  'conin$',
  'conout$',
];

const FOLDED_WINDOWS_RESERVED_BASENAMES: ReadonlySet<string> = new Set<string>(
  WINDOWS_RESERVED_BASENAMES.map((name) => caseFold(name)),
);

/** Thrown by {@link assertPortablePath} for a single invalid path. */
export class PortablePathError extends Error {
  readonly code = 'INVALID_PORTABLE_PATH';
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`invalid portable path ${JSON.stringify(path)}: ${reason}`);
    this.name = 'PortablePathError';
    this.path = path;
    this.reason = reason;
  }
}

/** Thrown by {@link assertNoPortablePathCollisions} for duplicates or case-fold collisions. */
export class PortablePathCollisionError extends Error {
  readonly code = 'PORTABLE_PATH_COLLISION';
  readonly path: string;
  readonly conflictingPath: string;
  /** `true` when both entries are the exact same string (duplicate path). */
  readonly duplicate: boolean;

  constructor(path: string, conflictingPath: string, duplicate: boolean) {
    super(
      duplicate
        ? `duplicate path ${JSON.stringify(path)}`
        : `paths ${JSON.stringify(path)} and ${JSON.stringify(conflictingPath)} collide under Unicode full case folding`,
    );
    this.name = 'PortablePathCollisionError';
    this.path = path;
    this.conflictingPath = conflictingPath;
    this.duplicate = duplicate;
  }
}

/**
 * Returns `true` when `value` contains an unpaired UTF-16 surrogate, which
 * cannot be encoded as valid UTF-8.
 */
export function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isControlCharacter(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * `'path'` enforces every rule (used for inventory/API paths);
 * `'destination'` skips only empty/`.`/`..` segments, because link
 * destinations are normalized before they become real paths (spec §5.3).
 */
type PathMode = 'path' | 'destination';

function pathProblem(path: string, mode: PathMode): string | null {
  if (path.length === 0) return 'path is empty';
  if (hasLoneSurrogate(path)) return 'path contains an unpaired surrogate and is not valid UTF-8';
  if (path.normalize('NFC') !== path) return 'path must be normalized as UTF-8 NFC';
  if (Buffer.byteLength(path, 'utf8') > MAX_PORTABLE_PATH_BYTES) {
    return `path exceeds ${MAX_PORTABLE_PATH_BYTES} UTF-8 bytes`;
  }
  if (path.startsWith('/')) return 'absolute paths are not allowed';

  const segments = path.split('/');
  for (let position = 0; position < segments.length; position += 1) {
    const segment = segments[position] ?? '';
    if (segment.length === 0) {
      if (mode === 'path') return `empty segment at position ${position}`;
      continue;
    }
    if (segment === '.' || segment === '..') {
      if (mode === 'path') return `"${segment}" segments are not allowed`;
      continue;
    }
    for (let index = 0; index < segment.length; index += 1) {
      const code = segment.charCodeAt(index);
      if (isControlCharacter(code)) return 'segment contains a control character';
      if (code === 0x3a) return 'segment contains ":"';
      if (code === 0x5c) return 'segment contains "\\\\"';
      if (code === 0x25) return 'segment contains "%"';
      if (code === 0x3c) return 'segment contains "<"';
      if (code === 0x3e) return 'segment contains ">"';
      if (code === 0x22) return 'segment contains quote marks';
      if (code === 0x7c) return 'segment contains "|"';
      if (code === 0x3f) return 'segment contains "?"';
      if (code === 0x2a) return 'segment contains "*"';
    }
    const last = segment.charAt(segment.length - 1);
    if (last === '.' || last === ' ') return 'segment must not end with a dot or a space';
    const dot = segment.indexOf('.');
    const rawBasename = dot === -1 ? segment : segment.slice(0, dot);
    const trimmedBasename = rawBasename.replace(/ +$/u, '');
    if (FOLDED_WINDOWS_RESERVED_BASENAMES.has(caseFold(trimmedBasename))) {
      return 'segment is a Windows reserved device name';
    }
    if (trimmedBasename !== rawBasename) {
      return 'segment basename must not end with a space before the extension';
    }
  }
  return null;
}

/**
 * Returns `null` when `path` satisfies every portable-path rule, otherwise a
 * human-readable reason. Pure: it never touches the filesystem.
 */
export function portablePathProblem(path: string): string | null {
  return pathProblem(path, 'path');
}

/**
 * Like {@link portablePathProblem} but tolerates `.`/`..`/empty segments, for
 * validating a *decoded link destination before it is resolved* (spec §5.3):
 * normalization removes them, while absolute targets, denied characters and
 * non-NFC names must already fail here.
 */
export function portableDestinationProblem(path: string): string | null {
  return pathProblem(path, 'destination');
}

/**
 * Zod schema for a portable relative path (spec §3.2.3). Prefer
 * {@link portablePathProblem} when you need the precise rejection reason.
 */
export const portablePathSchema = z.string().refine(
  (value) => portablePathProblem(value) === null,
  'must be a portable relative POSIX path: UTF-8 NFC, at most 240 bytes, no control characters and none of ": \\ % < > " | ? *", no empty/./.. segments, no trailing dot or space, no space before an extension, no Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, COM¹-³, LPT¹-³, CONIN$, CONOUT$)',
);

/**
 * Asserts that `path` is portable, returning the same string unchanged.
 * Throws {@link PortablePathError} otherwise.
 */
export function assertPortablePath(path: string): string {
  const problem = portablePathProblem(path);
  if (problem !== null) throw new PortablePathError(path, problem);
  return path;
}

/**
 * Asserts that no two entries of `paths` are the same string and that no two
 * distinct entries collide under full Unicode case folding (spec §3.2.3).
 * Every entry is revalidated as a portable path first — so non-NFC names fail
 * with {@link PortablePathError} before collisions are ever considered.
 * Throws {@link PortablePathError} or {@link PortablePathCollisionError}.
 */
export function assertNoPortablePathCollisions(paths: readonly string[]): void {
  const folded = new Map<string, string>();
  for (const path of paths) {
    assertPortablePath(path);
    const key = caseFoldPath(path);
    const existing = folded.get(key);
    if (existing !== undefined) {
      throw new PortablePathCollisionError(existing, path, existing === path);
    }
    folded.set(key, path);
  }
}

/**
 * Applies full Unicode case folding to `path` (spec §3.2.3 collision rule).
 * This is `unicode-case-folding`, not `String.prototype.toLowerCase`: for
 * example `caseFoldPath('Straße.md') === 'strasse.md'`. Note that full folding
 * does *not* map superscript digits to ASCII digits (`'¹'` folds to `'¹'`).
 */
export function caseFoldPath(path: string): string {
  return caseFold(path);
}
