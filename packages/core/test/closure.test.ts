import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_MARKDOWN_BYTES, validateLinkClosure, validateResourceSet } from '../dist/index.js';
import type { IssueCode, VirtualResource } from '../dist/index.js';

const fixture = (name: string): Uint8Array => readFileSync(new URL(`../../../fixtures/content/${name}`, import.meta.url));
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const map = (...entries: Array<[string, VirtualResource]>): ReadonlyMap<string, VirtualResource> => new Map(entries);

const codesOf = (result: { errors: ReadonlyArray<{ code: IssueCode }> }): IssueCode[] =>
  result.errors.map((issue) => issue.code);

test('fixture closure: links, fragments and assets resolve without materializing files', () => {
  const resources = map(
    ['index.md', fixture('mini/index.md')],
    ['resources/ohms-law.md', fixture('mini/resources/ohms-law.md')],
    ['assets/circuito-01.png', fixture('mini/assets/circuito-01.png')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.closure, ['assets/circuito-01.png', 'index.md', 'resources/ohms-law.md']);
  assert.deepEqual(result.unreachable, []);
  assert.deepEqual(result.files, ['assets/circuito-01.png', 'index.md', 'resources/ohms-law.md']);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, 'REMOTE_LINK');
  assert.ok(result.documents.has('index.md'));
  assert.equal(result.documents.get('resources/ohms-law.md')?.headings[0]?.slug, 'ley-de-ohm');
});

