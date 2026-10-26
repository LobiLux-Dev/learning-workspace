import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, RootContent, Text } from 'mdast';
import { hasLoneSurrogate, portableDestinationProblem } from '@learning-workspace/schemas/paths';
import { ValidationError } from './errors.js';

/**
 * CommonMark AST analysis for published content (spec §4.2 and §5.3).
 *
 * Parsing is done by `mdast-util-from-markdown` (a real CommonMark parser),
 * never by regular expressions over the source. Regular expressions are only
 * used to scan the *raw source slices* of text nodes for constructs that
 * CommonMark deliberately leaves as literal text — wikilinks and unresolved
 * reference links — because those never become AST nodes.
 *
 * `analyzeMarkdown` is pure: it returns the extracted headings/slugs, links,
 * references, images and fenced code blocks plus error/warning issues, and it
 * never touches the filesystem or the network.
 */

/** Error and warning codes produced while analyzing one Markdown document. */
export type MarkdownIssueCode =
  | 'RAW_HTML'
  | 'WIKILINK'
  | 'UNDEFINED_REFERENCE'
  | 'EMPTY_DESTINATION'
  | 'DISALLOWED_SCHEME'
  | 'ABSOLUTE_PATH'
  | 'QUERY_LOCAL'
  | 'MALFORMED_ESCAPE'
  | 'DOUBLE_ESCAPE'
  | 'REMOTE_IMAGE'
  | 'REMOTE_LINK'
  | 'BAD_FRAGMENT';

/** Additional codes produced by the virtual resource set / link closure validators. */
export type ResourceIssueCode =
  | 'SNAPSHOT_FILE_LIMIT'
  | 'SNAPSHOT_SIZE_LIMIT'
  | 'FILE_SIZE_LIMIT'
  | 'INVALID_PATH'
  | 'PATH_COLLISION'
  | 'BLOCKED_PATH'
  | 'EXTENSION_NOT_ALLOWED'
  | 'INVALID_UTF8'
  | 'INVALID_RESOURCE_TYPE'
  | 'ENTRY_MISSING'
  | 'ENTRY_NOT_MARKDOWN'
  | 'MISSING_TARGET'
  | 'PATH_ESCAPE'
  | 'DOCUMENT_INVALID';

export type IssueCode = MarkdownIssueCode | ResourceIssueCode;

/** Maximum accepted Markdown source size: 2 MiB (spec §4.2). */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

/** A single validation finding. `path` is filled in by the closure validator. */
export interface ValidationIssue {
  readonly code: IssueCode;
  readonly message: string;
  readonly index: number | undefined;
  readonly path?: string;
  readonly target?: string;
}

/** How a destination was written: inline link, reference usage, or definition. */
export type MarkdownReferenceKind = 'inline' | 'reference' | 'definition';

/** A link or image destination after URL decoding (but before path resolution). */
export interface MarkdownDestination {
  readonly kind: MarkdownReferenceKind;
  /** Destination exactly as the parser produced it (entities decoded, percent-encoding kept). */
  readonly raw: string;
  /** `relative` targets another resource, `self` a fragment of this document, `external` an URL. */
  readonly scope: 'relative' | 'self' | 'external';
  /** Percent-decoded relative path, when `scope` is `relative`. */
  readonly path: string | undefined;
  /** Percent-decoded fragment (without `#`), when the destination carries one. */
  readonly fragment: string | undefined;
  readonly index: number | undefined;
}

export interface MarkdownHeading {
  readonly depth: number;
  /** Plain text of the heading (formatting stripped, raw HTML excluded). */
  readonly text: string;
  /** Duplicate-suffixed CommonMark slug used by local fragments. */
  readonly slug: string;
  readonly index: number | undefined;
}

export interface MarkdownCodeBlock {
  readonly lang: string | null;
  readonly value: string;
  readonly index: number | undefined;
}

export interface MarkdownAnalysis {
  readonly headings: readonly MarkdownHeading[];
  readonly links: readonly MarkdownDestination[];
  readonly images: readonly MarkdownDestination[];
  readonly codeBlocks: readonly MarkdownCodeBlock[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

type MdastNode = Root | RootContent;

type PushIssue = (code: IssueCode, message: string, index: number | undefined, target?: string) => void;

interface PendingDestination {
  readonly raw: string;
  readonly kind: MarkdownReferenceKind;
  readonly role: 'link' | 'image';
  readonly index: number | undefined;
}

/**
 * Iterative pre-order walk (same order as recursion would produce). An
 * explicit stack keeps deeply nested documents — e.g. thousands of nested
 * blockquotes — from overflowing the JavaScript call stack inside our own
 * code.
 */
function walk(node: MdastNode, visit: (node: MdastNode) => void): void {
  const stack: MdastNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    visit(current);
    if ('children' in current) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        const child = current.children[index];
        if (child !== undefined) stack.push(child);
      }
    }
  }
}

