import { assertPortablePath, caseFoldPath, PortablePathError } from '@learning-workspace/schemas/paths';
import { ValidationError } from './errors.js';

/**
 * Package path policy (spec §4.2): configuration and instruction files are
 * rejected at any depth, case-insensitively, and only allowlisted file
 * extensions are accepted. The policy inspects *paths only* — inert text that
 * merely mentions a blocked name (in Markdown prose, YAML strings or code
 * blocks) is content, not configuration, and is never rejected here.
 */

/**
 * Path segments blocked at any depth, compared with full Unicode case folding.
 * `.git` is transport metadata that the local importer drops at the repository
 * root before this check; nested `.git` directories (submodules) are rejected.
 */
export const BLOCKED_PACKAGE_SEGMENTS: readonly string[] = [
  '.git',
  '.gitmodules',
  '.gitattributes',
  '.opencode',
  '.obsidian',
  'AGENTS.md',
  'CLAUDE.md',
  'SKILL.md',
  'opencode.json',
  'opencode.jsonc',
];

/** Text formats (Markdown/YAML/license text) for v0.1 packages, compared case-insensitively. */
export const PACKAGE_TEXT_EXTENSIONS: readonly string[] = ['.md', '.yaml', '.yml', '.txt'];

/** Raster asset formats for v0.1 packages, compared case-insensitively. */
export const PACKAGE_ASSET_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];

/** Allowlisted file extensions for v0.1 packages (spec §4.2), compared case-insensitively. */
export const PACKAGE_FILE_EXTENSIONS: readonly string[] = [
  ...PACKAGE_TEXT_EXTENSIONS,
  ...PACKAGE_ASSET_EXTENSIONS,
];

const FOLDED_BLOCKED_SEGMENTS: ReadonlySet<string> = new Set<string>(
  BLOCKED_PACKAGE_SEGMENTS.map((segment) => caseFoldPath(segment)),
);
const FOLDED_EXTENSIONS: ReadonlySet<string> = new Set<string>(
  PACKAGE_FILE_EXTENSIONS.map((extension) => caseFoldPath(extension)),
);

/** Lowercased extension of a path (`'.md'`), or `''` for dotfiles and extensionless names. */
export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** `true` for Markdown/YAML/license-text files (strict UTF-8 text). */
export function isTextFile(path: string): boolean {
  return ['.md', '.yaml', '.yml', '.txt'].includes(fileExtension(path));
}

/** `true` for raster asset files (bytes, never decoded as text). */
export function isAssetFile(path: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(fileExtension(path));
}

/** `true` when the file is Markdown and must be analyzed as a CommonMark document. */
export function isMarkdownFile(path: string): boolean {
  return fileExtension(path) === '.md';
}

/**
 * Returns `true` when any segment of `path` is a blocked configuration or
 * instruction entry (`.opencode`, `.obsidian`, `AGENTS.md`, …), regardless of
 * case. Pure predicate: it never looks at file content.
 */
export function isBlockedPackagePath(path: string): boolean {
  for (const segment of path.split('/')) {
    if (FOLDED_BLOCKED_SEGMENTS.has(caseFoldPath(segment))) return true;
  }
  return false;
}

/**
 * Returns `true` when `path` has an allowlisted file extension (spec §4.2).
 * Dotfiles and extensionless names have no extension and are rejected.
 */
export function isAllowedPackageFilePath(path: string): boolean {
  const extension = fileExtension(path);
  if (extension === '') return false;
  return FOLDED_EXTENSIONS.has(caseFoldPath(extension));
}

/**
 * Validates a package file path: portable (spec §3.2.3), not a blocked
 * configuration entry, and with an allowlisted extension. Returns the same
 * string unchanged or throws {@link ValidationError} with codes
 * `INVALID_PATH`, `BLOCKED_PATH` or `EXTENSION_NOT_ALLOWED`.
 *
 * This checks paths only; whether file *content* is inert is decided by the
 * Markdown/YAML validators, not here.
 */
export function assertPackageFilePath(path: string): string {
  try {
    assertPortablePath(path);
  } catch (error) {
    if (error instanceof PortablePathError) throw new ValidationError('INVALID_PATH', error.message, path);
    throw error;
  }
  if (isBlockedPackagePath(path)) {
    throw new ValidationError('BLOCKED_PATH', `blocked configuration path in package: ${path}`, path);
  }
  if (!isAllowedPackageFilePath(path)) {
    throw new ValidationError(
      'EXTENSION_NOT_ALLOWED',
      `file extension is not in the v0.1 allowlist: ${path}`,
      path,
    );
  }
  return path;
}
