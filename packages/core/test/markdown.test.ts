import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MARKDOWN_BYTES,
  ValidationError,
  analyzeMarkdown,
  assertMarkdownAllowed,
  commonMarkSlug,
} from '../dist/index.js';

const errorCodes = (source: string): string[] => analyzeMarkdown(source).errors.map((issue) => issue.code);

const expectError = (source: string, code: string): void => {
  const found = errorCodes(source);
  assert.ok(found.includes(code), `expected ${code}, got [${found.join(', ')}] for ${JSON.stringify(source)}`);
};

const expectThrownCode = (code: string, run: () => unknown): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ValidationError, String(error));
    assert.equal(error.code, code);
    return true;
  });
};

test('extracts headings with spec slugs and duplicate suffixes', () => {
  const source = '# Ley de Ohm\n\n## ¿Qué es un voltímetro?\n\n## Ley de Ohm\n';
  const analysis = analyzeMarkdown(source);
  assert.deepEqual(
    analysis.headings.map((heading) => ({ depth: heading.depth, slug: heading.slug })),
    [
      { depth: 1, slug: 'ley-de-ohm' },
      { depth: 2, slug: 'qué-es-un-voltímetro' },
      { depth: 2, slug: 'ley-de-ohm-1' },
    ],
  );
  assert.equal(analysis.errors.length, 0);
});

test('commonMarkSlug is the exported fragment contract', () => {
  assert.equal(commonMarkSlug('Ley de Ohm'), 'ley-de-ohm');
  assert.equal(commonMarkSlug('Ley de Ohm (V = IR)'), 'ley-de-ohm-v--ir');
  assert.equal(commonMarkSlug('¡Hola, mundo!'), 'hola-mundo');
  assert.equal(commonMarkSlug('Ünïcödé 2024'), 'ünïcödé-2024');
  assert.equal(commonMarkSlug('  '), '--');
  assert.equal(commonMarkSlug(''), '');
  // formatting and inline code contribute their plain text
  const formatted = analyzeMarkdown('## Ley de *Ohm* con `R`\n');
  assert.equal(formatted.headings[0]?.text, 'Ley de Ohm con R');
  assert.equal(formatted.headings[0]?.slug, 'ley-de-ohm-con-r');
});

test('extracts links, references, definitions, images and code blocks', () => {
  const source = [
    '# Documento',
    '',
    '[a](resources/x.md#sec)',
    '',
    '## Propio',
    '',
    '[b](#propio)',
    '',
    '[c][ref] and ![pic](assets/p.png)',
    '',
    'Shortcut forms like [d] stay literal.',
    '',
    '[ref]: other.md',
    '',
    '[ext](https://example.com/doc)',
    '',
    '```python',
    'print(1)',
    '```',
  ].join('\n');
  const analysis = analyzeMarkdown(source);

  const relative = analysis.links.find((link) => link.raw === 'resources/x.md#sec');
  assert.ok(relative !== undefined);
  assert.equal(relative.kind, 'inline');
  assert.equal(relative.scope, 'relative');
  assert.equal(relative.path, 'resources/x.md');
  assert.equal(relative.fragment, 'sec');

  const self = analysis.links.find((link) => link.raw === '#propio');
  assert.ok(self !== undefined);
  assert.equal(self.scope, 'self');
  assert.equal(self.fragment, 'propio');

  const definition = analysis.links.find((link) => link.kind === 'definition');
  assert.ok(definition !== undefined);
  assert.equal(definition.raw, 'other.md');

  const reference = analysis.links.find((link) => link.kind === 'reference');
  assert.ok(reference !== undefined);
  assert.equal(reference.path, 'other.md');

  const external = analysis.links.find((link) => link.scope === 'external');
  assert.ok(external !== undefined);
  assert.equal(external.raw, 'https://example.com/doc');

  const image = analysis.images.find((entry) => entry.raw === 'assets/p.png');
  assert.ok(image !== undefined);
  assert.equal(image.scope, 'relative');
  assert.equal(image.path, 'assets/p.png');

  assert.equal(analysis.codeBlocks.length, 1);
  assert.equal(analysis.codeBlocks[0]?.lang, 'python');
  assert.equal(analysis.codeBlocks[0]?.value, 'print(1)');

  // unresolved shortcuts and definitions are fine; https only warns
  assert.deepEqual(analysis.errors, []);
  assert.deepEqual(analysis.warnings.map((warning) => warning.code), ['REMOTE_LINK']);
});

