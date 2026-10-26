/**
 * Sandbox handling for the F0 spike.
 *
 * Rules (audit findings):
 *  - the sandbox is created with `mkdtemp` under /tmp/opencode and chmod 0700: no pre-existing
 *    path is ever reused or deleted;
 *  - log files are created 0600 and the ephemeral `server password` line is redacted in the
 *    stream BEFORE any byte reaches the disk;
 *  - cleanup removes ONLY the directory returned by mkdtemp (never someone else's), and keeps
 *    it at 0700 when `--keep-evidence` is passed explicitly.
 */
import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"

export const SANDBOX_PARENT = "/tmp/opencode"
export const SANDBOX_PREFIX = "f0-spike-"
const OWNERSHIP_MARKER = ".f0-spike-owned"

export interface Sandbox {
  readonly root: string
  readonly home: string
  readonly configDir: string
  readonly project: string
  readonly stateDir: string
  readonly evidenceFile: string
  readonly controlFile: string
  readonly consentFile: string
  readonly logPath: string
  readonly globalConfigFile: string
  /** Random token written to `<root>/.f0-spike-owned`: cleanup refuses any directory without it. */
  readonly token: string
}

function ensureParent(): void {
  if (!fs.existsSync(SANDBOX_PARENT)) fs.mkdirSync(SANDBOX_PARENT, { recursive: true, mode: 0o700 })
}

/** Creates a brand-new sandbox directory (mkdtemp) with mode 0700 and an ownership marker. */
export function createSandbox(): Sandbox {
  ensureParent()
  const root = fs.mkdtempSync(path.join(SANDBOX_PARENT, SANDBOX_PREFIX))
  fs.chmodSync(root, 0o700)

  const home = path.join(root, "home")
  const configDir = path.join(home, ".config")
  const project = path.join(root, "project")
  const stateDir = path.join(project, ".f0-spike")
  for (const dir of [home, configDir, project, stateDir]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const token = randomBytes(16).toString("hex")
  const sandbox: Sandbox = {
    root,
    home,
    configDir,
    project,
    stateDir,
    evidenceFile: path.join(stateDir, "evidence.jsonl"),
    controlFile: path.join(stateDir, "control.json"),
    consentFile: path.join(stateDir, "consent.json"),
    logPath: path.join(root, "opencode-serve.log"),
    globalConfigFile: path.join(configDir, "opencode", "opencode.json"),
    token,
  }
  fs.mkdirSync(path.dirname(sandbox.globalConfigFile), { recursive: true, mode: 0o700 })
  writeFile0600(path.join(root, OWNERSHIP_MARKER), token)
  return sandbox
}

/**
 * Global configuration for the FAKE home. Per V2 the `update` switch only has effect in the
 * global config (project-level `update` is ignored), so it is set here too. The real user
 * configuration is never read or written by the spike.
 */
export function writeGlobalHomeConfig(sandbox: Sandbox): void {
  const body = { $schema: "https://opencode.ai/config.json", update: "disable", share: "disabled" }
  writeFile0600(sandbox.globalConfigFile, JSON.stringify(body, null, 2))
}

export function writeFile0600(file: string, contents: string): void {
  const fd = fs.openSync(file, "w", 0o600)
  try {
    fs.writeSync(fd, contents)
  } finally {
    fs.closeSync(fd)
  }
  fs.chmodSync(file, 0o600)
}

export function fileMode(file: string): number | null {
  try {
    return fs.statSync(file).mode & 0o777
  } catch {
    return null
  }
}

/**
 * Log sink that never persists the ephemeral serve password: lines are held until complete and
 * any occurrence of the password is replaced with `[REDACTED]` before the write.
 */
export interface RedactingLog {
  append(chunk: string): void
  /** Password observed in the stream (memory only, never written to disk). */
  password(): string | null
  close(): void
  readonly path: string
}

class RedactingFileLog implements RedactingLog {
  readonly path: string
  private readonly fd: number
  private secret: string | null = null
  private held = ""

  constructor(file: string) {
    this.path = file
    this.fd = fs.openSync(file, "w", 0o600)
    fs.chmodSync(file, 0o600)
  }

  password(): string | null {
    return this.secret
  }

  append(chunk: string): void {
    this.held += chunk
    const lastNewline = this.held.lastIndexOf("\n")
    if (lastNewline < 0) return
    const ready = this.held.slice(0, lastNewline + 1)
    this.held = this.held.slice(lastNewline + 1)
    // A token can itself span chunks. Learn it only from a complete line.
    if (this.secret === null) {
      const match = /server password (\S+)/.exec(ready)
      if (match) this.secret = match[1] ?? null
    }
    this.flush(ready)
  }

  private flush(text: string): void {
    const knownRedacted = this.secret === null ? text : text.split(this.secret).join("[REDACTED]")
    // Also redact an unterminated password line when the process closes early.
    const safe = knownRedacted.replace(/(server password[ \t]+)\S+/g, "$1[REDACTED]")
    fs.writeSync(this.fd, safe)
  }

  close(): void {
    if (this.held.length > 0) {
      this.flush(this.held)
      this.held = ""
    }
    fs.closeSync(this.fd)
  }
}

export function openRedactingLog(file: string): RedactingLog {
  return new RedactingFileLog(file)
}

export interface CleanupResult {
  removed: boolean
  kept: boolean
  reason: string
}

/**
 * Removes ONLY the mkdtemp directory this run created. Any other path (pre-existing decoy,
 * foreign directory, path outside /tmp/opencode) is refused.
 */
export function cleanupSandbox(sandbox: Sandbox, keepEvidence: boolean): CleanupResult {
  const root = path.resolve(sandbox.root)
  const parent = path.resolve(SANDBOX_PARENT)
  const insideParent = root.startsWith(parent + path.sep)
  const namedOurs = path.basename(root).startsWith(SANDBOX_PREFIX)
  let owned = false
  try {
    owned = fs.readFileSync(path.join(root, OWNERSHIP_MARKER), "utf8") === sandbox.token
  } catch {
    owned = false
  }
  if (!insideParent || !namedOurs || !owned) {
    return {
      removed: false,
      kept: true,
      reason: `refused to clean a path that is not this run's mkdtemp sandbox under ${parent}/${SANDBOX_PREFIX}*: ${root}`,
    }
  }
  if (keepEvidence) {
    try {
      fs.chmodSync(root, 0o700)
    } catch {
      /* best effort */
    }
    return { removed: false, kept: true, reason: "--keep-evidence: sandbox retained at 0700" }
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  return { removed: !fs.existsSync(root), kept: false, reason: "sandbox removed" }
}
