import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('F0 environment probe exercises real SQLite, backup, fsync and no-replace on Linux', () => {
  const result = spawnSync(process.execPath, ['scripts/probe-environment.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report: unknown = JSON.parse(result.stdout);
  assert.ok(typeof report === 'object' && report !== null && 'checks' in report);
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.length >= 7);
  for (const check of report.checks) assert.equal(check.status, 'passed');
});

test('workspace dependencies are exact and npm lockfile exists', () => {
  const manifests = ['package.json', 'packages/schemas/package.json', 'packages/core/package.json', 'packages/cli/package.json'];
  for (const file of manifests) {
    const manifest = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
      assert.match(version, /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i, `${file}: dependency must be pinned`);
    }
  }
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as { lockfileVersion: number };
  assert.equal(lock.lockfileVersion, 3);
});

test('runtime guard rejects other Node 24 patches as well as other majors', () => {
  const code = `
    import assert from 'node:assert/strict';
    import { assertRuntimeVersion, requiredNodeVersion } from './scripts/check-runtime.mjs';
    assert.equal(requiredNodeVersion, '24.22.1');
    assert.doesNotThrow(() => assertRuntimeVersion('24.22.1'));
    for (const version of ['24.0.0', '24.21.0', '24.22.0', '24.22.2', '26.12.1']) {
      assert.throws(() => assertRuntimeVersion(version), /requires exact/);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const pin = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    engines: { node: string }; packageManager: string;
  };
  assert.equal(manifest.engines.node, pin);
  assert.equal(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(), pin);
});
