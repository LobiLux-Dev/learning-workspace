#!/usr/bin/env node
/**
 * F0 spike launcher (the ONLY entry point: `npm run spike:opencode` → `node spikes/opencode-v2/run.mjs`).
 *
 * Guarantees enforced BEFORE anything imports `@opencode/client` (the SDK lives in runner.ts):
 *   1. exact version pins — Node 24.22.1, opencode CLI 2.1.3, @opencode/plugin 2.1.3,
 *      @opencode/client 2.1.3; a mismatch exits non-zero WITHOUT starting any integration;
 *   2. a minimal environment allowlist — the runner is NEVER executed with the inherited
 *      environment (no cloud/model credentials, no proxies, no NODE_OPTIONS, no LD_*), so the
 *      launcher relaunches itself under the pinned Node binary with a clean environment and
 *      never forwards the caller's environment.
 *
 * Then it imports `runner.ts` (native TypeScript stripping on Node 24) and forwards its exit code.
 *
 * Test hook: `F0_SPIKE_NODE24_BIN` overrides the pinned binary location (used by
 * `spikes/opencode-v2/test/launcher.test.ts` to prove the pin gate exits before the SDK loads).
 */
import { spawnSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"

const BOOTSTRAP_ERROR = 2
const self = fileURLToPath(import.meta.url)

let bootstrap
try {
  bootstrap = await import("./lib/bootstrap.ts")
} catch (error) {
  process.stderr.write(`f0-spike: cannot load the bootstrap module: ${String(error?.message ?? error)}\n`)
  process.exit(BOOTSTRAP_ERROR)
}

const { PINS, buildAllowlistEnv, envMatchesAllowlist, verifyPins, verifyPinnedNode } = bootstrap
const currentIsPinned = process.versions.node === PINS.node
const pinnedNodeBin =
  process.env["F0_SPIKE_NODE24_BIN"] ?? (currentIsPinned ? process.execPath : "/tmp/opencode/learning-workspace-node24/node_modules/node/bin/node")

// --- 1. pinned Node runtime --------------------------------------------------------------------
if (!currentIsPinned || process.env["F0_SPIKE_NODE24_BIN"] !== undefined) {
  const pinned = verifyPinnedNode(pinnedNodeBin)
  if (!pinned.ok) {
    process.stderr.write(
      `f0-spike: refusing to run — ${pinned.error ?? "pinned Node unavailable"}; integration NOT started\n`,
    )
    process.exit(BOOTSTRAP_ERROR)
  }
}

// --- 2. clean environment: relaunch with the allowlist only (never forward the caller's env) ----
const cleanEnv = buildAllowlistEnv(process.env)
if (!currentIsPinned || !envMatchesAllowlist(process.env)) {
  const relaunch = spawnSync(pinnedNodeBin, [self, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: cleanEnv,
  })
  if (relaunch.error !== undefined && relaunch.error !== null) {
    process.stderr.write(`f0-spike: relaunch under the pinned Node failed: ${String(relaunch.error.message)}\n`)
    process.exit(BOOTSTRAP_ERROR)
  }
  process.exit(relaunch.status ?? BOOTSTRAP_ERROR)
}

// --- 3. exact version pins, verified BEFORE the SDK import --------------------------------------
const pins = verifyPins()
if (!pins.ok) {
  process.stderr.write(
    `f0-spike: version pin mismatch, integration NOT started (${pins.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name} expected=${check.expected} actual=${check.actual ?? "unavailable"}`)
      .join("; ")})\n`,
  )
  process.exit(BOOTSTRAP_ERROR)
}

// --- 4. everything verified → run the typed runner ------------------------------------------------
const runner = await import("./runner.ts")
process.exitCode = await runner.main()
