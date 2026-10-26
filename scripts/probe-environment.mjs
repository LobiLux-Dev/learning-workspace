import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { assertRuntimeVersion } from './check-runtime.mjs';

const require = createRequire(import.meta.url);

// Probe only: this deliberately does not expose a production publication API.
const renameNoReplaceProbe = String.raw`
import ctypes, errno, json, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
libc = ctypes.CDLL(None, use_errno=True)
try:
    renameat2 = libc.renameat2
except AttributeError:
    print(json.dumps({"status":"blocked","reason":"libc.renameat2 unavailable"}))
    sys.exit(0)
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
source, target = root/'native-source', root/'native-target'
source.mkdir(); target.mkdir()
(source/'marker.txt').write_bytes(b'new-synthetic')
(target/'marker.txt').write_bytes(b'existing-synthetic')
def move():
    result = renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1)
    return result, ctypes.get_errno()
result, error = move()
if result != -1 or error != errno.EEXIST:
    raise RuntimeError(f'Expected EEXIST without replacing destination, got result={result} errno={error}')
assert (source/'marker.txt').read_bytes() == b'new-synthetic'
assert (target/'marker.txt').read_bytes() == b'existing-synthetic'
(target/'marker.txt').unlink(); target.rmdir()
result, error = move()
if result != 0:
    raise OSError(error, 'renameat2(RENAME_NOREPLACE) failed for absent destination')
assert not source.exists()
assert (target/'marker.txt').read_bytes() == b'new-synthetic'
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
print(json.dumps({"status":"passed","primitive":"renameat2(RENAME_NOREPLACE)","existingDestinationPreserved":True,"absentDestinationPublished":True}))
`;

export async function probeEnvironment(baseDir = process.cwd()) {
  assertRuntimeVersion(process.versions.node);
  const checks = [];
  const evidenceParent = resolve(baseDir, '.f0-evidence');
  await mkdir(evidenceParent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(evidenceParent, 'environment-'));
  let db;
  try {
    checks.push({ name: 'node24-exact-pin', status: 'passed' });
    db = new Database(join(temporary, 'synthetic.sqlite'));
    db.pragma('foreign_keys = ON');
    const journalMode = db.pragma('journal_mode = WAL', { simple: true });
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    assert.equal(journalMode, 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    checks.push({ name: 'sqlite-wal-full-foreign-keys', status: 'passed' });
    db.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(body); INSERT INTO probe_fts(body) VALUES ('synthetic electronics fixture');");
    const found = db.prepare("SELECT count(*) AS count FROM probe_fts WHERE probe_fts MATCH 'electronics'").get();
    assert.equal(found.count, 1);
    checks.push({ name: 'sqlite-fts5', status: 'passed' });
    db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO probe VALUES (1, 'synthetic-backup');");
    await db.backup(join(temporary, 'synthetic-backup.sqlite'));
    const restored = new Database(join(temporary, 'synthetic-backup.sqlite'), { readonly: true });
    try {
      assert.equal(restored.prepare('SELECT value FROM probe WHERE id=1').get().value, 'synthetic-backup');
      assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      restored.close();
    }
    checks.push({ name: 'sqlite-backup-api-with-live-wal', status: 'passed' });
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
    db.close();
    db = undefined;

    const file = await open(join(temporary, 'fsync-source'), 'wx', 0o600);
    try {
      await file.writeFile(Buffer.from('synthetic-fsync\r\n', 'utf8'));
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(temporary, 'r');
    try {
      await directory.sync();
      await rename(join(temporary, 'fsync-source'), join(temporary, 'fsync-target'));
      await directory.sync();
    } finally {
      await directory.close();
    }
    assert.deepEqual(await readFile(join(temporary, 'fsync-target')), Buffer.from('synthetic-fsync\r\n'));
    checks.push({ name: 'file-and-directory-fsync', status: 'passed' });

    // Demonstrate why fs.rename alone is NOT the publication primitive.
    await writeFile(join(temporary, 'ordinary-source'), 'new');
    await writeFile(join(temporary, 'ordinary-target'), 'existing');
    await rename(join(temporary, 'ordinary-source'), join(temporary, 'ordinary-target'));
    assert.equal(await readFile(join(temporary, 'ordinary-target'), 'utf8'), 'new');
    checks.push({ name: 'node-rename-is-not-no-replace', status: 'passed', ordinaryRenameReplaces: true });

    if (process.platform === 'linux') {
      const native = spawnSync('python3', ['-c', renameNoReplaceProbe, temporary], {
        encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
      });
      if (native.error?.code === 'ENOENT') {
        checks.push({ name: 'linux-atomic-no-replace', status: 'blocked', reason: 'python3 is unavailable for the diagnostic syscall probe' });
      } else if (native.error || native.status !== 0) {
        throw new Error('Native renameat2 diagnostic failed; no publication capability is enabled');
      } else {
        const result = JSON.parse(native.stdout);
        checks.push({ name: 'linux-atomic-no-replace', ...result });
      }
    } else {
      checks.push({ name: 'linux-atomic-no-replace', status: 'blocked', reason: 'Linux is the only initial acceptance platform' });
    }

    const cli = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    return {
      phase: 'F0',
      syntheticDataOnly: true,
      versions: {
        node: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        sqlite: sqliteVersion,
        betterSqlite3: require('better-sqlite3/package.json').version,
        typescript: require('typescript/package.json').version,
        opencodeCli: cli.status === 0 ? cli.stdout.trim() : null,
      },
      checks,
      limitations: [
        'Probe DBs are synthetic temporary files, not Learning Core persistence or migrations.',
        'A successful fsync syscall does not prove physical power-loss durability.',
        'The Python syscall check is diagnostic only, not a production Node publication binding.',
        'OpenCode permissions and dispatch need the separate isolated spike.',
      ],
    };
  } finally {
    if (db?.open) db.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await probeEnvironment();
    console.log(JSON.stringify(report, null, 2));
    if (report.checks.some((check) => check.status !== 'passed')) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ phase: 'F0', status: 'failed', reason: error instanceof Error ? error.message : 'Environment probe failed' }));
    process.exitCode = 1;
  }
}
