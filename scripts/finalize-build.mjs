import { chmod } from 'node:fs/promises';

// tsc preserves the shebang, but does not set the executable bit for package bins.
await chmod(new URL('../packages/cli/dist/index.js', import.meta.url), 0o755);
