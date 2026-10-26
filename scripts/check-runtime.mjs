import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredNodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();

export function assertRuntimeVersion(actual) {
  if (actual !== requiredNodeVersion) {
    throw new Error(`F0 requires exact Node.js ${requiredNodeVersion} LTS; received ${actual}. See .node-version.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assertRuntimeVersion(process.versions.node);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
