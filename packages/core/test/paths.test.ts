import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PORTABLE_PATH_BYTES,
  PortablePathCollisionError,
  PortablePathError,
  assertNoPortablePathCollisions,
  assertPortablePath,
  caseFoldPath,
  portablePathProblem,
  portablePathSchema,
} from '@learning-workspace/schemas/paths';

test('accepts portable relative POSIX paths and returns them unchanged', () => {
  const valid = [
    'index.md',
    'resources/ohms-law.md',
    'assets/circuito-01.png',
    'notas/árbol de circuitos.md',
    'docs/versión-1.0.md',
    'a'.repeat(MAX_PORTABLE_PATH_BYTES),
    'é'.repeat(120), // exactly 240 UTF-8 bytes
    '.hidden-but-not-a-dotfile-segment/x.md',
  ];
  for (const path of valid) {
    assert.equal(portablePathProblem(path), null, path);
    assert.equal(assertPortablePath(path), path, path);
  }
});

test('rejects invalid paths with a specific reason', () => {
  const invalid: Array<[string, RegExp]> = [
    ['', /empty/],
    ['/abs.md', /absolute/],
    ['//server/share.md', /absolute/],
    ['a//b.md', /empty segment/],
    ['./x.md', /"\."/],
    ['../x.md', /"\.\."/],
    ['a/./b.md', /"\."/],
    ['a/../b.md', /"\.\."/],
    ['dir\\x.md', /segment contains/],
    ['C:/x.md', /segment contains/],
    ['100%.md', /segment contains/],
    ['x\u0000.md', /control character/],
    ['x\u007f.md', /control character/],
    ['con.md', /Windows reserved/],
    ['DIR/PRN.txt', /Windows reserved/],
    ['COM1', /Windows reserved/],
    ['a/trailing.', /dot or a space/],
    ['a/trailing ', /dot or a space/],
    ['e\u0301.md', /NFC/],
    ['a\uD800b.md', /surrogate/],
    ['a'.repeat(MAX_PORTABLE_PATH_BYTES + 1), /240 UTF-8 bytes/],
    ['é'.repeat(121), /240 UTF-8 bytes/],
  ];
  for (const [path, reason] of invalid) {
    const problem = portablePathProblem(path);
    assert.ok(problem !== null, `expected rejection for ${JSON.stringify(path)}`);
    assert.match(problem, reason);
    assert.throws(
      () => assertPortablePath(path),
      (error: unknown) => {
        assert.ok(error instanceof PortablePathError, String(error));
        assert.equal(error.code, 'INVALID_PORTABLE_PATH');
        assert.equal(error.path, path);
        assert.ok(error.reason.length > 0);
        return true;
      },
    );
  }
});

test('collisions use full Unicode case folding, not toLowerCase', () => {
  assert.equal(caseFoldPath('Straße.md'), 'strasse.md');
  assert.equal(caseFoldPath('CON'), 'con');
  assert.notEqual(caseFoldPath('straße'), 'straße'.toLowerCase());

  assert.doesNotThrow(() => assertNoPortablePathCollisions(['a.md', 'b.md', 'sub/c.md']));
  // exact duplicate
  assert.throws(
    () => assertNoPortablePathCollisions(['x.md', 'x.md']),
    (error: unknown) => {
      assert.ok(error instanceof PortablePathCollisionError, String(error));
      assert.equal(error.duplicate, true);
      return true;
    },
  );
  // full folding: ß folds to "ss", so these two collide even though toLowerCase keeps them distinct
  assert.throws(() => assertNoPortablePathCollisions(['strasse.md', 'straße.md']), PortablePathCollisionError);
  // ASCII case difference (the NFC form of a Kelvin-sign name is plain "K")
  assert.throws(() => assertNoPortablePathCollisions(['K.md', 'k.md']), PortablePathCollisionError);
  // case-only difference
  assert.throws(() => assertNoPortablePathCollisions(['Notes/Readme.md', 'notes/readme.md']), PortablePathCollisionError);
  // invalid path inside the list is rejected before any collision is computed
  assert.throws(() => assertNoPortablePathCollisions(['ok.md', 'a/../b.md']), PortablePathError);
});

test('rejects file name characters Windows does not allow', () => {
  const windowsIllegal = ['x?.md', 'x*.md', 'x|.md', 'x<.md', 'x>.md', 'x".md', 'a/b?c.md', 'pregunta?.txt'];
  for (const path of windowsIllegal) {
    const problem = portablePathProblem(path);
    assert.ok(problem !== null, `expected rejection for ${JSON.stringify(path)}`);
    assert.match(problem, /segment contains/);
    assert.throws(() => assertPortablePath(path), PortablePathError);
  }
});

test('rejects Windows reserved device names beyond ASCII com/lpt', () => {
  const reserved = [
    'CON',
    'NUL.md',
    'com1.txt',
    'LPT9.md',
    'COM¹.md', // superscript digits do not case-fold to ASCII digits
    'com².txt',
    'lpt³.md',
    'LPT¹.dat',
    'conin$',
    'CONOUT$.md',
    'docs/PRN',
    'NUL .txt', // basename with a trailing space normalizes to the NUL device
  ];
  for (const path of reserved) {
    const problem = portablePathProblem(path);
    assert.ok(problem !== null, `expected rejection for ${JSON.stringify(path)}`);
    assert.match(problem, /Windows reserved device name/);
  }
  // non-reserved names with extensions keep working
  assert.equal(portablePathProblem('docs/contador.md'), null);
  assert.equal(portablePathProblem('common/setup.md'), null);
});

test('rejects basenames that end with a space before the extension', () => {
  for (const path of ['foo .md', 'notes .yaml', 'a/b .txt']) {
    const problem = portablePathProblem(path);
    assert.ok(problem !== null, `expected rejection for ${JSON.stringify(path)}`);
    assert.match(problem, /space before the extension/);
  }
  // spaces inside the basename are fine (existing positive fixtures rely on it)
  assert.equal(portablePathProblem('notas/árbol de circuitos.md'), null);
});

test('raw U+212A KELVIN SIGN fails NFC before collision logic runs', () => {
  const kelvin = String.fromCharCode(0x212a); // not ASCII K
  assert.notEqual(kelvin.normalize('NFC'), kelvin); // NFC form is ASCII "K"
  const problem = portablePathProblem(`${kelvin}.md`);
  assert.ok(problem !== null);
  assert.match(problem, /NFC/);
  assert.throws(
    () => assertNoPortablePathCollisions([`${kelvin}.md`, 'k.md']),
    (error: unknown) => {
      assert.ok(error instanceof PortablePathError, String(error));
      assert.equal(error.code, 'INVALID_PORTABLE_PATH');
      return true;
    },
  );
  // full case folding still applies to NFC names that differ only by case/folding
  assert.throws(() => assertNoPortablePathCollisions(['straße.md', 'strasse.md']), PortablePathCollisionError);
});

test('portablePathSchema validates through zod', () => {
  assert.equal(portablePathSchema.parse('resources/ohms-law.md'), 'resources/ohms-law.md');
  assert.equal(portablePathSchema.safeParse('a/../b.md').success, false);
  assert.equal(portablePathSchema.safeParse('a\\b.md').success, false);
  assert.equal(portablePathSchema.safeParse('x?.md').success, false);
  assert.equal(portablePathSchema.safeParse('COM¹.md').success, false);
  assert.equal(portablePathSchema.safeParse(42).success, false);
});