function offsetOf(node: MdastNode): number | undefined {
  return node.position?.start.offset;
}

/**
 * Plain text of a phrasing subtree, used for heading slugs (spec §5.3).
 * Iterative: collects the pre-order node list first, then folds values
 * bottom-up so deep subtrees never recurse.
 */
function plainText(root: MdastNode): string {
  const order: MdastNode[] = [];
  const stack: MdastNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    order.push(current);
    if ('children' in current) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        const child = current.children[index];
        if (child !== undefined) stack.push(child);
      }
    }
  }
  const values = new Map<MdastNode, string>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = order[index];
    if (node === undefined) continue;
    let value: string;
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        value = node.value;
        break;
      case 'break':
        value = ' ';
        break;
      case 'image':
      case 'imageReference':
        value = node.alt ?? '';
        break;
      default:
        if ('children' in node) {
          const parts: string[] = [];
          for (const child of node.children) parts.push(values.get(child) ?? '');
          value = parts.join('');
        } else {
          value = '';
        }
    }
    values.set(node, value);
  }
  return values.get(root) ?? '';
}

/** `true` when the character at `at` is preceded by an odd number of backslashes. */
function isEscaped(raw: string, at: number): boolean {
  let backslashes = 0;
  for (let index = at - 1; index >= 0 && raw[index] === '\\'; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/**
 * Contract for heading fragments (spec §5.3): plain text lowercased, spaces
 * replaced with `-`, punctuation and symbols removed except `-` and `_`.
 * Duplicate suffixes are applied by {@link analyzeMarkdown} in document order.
 */
export function commonMarkSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^\p{L}\p{M}\p{N}\-_]/gu, '');
}

/** A problem found in a percent-decoded link destination, before resolution. */
export interface DestinationProblem {
  readonly code: IssueCode;
  readonly message: string;
}

/**
 * Revalidates a link destination **after** percent-decoding (spec §5.3):
 * `%2f` decodes to an absolute path, `%3a` to a scheme separator, `%3f` to a
 * local query, `%5c` to a backslash and `%00` to a control character — none of
 * which is visible in the raw destination. Absolute targets and denied
 * schemes fail before any path resolution runs; `..` segments are still
 * allowed here and revalidated for containment after resolution.
 */
export function decodedDestinationProblem(path: string): DestinationProblem | null {
  if (path.startsWith('/')) {
    return {
      code: 'ABSOLUTE_PATH',
      message: path.startsWith('//')
        ? 'decoded destination is a protocol-relative URL'
        : 'decoded destination is an absolute path',
    };
  }
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(path);
  if (scheme !== null) {
    return {
      code: 'DISALLOWED_SCHEME',
      message: `decoded destination uses denied URL scheme "${scheme[0].slice(0, -1).toLowerCase()}:"`,
    };
  }
  if (path.includes('?')) {
    return { code: 'QUERY_LOCAL', message: 'decoded destination contains a local query string' };
  }
  const problem = portableDestinationProblem(path);
  if (problem !== null) {
    return { code: 'INVALID_PATH', message: `decoded destination is not a portable path: ${problem}` };
  }
  return null;
}

/**
 * Scans a text node's raw source slice for constructs CommonMark leaves as
 * literal text: wikilinks/Obsidian embeds (`[[`, `]]`) and unresolved full or
 * collapsed reference links (`[text][label]`, `[text][]`). Code spans, fenced
 * code, HTML and escaped brackets are not scanned (text nodes exclude them).
 */
function scanTextNode(source: string, node: Text, pushError: PushIssue): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return;
  const raw = source.slice(start, end);

  for (let at = 0; at + 1 < raw.length; at += 1) {
    const opensWiki = raw[at] === '[' && raw[at + 1] === '[';
    const closesWiki = raw[at] === ']' && raw[at + 1] === ']';
    if ((opensWiki || closesWiki) && !isEscaped(raw, at)) {
      pushError(
        'WIKILINK',
        'wikilink/Obsidian embed syntax is rejected in published content (spec §4.2)',
        start + at,
        opensWiki ? '[[' : ']]',
      );
    }
  }

  const referencePattern = /\[(?:\\.|[^\]\\])*\]\[(?:\\.|[^\]\\])*\]/g;
  let match = referencePattern.exec(raw);
  while (match !== null) {
    const at = match.index;
    const secondBracket = match[0].indexOf(']') + 1;
    if (!isEscaped(raw, at) && !isEscaped(raw, secondBracket)) {
      pushError(
        'UNDEFINED_REFERENCE',
        `reference link "${match[0]}" has no matching definition`,
        start + at,
        match[0],
      );
    }
    match = referencePattern.exec(raw);
  }
}

