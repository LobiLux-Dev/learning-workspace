/**
 * Bootstrap guards for the F0 spike: exact version pins and the environment allowlist.
 *
 * Only Node builtins are imported here. The launcher (`run.mjs`) must be able to verify the
 * pins BEFORE anything imports `@opencode/client`, and must be able to rebuild a clean
 * environment without inheriting credentials, proxies or Node/DynamicLoader configuration.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { PinCheck, PinReport } from "./contracts.ts"
import { isRecord } from "./logic.ts"

export const SPIKE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const ROOT_DIR = path.resolve(SPIKE_DIR, "..", "..")

/** Exact pins (spec §9.1: patch versions are fixed, no "compatible with" claims). */
export const PINS = {
  node: "24.22.1",
  opencode: "2.1.3",
  plugin: "2.1.3",
  client: "2.1.3",
} as const

export const NODE24_DIR = "/tmp/opencode/learning-workspace-node24/node_modules/node/bin"
export const NODE24_BIN = path.join(NODE24_DIR, "node")
export const OPENCODE_BIN = "/usr/bin/opencode"

/** Keys copied from the parent environment: everything else is dropped (allowlist). */
export const ALLOWLIST_KEYS: readonly string[] = ["PATH"]

/** Fixed values written into every environment the spike spawns. */
export const ALLOWLIST_FIXED: Readonly<Record<string, string>> = {
  LC_ALL: "C.UTF-8",
  LANG: "C.UTF-8",
  TZ: "UTC",
  NO_COLOR: "1",
  F0_FIXTURE_API_KEY: "f0-fixture-dummy",
}

function readPackageVersion(root: string, pkg: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(root, "node_modules", ...pkg.split("/"), "package.json"), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed)) {
      const version = parsed["version"]
      if (typeof version === "string") return version
    }
  } catch {
    return null
  }
  return null
}

function probeVersion(bin: string, args: string[]): string | null {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin" } })
  if (result.error || result.status !== 0) return null
  return (result.stdout ?? "").trim()
}

/**
 * Verifies every pin from an environment-independent source (files + `--version`).
 * The launcher calls this before importing the runner, which imports the SDK.
 */
export function verifyPins(options?: { root?: string; opencodeBin?: string }): PinReport {
  const root = options?.root ?? ROOT_DIR
  const opencodeBin = options?.opencodeBin ?? OPENCODE_BIN
  const cli = probeVersion(opencodeBin, ["--version"])
  const checks: PinCheck[] = [
    {
      name: "node",
      expected: PINS.node,
      actual: process.versions.node,
      ok: process.versions.node === PINS.node,
      source: "process.versions.node",
    },
    {
      name: "opencode-cli",
      expected: `opencode v${PINS.opencode}`,
      actual: cli,
      ok: cli === `opencode v${PINS.opencode}`,
      source: opencodeBin,
    },
    {
      name: "@opencode/plugin",
      expected: PINS.plugin,
      actual: readPackageVersion(root, "@opencode/plugin"),
      ok: readPackageVersion(root, "@opencode/plugin") === PINS.plugin,
      source: "node_modules/@opencode/plugin/package.json",
    },
    {
      name: "@opencode/client",
      expected: PINS.client,
      actual: readPackageVersion(root, "@opencode/client"),
      ok: readPackageVersion(root, "@opencode/client") === PINS.client,
      source: "node_modules/@opencode/client/package.json",
    },
  ]
  return { ok: checks.every((check) => check.ok), checks }
}

export function formatPinFailure(report: PinReport): string {
  const bad = report.checks.filter((check) => !check.ok)
  return `f0-spike: version pin mismatch, integration NOT started (${bad
    .map((check) => `${check.name} expected=${check.expected} actual=${check.actual ?? "unavailable"}`)
    .join("; ")})`
}

/**
 * Builds the minimal environment for every spike child process. Only PATH (extended with the
 * pinned Node directory, idempotently) and the fixed values survive: no HOME/XDG inherited from
 * the caller, no cloud/model credentials, no proxies, no NODE_OPTIONS, no LD_* loader config.
 */
export function buildAllowlistEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const parentPath = base["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"
  const entries = parentPath.split(":")
  const path = entries.includes(NODE24_DIR) ? parentPath : `${NODE24_DIR}:${parentPath}`
  const env: Record<string, string> = { ...ALLOWLIST_FIXED }
  for (const key of ALLOWLIST_KEYS) env[key] = path
  return env
}

/** True when `base` contains exactly the allowlist keys with the expected values. */
export function envMatchesAllowlist(base: NodeJS.ProcessEnv): boolean {
  const expected = buildAllowlistEnv(base)
  const present = Object.keys(base).filter((key) => base[key] !== undefined)
  if (present.length !== Object.keys(expected).length) return false
  for (const [key, value] of Object.entries(expected)) {
    if (base[key] !== value) return false
  }
  for (const key of present) {
    if (!(key in expected)) return false
  }
  return true
}

/** Booleans only: which sentinel variables are present. Values are never read into reports. */
export function sentinelPresence(env: NodeJS.ProcessEnv, names: readonly string[]): Record<string, boolean> {
  const present: Record<string, boolean> = {}
  for (const name of names) present[name] = env[name] !== undefined
  return present
}

/** Verifies the pinned Node binary exists and reports exactly the pinned version. */
export function verifyPinnedNode(bin: string): { ok: boolean; actual: string | null; error: string | null } {
  if (!fs.existsSync(bin)) return { ok: false, actual: null, error: `pinned node binary missing: ${bin}` }
  const version = probeVersion(bin, ["--version"])
  if (version === null) return { ok: false, actual: null, error: `pinned node binary not runnable: ${bin}` }
  if (version.replace(/^v/, "") !== PINS.node) {
    return { ok: false, actual: version, error: `pinned node is ${version}, expected v${PINS.node}` }
  }
  return { ok: true, actual: version, error: null }
}
