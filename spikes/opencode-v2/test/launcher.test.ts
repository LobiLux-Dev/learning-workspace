/**
 * Launcher guard: with an unusable pinned Node binary the launcher must exit non-zero BEFORE
 * importing the runner (and therefore before `@opencode/client` is loaded), without creating
 * sandboxes or writing the results file.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { it } from "node:test"
import { fileURLToPath } from "node:url"

const SPIKE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT_DIR = path.resolve(SPIKE_DIR, "..", "..")
const RUNNER = path.join(SPIKE_DIR, "run.mjs")
const RESULTS = path.join(SPIKE_DIR, "results", "latest.json")

const dirtyEnv: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/someone",
  F0_SPIKE_NODE24_BIN: "/nonexistent/f0-pinned-node",
  F0_SENTINEL_OPENAI_API_KEY: "fake-key",
  NODE_OPTIONS: "--no-deprecation",
  HTTPS_PROXY: "http://127.0.0.1:9",
}

it("exits non-zero without running the spike when the pinned Node is unusable", () => {
  const resultsBefore = fs.existsSync(RESULTS) ? fs.statSync(RESULTS).mtimeMs : null
  const child = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT_DIR,
    env: dirtyEnv,
    encoding: "utf8",
    timeout: 60_000,
  })

  assert.notEqual(child.status, 0, "launcher must fail the pin gate with a non-zero exit code")
  const stderr = child.stderr ?? ""
  assert.match(
    stderr,
    /refusing to run|relaunch under the pinned Node failed|version pin mismatch/,
    `unexpected launcher stderr: ${stderr.slice(0, 400)}`,
  )
  assert.ok(!(child.stdout ?? "").includes('"spike": "f0-opencode-v2"'), "runner must not have produced a report")
  assert.ok(!(child.stdout ?? "").includes("F0-PROBE"), "runner must not have executed scenario checks")

  const resultsAfter = fs.existsSync(RESULTS) ? fs.statSync(RESULTS).mtimeMs : null
  assert.equal(resultsAfter, resultsBefore, "the results file must not be touched by a pin-gate failure")
})