/**
 * Analyzes one Markdown document: extracts headings with their spec slugs,
 * links, references, images and fenced code blocks, and reports structural
 * errors (raw HTML, wikilinks, remote images, denied schemes, ambiguous URL
 * escapes, absolute paths — including percent-encoded ones —, local queries,
 * unresolved references, invalid self-fragments). HTTPS ordinary links only
 * produce a warning; nothing is fetched. Target existence, `..` containment
 * and cross-document fragments are validated by `validateLinkClosure`.
 *
 * Throws {@link ValidationError} for sources this module refuses outright:
 * lone surrogates (`MARKDOWN_INVALID_UTF8`), sources over 2 MiB
 * (`MARKDOWN_TOO_LARGE`, spec §4.2) and parser failures
 * (`MARKDOWN_PARSE`) — a failing parser is reported as a diagnosed
 * validation error, never as a raw `RangeError`.
 */
export function analyzeMarkdown(source: string): MarkdownAnalysis {
  if (hasLoneSurrogate(source)) {
    throw new ValidationError('MARKDOWN_INVALID_UTF8', 'markdown source contains an unpaired surrogate (invalid UTF-8)');
  }
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_MARKDOWN_BYTES) {
    throw new ValidationError(
      'MARKDOWN_TOO_LARGE',
      `markdown source is ${sourceBytes} bytes; the limit is ${MAX_MARKDOWN_BYTES} bytes (2 MiB)`,
    );
  }
  let root: Root;
  try {
    root = fromMarkdown(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ValidationError('MARKDOWN_PARSE', `CommonMark parser could not process the document: ${detail}`);
  }
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const links: MarkdownDestination[] = [];
  const images: MarkdownDestination[] = [];
  const codeBlocks: MarkdownCodeBlock[] = [];
  const headingDrafts: Array<{ depth: number; text: string; index: number | undefined }> = [];
  const definitions = new Map<string, string>();
  const references: Array<{
    identifier: string;
    label: string;
    role: 'link' | 'image';
    index: number | undefined;
  }> = [];
  const pending: PendingDestination[] = [];

  const pushError: PushIssue = (code, message, index, target) => {
    if (target === undefined) errors.push({ code, message, index });
    else errors.push({ code, message, index, target });
  };
  const pushWarning: PushIssue = (code, message, index, target) => {
    if (target === undefined) warnings.push({ code, message, index });
    else warnings.push({ code, message, index, target });
  };

  walk(root, (node) => {
    switch (node.type) {
      case 'html':
        pushError('RAW_HTML', 'raw HTML is rejected in published content (spec §4.2)', offsetOf(node), node.value);
        break;
      case 'code':
        codeBlocks.push({ lang: node.lang ?? null, value: node.value, index: offsetOf(node) });
        break;
      case 'heading':
        headingDrafts.push({ depth: node.depth, text: plainText(node), index: offsetOf(node) });
        break;
      case 'definition':
        if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
        pending.push({ raw: node.url, kind: 'definition', role: 'link', index: offsetOf(node) });
        break;
      case 'link':
        pending.push({ raw: node.url, kind: 'inline', role: 'link', index: offsetOf(node) });
        break;
      case 'image':
        pending.push({ raw: node.url, kind: 'inline', role: 'image', index: offsetOf(node) });
        break;
      case 'linkReference':
        references.push({
          identifier: node.identifier,
          label: node.label ?? node.identifier,
          role: 'link',
          index: offsetOf(node),
        });
        break;
      case 'imageReference':
        references.push({
          identifier: node.identifier,
          label: node.label ?? node.identifier,
          role: 'image',
          index: offsetOf(node),
        });
        break;
      case 'text':
        scanTextNode(source, node, pushError);
        break;
      default:
        break;
    }
  });

  // Slugs are unique across the whole document: a base that is already used
  // (by a heading or by an earlier suffix) tries `-1`, `-2`, … until free, so
  // `# A / # A / # A-1` yields `a`, `a-1`, `a-1-1` and `# A-1 / # A / # A`
  // yields `a-1`, `a`, `a-2`. Fragments always address exactly one heading.
  const usedSlugs = new Set<string>();
  const headings: MarkdownHeading[] = headingDrafts.map((draft) => {
    const base = commonMarkSlug(draft.text);
    let slug = base;
    if (usedSlugs.has(slug)) {
      let suffix = 1;
      while (usedSlugs.has(`${base}-${suffix}`)) suffix += 1;
      slug = `${base}-${suffix}`;
    }
    usedSlugs.add(slug);
    return { depth: draft.depth, text: draft.text, slug, index: draft.index };
  });
  const slugs = new Set<string>(headings.map((heading) => heading.slug));

  for (const reference of references) {
    const url = definitions.get(reference.identifier);
    if (url === undefined) {
      pushError(
        'UNDEFINED_REFERENCE',
        `reference "${reference.label}" has no matching definition`,
        reference.index,
        reference.label,
      );
      continue;
    }
    pending.push({ raw: url, kind: 'reference', role: reference.role, index: reference.index });
  }

  const processDestination = (destination: PendingDestination): void => {
    const { raw, kind, role, index } = destination;
    const record = (scope: 'relative' | 'self' | 'external', path: string | undefined, fragment: string | undefined): void => {
      const entry: MarkdownDestination = { kind, raw, scope, path, fragment, index };
      if (role === 'link') links.push(entry);
      else images.push(entry);
    };
    const decode = (value: string, what: string): string | undefined => {
      if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
        pushError('MALFORMED_ESCAPE', `malformed percent-escape in ${what}`, index, raw);
        return undefined;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        pushError('MALFORMED_ESCAPE', `percent-encoding is not valid UTF-8 in ${what}`, index, raw);
        return undefined;
      }
      if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
        pushError('DOUBLE_ESCAPE', `double-escaped sequence in ${what}; URLs decode exactly once`, index, raw);
        return undefined;
      }
      return decoded;
    };

    if (raw === '') {
      pushError('EMPTY_DESTINATION', 'link/image destination is empty', index, raw);
      return;
    }

    const hash = raw.indexOf('#');
    const rawPath = hash === -1 ? raw : raw.slice(0, hash);
    const rawFragment = hash === -1 ? undefined : raw.slice(hash + 1);

    if (hash === 0) {
      if (rawFragment === undefined || rawFragment === '') {
        pushError('BAD_FRAGMENT', 'fragment is empty', index, raw);
        return;
      }
      const fragment = decode(rawFragment, 'fragment');
      if (fragment === undefined) return;
      if (!slugs.has(fragment)) {
        pushError('BAD_FRAGMENT', `fragment "#${fragment}" does not match any heading slug of this document`, index, raw);
        return;
      }
      record('self', undefined, fragment);
      return;
    }

    const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(rawPath);
    if (scheme !== null) {
      const protocol = scheme[0].slice(0, -1).toLowerCase();
      record('external', undefined, undefined);
      if (protocol === 'https') {
        if (role === 'image') {
          pushError('REMOTE_IMAGE', 'remote images are rejected; assets ship inside the package (spec §4.2)', index, raw);
        } else {
          pushWarning('REMOTE_LINK', 'HTTPS link kept as navigable text only; it is never fetched', index, raw);
        }
        return;
      }
      pushError('DISALLOWED_SCHEME', `URL scheme "${protocol}:" is denied (only https: links are tolerated)`, index, raw);
      return;
    }

    if (rawPath.startsWith('/')) {
      pushError(
        'ABSOLUTE_PATH',
        rawPath.startsWith('//') ? 'protocol-relative URL is rejected' : 'absolute path link is rejected',
        index,
        raw,
      );
      return;
    }
    if (rawPath.includes('?')) {
      pushError('QUERY_LOCAL', 'local links with a query string are rejected (spec §5.3)', index, raw);
      return;
    }

    const path = decode(rawPath, 'path');
    if (path === undefined) return;
    const problem = decodedDestinationProblem(path);
    if (problem !== null) {
      pushError(problem.code, problem.message, index, raw);
      return;
    }
    if (rawFragment !== undefined) {
      if (rawFragment === '') {
        pushError('BAD_FRAGMENT', 'fragment is empty', index, raw);
        return;
      }
      const fragment = decode(rawFragment, 'fragment');
      if (fragment === undefined) return;
      record('relative', path, fragment);
      return;
    }
    record('relative', path, undefined);
  };

  for (const destination of pending) processDestination(destination);

  return { headings, links, images, codeBlocks, errors, warnings };
}

/**
 * Analyzes `source` and throws {@link ValidationError} when it has any error
 * (using the first error's code); warnings are tolerated and returned with
 * the analysis.
 */
export function assertMarkdownAllowed(source: string): MarkdownAnalysis {
  const analysis = analyzeMarkdown(source);
  const first = analysis.errors[0];
  if (first !== undefined) {
    throw new ValidationError(
      first.code,
      `markdown rejected with ${analysis.errors.length} error(s): ${first.message}`,
      first.path,
    );
  }
  return analysis;
}
