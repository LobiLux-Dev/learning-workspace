/**
 * Sandbox regression for the F0 spike: mkdtemp 0700, pre-existing paths are never deleted,
 * logs are 0600 and the ephemeral serve password never reaches the disk.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { it } from "node:test"
import {
  SANDBOX_PARENT,
  SANDBOX_PREFIX,
  cleanupSandbox,
  createSandbox,
  fileMode,
  openRedactingLog,
  writeFile0600,
  writeGlobalHomeConfig,
} from "../lib/sandbox.ts"

function makeDecoy(): { dir: string; marker: string } {
  const dir = path.join(SANDBOX_PARENT, `f0-spike-decoy-test-${process.pid}-${Date.now().toString(36)}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const marker = path.join(dir, "marker.txt")
  fs.writeFileSync(marker, "must survive\n", { mode: 0o600 })
  return { dir, marker }
}

it("creates a fresh mkdtemp sandbox at 0700 and cleans ONLY its own directory", () => {
  const decoy = makeDecoy()
  const sandbox = createSandbox()
  try {
    assert.ok(sandbox.root.startsWith(path.join(SANDBOX_PARENT, SANDBOX_PREFIX)))
    assert.notEqual(sandbox.root, decoy.dir)
    assert.equal(fileMode(sandbox.root), 0o700)
    assert.equal(fileMode(sandbox.stateDir), 0o700)
    assert.ok(fs.existsSync(sandbox.project))

    const result = cleanupSandbox(sandbox, false)
    assert.equal(result.removed, true)
    assert.equal(fs.existsSync(sandbox.root), false)
    // the pre-existing path must be untouched
    assert.equal(fs.existsSync(decoy.marker), true)
    assert.equal(fs.readFileSync(decoy.marker, "utf8"), "must survive\n")
    assert.equal(fileMode(decoy.dir), 0o700)
  } finally {
    if (fs.existsSync(sandbox.root)) fs.rmSync(sandbox.root, { recursive: true, force: true })
    fs.rmSync(decoy.dir, { recursive: true, force: true })
  }
})

it("--keep-evidence retains the sandbox at 0700 and cleanup refuses foreign paths", () => {
  const decoy = makeDecoy()
  const sandbox = createSandbox()
  try {
    const kept = cleanupSandbox(sandbox, true)
    assert.equal(kept.removed, false)
    assert.equal(kept.kept, true)
    assert.equal(fs.existsSync(sandbox.root), true)
    assert.equal(fileMode(sandbox.root), 0o700)

    // a sandbox object pointing at somebody else's directory must be refused
    const foreign = { ...sandbox, root: decoy.dir }
    const refused = cleanupSandbox(foreign, false)
    assert.equal(refused.removed, false)
    assert.equal(refused.kept, true)
    assert.match(refused.reason, /refused/)
    assert.equal(fs.existsSync(decoy.marker), true)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
    fs.rmSync(decoy.dir, { recursive: true, force: true })
  }
})

it("serve logs are 0600 and the server password never reaches the disk", () => {
  const sandbox = createSandbox()
  try {
    const secret = "AbC123SecretValue_do_not_write"
    const log = openRedactingLog(sandbox.logPath)
    // password split across chunks and across a line boundary
    log.append("server listening on http://127.0.0.1:1234\nserver pass")
    assert.equal(log.password(), null)
    log.append(`word ${secret}\nsecond line\n`)
    log.append(`echo ${secret} tail`)
    log.close()

    assert.equal(log.password(), secret)
    const onDisk = fs.readFileSync(sandbox.logPath, "utf8")
    assert.equal(onDisk.includes(secret), false, "password must be redacted on disk")
    assert.match(onDisk, /\[REDACTED\]/)
    assert.match(onDisk, /server listening on http:\/\/127\.0\.0\.1:1234/)
    assert.match(onDisk, /second line/)
    assert.match(onDisk, /tail/)
    assert.equal(fileMode(sandbox.logPath), 0o600)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

it("writes config files at 0600 and the fake-HOME global config disables updates", () => {
  const sandbox = createSandbox()
  try {
    writeGlobalHomeConfig(sandbox)
    const raw = fs.readFileSync(sandbox.globalConfigFile, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      assert.fail("global config must be a JSON object")
    }
    const record = Object.fromEntries(Object.entries(parsed))
    assert.equal(record["update"], "disable")
    assert.equal(record["share"], "disabled")
    assert.equal(fileMode(sandbox.globalConfigFile), 0o600)

    writeFile0600(sandbox.controlFile, "{}")
    assert.equal(fileMode(sandbox.controlFile), 0o600)
    assert.ok(sandbox.globalConfigFile.startsWith(sandbox.home))
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

it("never latches or leaks a password token split across chunks", () => {
  const sandbox = createSandbox()
  try {
    const log = openRedactingLog(sandbox.logPath)
    log.append("server password first-half")
    assert.equal(log.password(), null)
    log.append("-second-half\n")
    assert.equal(log.password(), "first-half-second-half")
    log.close()
    const onDisk = fs.readFileSync(sandbox.logPath, "utf8")
    assert.equal(onDisk.includes("first-half"), false)
    assert.equal(onDisk.includes("second-half"), false)
    assert.match(onDisk, /\[REDACTED\]/)
  } finally {
    cleanupSandbox(sandbox, false)
  }
})

it("redacts a final password line even without its terminating newline", () => {
  const sandbox = createSandbox()
  try {
    const log = openRedactingLog(sandbox.logPath)
    log.append("server password unfinished-secret")
    log.close()
    assert.equal(fs.readFileSync(sandbox.logPath, "utf8").includes("unfinished-secret"), false)
  } finally {
    cleanupSandbox(sandbox, false)
  }
})