test('rejects raw HTML, wikilinks, embeds and remote images', () => {
  expectError('<div class="a">hi</div>', 'RAW_HTML');
  expectError('text <span>inline</span>', 'RAW_HTML');
  expectError('[[Page]]', 'WIKILINK');
  expectError('![[note.png]]', 'WIKILINK');
  expectError('![diagram](https://example.com/a.png)', 'REMOTE_IMAGE');
});

test('allows HTML and wikilink-looking text inside code', () => {
  const source = ['Inline `[[x]]` and `<div>` are text.', '', '```md', '[[Page]]', '<div class="a">html</div>', '```'].join('\n');
  const analysis = analyzeMarkdown(source);
  assert.deepEqual(analysis.errors, []);
  assert.equal(analysis.codeBlocks.length, 1);
  assert.ok(analysis.codeBlocks[0]?.value.includes('[[Page]]'));
});

test('denies every URL scheme except https, which only warns', () => {
  for (const source of [
    '[x](javascript:alert(1))',
    '[x](JAVASCRIPT:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](file:///etc/passwd)',
    '[x](obsidian://open?vault=v)',
    '[x](http://example.com/plain)',
    '<mailto:learner@example.com>',
    '[x](javascript&#58;alert(1))',
  ]) {
    expectError(source, 'DISALLOWED_SCHEME');
  }
  const https = analyzeMarkdown('[x](https://example.com/doc)');
  assert.deepEqual(https.errors, []);
  assert.deepEqual(https.warnings.map((warning) => warning.code), ['REMOTE_LINK']);
  // nothing is fetched: the analysis carries no network side effects by construction
  assert.equal(https.links[0]?.scope, 'external');
});

test('rejects absolute paths, protocol-relative URLs and local queries', () => {
  expectError('[x](/etc/passwd)', 'ABSOLUTE_PATH');
  expectError('[x](//example.com/a.md)', 'ABSOLUTE_PATH');
  expectError('[x](a.md?download=1)', 'QUERY_LOCAL');
  expectError('[x](#)', 'BAD_FRAGMENT');
  expectError('[x](#does-not-exist)', 'BAD_FRAGMENT');
  expectError('[x]()', 'EMPTY_DESTINATION');
});

test('decodes URLs exactly once: malformed escapes and double escapes fail', () => {
  expectError('[x](100%.md)', 'MALFORMED_ESCAPE');
  expectError('[x](a%2.md)', 'MALFORMED_ESCAPE');
  expectError('[x](a%FF.md)', 'MALFORMED_ESCAPE'); // escape of invalid UTF-8
  expectError('[x](%252e%252e/secret.md)', 'DOUBLE_ESCAPE');
  expectError('[x](a%2520b.md)', 'DOUBLE_ESCAPE');
  // a single, valid decode succeeds and produces the decoded path
  const ok = analyzeMarkdown('[x](a%20b.md)');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.links[0]?.path, 'a b.md');
});

test('undefined references fail; shortcuts and escaped brackets stay literal', () => {
  expectError('[text][missing]', 'UNDEFINED_REFERENCE');
  expectError('[text][]', 'UNDEFINED_REFERENCE');
  expectError('![alt][missing-image]', 'UNDEFINED_REFERENCE');
  // full reference syntax with unresolved label is an error even in prose arrays
  expectError('arr[0][1]', 'UNDEFINED_REFERENCE');
  // shortcut references are ordinary text when undefined (CommonMark literal)
  assert.deepEqual(errorCodes('See [d] for details.'), []);
  // escaping the first bracket disables the reference construct
  assert.deepEqual(errorCodes('array \\[0][1] stays literal'), []);
  // a defined reference never reports an undefined reference
  assert.deepEqual(errorCodes('[foo][bar]\n\n[bar]: other.md'), []);
});

