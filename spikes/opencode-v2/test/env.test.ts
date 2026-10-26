/**
 * Runtime/environment regression for the F0 spike launcher: the allowlist must drop credentials,
 * proxies and Node/loader configuration, and sentinels must be absent in a REAL child process.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { it } from "node:test"
import {
  ALLOWLIST_FIXED,
  NODE24_DIR,
  PINS,
  buildAllowlistEnv,
  envMatchesAllowlist,
  sentinelPresence,
  verifyPins,
  verifyPinnedNode,
} from "../lib/bootstrap.ts"
import { SENTINEL_ENV_VARS } from "../lib/contracts.ts"

const dirtyEnv: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/someone",
  F0_SENTINEL_AWS_SECRET_ACCESS_KEY: "fake-aws-value",
  F0_SENTINEL_OPENAI_API_KEY: "fake-openai-value",
  F0_SENTINEL_ANTHROPIC_API_KEY: "fake-anthropic-value",
  F0_SENTINEL_HTTPS_PROXY: "http://127.0.0.1:9",
  F0_SENTINEL_NODE_OPTIONS: "--no-deprecation",
  F0_SENTINEL_LD_LIBRARY_PATH: "/tmp/fake-lib",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1",
  NODE_OPTIONS: "--no-deprecation",
  LD_LIBRARY_PATH: "/tmp/fake-lib",
  LD_PRELOAD: "/tmp/fake.so",
  AWS_ACCESS_KEY_ID: "fake",
  AWS_SECRET_ACCESS_KEY: "fake",
  OPENAI_API_KEY: "fake",
  ANTHROPIC_API_KEY: "fake",
  GITHUB_TOKEN: "fake",
}

it("allowlist keeps only PATH plus the fixed fixture keys", () => {
  const env = buildAllowlistEnv(dirtyEnv)
  assert.deepEqual(Object.keys(env).sort(), [...Object.keys(ALLOWLIST_FIXED), "PATH"].sort())
  assert.ok(env["PATH"]?.startsWith(NODE24_DIR))
  assert.equal(env["LC_ALL"], "C.UTF-8")
  assert.equal(env["F0_FIXTURE_API_KEY"], "f0-fixture-dummy")
  for (const sentinel of SENTINEL_ENV_VARS) assert.equal(env[sentinel], undefined, `${sentinel} must not survive`)
  for (const leaked of ["NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "HTTP_PROXY", "HTTPS_PROXY", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "HOME"]) {
    assert.equal(env[leaked], undefined, `${leaked} must not survive`)
  }
})

it("allowlist building is idempotent so a relaunch cannot loop", () => {
  const once = buildAllowlistEnv(dirtyEnv)
  const twice = buildAllowlistEnv(once)
  assert.deepEqual(once, twice)
  assert.ok(envMatchesAllowlist(once))
  assert.equal(envMatchesAllowlist(dirtyEnv), false)
  assert.equal(envMatchesAllowlist({ ...once, EXTRA: "x" }), false)
})

it("sentinel presence is reported as booleans only", () => {
  const presence = sentinelPresence(dirtyEnv, SENTINEL_ENV_VARS)
  assert.equal(Object.keys(presence).length, SENTINEL_ENV_VARS.length)
  for (const [name, present] of Object.entries(presence)) {
    assert.equal(typeof present, "boolean", name)
    assert.equal(present, true, `${name} should be present in the dirty env`)
  }
  const clean = sentinelPresence(buildAllowlistEnv(dirtyEnv), SENTINEL_ENV_VARS)
  for (const present of Object.values(clean)) assert.equal(present, false)
})

it("a REAL child process spawned with the allowlist sees no sentinels", () => {
  const env = buildAllowlistEnv(dirtyEnv)
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const names = ${JSON.stringify([...SENTINEL_ENV_VARS, "NODE_OPTIONS", "LD_PRELOAD", "HTTP_PROXY", "AWS_SECRET_ACCESS_KEY"])};` +
        "const present = {}; for (const n of names) present[n] = process.env[n] !== undefined;" +
        "process.stdout.write(JSON.stringify(present))",
    ],
    { env, encoding: "utf8" },
  )
  assert.equal(child.status, 0, child.stderr)
  const parsed: unknown = JSON.parse(child.stdout ?? "{}")
  if (typeof parsed !== "object" || parsed === null) assert.fail("child must report an object")
  for (const [name, value] of Object.entries(parsed)) {
    assert.equal(value, false, `${name} leaked into the child process`)
  }
})

it("pins are exact and the pinned Node binary reports 24.22.1", () => {
  const pins = verifyPins()
  const nonNode = pins.checks.filter((check) => check.name !== "node")
  for (const check of nonNode) {
    assert.equal(check.ok, true, `${check.name}: expected ${check.expected}, got ${check.actual ?? "unavailable"}`)
  }
  const nodeCheck = pins.checks.find((check) => check.name === "node")
  assert.equal(nodeCheck?.expected, "24.22.1")
  // this test may run on the host Node: the check must then report the mismatch, not hide it
  assert.equal(nodeCheck?.ok, process.versions.node === "24.22.1")
  assert.equal(PINS.node, "24.22.1")
  assert.equal(PINS.opencode, "2.1.3")
  assert.equal(verifyPinnedNode("/nonexistent/pinned-node").ok, false)
  assert.equal(verifyPins({ opencodeBin: "/nonexistent/opencode" }).ok, false)
})