test('unreachable files are reported but never fail validation', () => {
  const resources = map(
    ['index.md', text('# Solo\n')],
    ['notes/orphan.md', text('# Huérfana\n')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.closure, ['index.md']);
  assert.deepEqual(result.unreachable, ['notes/orphan.md']);
});

test('missing targets, escapes and fragments fail', () => {
  const missing = validateLinkClosure({ resources: map(['index.md', text('# X\n\n[go](missing.md)\n')]), entry: 'index.md' });
  assert.equal(missing.ok, false);
  assert.ok(codesOf(missing).includes('MISSING_TARGET'));

  const escape = validateLinkClosure({ resources: map(['index.md', text('# X\n\n[up](../outside.md)\n')]), entry: 'index.md' });
  assert.ok(codesOf(escape).includes('PATH_ESCAPE'));

  const deepEscape = validateLinkClosure({
    resources: map(
      ['sub/page.md', text('## P\n\n[out](../../outside.md)\n')],
      ['index.md', text('# I\n')],
    ),
    entry: 'sub/page.md',
  });
  assert.ok(codesOf(deepEscape).includes('PATH_ESCAPE'));

  const badFragment = validateLinkClosure({
    resources: map(
      ['index.md', text('# X\n\n[go](other.md#nope)\n')],
      ['other.md', text('## Heading\n')],
    ),
    entry: 'index.md',
  });
  assert.ok(codesOf(badFragment).includes('BAD_FRAGMENT'));
  const fragmentIssue = badFragment.errors.find((issue) => issue.code === 'BAD_FRAGMENT');
  assert.equal(fragmentIssue?.path, 'index.md');
  assert.equal(fragmentIssue?.target, 'other.md#nope');

  const assetFragment = validateLinkClosure({
    resources: map(
      ['index.md', text('# X\n\n[img](a.png#frag)\n')],
      ['a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ),
    entry: 'index.md',
  });
  assert.ok(codesOf(assetFragment).includes('BAD_FRAGMENT'));

  const selfFragment = validateLinkClosure({ resources: map(['index.md', text('# Head\n\n[go](#other)\n')]), entry: 'index.md' });
  assert.ok(codesOf(selfFragment).includes('BAD_FRAGMENT'));
  const selfOk = validateLinkClosure({ resources: map(['index.md', text('# Head\n\n[go](#head)\n')]), entry: 'index.md' });
  assert.equal(selfOk.ok, true);
});

test('links may walk up with .. as long as they stay inside the root', () => {
  const resources = map(
    ['sub/page.md', text('## P\n\n[up](../index.md) y [sibling](other.md)\n')],
    ['sub/other.md', text('## O\n\n[down](page.md)\n')],
    ['index.md', text('# I\n\n[down](sub/page.md)\n')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.closure, ['index.md', 'sub/other.md', 'sub/page.md']);
});

test('policy, collisions and encoding violations fail the whole set', () => {
  const blocked = validateResourceSet(
    map(
      ['index.md', text('# X\n')],
      ['AGENTS.md', text('instructions')],
      ['.opencode/plugins/x.md', text('plugin')],
      ['setup.json', new TextEncoder().encode('{}')],
    ),
  );
  assert.equal(blocked.ok, false);
  assert.deepEqual(codesOf(blocked).sort(), ['BLOCKED_PATH', 'BLOCKED_PATH', 'EXTENSION_NOT_ALLOWED']);

  const collision = validateResourceSet(map(['A.md', text('# A\n')], ['a.md', text('# a\n')]));
  assert.ok(codesOf(collision).includes('PATH_COLLISION'));

  const invalidUtf8 = validateResourceSet(map(['bad.md', new Uint8Array([0x61, 0xff, 0x62])]));
  assert.ok(codesOf(invalidUtf8).includes('INVALID_UTF8'));

  const loneSurrogate = validateResourceSet(map(['bad.md', 'a\uD800']));
  assert.ok(codesOf(loneSurrogate).includes('INVALID_UTF8'));

  const nonPortable = validateResourceSet(map(['../escape.md', text('x')]));
  assert.ok(codesOf(nonPortable).includes('INVALID_PATH'));
});

test('structural markdown errors are reported with their document path', () => {
  const resources = map(
    ['index.md', text('# X\n\n[a](a.md?x=1) and [[wiki]] and [b][missing]\n')],
    ['a.md', text('## A\n')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, false);
  const codes = codesOf(result);
  assert.ok(codes.includes('QUERY_LOCAL'));
  assert.ok(codes.includes('WIKILINK'));
  assert.ok(codes.includes('UNDEFINED_REFERENCE'));
  for (const issue of result.errors) {
    if (issue.code === 'QUERY_LOCAL' || issue.code === 'WIKILINK' || issue.code === 'UNDEFINED_REFERENCE') {
      assert.equal(issue.path, 'index.md');
    }
  }
});

test('entry must exist and be Markdown', () => {
  const resources = map(['index.md', text('# X\n')], ['a.png', new Uint8Array([1, 2, 3])]);

  const missing = validateLinkClosure({ resources, entry: 'nope.md' });
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0]?.code, 'ENTRY_MISSING');
  assert.deepEqual(missing.closure, []);
  assert.deepEqual(missing.unreachable, ['a.png', 'index.md']);

  const notMarkdown = validateLinkClosure({ resources, entry: 'a.png' });
  assert.equal(notMarkdown.errors[0]?.code, 'ENTRY_NOT_MARKDOWN');
});

test('duplicate broken links produce a single issue and https links only warn', () => {
  const resources = map(['index.md', text('# X\n\n[a](m.md) y [b](m.md) y [c](https://example.com)\n')]);
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.code, 'MISSING_TARGET');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, 'REMOTE_LINK');
  assert.equal(result.ok, false);
});

test('inert text about configuration files is not a policy violation', () => {
  const resources = map(['notes/lecture.md', text('# Notas\n\nEl profe mencionó AGENTS.md y .opencode.\n\n```yaml\nopencode.jsonc: true\n```\n')]);
  const result = validateLinkClosure({ resources, entry: 'notes/lecture.md' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('percent-encoded absolute destinations fail before resolution (regression)', () => {
  const resources = map(
    ['index.md', text('[absolute](%2fsecret.md)')],
    ['secret.md', text('# secret\n')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('ABSOLUTE_PATH'), JSON.stringify(codesOf(result)));
  assert.deepEqual(result.closure, ['index.md']);
  assert.deepEqual(result.unreachable, ['secret.md']);
});

test('cross-document fragments resolve against the target heading slugs', () => {
  const resources = map(
    ['index.md', text('# I\n\n[one](other.md#heading-one) y [dup](other.md#capítulo-1)\n')],
    ['other.md', text('# Heading One\n\n## Capítulo\n\n## Capítulo\n')],
  );
  const result = validateLinkClosure({ resources, entry: 'index.md' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.closure, ['index.md', 'other.md']);
  // the second duplicate heading owns "-1": the fragment addresses exactly one heading
  const fragmentIssue = result.errors.find((issue) => issue.code === 'BAD_FRAGMENT');
  assert.equal(fragmentIssue, undefined);
});

test('an oversized document becomes a set issue, not an exception', () => {
  const oversized = `# x\n${'a'.repeat(MAX_MARKDOWN_BYTES)}`;
  assert.ok(Buffer.byteLength(oversized, 'utf8') > MAX_MARKDOWN_BYTES);
  const result = validateResourceSet(map(['big.md', text(oversized)]));
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('FILE_SIZE_LIMIT'), JSON.stringify(codesOf(result)));
  assert.equal(result.documents.size, 0, 'reject oversized input before AST analysis');
});