test('assertMarkdownAllowed throws the first error code', () => {
  assert.throws(
    () => assertMarkdownAllowed('<div>no</div>'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError, String(error));
      assert.equal(error.code, 'RAW_HTML');
      return true;
    },
  );
  const allowed = assertMarkdownAllowed('# ok\n\ntext with [link](other.md)\n');
  assert.equal(allowed.errors.length, 0);
});

test('revalidates percent-decoded destinations before any resolution', () => {
  // The raw destination hides the problem: only the decoded form is absolute/denied.
  const cases: Array<[string, string]> = [
    ['[x](%2fsecret.md)', 'ABSOLUTE_PATH'],
    ['[x](%2f%2fhost/x.md)', 'ABSOLUTE_PATH'],
    ['[x](a%3Fb.md)', 'QUERY_LOCAL'],
    ['[x](a%5cb.md)', 'INVALID_PATH'],
    ['[x](C%3A/x.md)', 'DISALLOWED_SCHEME'],
    ['[x](javascript%3Aalert(1))', 'DISALLOWED_SCHEME'],
    ['[x](a%00.md)', 'INVALID_PATH'],
    ['![i](%2fremote.png)', 'ABSOLUTE_PATH'],
  ];
  for (const [source, code] of cases) expectError(source, code);
  expectThrownCode('ABSOLUTE_PATH', () => assertMarkdownAllowed('[x](%2fsecret.md)'));

  // ordinary percent-encoding still decodes exactly once to a valid path
  const ok = analyzeMarkdown('[x](caf%C3%A9%20ok.md)');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.links[0]?.path, 'café ok.md');
});

test('heading slugs are globally unique with deterministic suffixes', () => {
  assert.deepEqual(
    analyzeMarkdown('# A\n# A\n# A-1\n').headings.map((heading) => heading.slug),
    ['a', 'a-1', 'a-1-1'],
  );
  assert.deepEqual(
    analyzeMarkdown('# A-1\n# A\n# A\n').headings.map((heading) => heading.slug),
    ['a-1', 'a', 'a-2'],
  );
  const slugs = analyzeMarkdown('# Ent\n\n## Ent\n\n## Ent-1\n\n## Ent\n').headings.map((heading) => heading.slug);
  assert.equal(new Set(slugs).size, slugs.length, `slugs must be unique: ${slugs.join(', ')}`);
  // CommonMark requires a space after # : "#A" is plain text, not a heading
  assert.equal(analyzeMarkdown('#A-1\n#A\n#A').headings.length, 0);
});

test('enforces the 2 MiB source limit and rejects lone-surrogate sources', () => {
  expectThrownCode('MARKDOWN_TOO_LARGE', () => analyzeMarkdown('a'.repeat(MAX_MARKDOWN_BYTES + 1)));
  expectThrownCode('MARKDOWN_TOO_LARGE', () => assertMarkdownAllowed('# x\n'.padEnd(MAX_MARKDOWN_BYTES + 1, 'a')));
  expectThrownCode('MARKDOWN_INVALID_UTF8', () => analyzeMarkdown('a\uD800'));
  // exactly 2 MiB is within the normative limit and parses
  const atLimit = analyzeMarkdown('a'.repeat(MAX_MARKDOWN_BYTES));
  assert.deepEqual(atLimit.errors, []);
});

test('deeply nested documents are walked iteratively without stack overflow', { timeout: 20_000 }, () => {
  const deep = '>'.repeat(10_000) + ' deep\n';
  assert.ok(Buffer.byteLength(deep, 'utf8') < MAX_MARKDOWN_BYTES);
  try {
    const analysis = analyzeMarkdown(deep);
    assert.deepEqual(analysis.errors, []);
  } catch (error) {
    // If the external parser cannot handle the document, the failure must be
    // a diagnosed ValidationError — never a raw RangeError from our traversal.
    assert.ok(error instanceof ValidationError, `expected ValidationError, got ${String(error)}`);
  }

  // 5 000 levels of nested emphasis inside a heading exercise the iterative plainText fold
  const depth = 5_000;
  const deepHeading = analyzeMarkdown(`## ${'*'.repeat(depth)}deep emphasis${'*'.repeat(depth)}\n`);
  assert.equal(deepHeading.headings[0]?.slug, 'deep-emphasis');
  assert.deepEqual(deepHeading.errors, []);
});
