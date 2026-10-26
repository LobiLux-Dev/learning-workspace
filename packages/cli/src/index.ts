#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { schemaRegistry, parseYaml, assertPortablePath } from '@learning-workspace/schemas';

const VERSION = '0.1.0';
const REQUIRED_NODE_VERSION = '24.22.1';
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const help = `Learning Workspace ${VERSION} — F0 only

Usage:
  learn --help
  learn --version
  learn f0 schemas
  learn f0 validate <SchemaName> <yaml-or-json-file>
  learn f0 path <relative-path>
  learn f0 capabilities

These commands validate data locally; they do not install Notebooks, create
enrollments, open a Portfolio, persist academic state or invoke any model.
Domain commands (init, study, progress, etc.) are not implemented in F0.
`;

async function readUtf8Input(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Input must be a regular file, not a symlink or device');
    if (stat.size > MAX_INPUT_BYTES) throw new Error('Input exceeds the 2 MiB limit');
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_INPUT_BYTES) throw new Error('Input exceeds the 2 MiB limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

async function main(args: readonly string[]): Promise<void> {
  if (process.versions.node !== REQUIRED_NODE_VERSION) {
    throw new Error(`Exact Node.js ${REQUIRED_NODE_VERSION} LTS is required; use .node-version`);
  }
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log(help);
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    console.log(VERSION);
    return;
  }
  if (args.length === 2 && args[0] === 'f0' && args[1] === 'schemas') {
    console.log(JSON.stringify(Object.keys(schemaRegistry).sort(), null, 2));
    return;
  }
  if (args.length === 2 && args[0] === 'f0' && args[1] === 'capabilities') {
    console.log(JSON.stringify({
      phase: 'F0',
      requiredNodeVersion: REQUIRED_NODE_VERSION,
      localContractValidation: true,
      academicPersistence: false,
      academicMutations: false,
      pedagogicalAgents: false,
      personalDataIntegration: false,
      remoteModelDispatch: false,
      note: 'The isolated spike is diagnostic evidence only, not a product integration authorization.',
    }, null, 2));
    return;
  }
  if (args.length === 3 && args[0] === 'f0' && args[1] === 'path' && args[2]) {
    assertPortablePath(args[2]);
    console.log(JSON.stringify({ valid: true, path: args[2] }));
    return;
  }
  if (args.length === 4 && args[0] === 'f0' && args[1] === 'validate' && args[2] && args[3]) {
    if (!Object.hasOwn(schemaRegistry, args[2])) throw new Error('Unknown schema; run learn f0 schemas');
    const schema = schemaRegistry[args[2] as keyof typeof schemaRegistry];
    if (schema === undefined) throw new Error('Unknown schema; run learn f0 schemas');
    // Zod receives untrusted values, never authorization context or executable input.
    parseYaml(await readUtf8Input(args[3]), schema);
    console.log(JSON.stringify({ valid: true, schema: args[2] }));
    return;
  }
  throw new Error('Unsupported command: this checkout implements F0 validators only. Run learn --help');
}

try {
  await main(process.argv.slice(2));
} catch (error: unknown) {
  const isFileError = error instanceof Error && 'syscall' in error;
  const message = isFileError ? 'Cannot read input safely; check the regular file and permissions' : error instanceof Error ? error.message : 'Validation failed';
  console.error(JSON.stringify({ code: 'F0_VALIDATION_ERROR', message }));
  process.exitCode = isFileError ? 1 : 2;
}
