import { posix } from 'node:path';
import {
  PortablePathCollisionError,
  PortablePathError,
  assertNoPortablePathCollisions,
  assertPortablePath,
  hasLoneSurrogate,
} from '@learning-workspace/schemas/paths';
import { compareSnapshotPaths, enforceInventoryLimits, MAX_SNAPSHOT_FILES } from './digest.js';
import { ValidationError } from './errors.js';
import { analyzeMarkdown, decodedDestinationProblem } from './markdown.js';
import type { IssueCode, MarkdownAnalysis, ValidationIssue } from './markdown.js';
import { isAllowedPackageFilePath, isBlockedPackagePath, isMarkdownFile, isTextFile } from './policy.js';

/**
 * Validation of a virtual resource set and of the transitive local-link
 * closure of one document (spec §5.3). Everything is in-memory: resources are
 * supplied as a map of path → bytes or text, nothing is materialized,
 * copied, or read from disk — publishing belongs to a later phase.
 */

/** A virtual resource: exact bytes, or text already decoded by the caller. */
export type VirtualResource = Uint8Array | string;

export interface ResourceSetValidation {
  readonly ok: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  /** All validated paths, sorted by UTF-8 bytes. */
  readonly files: readonly string[];
  /** Analyses of every decodable Markdown file, keyed by path. */
  readonly documents: ReadonlyMap<string, MarkdownAnalysis>;
}

export interface LinkClosureValidation extends ResourceSetValidation {
  readonly entry: string;
  /** Files reachable from `entry` (document + transitively linked targets), byte-sorted. */
  readonly closure: readonly string[];
  /** Validated files that the closure does not reach; reported, never an error. */
  readonly unreachable: readonly string[];
}

