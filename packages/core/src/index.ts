/**
 * `@learning-workspace/core` — pure domain validators for F0: portable path
 * rules, the `snapshot-sha256-v1` digest, package path policy, RFC 8785
 * canonical JSON, CommonMark AST analysis and virtual resource closure
 * validation. No database, no filesystem writes, no network access.
 */

export { ValidationError } from './errors.js';

export {
  SNAPSHOT_DIGEST_ALGORITHM,
  SNAPSHOT_DIGEST_PREFIX,
  MAX_SNAPSHOT_FILES,
  MAX_SNAPSHOT_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_ASSET_FILE_BYTES,
  compareSnapshotPaths,
  computeSnapshotDigest,
  parseInventory,
  serializeInventory,
} from './digest.js';
export type { InventoryRow, SnapshotDigest, SnapshotEntry } from './digest.js';

export {
  BLOCKED_PACKAGE_SEGMENTS,
  PACKAGE_FILE_EXTENSIONS,
  PACKAGE_TEXT_EXTENSIONS,
  PACKAGE_ASSET_EXTENSIONS,
  assertPackageFilePath,
  fileExtension,
  isAllowedPackageFilePath,
  isAssetFile,
  isBlockedPackagePath,
  isMarkdownFile,
  isTextFile,
} from './policy.js';

export { MAX_CANONICAL_JSON_DEPTH, canonicalizeJson } from './canonical-json.js';

export {
  MAX_MARKDOWN_BYTES,
  analyzeMarkdown,
  assertMarkdownAllowed,
  commonMarkSlug,
  decodedDestinationProblem,
} from './markdown.js';
export type {
  DestinationProblem,
  IssueCode,
  MarkdownAnalysis,
  MarkdownCodeBlock,
  MarkdownDestination,
  MarkdownHeading,
  MarkdownIssueCode,
  MarkdownReferenceKind,
  ResourceIssueCode,
  ValidationIssue,
} from './markdown.js';

export { validateLinkClosure, validateResourceSet } from './resources.js';
export type { LinkClosureInput, LinkClosureValidation, ResourceSetValidation, VirtualResource } from './resources.js';

export {
  MAX_PORTABLE_PATH_BYTES,
  PortablePathCollisionError,
  PortablePathError,
  assertNoPortablePathCollisions,
  assertPortablePath,
  caseFoldPath,
  hasLoneSurrogate,
  portableDestinationProblem,
  portablePathProblem,
  portablePathSchema,
} from '@learning-workspace/schemas/paths';
