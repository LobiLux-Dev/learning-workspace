import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BLOCKED_PACKAGE_SEGMENTS,
  PACKAGE_FILE_EXTENSIONS,
  ValidationError,
  analyzeMarkdown,
  assertPackageFilePath,
  isAllowedPackageFilePath,
  isBlockedPackagePath,
  isTextFile,
} from '../dist/index.js';

const expectCode = (code: string, run: () => unknown, path?: string): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ValidationError, String(error));
    assert.equal(error.code, code);
    if (path !== undefined) assert.equal(error.path, path);
    return true;
  });
};

test('blocked configuration segments, at any depth and regardless of case', () => {
  const blocked = [
    'AGENTS.md',
    'agents.md',
    'notes/Agents.MD',
    'docs/CLAUDE.md',
    'SKILL.md',
    'skills/skill.md',
    '.opencode/agents/reviewer.md',
    'deep/.opencode/plugins/x.md',
    '.obsidian/app.json',
    '.git/config',
    'sub/.git/HEAD',
    '.gitmodules',
    '.GITATTRIBUTES',
    'opencode.json',
    'opencode.jsonc',
    'OPencode.JSONC',
  ];
  for (const path of blocked) assert.ok(isBlockedPackagePath(path), `expected blocked: ${path}`);

  const allowed = [
    'index.md',
    'resources/ohms-law.md',
    'notes/agenda.md',
    'docs/agents-and-models.md',
    'docs/cli-skills.md',
    'assets/circuito-01.png',
  ];
  for (const path of allowed) assert.ok(!isBlockedPackagePath(path), `expected allowed: ${path}`);
  assert.equal(BLOCKED_PACKAGE_SEGMENTS.includes('AGENTS.md'), true);
});

test('file extension allowlist without rejecting inert text', () => {
  for (const path of ['a.md', 'b.yaml', 'c.yml', 'd.txt', 'e.png', 'f.jpg', 'g.jpeg', 'h.webp', 'UPPER.MD']) {
    assert.ok(isAllowedPackageFilePath(path), `expected allowlisted: ${path}`);
  }
  for (const path of ['x.exe', 'y.json', 'z.html', 'w.js', 'run.sh', '.gitignore', 'README', 'a/opencode.json']) {
    assert.ok(!isAllowedPackageFilePath(path), `expected rejected: ${path}`);
  }
  assert.equal(PACKAGE_FILE_EXTENSIONS.includes('.webp'), true);

  // Policy checks paths only: markdown prose mentioning blocked names is inert content.
  const source = [
    'El archivo AGENTS.md no debe instalarse nunca.',
    '',
    'Tampoco .opencode ni .obsidian.',
    '',
    '```sh',
    'cat AGENTS.md',
    '```',
    '',
    'Y `CLAUDE.md` como texto en línea.',
  ].join('\n');
  const analysis = analyzeMarkdown(source);
  assert.deepEqual(analysis.errors, []);
});

test('assertPackageFilePath returns the path or throws a coded error', () => {
  assert.equal(assertPackageFilePath('notes/one.md'), 'notes/one.md');
  expectCode('BLOCKED_PATH', () => assertPackageFilePath('AGENTS.md'), 'AGENTS.md');
  expectCode('BLOCKED_PATH', () => assertPackageFilePath('pkg/.opencode/x.md'), 'pkg/.opencode/x.md');
  expectCode('EXTENSION_NOT_ALLOWED', () => assertPackageFilePath('setup.json'), 'setup.json');
  expectCode('INVALID_PATH', () => assertPackageFilePath('../escape.md'), '../escape.md');
  expectCode('INVALID_PATH', () => assertPackageFilePath('a\\b.md'), 'a\\b.md');
});

test('CC0 dedication fixture is inert, allowlisted license text', () => {
  const cc0 = readFileSync(new URL('../../../fixtures/content/licenses/CC0-1.0.txt', import.meta.url), 'utf8');
  assert.ok(cc0.includes('CC0 1.0 Universal'));
  assert.ok(cc0.includes('Waiver'));
  assert.equal(assertPackageFilePath('licenses/CC0-1.0.txt'), 'licenses/CC0-1.0.txt');
  assert.ok(isTextFile('licenses/CC0-1.0.txt'));
  // plain license prose triggers no structural Markdown errors either
  assert.deepEqual(analyzeMarkdown(cc0).errors, []);
});