export interface LinkClosureInput {
  readonly resources: ReadonlyMap<string, VirtualResource>;
  readonly entry: string;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

type DecodeResult =
  | { readonly ok: true; readonly kind: 'text'; readonly text: string }
  | { readonly ok: true; readonly kind: 'binary' }
  | { readonly ok: false; readonly reason: 'INVALID_UTF8' | 'INVALID_RESOURCE_TYPE' };

/** Text formats are strictly decoded; image bytes are kept as bytes and never decoded. */
function decodeResource(path: string, resource: VirtualResource): DecodeResult {
  if (!isTextFile(path)) {
    return resource instanceof Uint8Array
      ? { ok: true, kind: 'binary' }
      : { ok: false, reason: 'INVALID_RESOURCE_TYPE' };
  }
  if (typeof resource === 'string') {
    return hasLoneSurrogate(resource)
      ? { ok: false, reason: 'INVALID_UTF8' }
      : { ok: true, kind: 'text', text: resource };
  }
  if (!(resource instanceof Uint8Array)) {
    return { ok: false, reason: 'INVALID_RESOURCE_TYPE' };
  }
  try {
    return { ok: true, kind: 'text', text: utf8Decoder.decode(resource) };
  } catch {
    return { ok: false, reason: 'INVALID_UTF8' };
  }
}

/**
 * Validates every path and file of a virtual resource set: portable paths,
 * blocked configuration entries, allowlisted extensions, case-fold
 * collisions, strict UTF-8 decoding of text formats, and Markdown structure.
 * Pure: no filesystem access, no materialization.
 */
export function validateResourceSet(
  resources: ReadonlyMap<string, VirtualResource>,
): ResourceSetValidation {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const documents = new Map<string, MarkdownAnalysis>();
  if (resources.size > MAX_SNAPSHOT_FILES) {
    errors.push({ code: 'SNAPSHOT_FILE_LIMIT', message: `resource set exceeds ${MAX_SNAPSHOT_FILES} files`, index: undefined });
    return { ok: false, errors, warnings, files: [], documents };
  }
  const files = [...resources.keys()].sort(compareSnapshotPaths);

  // Bound the whole virtual set before UTF-8 decoding or AST allocation, not
  // merely the files reachable from the entry document.
  try {
    enforceInventoryLimits(files.map((path) => {
      const resource = resources.get(path);
      const size = typeof resource === 'string' ? Buffer.byteLength(resource, 'utf8') : resource instanceof Uint8Array ? resource.byteLength : 0;
      return { path, size };
    }));
  } catch (error) {
    if (error instanceof ValidationError && (error.code === 'SNAPSHOT_FILE_LIMIT' || error.code === 'SNAPSHOT_SIZE_LIMIT' || error.code === 'FILE_SIZE_LIMIT')) {
      errors.push({ code: error.code, message: error.message, index: undefined, ...(error.path === undefined ? {} : { path: error.path }) });
      return { ok: false, errors, warnings, files, documents };
    }
    throw error;
  }

  for (const path of files) {
    try {
      assertPortablePath(path);
    } catch (error) {
      if (error instanceof PortablePathError) errors.push({ code: 'INVALID_PATH', message: error.message, index: undefined, path });
      else throw error;
    }
    if (isBlockedPackagePath(path)) {
      errors.push({
        code: 'BLOCKED_PATH',
        message: `blocked configuration path in resource set: ${path}`,
        index: undefined,
        path,
      });
    } else if (!isAllowedPackageFilePath(path)) {
      errors.push({
        code: 'EXTENSION_NOT_ALLOWED',
        message: `file extension is not in the v0.1 allowlist: ${path}`,
        index: undefined,
        path,
      });
    }
  }

  try {
    assertNoPortablePathCollisions(files);
  } catch (error) {
    if (error instanceof PortablePathCollisionError) {
      errors.push({ code: 'PATH_COLLISION', message: error.message, index: undefined, path: error.path });
    } else if (error instanceof PortablePathError) {
      errors.push({ code: 'INVALID_PATH', message: error.message, index: undefined, path: error.path });
    } else {
      throw error;
    }
  }

  for (const path of files) {
    const resource = resources.get(path);
    if (resource === undefined) {
      errors.push({
        code: 'INVALID_RESOURCE_TYPE',
        message: `resource value must be Uint8Array bytes or a string: ${path}`,
        index: undefined,
        path,
      });
      continue;
    }
    const decoded = decodeResource(path, resource);
    if (!decoded.ok) {
      const message =
        decoded.reason === 'INVALID_UTF8'
          ? `resource is not valid UTF-8 text: ${path}`
          : `resource must be Uint8Array bytes or a string: ${path}`;
      errors.push({ code: decoded.reason, message, index: undefined, path });
      continue;
    }
    if (decoded.kind !== 'text' || !isMarkdownFile(path)) continue;
    try {
      const analysis = analyzeMarkdown(decoded.text);
      documents.set(path, analysis);
      for (const issue of analysis.errors) errors.push({ ...issue, path });
      for (const issue of analysis.warnings) warnings.push({ ...issue, path });
    } catch (error) {
      // analyzeMarkdown reports refusals (size, lone surrogates, parser
      // failure) as ValidationError; a set validator turns them into issues
      // instead of leaking exceptions to the caller.
      if (error instanceof ValidationError) {
        errors.push({ code: 'DOCUMENT_INVALID', message: `${error.code}: ${error.message}`, index: undefined, path });
      } else {
        throw error;
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, files, documents };
}

type Resolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: IssueCode; readonly message: string };

/**
 * Resolves a relative destination against a document path and revalidates
 * containment (spec §5.3). The decoded destination is revalidated **before**
 * `posix.join`, because `join` silently discards the base when the target is
 * absolute (`%2f` decodes to `/…`); `..` segments stay allowed here and are
 * caught by the containment check after normalization.
 */
function resolveRelative(docPath: string, target: string): Resolution {
  const problem = decodedDestinationProblem(target);
  if (problem !== null) return { ok: false, code: problem.code, message: problem.message };
  const base = posix.dirname(docPath);
  const joined = posix.normalize(posix.join(base, target));
  if (posix.isAbsolute(joined) || joined === '..' || joined.startsWith('../')) {
    return {
      ok: false,
      code: 'PATH_ESCAPE',
      message: `link resolves outside the resource root: ${target} (from ${docPath})`,
    };
  }
  try {
    assertPortablePath(joined);
  } catch (error) {
    if (error instanceof PortablePathError) return { ok: false, code: 'INVALID_PATH', message: error.message };
    throw error;
  }
  return { ok: true, path: joined };
}

/**
 * Validates a virtual resource set and the transitive closure of local links
 * starting at `entry`: every reachable target must exist inside the set,
 * `..` may walk within the root but never out of it, and fragments must match
 * a heading slug of the target document (spec §5.3). Unreachable files are
 * reported separately and never fail validation. Pure: bytes are inspected
 * in memory, never copied or materialized.
 */
export function validateLinkClosure(input: LinkClosureInput): LinkClosureValidation {
  const base = validateResourceSet(input.resources);
  const errors: ValidationIssue[] = [...base.errors];
  const warnings: ValidationIssue[] = [...base.warnings];
  const seenIssueKeys = new Set<string>();
  const visited = new Set<string>();
  const queued = new Set<string>();

  const addIssue = (issue: ValidationIssue): void => {
    const key = `${issue.code}|${issue.path ?? ''}|${issue.target ?? ''}|${issue.message}`;
    if (seenIssueKeys.has(key)) return;
    seenIssueKeys.add(key);
    errors.push(issue);
  };

  const finalize = (): LinkClosureValidation => ({
    ok: errors.length === 0,
    errors,
    warnings,
    files: base.files,
    documents: base.documents,
    entry: input.entry,
    closure: [...visited].sort(compareSnapshotPaths),
    unreachable: base.files.filter((path) => !visited.has(path)),
  });

  if (!input.resources.has(input.entry)) {
    errors.push({
      code: 'ENTRY_MISSING',
      message: `entry document is not in the resource set: ${input.entry}`,
      index: undefined,
      path: input.entry,
    });
    return finalize();
  }
  if (!isMarkdownFile(input.entry)) {
    errors.push({
      code: 'ENTRY_NOT_MARKDOWN',
      message: `entry document must be a Markdown file: ${input.entry}`,
      index: undefined,
      path: input.entry,
    });
    return finalize();
  }

  visited.add(input.entry);
  queued.add(input.entry);
  const queue: string[] = [input.entry];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const docPath = queue[cursor];
    if (docPath === undefined) continue;
    const analysis = base.documents.get(docPath);
    if (analysis === undefined) continue;
    const destinations = [...analysis.links, ...analysis.images];
    for (const destination of destinations) {
      if (destination.path === undefined) continue; // self fragments validated in analyzeMarkdown; external links only warn
      const resolved = resolveRelative(docPath, destination.path);
      if (!resolved.ok) {
        addIssue({
          code: resolved.code,
          message: resolved.message,
          index: destination.index,
          path: docPath,
          target: destination.raw,
        });
        continue;
      }
      const target = resolved.path;
      if (!input.resources.has(target)) {
        addIssue({
          code: 'MISSING_TARGET',
          message: `link target does not exist in the resource set: ${target}`,
          index: destination.index,
          path: docPath,
          target: destination.raw,
        });
        continue;
      }
      visited.add(target);
      if (destination.fragment !== undefined) {
        if (isMarkdownFile(target)) {
          const targetDocument = base.documents.get(target);
          if (targetDocument !== undefined) {
            const targetSlugs = new Set(targetDocument.headings.map((heading) => heading.slug));
            if (!targetSlugs.has(destination.fragment)) {
              addIssue({
                code: 'BAD_FRAGMENT',
                message: `fragment "#${destination.fragment}" does not match any heading slug of ${target}`,
                index: destination.index,
                path: docPath,
                target: destination.raw,
              });
            }
          }
        } else {
          addIssue({
            code: 'BAD_FRAGMENT',
            message: `fragment on a non-Markdown target: ${target}`,
            index: destination.index,
            path: docPath,
            target: destination.raw,
          });
        }
      }
      if (base.documents.has(target) && !queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    }
  }

  return finalize();
}
