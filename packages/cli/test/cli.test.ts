import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function run(...args: string[]) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), ...args], {
    encoding: 'utf8', timeout: 10_000,
  });
}

test('CLI advertises only implemented F0 validators', () => {
  assert.equal(run('--version').stdout.trim(), '0.1.0');
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /F0 only/);
  assert.match(result.stdout, /not implemented in F0/);
});

test('CLI fails closed for all product integration capabilities and future commands', () => {
  const result = run('f0', 'capabilities');
  assert.equal(result.status, 0);
  const capabilities = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(capabilities['requiredNodeVersion'], '24.22.1');
  for (const key of ['academicPersistence', 'academicMutations', 'pedagogicalAgents', 'personalDataIntegration', 'remoteModelDispatch']) {
    assert.equal(capabilities[key], false);
  }
  assert.equal(run('init').status, 2);
  assert.equal(run('study').status, 2);
});

test('CLI validates portable paths without normalizing unsafe inputs', () => {
  assert.equal(run('f0', 'path', 'resources/ohms-law.md').status, 0);
  for (const path of ['../secret', '/absolute', 'resources/NUL.md', 'a%2fb.md']) {
    assert.equal(run('f0', 'path', path).status, 2, path);
  }
});

test('CLI safely validates a synthetic profile and rejects unknown fields, symlinks and malformed UTF8', async () => {
  const base = process.env['TMPDIR'] ?? '/tmp/opencode';
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, 'learning-workspace-cli-'));
  const file = join(directory, 'profile.yaml');
  try {
    const body = `schema_version: '1.0'\nlearner_uid: '019a3dda-cc44-73c0-989a-2e14c65d13e1'\npreferred_instruction_language: es-MX\npreferences:\n  explanation_detail: adaptive\n  preferred_session_minutes: 25\n`;
    await writeFile(file, body);
    assert.equal(run('f0', 'validate', 'Profile', file).status, 0);
    await writeFile(file, `${body}unexpected: true\n`);
    assert.equal(run('f0', 'validate', 'Profile', file).status, 2);
    await symlink(file, join(directory, 'linked.yaml'));
    assert.equal(run('f0', 'validate', 'Profile', join(directory, 'linked.yaml')).status, 1);
    await writeFile(file, Buffer.from([0xff, 0xfe]));
    assert.equal(run('f0', 'validate', 'Profile', file).status, 2);
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.equal(run('f0', 'validate', 'Profile', file).status, 2);
    assert.equal(run('f0', 'validate', 'Nonexistent', file).status, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
