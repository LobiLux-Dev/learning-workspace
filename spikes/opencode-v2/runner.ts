/**
 * F0 OpenCode V2 spike — typed runner (spec §8.2/§9.1/§11, plan §F0).
 *
 * Executed ONLY by `run.mjs` after the launcher verified the exact version pins; this module
 * additionally re-verifies them before any integration (server, client, sessions) starts.
 *
 * What runs for real:
 *  - isolated sandbox (mkdtemp 0700) + fake HOME global config (`update: "disable"`)
 *  - ephemeral loopback fixture provider (127.0.0.1 only, no external network)
 *  - `opencode serve` under a minimal environment allowlist (no inherited credentials/proxies/
 *    NODE_OPTIONS/LD_*), verified by sentinel variables reported as booleans only
 *  - the plugin's direct tool, runtime actor, `learning.approve` assert bound to a SHA-256,
 *    evaluate correlation, deny-by-default checks, child non-escalation and the four dispatch
 *    hooks (context/compaction/generate/title) with positive and negative controls
 *  - disclosure default-deny / remote-destination rejection / loopback acceptance
 *
 * Exit codes: 0 = every check passed; 1 = any check blocked or failed; 2 = pin mismatch or
 * unexpected runner error. `blocked` never counts as verified and never enables a capability.
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import {
  OpenCode,
  type PermissionEffect,
  type PermissionRequest,
  type PermissionSavedInfo,
  type SessionInfo,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
  type V2Event,
} from "@opencode/client"
import {
  OPENCODE_BIN,
  PINS,
  ROOT_DIR,
  SPIKE_DIR,
  buildAllowlistEnv,
  sentinelPresence,
  verifyPins,
} from "./lib/bootstrap.ts"
import {
  SENTINEL_ENV_VARS,
  type Check,
  type CheckStatus,
  type DispatchKind,
  type EvidenceRow,
  type SpikeConsent,
  type SpikeReport,
  type Verdict,
} from "./lib/contracts.ts"
import { freeLoopbackPort, startFixtureProvider, type FixtureProvider } from "./lib/fixture.ts"
import {
  asString,
  denyVerdict,
  disclosureVerdict,
  hookVerdict,
  isRecord,
  parseEvidence,
  savedApprovalVerdict,
  spikeDigest,
  type SavedApprovalStep,
} from "./lib/logic.ts"
import {
  cleanupSandbox,
  createSandbox,
  fileMode,
  openRedactingLog,
  writeFile0600,
  writeGlobalHomeConfig,
  type RedactingLog,
  type Sandbox,
} from "./lib/sandbox.ts"

type Client = ReturnType<typeof OpenCode.make>

// -------------------------------------------------------------------------------------------
// Check registry
// -------------------------------------------------------------------------------------------

const CHECK_IDS = [
  "env.versions-exact",
  "env.node24-runtime",
  "env.allowlist-sentinels",
  "sandbox.isolation-permissions",
  "server.isolated-startup",
  "plugin.recognized",
  "provider.fixture-loopback-dispatch",
  "dispatch.kind-attribution",
  "tool.f0-registered-codemode-off",
  "tool.f0-executed-directly",
  "tool.f0-actor-runtime",
  "approve.ask-sha-correlated",
  "approve.reject",
  "approve.replay-needs-new-ask",
  "approve.altered-input-needs-new-ask",
  "approve.allow-converted-to-deny",
  "approve.saved-approval-no-bypass",
  "policy.exposure-follows-permissions",
  "deny.shell",
  "deny.edit",
  "deny.execute",
  "deny.subagent-delegation",
  "child.no-escalation",
  "hook.context-blocks-dispatch",
  "hook.generate-blocks-dispatch",
  "hook.compaction-blocks-dispatch",
  "hook.title-blocks-dispatch",
  "disclosure.default-deny-without-evidence",
  "disclosure.remote-destination-rejected",
  "disclosure.fixture-destination-allowed",
  "runner.unexpected-error",
] as const

type CheckId = (typeof CHECK_IDS)[number]

// -------------------------------------------------------------------------------------------
// Run context
// -------------------------------------------------------------------------------------------

interface AskLogEntry {
  t: number
  id: string
  sessionID: string
  action: string
  resources: string[]
}

interface RunCtx {
  readonly client: Client
  readonly fixture: FixtureProvider
  readonly sandbox: Sandbox
  readonly location: { readonly directory: string }
  readonly eventLog: V2Event[]
  readonly askLog: AskLogEntry[]
  readonly checks: Check[]
  readonly report: Reporter
  readonly artifacts: Record<string, unknown>
}

type Reporter = (id: CheckId, status: CheckStatus, reason: string, details?: unknown) => void

interface CallOutcome {
  readonly ok: boolean
  readonly error: string | null
}

const BLOCKED_SUFFIX = " — capability remains disabled; nothing was enabled as a fallback"

function makeReporter(checks: Check[]): Reporter {
  return (id, status, reason, details) => {
    const text = status === "blocked" ? reason + BLOCKED_SUFFIX : reason
    const entry: Check = details === undefined ? { id, status, reason: text } : { id, status, reason: text, details }
    checks.push(entry)
    process.stderr.write(`[f0] ${status.toUpperCase().padEnd(7)} ${id}: ${text}\n`)
  }
}

function report(ctx: RunCtx, id: CheckId, status: CheckStatus, reason: string, details?: unknown): void {
  ctx.report(id, status, reason, details)
}

function reportVerdict(ctx: RunCtx, id: CheckId, verdict: Verdict, details?: unknown): void {
  ctx.report(id, verdict.status, verdict.reason, details)
}

// -------------------------------------------------------------------------------------------
// Evidence helpers (plugin writes JSONL; the runner validates the boundary before using it)
// -------------------------------------------------------------------------------------------

function readEvidence(ctx: RunCtx): EvidenceRow[] {
  try {
    return parseEvidence(fs.readFileSync(ctx.sandbox.evidenceFile, "utf8"))
  } catch {
    return []
  }
}

function pluginLoadedRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "plugin.loaded" }>> {
  const out: Array<Extract<EvidenceRow, { type: "plugin.loaded" }>> = []
  for (const row of rows) if (row.type === "plugin.loaded") out.push(row)
  return out
}

function toolSnapshotRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "tools.snapshot" }>> {
  const out: Array<Extract<EvidenceRow, { type: "tools.snapshot" }>> = []
  for (const row of rows) if (row.type === "tools.snapshot") out.push(row)
  return out
}

function toolBeginRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "tool.execute.begin" }>> {
  const out: Array<Extract<EvidenceRow, { type: "tool.execute.begin" }>> = []
  for (const row of rows) if (row.type === "tool.execute.begin") out.push(row)
  return out
}

function assertBeginRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "assert.begin" }>> {
  const out: Array<Extract<EvidenceRow, { type: "assert.begin" }>> = []
  for (const row of rows) if (row.type === "assert.begin") out.push(row)
  return out
}

function assertEndRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "assert.end" }>> {
  const out: Array<Extract<EvidenceRow, { type: "assert.end" }>> = []
  for (const row of rows) if (row.type === "assert.end") out.push(row)
  return out
}

function evaluateRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "evaluate" }>> {
  const out: Array<Extract<EvidenceRow, { type: "evaluate" }>> = []
  for (const row of rows) if (row.type === "evaluate") out.push(row)
  return out
}

function gateRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "gate" }>> {
  const out: Array<Extract<EvidenceRow, { type: "gate" }>> = []
  for (const row of rows) if (row.type === "gate") out.push(row)
  return out
}

function httpDispatchRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "http.dispatch" }>> {
  const out: Array<Extract<EvidenceRow, { type: "http.dispatch" }>> = []
  for (const row of rows) if (row.type === "http.dispatch") out.push(row)
  return out
}

function sentinelRows(rows: EvidenceRow[]): Array<Extract<EvidenceRow, { type: "env.sentinel" }>> {
  const out: Array<Extract<EvidenceRow, { type: "env.sentinel" }>> = []
  for (const row of rows) if (row.type === "env.sentinel") out.push(row)
  return out
}

function evaluationsFor(ctx: RunCtx, resource: string): Array<Extract<EvidenceRow, { type: "evaluate" }>> {
  return evaluateRows(readEvidence(ctx)).filter((row) => row.resources.includes(resource))
}

function evaluationsAll(ctx: RunCtx, action: string): Array<Extract<EvidenceRow, { type: "evaluate" }>> {
  return evaluateRows(readEvidence(ctx)).filter((row) => row.action === action)
}

function gateFor(ctx: RunCtx, kind: DispatchKind): Extract<EvidenceRow, { type: "gate" }> | null {
  const rows = gateRows(readEvidence(ctx)).filter((row) => row.kind === kind)
  return rows.at(-1) ?? null
}

interface AssertRecord {
  readonly begin: Extract<EvidenceRow, { type: "assert.begin" }>
  readonly end: Extract<EvidenceRow, { type: "assert.end" }> | null
}

function assertionsFor(ctx: RunCtx, resource: string): AssertRecord[] {
  const rows = readEvidence(ctx)
  const ends = assertEndRows(rows)
  const records: AssertRecord[] = []
  for (const begin of assertBeginRows(rows)) {
    if (!begin.resources.includes(resource)) continue
    const end = ends.find((candidate) => candidate.id === begin.id) ?? null
    records.push({ begin, end })
  }
  return records
}

function setControl(sandbox: Sandbox, block: Partial<Record<DispatchKind, boolean>>): void {
  writeFile0600(sandbox.controlFile, JSON.stringify({ block }, null, 2))
}

function setConsent(sandbox: Sandbox, consent: SpikeConsent | null): void {
  if (consent === null) {
    if (fs.existsSync(sandbox.consentFile)) fs.unlinkSync(sandbox.consentFile)
    return
  }
  writeFile0600(sandbox.consentFile, JSON.stringify(consent, null, 2))
}

function validConsent(baseURL: string, providerID = "f0fixture", destinations: string[] = [baseURL]): SpikeConsent {
  return {
    fixture: true,
    providerID,
    destinations,
    purposes: ["tutor"],
    expiresAt: Date.now() + 3_600_000,
    note: "FICTIONAL spike fixture evidence — no real consent, no personal data.",
  }
}

// -------------------------------------------------------------------------------------------
// Session / permission helpers
// -------------------------------------------------------------------------------------------

async function createSession(ctx: RunCtx, agent: string, title?: string): Promise<SessionInfo> {
  const input: { agent: string; location: { directory: string }; title?: string } = {
    agent,
    location: ctx.location,
  }
  if (title !== undefined) input.title = title
  return ctx.client.session.create(input)
}

async function prompt(ctx: RunCtx, sessionID: string, text: string): Promise<CallOutcome> {
  try {
    await ctx.client.session.prompt({ sessionID, text })
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

async function idle(ctx: RunCtx, sessionID: string, ms: number): Promise<CallOutcome> {
  try {
    await ctx.client.session.wait({ sessionID }, { signal: AbortSignal.timeout(ms) })
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function messagesOf(ctx: RunCtx, sessionID: string): Promise<SessionMessageInfo[]> {
  try {
    return await ctx.client.session.context({ sessionID })
  } catch {
    return []
  }
}

async function findAsk(ctx: RunCtx, sessionID: string, resource: string): Promise<PermissionRequest | null> {
  try {
    const pending = await ctx.client.permission.request.list({ location: ctx.location })
    const matches = pending.data.filter(
      (request) =>
        request.sessionID === sessionID &&
        request.action === "learning.approve" &&
        request.resources.includes(resource),
    )
    return matches.at(-1) ?? null
  } catch {
    return null
  }
}

interface ReplyDecision {
  readonly decision: "once" | "always" | "reject"
  readonly message?: string
}

async function replyAsk(ctx: RunCtx, sessionID: string, ask: PermissionRequest, decision: ReplyDecision): Promise<CallOutcome> {
  try {
    await ctx.client.permission.reply({ sessionID, requestID: ask.id, ...decision })
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

interface EffectiveEffect {
  readonly effect: PermissionEffect | null
  readonly id: string | null
  readonly error: string | null
}

/** Effective policy probe. Safe for allow/deny only: an "ask" would publish a real request. */
async function effectiveEffect(ctx: RunCtx, sessionID: string, action: string): Promise<EffectiveEffect> {
  try {
    const result = await ctx.client.permission.create({ sessionID, action, resources: ["*"] })
    return { effect: result.effect, id: result.id, error: null }
  } catch (error) {
    return { effect: null, id: null, error: errorText(error) }
  }
}

async function drainPending(ctx: RunCtx, sessionID: string): Promise<number> {
  try {
    const pending = await ctx.client.permission.request.list({ location: ctx.location })
    const mine = pending.data.filter((request) => request.sessionID === sessionID)
    for (const request of mine) {
      await ctx.client.permission.reply({
        sessionID,
        requestID: request.id,
        decision: "reject",
        message: "f0-spike: drained probe request",
      })
    }
    return mine.length
  } catch {
    return 0
  }
}

// -------------------------------------------------------------------------------------------
// Tool helpers
// -------------------------------------------------------------------------------------------

interface ProbeParams {
  readonly sessionID: string
  readonly operation: string
  readonly payload: Record<string, unknown>
  readonly approve: boolean
  readonly save?: string[]
  readonly reply: ReplyDecision | null
  readonly waitMs?: number
}

interface ProbeResult {
  readonly nonce: string
  readonly digest: string
  readonly resource: string
  readonly text: string
  readonly prompt: CallOutcome
  readonly ask: PermissionRequest | null
  readonly reply: CallOutcome | null
  readonly assertion: AssertRecord | null
  readonly idle: CallOutcome
  readonly messages: SessionMessageInfo[]
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  for (let index = 0; index < bytes; index += 1) buffer[index] = (Math.random() * 256) | 0
  let out = ""
  for (const byte of buffer) out += byte.toString(16).padStart(2, "0")
  return out
}

async function probeFlow(ctx: RunCtx, params: ProbeParams): Promise<ProbeResult> {
  const { sessionID, operation, payload, approve, reply } = params
  const save = params.save ?? []
  const waitMs = params.waitMs ?? 20_000
  const nonce = randomHex(4)
  const digest = spikeDigest(operation, payload)
  const resource = `${operation}:${digest}`
  const input: Record<string, unknown> = { operation, payload }
  if (approve) input["approve"] = true
  if (save.length > 0) input["save"] = save
  const text = `F0 spike fixture probe.\n[[F0CALL ${nonce} ${JSON.stringify({ name: "f0_probe", input })}]]`

  // Only asserts recorded AFTER this prompt count for this step (replay reuses the resource).
  const knownBefore = new Set(assertionsFor(ctx, resource).map((record) => record.begin.id))
  const freshAssertion = (): AssertRecord | null =>
    assertionsFor(ctx, resource).find((record) => !knownBefore.has(record.begin.id)) ?? null

  const promptOutcome = await prompt(ctx, sessionID, text)

  let ask: PermissionRequest | null = null
  let assertion: AssertRecord | null = null
  if (approve) {
    const deadline = Date.now() + waitMs
    for (;;) {
      ask = await findAsk(ctx, sessionID, resource)
      assertion = freshAssertion()
      const settled = ask !== null || (assertion !== null && assertion.end !== null)
      if (settled || Date.now() >= deadline) break
      await sleep(100)
    }
  }

  let replyOutcome: CallOutcome | null = null
  if (ask !== null && reply !== null) replyOutcome = await replyAsk(ctx, sessionID, ask, reply)
  const idleOutcome = await idle(ctx, sessionID, 45_000)
  const messages = await messagesOf(ctx, sessionID)

  return {
    nonce,
    digest,
    resource,
    text,
    prompt: promptOutcome,
    ask,
    reply: replyOutcome,
    assertion: freshAssertion() ?? assertion,
    idle: idleOutcome,
    messages,
  }
}

interface CallToolResult {
  readonly prompt: CallOutcome
  readonly idle: CallOutcome
  readonly messages: SessionMessageInfo[]
  readonly toolName: string
}

async function callTool(
  ctx: RunCtx,
  sessionID: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<CallToolResult> {
  const nonce = randomHex(4)
  const text = `F0 spike fixture tool call.\n[[F0CALL ${nonce} ${JSON.stringify({ name: toolName, input: toolInput })}]]`
  const promptOutcome = await prompt(ctx, sessionID, text)
  const idleOutcome = await idle(ctx, sessionID, 45_000)
  const messages = await messagesOf(ctx, sessionID)
  return { prompt: promptOutcome, idle: idleOutcome, messages, toolName }
}

function toolParts(messages: SessionMessageInfo[]): SessionMessageAssistantTool[] {
  const parts: SessionMessageAssistantTool[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) if (part.type === "tool") parts.push(part)
  }
  return parts
}

function findToolPart(
  messages: SessionMessageInfo[],
  operation: string,
  seq: number,
): SessionMessageAssistantTool | null {
  const matches = toolParts(messages).filter((part) => {
    const state: unknown = part.state
    if (!isRecord(state)) return false
    const input: unknown = state["input"]
    if (!isRecord(input)) return false
    if (input["operation"] !== operation) return false
    const payload = input["payload"]
    if (!isRecord(payload)) return false
    return payload["seq"] === seq
  })
  return matches.at(-1) ?? null
}

function findLastToolPart(messages: SessionMessageInfo[], toolName: string): SessionMessageAssistantTool | null {
  const matches = toolParts(messages).filter((part) => part.name === toolName)
  return matches.at(-1) ?? null
}

type PartState = "completed" | "error" | "running" | "streaming" | "unknown"

function partStatus(part: SessionMessageAssistantTool): PartState {
  const state: unknown = part.state
  if (!isRecord(state)) return "unknown"
  const status = state["status"]
  if (status === "completed" || status === "error" || status === "running" || status === "streaming") return status
  return "unknown"
}

function partError(part: SessionMessageAssistantTool): string {
  const state: unknown = part.state
  if (!isRecord(state)) return ""
  const error: unknown = state["error"]
  if (!isRecord(error)) return ""
  const message = asString(error["message"])
  const type = asString(error["type"])
  return message ?? type ?? ""
}

function partOutput(part: SessionMessageAssistantTool): string {
  const state: unknown = part.state
  if (!isRecord(state)) return ""
  const content = state["content"]
  if (!Array.isArray(content)) return ""
  const texts: string[] = []
  for (const entry of content) {
    if (isRecord(entry) && entry["type"] === "text" && typeof entry["text"] === "string") texts.push(entry["text"])
  }
  return texts.join(" ").slice(0, 200)
}

function summarizePart(part: SessionMessageAssistantTool): Record<string, unknown> {
  return { name: part.name, status: partStatus(part), error: partError(part), output: partOutput(part) }
}

function registryIds(ctx: RunCtx): string[] {
  const rows = toolSnapshotRows(readEvidence(ctx))
  const last = rows.at(-1) ?? null
  return last === null ? [] : last.ids
}

function latestTools(ctx: RunCtx): unknown[] {
  for (let index = ctx.fixture.requests.length - 1; index >= 0; index -= 1) {
    const request = ctx.fixture.requests[index]
    if (request === undefined) continue
    const tools: unknown = request.tools
    if (Array.isArray(tools)) return tools
  }
  return []
}

function toolNameOf(tool: unknown): string {
  if (!isRecord(tool)) return ""
  const fn = tool["function"]
  if (isRecord(fn) && typeof fn["name"] === "string") return fn["name"]
  return typeof tool["name"] === "string" ? tool["name"] : ""
}

type ToolKind = "shell" | "edit" | "execute" | "subagent"

const TOOL_KIND_ACTION: Record<ToolKind, string> = {
  shell: "shell",
  edit: "edit",
  execute: "execute",
  subagent: "subagent",
}

const TOOL_KIND_CANDIDATES: Record<ToolKind, string[]> = {
  shell: ["shell", "bash"],
  edit: ["write", "edit", "patch"],
  execute: ["execute", "codemode"],
  subagent: ["subagent", "task"],
}

interface ToolDiscovery {
  readonly kind: ToolKind
  readonly name: string
  readonly action: string
  readonly registered: boolean
  readonly exposed: boolean
  readonly requestToolNames: string[]
  readonly registryIds: string[]
}

function discoverTool(ctx: RunCtx, kind: ToolKind): ToolDiscovery {
  const requestToolNames = latestTools(ctx).map(toolNameOf).filter((name) => name.length > 0)
  const registry = registryIds(ctx)
  const pool = [...new Set([...registry, ...requestToolNames])]
  const candidates = TOOL_KIND_CANDIDATES[kind]
  const name =
    candidates.find((candidate) => pool.includes(candidate)) ??
    candidates.find((candidate) => pool.some((entry) => entry.includes(candidate))) ??
    candidates[0] ??
    kind
  return {
    kind,
    name,
    action: TOOL_KIND_ACTION[kind],
    registered: registry.includes(name),
    exposed: requestToolNames.includes(name),
    requestToolNames,
    registryIds: registry,
  }
}

const FALLBACK_INPUTS: Record<ToolKind, Record<string, unknown>> = {
  shell: { command: "touch side-effect-shell.txt" },
  edit: { filePath: "side-effect-edit.txt", content: "f0-spike-fixture-content" },
  execute: { code: "1" },
  subagent: { prompt: "F0 spike delegation attempt" },
}

function buildToolInput(tool: unknown, targetPath: string | null): Record<string, unknown> {
  const fallback: Record<string, unknown> = {}
  if (!isRecord(tool)) return fallback
  const fn = isRecord(tool["function"]) ? tool["function"] : tool
  const schema = isRecord(fn["parameters"]) ? fn["parameters"] : {}
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {}
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((entry): entry is string => typeof entry === "string")
    : Object.keys(properties)

  const values: Record<string, string> = {
    command: targetPath === null ? "true" : `touch ${targetPath}`,
    filePath: targetPath ?? "side-effect.txt",
    path: targetPath ?? "side-effect.txt",
    file_path: targetPath ?? "side-effect.txt",
    content: "f0-spike-fixture-content",
    prompt: "F0 spike delegation attempt",
    task: "F0 spike delegation attempt",
    description: "F0 spike delegation attempt",
    message: "F0 spike delegation attempt",
    agent: "f0-child",
    subagent: "f0-child",
    subagent_type: "f0-child",
    code: "1",
  }

  const out: Record<string, unknown> = {}
  for (const key of required) {
    const known = values[key]
    if (known !== undefined) {
      out[key] = known
      continue
    }
    const property: unknown = properties[key]
    const type = isRecord(property) ? property["type"] : null
    out[key] =
      type === "object"
        ? {}
        : type === "number" || type === "integer"
          ? 1
          : type === "boolean"
            ? true
            : type === "array"
              ? []
              : "f0-spike"
  }
  return out
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// -------------------------------------------------------------------------------------------
// Fixture configuration (fictional data only)
// -------------------------------------------------------------------------------------------

interface SpikeAgentConfig {
  readonly description: string
  readonly mode: "primary" | "subagent"
  readonly system?: string
  readonly permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
}

interface SpikeConfig {
  readonly $schema: string
  readonly update: "disable"
  readonly share: "disabled"
  readonly snapshots: false
  readonly model: string
  readonly default_agent: string
  readonly compaction: { readonly auto: false }
  readonly plugins: string[]
  readonly permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
  readonly agents: Record<string, SpikeAgentConfig>
  readonly providers: Record<string, unknown>
}

const DENY_ALL: { action: string; resource: string; effect: "deny" } = {
  action: "*",
  resource: "*",
  effect: "deny",
}

function buildConfig(fixtureBaseURL: string, pluginDir: string): SpikeConfig {
  return {
    $schema: "https://opencode.ai/config.json",
    update: "disable",
    share: "disabled",
    snapshots: false,
    model: "f0fixture/f0-model",
    default_agent: "f0-primary",
    compaction: { auto: false },
    plugins: [pluginDir],
    permissions: [
      DENY_ALL,
      { action: "f0_probe", resource: "*", effect: "allow" },
      { action: "question", resource: "*", effect: "allow" },
      { action: "learning.read", resource: "*", effect: "allow" },
      { action: "learning.approve", resource: "*", effect: "ask" },
    ],
    agents: {
      "f0-primary": {
        description: "F0 spike primary agent (fixture only)",
        mode: "primary",
        system: "F0 spike fixture agent. Synthetic data only.",
        permissions: [
          DENY_ALL,
          { action: "f0_probe", resource: "*", effect: "allow" },
          { action: "question", resource: "*", effect: "allow" },
          { action: "learning.approve", resource: "*", effect: "ask" },
        ],
      },
      "f0-child": {
        description: "F0 spike child agent — must not escalate (fixture only)",
        mode: "subagent",
        system: "F0 spike fixture child agent. Synthetic data only.",
        permissions: [
          DENY_ALL,
          { action: "f0_probe", resource: "*", effect: "allow" },
          { action: "learning.read", resource: "*", effect: "allow" },
        ],
      },
    },
    providers: {
      f0fixture: {
        name: "F0 Fixture Loopback",
        env: ["F0_FIXTURE_API_KEY"],
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: fixtureBaseURL },
        models: { "f0-model": { name: "F0 Fixture Model", limit: { context: 16_000, output: 1_024 } } },
      },
      f0remote: {
        name: "F0 Fixture Remote (never contacted)",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://remote.example.invalid/v1" },
        models: { "f0-model": { name: "F0 Fixture Remote Model", limit: { context: 16_000, output: 1_024 } } },
      },
    },
  }
}

// -------------------------------------------------------------------------------------------
// opencode serve (isolated)
// -------------------------------------------------------------------------------------------

interface ServeHandle {
  readonly child: ChildProcess
  readonly baseUrl: string
  readonly ready: boolean
  readonly lastError: string | null
  readonly password: string | null
  readonly env: Record<string, string>
}

function serveEnv(sandbox: Sandbox): Record<string, string> {
  const base = buildAllowlistEnv(process.env)
  return {
    ...base,
    HOME: sandbox.home,
    XDG_CONFIG_HOME: path.join(sandbox.home, ".config"),
    XDG_DATA_HOME: path.join(sandbox.home, ".local", "share"),
    XDG_STATE_HOME: path.join(sandbox.home, ".local", "state"),
    XDG_CACHE_HOME: path.join(sandbox.home, ".cache"),
    XDG_RUNTIME_DIR: path.join(sandbox.home, "run"),
  }
}

async function startOpenCode(sandbox: Sandbox, port: number, log: RedactingLog): Promise<ServeHandle> {
  const env = serveEnv(sandbox)
  const child = spawn(OPENCODE_BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: sandbox.project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  child.stdout?.on("data", (chunk: Buffer) => log.append(chunk.toString("utf8")))
  child.stderr?.on("data", (chunk: Buffer) => log.append(chunk.toString("utf8")))

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 45_000
  let ready = false
  let lastError: string | null = null
  let password: string | null = null

  while (!ready && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      lastError = `opencode serve exited early with code ${child.exitCode}`
      break
    }
    password = log.password()
    try {
      const headers =
        password === null ? {} : { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
      const response = await fetch(`${baseUrl}/api/info`, { headers, signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        ready = true
        break
      }
      lastError = password === null ? `HTTP ${response.status} (waiting for server password)` : `HTTP ${response.status}`
    } catch (error) {
      lastError = errorText(error)
    }
    await sleep(200)
  }
  return { child, baseUrl, ready, lastError, password, env }
}

async function stopOpenCode(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) return
  const pid = child.pid
  if (pid === undefined) return
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    if (child.exitCode !== null || child.signalCode !== null) resolve()
  })
  const signal = (sig: NodeJS.Signals): void => {
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        child.kill(sig)
      } catch {
        /* already gone */
      }
    }
  }
  signal("SIGTERM")
  const force = setTimeout(() => signal("SIGKILL"), 5_000)
  await exited
  clearTimeout(force)
}

// -------------------------------------------------------------------------------------------
// Hook blocking harness
// -------------------------------------------------------------------------------------------

interface HookCheckParams {
  readonly id: CheckId
  readonly kind: DispatchKind | "primary"
  readonly gateKind: DispatchKind
  readonly blockSpec: Partial<Record<DispatchKind, boolean>>
  readonly drainMs: number
  readonly trigger: () => Promise<unknown>
}

async function runHookCheck(ctx: RunCtx, params: HookCheckParams): Promise<void> {
  const kindDelta = (mark: number, kind: string): number =>
    ctx.fixture.requests.slice(mark).filter((request) => (request.kind ?? "unknown") === kind).length
  const totalDelta = (mark: number): number => ctx.fixture.requests.length - mark

  setControl(ctx.sandbox, params.blockSpec)
  await sleep(params.drainMs)
  const mark = ctx.fixture.requests.length
  const evidenceMark = readEvidence(ctx).length
  const triggerResult = await params.trigger()
  await sleep(1_500)
  const negative = {
    total: totalDelta(mark),
    kindCount: kindDelta(mark, params.kind),
    kinds: [...new Set(ctx.fixture.requests.slice(mark).map((request) => request.kind ?? "unknown"))],
    gate: gateRows(readEvidence(ctx).slice(evidenceMark)).filter((row) => row.kind === params.gateKind).at(-1) ?? null,
  }

  setControl(ctx.sandbox, {})
  await sleep(params.drainMs)
  const mark2 = ctx.fixture.requests.length
  const evidenceMark2 = readEvidence(ctx).length
  await params.trigger()
  const positiveDeadline = Date.now() + 20_000
  while (kindDelta(mark2, params.kind) === 0 && Date.now() < positiveDeadline) await sleep(250)
  const positive = {
    total: totalDelta(mark2),
    kindCount: kindDelta(mark2, params.kind),
    kinds: [...new Set(ctx.fixture.requests.slice(mark2).map((request) => request.kind ?? "unknown"))],
    gate: gateRows(readEvidence(ctx).slice(evidenceMark2)).filter((row) => row.kind === params.gateKind).at(-1) ?? null,
  }

  const verdict = hookVerdict(
    params.kind,
    negative,
    positive,
    params.gateKind,
  )
  reportVerdict(ctx, params.id, verdict, { negative, positive, trigger: triggerResult })
}

// -------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------

const PLUGIN_DIR = path.join(SPIKE_DIR, "plugin")
const RESULTS_FILE = path.join(SPIKE_DIR, "results", "latest.json")

interface Decoy {
  readonly dir: string
  readonly marker: string
}

/** A pre-existing directory created BEFORE the sandbox: cleanup must never touch it. */
function createDecoy(): Decoy | null {
  try {
    const dir = path.join(
      "/tmp/opencode",
      `f0-spike-decoy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    )
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const marker = path.join(dir, "marker.txt")
    writeFile0600(marker, "f0-spike decoy: pre-existing path, must survive the run\n")
    return { dir, marker }
  } catch {
    return null
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

export async function main(): Promise<number> {
  const startedAt = new Date().toISOString()
  const keepEvidence = process.argv.includes("--keep-evidence")
  const checks: Check[] = []
  const emit = makeReporter(checks)
  let unexpected: string | null = null
  let eventSummary: Record<string, number> = {}

  // --- pin gate: verified BEFORE any integration is started --------------------------------
  const pins = verifyPins()
  const nodeOk = process.versions.node === PINS.node
  emit(
    "env.versions-exact",
    pins.ok ? "passed" : "failed",
    pins.checks.map((check) => `${check.name}=${check.actual ?? "unavailable"} (expected ${check.expected})`).join("; "),
    pins,
  )
  emit("env.node24-runtime", nodeOk ? "passed" : "failed", `runtime ${process.version} (pinned v${PINS.node})`)
  if (!pins.ok || !nodeOk) {
    for (const id of CHECK_IDS) {
      if (!checks.some((check) => check.id === id)) emit(id, "blocked", "version pin mismatch — integration not started")
    }
    return 2
  }

  const decoy = createDecoy()
  const workspaceHadOpenCodeDir = fs.existsSync(path.join(ROOT_DIR, ".opencode"))
  const sandbox = createSandbox()
  const scenarioArtifacts: Record<string, unknown> = {}
  let fixture: FixtureProvider | null = null
  let log: RedactingLog | null = null
  let serve: ServeHandle | null = null

  try {
    fixture = await startFixtureProvider()
    const port = await freeLoopbackPort()
    setControl(sandbox, {})
    setConsent(sandbox, validConsent(fixture.baseURL))
    writeFile0600(
      path.join(sandbox.project, "opencode.json"),
      JSON.stringify(buildConfig(fixture.baseURL, PLUGIN_DIR), null, 2),
    )
    writeGlobalHomeConfig(sandbox)
    log = openRedactingLog(sandbox.logPath)
    serve = await startOpenCode(sandbox, port, log)
    const fixtureBaseURL = fixture.baseURL

    if (!serve.ready) {
      emit(
        "server.isolated-startup",
        "failed",
        `opencode serve did not become ready on 127.0.0.1:${port} (${serve.lastError ?? "unknown"}); log=${sandbox.logPath}`,
        { port, log: sandbox.logPath },
      )
    } else {
      const workspaceStillClean = fs.existsSync(path.join(ROOT_DIR, ".opencode")) === workspaceHadOpenCodeDir
      emit(
        "server.isolated-startup",
        workspaceStillClean ? "passed" : "failed",
        `opencode serve ready on 127.0.0.1:${port} under an allowlisted environment (no inherited credentials/proxies/NODE_OPTIONS/LD_*), sandbox HOME/XDG and sandbox cwd; workspace .opencode unchanged: ${workspaceStillClean}`,
        {
          cwd: sandbox.project,
          home: sandbox.home,
          serveEnvKeys: Object.keys(serve.env).sort(),
          workspaceOpenCodeDirBefore: workspaceHadOpenCodeDir,
          serverAuth: serve.password === null ? "none" : "HTTP Basic with ephemeral serve password (redacted on disk)",
        },
      )

      const client = OpenCode.make({
        baseUrl: serve.baseUrl,
        headers: serve.password === null ? {} : { authorization: basicAuth(serve.password) },
      })
      const eventsAbort = new AbortController()
      const eventLog: V2Event[] = []
      const askLog: AskLogEntry[] = []
      const location = { directory: sandbox.project }
      const ctx: RunCtx = {
        client,
        fixture,
        sandbox,
        location,
        eventLog,
        askLog,
        checks,
        report: emit,
        artifacts: scenarioArtifacts,
      }

      void (async () => {
        try {
          for await (const event of client.event.subscribe({ signal: eventsAbort.signal })) {
            eventLog.push(event)
            if (event.type === "permission.asked") {
              askLog.push({
                t: Date.now(),
                id: event.data.id,
                sessionID: event.data.sessionID,
                action: event.data.action,
                resources: event.data.resources,
              })
            }
          }
        } catch {
          /* stream closed during cleanup */
        }
      })()

      // Activate the location: on 2.1.3 /api/plugin and /api/agent answer only after a reload.
      try {
        await client.location.reload()
      } catch {
        /* retries below cover activation */
      }

      // --- plugin recognized (+ config agents, always fetched) ------------------------------
      let pluginEntry: Record<string, unknown> | null = null
      let pluginCount = 0
      let agentIds: string[] = []
      for (let attempt = 0; attempt < 30 && pluginEntry === null; attempt += 1) {
        try {
          const listed = await client.plugin.list({ location })
          pluginCount = listed.data.length
          const found = listed.data.find((entry) => entry.id === "f0-spike")
          if (found !== undefined) pluginEntry = { id: found.id, source: found.source, state: found.state }
        } catch {
          /* retry while the location finishes activating */
        }
        if (pluginEntry === null) await sleep(300)
      }
      try {
        const agents = await client.agent.list({ location })
        agentIds = agents.data.map((agent) => agent.id)
      } catch {
        agentIds = []
      }
      const f0Agents = agentIds.filter((id) => id.startsWith("f0-"))
      const pluginLoadedEvidence = pluginLoadedRows(readEvidence(ctx))
      if (pluginEntry === null) {
        report(
          ctx,
          "plugin.recognized",
          "blocked",
          `GET /api/plugin never listed f0-spike after location reload (entries=${pluginCount}) although the plugin executed (${pluginLoadedEvidence.length} plugin.loaded record(s)) — V2 listing unverified`,
          { pluginCount, agentIds, pluginLoadedEvidence: pluginLoadedEvidence.at(-1) ?? null },
        )
      } else {
        const missingAgents = ["f0-primary", "f0-child"].filter((id) => !f0Agents.includes(id))
        if (missingAgents.length > 0) {
          report(
            ctx,
            "plugin.recognized",
            "failed",
            `plugin listed as active but config agents missing: ${missingAgents.join(", ")} (visible f0 agents: ${f0Agents.join(",") || "none"})`,
            { pluginEntry, agentIds, pluginCount },
          )
        } else {
          report(
            ctx,
            "plugin.recognized",
            "passed",
            `GET /api/plugin lists ${String(pluginEntry["id"])} source=${JSON.stringify(pluginEntry["source"])} state=${JSON.stringify(pluginEntry["state"])}; config agents visible: ${f0Agents.join(", ")}`,
            { pluginEntry, pluginCount, agentIds, pluginLoadedEvidence: pluginLoadedEvidence.at(-1) ?? null },
          )
        }
      }

      // --- env allowlist sentinels (runner process + opencode serve process) ----------------
      const runnerPresence = sentinelPresence(process.env, SENTINEL_ENV_VARS)
      const serveRows = sentinelRows(readEvidence(ctx))
      const servePresence = serveRows.at(-1)?.present ?? null
      const runnerLeak = Object.entries(runnerPresence).filter(([, present]) => present).map(([name]) => name)
      const serveLeak =
        servePresence === null ? [] : Object.entries(servePresence).filter(([, present]) => present).map(([name]) => name)
      if (servePresence === null) {
        report(
          ctx,
          "env.allowlist-sentinels",
          "blocked",
          "the plugin did not report env.sentinel evidence from the opencode serve process — sentinel absence unverified",
          { runner: runnerPresence },
        )
      } else if (runnerLeak.length > 0 || serveLeak.length > 0) {
        report(
          ctx,
          "env.allowlist-sentinels",
          "failed",
          `sentinel variables present (booleans only): runner=${runnerLeak.join(",") || "none"}, serve=${serveLeak.join(",") || "none"}`,
          { runner: runnerPresence, serve: servePresence },
        )
      } else {
        report(
          ctx,
          "env.allowlist-sentinels",
          "passed",
          `all ${SENTINEL_ENV_VARS.length} sentinel variables absent from the runner process and from the opencode serve process (booleans only; values are never read into the report)`,
          { runner: runnerPresence, serve: servePresence },
        )
      }

      await runScenarioChecks(ctx, { fixtureBaseURL })
      eventSummary = {
        permissionAsked: eventLog.filter((event) => event.type === "permission.asked").length,
        toolFailed: eventLog.filter((event) => event.type === "session.tool.failed").length,
        compactionFailed: eventLog.filter((event) => event.type === "session.compaction.failed").length,
        executionFailed: eventLog.filter((event) => event.type === "session.execution.failed").length,
      }
    }
  } catch (error) {
    unexpected = errorText(error)
    emit("runner.unexpected-error", "failed", `unexpected runner error: ${unexpected}`)
  } finally {
    if (serve !== null) await stopOpenCode(serve.child)
    if (log !== null) log.close()
    if (fixture !== null) await fixture.close()
  }

  // --- sandbox isolation evidence (captured before cleanup) ----------------------------------
  const sandboxRootMode = fileMode(sandbox.root)
  const logMode = fileMode(sandbox.logPath)
  const logContents = readText(sandbox.logPath) ?? ""
  const servePassword = log === null ? null : log.password()
  const passwordAbsentFromDisk = servePassword === null ? null : !logContents.includes(servePassword)
  const redactionCount = (logContents.match(/\[REDACTED\]/g) ?? []).length

  const cleanup = cleanupSandbox(sandbox, keepEvidence)
  const decoySurvived = decoy === null ? null : fs.existsSync(decoy.marker)
  if (decoy !== null) {
    try {
      fs.rmSync(decoy.dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }

  const sandboxOk =
    sandboxRootMode === 0o700 &&
    logMode === 0o600 &&
    passwordAbsentFromDisk !== false &&
    decoySurvived !== false
  if (sandboxOk) {
    emit(
      "sandbox.isolation-permissions",
      "passed",
      `mkdtemp sandbox mode 0700, serve log mode 0600 with the ephemeral password redacted on disk (${redactionCount} redaction(s), password absent: ${String(passwordAbsentFromDisk)}), pre-existing decoy path untouched; cleanup: ${cleanup.reason}`,
      { sandboxRootMode, logMode, passwordAbsentFromDisk, redactionCount, decoySurvived, cleanup, keepEvidence },
    )
  } else {
    emit(
      "sandbox.isolation-permissions",
      "failed",
      `sandbox isolation violated (root=${sandboxRootMode === null ? "gone" : sandboxRootMode.toString(8)}, log=${logMode === null ? "gone" : logMode.toString(8)}, passwordAbsent=${String(passwordAbsentFromDisk)}, decoySurvived=${String(decoySurvived)})`,
      { sandboxRootMode, logMode, passwordAbsentFromDisk, redactionCount, decoySurvived, cleanup, keepEvidence },
    )
  }

  // --- finish --------------------------------------------------------------------------------
  const unreachableIsNotBlocked: CheckId[] = ["runner.unexpected-error"]
  for (const id of CHECK_IDS) {
    if (unreachableIsNotBlocked.includes(id)) continue
    if (!checks.some((check) => check.id === id)) emit(id, "blocked", "not reached — an earlier prerequisite failed")
  }

  const summary = {
    passed: checks.filter((check) => check.status === "passed").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
    failed: checks.filter((check) => check.status === "failed").length,
    total: checks.length,
  }

  const reportBody: SpikeReport = {
    spike: "f0-opencode-v2",
    startedAt,
    finishedAt: new Date().toISOString(),
    spec: ["8.2", "9.1", "11"],
    plan: "docs/implementation-plan.md §F0",
    pins,
    versions: {
      runtimeNode: process.version,
      pinnedNode: `v${PINS.node}`,
      opencodeCli: pins.checks.find((check) => check.name === "opencode-cli")?.actual ?? null,
      "@opencode/plugin": pins.checks.find((check) => check.name === "@opencode/plugin")?.actual ?? null,
      "@opencode/client": pins.checks.find((check) => check.name === "@opencode/client")?.actual ?? null,
      allowlistKeys: Object.keys(buildAllowlistEnv(process.env)).sort(),
      sentinelBooleans: sentinelPresence(process.env, SENTINEL_ENV_VARS),
    },
    checks,
    summary,
    fixtureProvider:
      fixture === null
        ? null
        : {
            baseURL: fixture.baseURL,
            requests: fixture.requests.length,
            byKind: fixture.requests.reduce<Record<string, number>>((acc, request) => {
              const key = request.kind ?? "unknown"
              acc[key] = (acc[key] ?? 0) + 1
              return acc
            }, {}),
          },
    events: eventSummary,
    artifacts: {
      ...scenarioArtifacts,
      sandbox: sandbox.root,
      sandboxKept: cleanup.kept,
      sandboxRemoved: cleanup.removed,
      resultsJson: RESULTS_FILE,
      evidenceJsonl: sandbox.evidenceFile,
      serverLog: sandbox.logPath,
      configFile: path.join(sandbox.project, "opencode.json"),
      globalHomeConfig: sandbox.globalConfigFile,
      keepEvidence,
    },
    scope: [
      "F1 single-use grants, Core approval consumption and pedagogical agents are out of scope (spec §8.2 grant consumption belongs to F1/F6).",
      "Loopback fixture provider only: no external network, no real provider, no real credentials or database read; the product disclosure gate stays closed.",
      "The remote rejection is an OBSERVED plugin gate (decision + no http.dispatch record + no fixture request); this spike has no independent egress monitor or network namespace.",
      "The fixture digest sorts keys recursively over ASCII payload data only — it is not a full RFC 8785 (JCS) implementation.",
      "blocked = not verified; nothing was enabled as a fallback when a check could not be completed.",
    ],
  }

  try {
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true })
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(reportBody, null, 2))
  } catch (error) {
    process.stderr.write(`[f0] could not write results file: ${errorText(error)}\n`)
  }
  process.stdout.write(JSON.stringify(reportBody, null, 2) + "\n")

  if (unexpected !== null) return 2
  return summary.blocked === 0 && summary.failed === 0 ? 0 : 1
}

// -------------------------------------------------------------------------------------------
// Scenario checks: baseline → tool → approvals → policy/deny → child → hooks → disclosure
// -------------------------------------------------------------------------------------------

function denyState(part: SessionMessageAssistantTool | null): "completed" | "error" | "missing" {
  if (part === null) return "missing"
  const status = partStatus(part)
  if (status === "completed") return "completed"
  if (status === "error") return "error"
  return "missing"
}

function lastAssistantAgent(messages: SessionMessageInfo[]): string | null {
  let agent: string | null = null
  for (const message of messages) if (message.type === "assistant") agent = message.agent
  return agent
}

/** Spec §8.2 fallback: when a saved pattern can bypass the hook, approval from OpenCode is disabled. */
async function applyApprovalFallback(ctx: RunCtx): Promise<string> {
  try {
    const configFile = path.join(ctx.sandbox.project, "opencode.json")
    const raw = readText(configFile)
    if (raw === null) return "fallback could not read the fixture config"
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return "fallback could not parse the fixture config"
    const permissions = parsed["permissions"]
    if (!Array.isArray(permissions)) return "fixture config has no permissions array"
    const patched = permissions.map((rule) => {
      if (!isRecord(rule) || rule["action"] !== "learning.approve") return rule
      return { ...rule, effect: "deny" }
    })
    writeFile0600(configFile, JSON.stringify({ ...parsed, permissions: patched }, null, 2))
    try {
      await ctx.client.location.reload()
      return "config rewritten to effect=deny for learning.approve and location reloaded (unconditional reject)"
    } catch (error) {
      return `config rewritten to effect=deny for learning.approve but location.reload failed: ${errorText(error)}`
    }
  } catch (error) {
    return `fallback could not be applied: ${errorText(error)}`
  }
}

async function runScenarioChecks(ctx: RunCtx, options: { fixtureBaseURL: string }): Promise<void> {
  const { client, fixture, sandbox, location } = ctx

  // --- baseline dispatch --------------------------------------------------------------------
  setControl(sandbox, {})
  setConsent(sandbox, validConsent(options.fixtureBaseURL))
  const session = await createSession(ctx, "f0-primary", "f0-spike-main")
  const baselineMark = fixture.requests.length
  await prompt(ctx, session.id, "F0 spike baseline fixture prompt. No tool required.")
  const baselineIdle = await idle(ctx, session.id, 45_000)
  const baselineRequests = fixture.requests.slice(baselineMark)
  ctx.artifacts["baselineToolNames"] = baselineRequests[0]?.toolNames ?? []

  if (baselineRequests.length > 0) {
    report(
      ctx,
      "provider.fixture-loopback-dispatch",
      "passed",
      `loopback fixture received ${baselineRequests.length} real request(s) at ${options.fixtureBaseURL} via @opencode/ai/providers/openai-compatible; model=${baselineRequests[0]?.model ?? "unknown"}`,
      { firstRequest: { kind: baselineRequests[0]?.kind ?? null, toolNames: baselineRequests[0]?.toolNames ?? [] } },
    )
  } else {
    report(
      ctx,
      "provider.fixture-loopback-dispatch",
      "failed",
      `no provider request reached the loopback fixture (idle=${JSON.stringify(baselineIdle)}); log=${sandbox.logPath}`,
      { log: sandbox.logPath },
    )
  }

  const kindsObserved = [
    ...new Set(fixture.requests.map((request) => request.kind).filter((kind): kind is string => kind !== null)),
  ]
  const dispatchRecords = httpDispatchRows(readEvidence(ctx))
  if (kindsObserved.length > 0) {
    report(
      ctx,
      "dispatch.kind-attribution",
      "passed",
      `fixture observed flow kinds via the plugin-injected x-f0-kind header: ${kindsObserved.join(", ")}`,
      { pluginHttpDispatchRecords: dispatchRecords.length },
    )
  } else {
    report(
      ctx,
      "dispatch.kind-attribution",
      "blocked",
      `x-f0-kind absent on all ${fixture.requests.length} fixture requests and ${dispatchRecords.length} plugin http.dispatch record(s) — per-flow counter attribution unavailable`,
      { pluginHttpDispatchRecords: dispatchRecords.length },
    )
  }

  // --- direct tool registration --------------------------------------------------------------
  const snapshotRows = toolSnapshotRows(readEvidence(ctx))
  const lastSnapshot = snapshotRows.at(-1) ?? null
  const f0Entry = lastSnapshot === null ? undefined : lastSnapshot.f0.find((entry) => entry.id === "f0_probe")
  const requestHasF0 = (baselineRequests[0]?.toolNames ?? []).includes("f0_probe")
  const codemode = f0Entry === undefined ? null : (f0Entry.codemode ?? null)
  if (requestHasF0 && f0Entry !== undefined && codemode !== true) {
    report(
      ctx,
      "tool.f0-registered-codemode-off",
      "passed",
      `f0_probe exposed directly to the model (present in the real request tool snapshot) and the registry reports codemode=${String(codemode)} (not Code-Mode-only)`,
      { requestToolNames: baselineRequests[0]?.toolNames ?? [], registry: lastSnapshot },
    )
  } else {
    report(
      ctx,
      "tool.f0-registered-codemode-off",
      "failed",
      `direct tool registration not confirmed (inRequest=${requestHasF0}, inRegistry=${f0Entry !== undefined}, codemode=${String(codemode)})`,
      { requestToolNames: baselineRequests[0]?.toolNames ?? [], registry: lastSnapshot },
    )
  }

  // --- direct execution + runtime actor ------------------------------------------------------
  const baseStep = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-base",
    payload: { note: "fixture-f0", seq: 1 },
    approve: false,
    reply: null,
  })
  const basePart = findToolPart(baseStep.messages, "spike-base", 1)
  if (basePart !== null && partStatus(basePart) === "completed") {
    report(
      ctx,
      "tool.f0-executed-directly",
      "passed",
      `f0_probe executed through the real agent loop (state=completed, output=${partOutput(basePart)})`,
      { digest: baseStep.digest, prompt: baseStep.text.slice(0, 160) },
    )
  } else {
    report(
      ctx,
      "tool.f0-executed-directly",
      "failed",
      `f0_probe did not complete: ${basePart === null ? "no tool part in session messages" : `state=${partStatus(basePart)} error=${partError(basePart)}`}`,
      { idle: baseStep.idle },
    )
  }

  const toolBegins = toolBeginRows(readEvidence(ctx))
  const toolBegin = toolBegins.at(-1) ?? null
  const assistantAgent = lastAssistantAgent(baseStep.messages)
  if (
    toolBegin !== null &&
    toolBegin.actor === "f0-primary" &&
    toolBegin.sessionID === session.id &&
    assistantAgent === "f0-primary"
  ) {
    report(
      ctx,
      "tool.f0-actor-runtime",
      "passed",
      `runtime actor read from the executor context: actor=${toolBegin.actor}, sessionID=${toolBegin.sessionID}, messageID=${toolBegin.messageID}; assistant message agent=${assistantAgent}`,
      { toolBegin, assistantAgent },
    )
  } else {
    report(
      ctx,
      "tool.f0-actor-runtime",
      "failed",
      `runtime actor mismatch or missing (toolBegin=${JSON.stringify(toolBegin)}, assistantAgent=${String(assistantAgent)}, expected f0-primary/${session.id})`,
    )
  }

  // --- approval: ask bound to SHA-256 and correlated with evaluate ---------------------------
  const approveStep = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-approve",
    payload: { note: "fixture-approve", seq: 1 },
    approve: true,
    reply: { decision: "once" },
  })
  const approveResource = approveStep.resource
  const approveEvaluations = evaluationsFor(ctx, approveResource)
  const approvedPart = findToolPart(approveStep.messages, "spike-approve", 1)
  const approveAskEvents = ctx.askLog.filter(
    (entry) => entry.action === "learning.approve" && entry.resources.includes(approveResource),
  )
  const correlatedAsk =
    approveStep.ask !== null &&
    approveStep.ask.resources.includes(approveResource) &&
    approveEvaluations.some(
      (row) => row.effectIn === "ask" && row.effectOut === "ask" && row.correlated !== null,
    )
  if (
    correlatedAsk &&
    approveStep.assertion?.end?.outcome === "allowed" &&
    approvedPart !== null &&
    partStatus(approvedPart) === "completed"
  ) {
    report(
      ctx,
      "approve.ask-sha-correlated",
      "passed",
      `ask published for resource ${approveStep.ask?.resources[0] ?? approveResource} (sha recomputed independently: ${approveStep.digest}); evaluate recorded the same action/resources with effect ask and a non-null assert correlation; reply "once" completed the assert`,
      {
        resource: approveResource,
        digest: approveStep.digest,
        evaluations: approveEvaluations,
        askEvents: approveAskEvents,
        requestID: approveStep.ask?.id ?? null,
      },
    )
  } else {
    report(
      ctx,
      "approve.ask-sha-correlated",
      "failed",
      `ask=${approveStep.ask === null ? "none" : approveStep.ask.resources.join(",")}; correlatedEvaluate=${String(correlatedAsk)}; assert=${approveStep.assertion?.end?.outcome ?? "none"}; tool=${approvedPart === null ? "missing" : partStatus(approvedPart)}`,
      { resource: approveResource, digest: approveStep.digest },
    )
  }

  // --- approval: rejection --------------------------------------------------------------------
  const rejectStep = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-reject",
    payload: { note: "fixture-reject", seq: 2 },
    approve: true,
    reply: { decision: "reject", message: "f0-spike: rejected by fixture runner" },
  })
  const rejectPart = findToolPart(rejectStep.messages, "spike-reject", 2)
  if (
    rejectStep.ask !== null &&
    rejectStep.assertion?.end?.outcome === "rejected" &&
    rejectPart !== null &&
    partStatus(rejectPart) === "error"
  ) {
    report(
      ctx,
      "approve.reject",
      "passed",
      `reply "reject" rejected the assert (${rejectStep.assertion?.end?.message ?? "no message"}) and the tool part ended in error; no authorization was granted`,
      { resource: rejectStep.resource, part: summarizePart(rejectPart) },
    )
  } else {
    report(
      ctx,
      "approve.reject",
      "failed",
      `expected a rejected assert plus a tool error; ask=${String(rejectStep.ask !== null)}, assert=${rejectStep.assertion?.end?.outcome ?? "none"}, tool=${rejectPart === null ? "missing" : partStatus(rejectPart)}`,
    )
  }

  // --- approval: replay of a consumed approval ------------------------------------------------
  const replayBefore = ctx.askLog.filter((entry) => entry.resources.includes(approveResource)).length
  const replayStep = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-approve",
    payload: { note: "fixture-approve", seq: 1 },
    approve: true,
    reply: { decision: "reject", message: "f0-spike: replay must not inherit approval" },
  })
  const replayAfter = ctx.askLog.filter((entry) => entry.resources.includes(approveResource)).length
  const replayAuthorized = !replayStep.ask && replayStep.assertion?.end?.outcome === "allowed"
  if (replayStep.ask !== null && replayAfter > replayBefore && replayStep.assertion?.end?.outcome === "rejected") {
    report(
      ctx,
      "approve.replay-needs-new-ask",
      "passed",
      `identical operation+input (sha ${replayStep.digest}) raised a NEW ask (asks for the resource: ${replayBefore} -> ${replayAfter}); the consumed "once" approval was not reused`,
      { resource: approveResource, askEvents: ctx.askLog.filter((entry) => entry.resources.includes(approveResource)) },
    )
  } else if (replayAuthorized) {
    report(
      ctx,
      "approve.replay-needs-new-ask",
      "failed",
      `replay of sha ${replayStep.digest} was auto-allowed without any ask — a consumed approval was reused`,
      { resource: approveResource },
    )
  } else {
    report(
      ctx,
      "approve.replay-needs-new-ask",
      "failed",
      `replay did not produce a fresh ask (ask=${String(replayStep.ask !== null)}, asks ${replayBefore}->${replayAfter}, assert=${replayStep.assertion?.end?.outcome ?? "none"})`,
    )
  }

  // --- approval: altered input ----------------------------------------------------------------
  const alteredStep = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-approve",
    payload: { note: "fixture-approve", seq: 3 },
    approve: true,
    reply: { decision: "once" },
  })
  const alteredPart = findToolPart(alteredStep.messages, "spike-approve", 3)
  if (
    alteredStep.ask !== null &&
    alteredStep.resource !== approveResource &&
    alteredStep.ask.resources.includes(alteredStep.resource) &&
    alteredStep.assertion?.end?.outcome === "allowed" &&
    alteredPart !== null &&
    partStatus(alteredPart) === "completed"
  ) {
    report(
      ctx,
      "approve.altered-input-needs-new-ask",
      "passed",
      `altered payload produced sha ${alteredStep.digest} ≠ the approved sha; its own ask (${alteredStep.ask.resources[0]}) was required before the assert resolved`,
      { approvedResource: approveResource, newResource: alteredStep.resource },
    )
  } else {
    report(
      ctx,
      "approve.altered-input-needs-new-ask",
      "failed",
      `altered input did not require its own ask (ask=${JSON.stringify(alteredStep.ask?.resources ?? null)}, assert=${alteredStep.assertion?.end?.outcome ?? "none"})`,
      { approvedResource: approveResource, newResource: alteredStep.resource },
    )
  }

  // --- approval: effective allow is converted to deny ------------------------------------------
  const allowSession = await createSession(ctx, "f0-primary", "f0-spike-allow-rule")
  let allowUpdateError: string | null = null
  try {
    await client.session.update({
      sessionID: allowSession.id,
      permissions: [{ action: "learning.approve", resource: "*", effect: "allow" }],
    })
  } catch (error) {
    allowUpdateError = errorText(error)
  }
  const allowStep = await probeFlow(ctx, {
    sessionID: allowSession.id,
    operation: "spike-allow",
    payload: { note: "fixture-allow", seq: 4 },
    approve: true,
    reply: { decision: "reject", message: "f0-spike: must not reach a reply" },
    waitMs: 15_000,
  })
  const allowEvaluations = evaluationsFor(ctx, allowStep.resource)
  const allowPart = findToolPart(allowStep.messages, "spike-allow", 4)
  const allowConverted = allowEvaluations.find((row) => row.effectIn === "allow" && row.effectOut === "deny")
  if (allowUpdateError !== null) {
    report(ctx, "approve.allow-converted-to-deny", "failed", `session permission override failed: ${allowUpdateError}`)
  } else if (
    allowConverted !== undefined &&
    allowStep.assertion?.end?.outcome === "rejected" &&
    allowStep.ask === null &&
    (allowPart === null || partStatus(allowPart) !== "completed")
  ) {
    report(
      ctx,
      "approve.allow-converted-to-deny",
      "passed",
      `the session rule effect=allow was observed by evaluate (effectIn=allow) and converted to deny (effectOut=${allowConverted.effectOut}); the assert was rejected without publishing an ask`,
      { evaluations: allowEvaluations, assert: allowStep.assertion?.end ?? null, tool: allowPart === null ? null : summarizePart(allowPart) },
    )
  } else {
    report(
      ctx,
      "approve.allow-converted-to-deny",
      "failed",
      `expected an allow→deny conversion; evaluations=${allowEvaluations.length}, ask=${String(allowStep.ask !== null)}, assert=${allowStep.assertion?.end?.outcome ?? "none"}, tool=${allowPart === null ? "missing" : partStatus(allowPart)}`,
    )
  }
  try {
    await client.session.update({ sessionID: allowSession.id, permissions: [] })
  } catch {
    /* best effort reset */
  }

  // --- approval: hardened saved-approval smoke -------------------------------------------------
  const savedPayload: Record<string, unknown> = { note: "fixture-saved", seq: 5 }
  const savedDigest = spikeDigest("spike-saved", savedPayload)
  const savedResource = `spike-saved:${savedDigest}`
  const savedFirst = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-saved",
    payload: savedPayload,
    approve: true,
    save: [savedResource],
    reply: { decision: "always" },
  })
  let savedList: PermissionSavedInfo[] = []
  let savedListError: string | null = null
  try {
    savedList = await client.permission.saved.list()
  } catch (error) {
    savedListError = errorText(error)
  }
  const savedPattern =
    savedList.find(
      (entry) => entry.action === "learning.approve" && entry.resource.includes(savedDigest),
    ) ?? null

  const evalsBefore = evaluationsFor(ctx, savedResource)
  const savedSecond = await probeFlow(ctx, {
    sessionID: session.id,
    operation: "spike-saved",
    payload: savedPayload,
    approve: true,
    reply: { decision: "reject", message: "f0-spike: saved pattern must not authorize" },
    waitMs: 15_000,
  })
  const evalsAfter = evaluationsFor(ctx, savedResource)
  const secondEvaluations = evalsAfter.slice(evalsBefore.length)
  const secondPart = findToolPart(savedSecond.messages, "spike-saved", 5)
  const buildStep = (
    ask: PermissionRequest | null,
    assertion: AssertRecord | null,
    part: SessionMessageAssistantTool | null,
    before: number,
    after: number,
    rows: Array<Extract<EvidenceRow, { type: "evaluate" }>>,
  ): SavedApprovalStep => ({
    askObserved: ask !== null,
    assertOutcome: assertion?.end?.outcome ?? null,
    toolState: denyState(part),
    allowToDenyObserved: rows.some((row) => row.effectIn === "allow" && row.effectOut === "deny"),
    evaluateCountBefore: before,
    evaluateCountAfter: after,
  })
  const savedStep = buildStep(
    savedSecond.ask,
    savedSecond.assertion,
    secondPart,
    evalsBefore.length,
    evalsAfter.length,
    secondEvaluations,
  )

  const authorizedWithoutAsk = !savedStep.askObserved && (savedStep.assertOutcome === "allowed" || savedStep.toolState === "completed")
  let reprobe: { performed: boolean; step: SavedApprovalStep } | null = null
  let fallbackApplied: string | undefined
  if (authorizedWithoutAsk) {
    const beforeThird = evaluationsFor(ctx, savedResource).length
    const savedThird = await probeFlow(ctx, {
      sessionID: session.id,
      operation: "spike-saved",
      payload: savedPayload,
      approve: true,
      reply: { decision: "reject", message: "f0-spike: re-probe — saved pattern must not authorize" },
      waitMs: 15_000,
    })
    const evalsThird = evaluationsFor(ctx, savedResource)
    reprobe = {
      performed: true,
      step: buildStep(
        savedThird.ask,
        savedThird.assertion,
        findToolPart(savedThird.messages, "spike-saved", 5),
        beforeThird,
        evalsThird.length,
        evalsThird.slice(beforeThird),
      ),
    }
    fallbackApplied = await applyApprovalFallback(ctx)
  }

  const savedVerdict = savedApprovalVerdict({
    savedPattern:
      savedPattern === null
        ? {
            found: false,
            detail:
              savedListError ??
              `permission.saved.list returned ${JSON.stringify(savedList.map((entry) => ({ action: entry.action, resource: entry.resource })))}`,
          }
        : { found: true, detail: JSON.stringify({ action: savedPattern.action, resource: savedPattern.resource }) },
    step: savedStep,
    reprobe,
    ...(fallbackApplied === undefined ? {} : { fallbackApplied }),
  })
  reportVerdict(ctx, "approve.saved-approval-no-bypass", savedVerdict, {
    savedFirstAsk: savedFirst.ask === null ? null : savedFirst.ask.id,
    savedListError,
    savedPattern: savedPattern === null ? null : { action: savedPattern.action, resource: savedPattern.resource },
    step: savedStep,
    reprobe,
    fallbackApplied: fallbackApplied ?? null,
  })

  // --- control: exposure follows the permission rules ------------------------------------------
  try {
    const readBefore = await effectiveEffect(ctx, session.id, "read")
    await client.session.update({ sessionID: session.id, permissions: [{ action: "read", resource: "*", effect: "allow" }] })
    const allowMark = fixture.requests.length
    await prompt(ctx, session.id, "F0 spike exposure control (read allowed).")
    await idle(ctx, session.id, 45_000)
    const toolsWithRead = fixture.requests
      .slice(allowMark)
      .map((request) => request.toolNames)
      .find((names) => names.includes("read"))

    await client.session.update({ sessionID: session.id, permissions: [] })
    const denyMark = fixture.requests.length
    await prompt(ctx, session.id, "F0 spike exposure control (read denied again).")
    await idle(ctx, session.id, 45_000)
    const toolsWithoutRead = fixture.requests
      .slice(denyMark)
      .map((request) => request.toolNames)
      .find((names) => names.includes("read"))

    if (readBefore.effect === "deny" && toolsWithRead !== undefined && toolsWithoutRead === undefined) {
      report(
        ctx,
        "policy.exposure-follows-permissions",
        "passed",
        "session rule read:deny → allow exposed `read` to the model; removing the rule hid it again — exposure tracks the effective permission rules (effects probed via POST /api/session/{id}/permission)",
        { readBefore, toolsWithRead, toolsWithoutRead },
      )
    } else {
      report(
        ctx,
        "policy.exposure-follows-permissions",
        "failed",
        `exposure did not track the rules (readBefore=${JSON.stringify(readBefore)}, withAllow=${JSON.stringify(toolsWithRead ?? null)}, afterReset=${JSON.stringify(toolsWithoutRead ?? null)})`,
      )
    }
  } catch (error) {
    report(ctx, "policy.exposure-follows-permissions", "failed", `control failed: ${errorText(error)}`)
  }

  // --- denials: shell / edit / execute / subagent -----------------------------------------------
  const denyTargets: Array<{ kind: ToolKind; id: CheckId; target: string | null }> = [
    { kind: "shell", id: "deny.shell", target: path.join(sandbox.project, "side-effect-shell.txt") },
    { kind: "edit", id: "deny.edit", target: path.join(sandbox.project, "side-effect-edit.txt") },
    { kind: "execute", id: "deny.execute", target: null },
    { kind: "subagent", id: "deny.subagent-delegation", target: null },
  ]
  const denyOutcomes: Record<string, unknown> = {}
  for (const targetSpec of denyTargets) {
    const discovery = discoverTool(ctx, targetSpec.kind)
    const toolInput =
      discovery.exposed ? buildToolInput(latestTools(ctx).find((tool) => toolNameOf(tool) === discovery.name), targetSpec.target) : FALLBACK_INPUTS[targetSpec.kind]
    const effective = await effectiveEffect(ctx, session.id, discovery.action)
    const step = await callTool(ctx, session.id, discovery.name, toolInput)
    const part = findLastToolPart(step.messages, discovery.name)
    const sideEffect = targetSpec.target !== null && fs.existsSync(targetSpec.target)
    const state = denyState(part)
    const verdict = denyVerdict({
      action: discovery.action,
      toolName: discovery.name,
      registered: discovery.registered,
      exposed: discovery.exposed,
      effective: effective.effect,
      effectiveError: effective.error,
      toolState: state === "completed" ? "completed" : state === "error" ? "error" : "missing",
      errorMessage: part === null ? "" : partError(part),
      sideEffect,
    })
    denyOutcomes[targetSpec.kind] = {
      discovery,
      toolInput,
      effective,
      state,
      sideEffect,
      idle: step.idle,
    }
    reportVerdict(ctx, targetSpec.id, verdict, {
      requestedTool: discovery.name,
      action: discovery.action,
      effective,
      input: toolInput,
      sideEffectPath: targetSpec.target,
      sideEffectCreated: sideEffect,
      registered: discovery.registered,
      exposedToModel: discovery.exposed,
      requestToolNames: discovery.requestToolNames,
      error: part === null ? "" : partError(part).slice(0, 300),
    })
  }

  // --- child agent must not escalate -------------------------------------------------------------
  let childSession: SessionInfo | null = null
  let childCreateNote = ""
  try {
    childSession = await client.session.create({
      agent: "f0-child",
      title: "f0-spike-child",
      location,
    })
    childCreateNote = "created directly with agent=f0-child"
  } catch (error) {
    childCreateNote = `direct create failed (${errorText(error)}); falling back to switchAgent`
    try {
      const fallback = await createSession(ctx, "f0-primary", "f0-spike-child")
      await client.session.switchAgent({ sessionID: fallback.id, agent: "f0-child" })
      childSession = fallback
    } catch (fallbackError) {
      childCreateNote += `; fallback failed: ${errorText(fallbackError)}`
      childSession = null
    }
  }

  if (childSession === null) {
    report(ctx, "child.no-escalation", "blocked", `could not obtain a session on f0-child: ${childCreateNote}`)
  } else {
    const evaluateCountBefore = evaluationsAll(ctx, "learning.approve").length
    await prompt(ctx, childSession.id, "F0 spike child baseline prompt.")
    await idle(ctx, childSession.id, 45_000)
    const childTools = fixture.requests[fixture.requests.length - 1]?.toolNames ?? []
    const childStep = await probeFlow(ctx, {
      sessionID: childSession.id,
      operation: "spike-child-approve",
      payload: { note: "fixture-child", seq: 6 },
      approve: true,
      reply: { decision: "reject", message: "f0-spike: must not reach a reply" },
      waitMs: 12_000,
    })
    const evaluateCountAfter = evaluationsAll(ctx, "learning.approve").length
    const childApproveEffective = await effectiveEffect(ctx, childSession.id, "learning.approve")
    const childShellEffective = await effectiveEffect(ctx, childSession.id, "shell")
    const childDrained = await drainPending(ctx, childSession.id)
    const childDiscovery = discoverTool(ctx, "shell")
    const childShellStep = await callTool(ctx, childSession.id, childDiscovery.name, FALLBACK_INPUTS.shell)
    const childShellPart = findLastToolPart(childShellStep.messages, childDiscovery.name)
    const childInfo = await client.session.get({ sessionID: childSession.id }).catch(() => null)
    const childAgent = childInfo === null ? null : childInfo.agent ?? null
    const childAssistantAgent = lastAssistantAgent(childStep.messages)

    const approveDeniedWithoutHook =
      childStep.ask === null &&
      childStep.assertion?.end?.outcome === "rejected" &&
      evaluateCountAfter === evaluateCountBefore
    const shellState = denyState(childShellPart)
    const shellError = childShellPart === null ? "" : partError(childShellPart)
    const policyDenies = childApproveEffective.effect === "deny" && childShellEffective.effect === "deny"
    const agentOk = childAgent === "f0-child" || childAssistantAgent === "f0-child"

    if (approveDeniedWithoutHook && shellState !== "completed" && agentOk && policyDenies) {
      report(
        ctx,
        "child.no-escalation",
        "passed",
        `agent=${String(childAgent ?? childAssistantAgent)} (${childCreateNote}); the child policy evaluates learning.approve=deny and shell=deny (probes returned deny, ${childDrained} stray request(s) drained); the f0_probe assert was rejected without invoking evaluate (evaluate count unchanged: ${evaluateCountBefore}) and without any ask; shell tool in child: ${shellState === "missing" ? "not exposed" : `rejected (${shellError.slice(0, 120)})`}; child request tools: ${JSON.stringify(childTools)}`,
        {
          childAgent,
          childAssistantAgent,
          assert: childStep.assertion?.end ?? null,
          childApproveEffective,
          childShellEffective,
          childTools,
          shellState,
        },
      )
    } else if (approveDeniedWithoutHook && shellState === "error" && agentOk && policyDenies) {
      report(
        ctx,
        "child.no-escalation",
        "blocked",
        `child approval was denied without evaluate/ask, but the shell attempt failed with a non-permission error — denial source unverified: ${shellError.slice(0, 200)} (${childCreateNote})`,
        { childApproveEffective, childShellEffective, childTools, shellState },
      )
    } else {
      report(
        ctx,
        "child.no-escalation",
        "failed",
        `escalation check failed: agent=${String(childAgent)}/${String(childAssistantAgent)}, ask=${String(childStep.ask !== null)}, assert=${childStep.assertion?.end?.outcome ?? "none"}, evaluateCount ${evaluateCountBefore}->${evaluateCountAfter}, shellState=${shellState}, policy=${JSON.stringify({ approve: childApproveEffective, shell: childShellEffective })} (${childCreateNote})`,
        { childTools },
      )
    }
    ctx.artifacts["childSession"] = childSession.id
  }

  // --- hooks: stop dispatch per flow ----------------------------------------------------------------
  const generateSession = await createSession(ctx, "f0-primary", "f0-spike-generate")
  await runHookCheck(ctx, {
    id: "hook.generate-blocks-dispatch",
    kind: "generate",
    gateKind: "generate",
    blockSpec: { generate: true },
    drainMs: 400,
    trigger: async () => {
      const mark = fixture.requests.length
      try {
        const out = await client.session.generate({ sessionID: generateSession.id, prompt: "F0 spike generate probe." })
        return { ok: true, delta: fixture.requests.length - mark, text: out.text.slice(0, 60) }
      } catch (error) {
        return { ok: false, error: errorText(error), delta: fixture.requests.length - mark }
      }
    },
  })

  const compactionSession = await createSession(ctx, "f0-primary", "f0-spike-compaction")
  await prompt(ctx, compactionSession.id, "F0 spike compaction seed message one.")
  await prompt(ctx, compactionSession.id, "F0 spike compaction seed message two.")
  await idle(ctx, compactionSession.id, 45_000)
  await runHookCheck(ctx, {
    id: "hook.compaction-blocks-dispatch",
    kind: "compaction",
    gateKind: "compaction",
    blockSpec: { compaction: true },
    drainMs: 400,
    trigger: async () => {
      let compactResult: unknown
      try {
        compactResult = await client.session.compact({ sessionID: compactionSession.id })
      } catch (error) {
        compactResult = { error: errorText(error) }
      }
      await prompt(ctx, compactionSession.id, "F0 spike compaction boundary prompt.")
      const idleResult = await idle(ctx, compactionSession.id, 45_000)
      await sleep(1_500)
      return { compactResult, idleResult }
    },
  })

  await runHookCheck(ctx, {
    id: "hook.title-blocks-dispatch",
    kind: "title",
    gateKind: "title",
    blockSpec: { title: true },
    drainMs: 400,
    trigger: async () => {
      // sessions are created WITHOUT a title so OpenCode itself may generate one
      const fresh = await createSession(ctx, "f0-primary")
      const promptResult = await prompt(ctx, fresh.id, "F0 spike title probe message.")
      const idleResult = await idle(ctx, fresh.id, 45_000)
      await sleep(2_000)
      const info = await client.session.get({ sessionID: fresh.id }).catch(() => null)
      return { sessionID: fresh.id, promptResult, idleResult, title: info === null ? null : info.title ?? null }
    },
  })

  await runHookCheck(ctx, {
    id: "hook.context-blocks-dispatch",
    kind: "primary",
    gateKind: "context",
    blockSpec: { context: true, compaction: true, generate: true, title: true },
    drainMs: 1_500,
    trigger: async () => {
      const fresh = await createSession(ctx, "f0-primary")
      const mark = fixture.requests.length
      const promptResult = await prompt(ctx, fresh.id, "F0 spike context block probe.")
      const idleResult = await idle(ctx, fresh.id, 20_000)
      await sleep(1_500)
      return {
        sessionID: fresh.id,
        promptResult,
        idleResult,
        deltaWhileBlocked: fixture.requests.length - mark,
        gate: gateFor(ctx, "context"),
      }
    },
  })
  setControl(sandbox, {})

  // --- disclosure gate ------------------------------------------------------------------------------
  setControl(sandbox, {})
  setConsent(sandbox, null)
  const denySession = await createSession(ctx, "f0-primary", "f0-spike-disclosure-deny")
  const denyMark = fixture.requests.length
  const denyPrompt = await prompt(ctx, denySession.id, "F0 spike disclosure probe without evidence.")
  const denyIdle = await idle(ctx, denySession.id, 20_000)
  await sleep(1_500)
  const denyDelta = fixture.requests.length - denyMark
  const denyGate = gateFor(ctx, "context")
  reportVerdict(
    ctx,
    "disclosure.default-deny-without-evidence",
    disclosureVerdict({
      scenario: "no disclosure evidence",
      delta: denyDelta,
      gateDecision: denyGate === null ? null : denyGate.decision,
      gateReason: denyGate === null ? null : denyGate.reason,
      expectedReasons: ["default-deny:no-disclosure-evidence"],
    }),
    { gate: denyGate, idle: denyIdle, prompt: denyPrompt },
  )

  setConsent(sandbox, validConsent("https://remote.example.invalid/v1", "f0remote", ["https://remote.example.invalid/v1"]))
  let remoteSwitched = false
  let remoteNote = ""
  try {
    await client.session.switchModel({ sessionID: denySession.id, model: { providerID: "f0remote", id: "f0-model" } })
    remoteSwitched = true
    remoteNote = "session switched to provider f0remote"
  } catch (error) {
    remoteNote = `switchModel to f0remote failed: ${errorText(error)}`
  }
  const remoteHttpBefore = httpDispatchRows(readEvidence(ctx)).filter((row) => row.url.includes("remote.example.invalid")).length
  const remoteMark = fixture.requests.length
  const remotePrompt = remoteSwitched ? await prompt(ctx, denySession.id, "F0 spike remote destination probe.") : null
  const remoteIdle = remoteSwitched ? await idle(ctx, denySession.id, 20_000) : null
  await sleep(1_500)
  const remoteDelta = fixture.requests.length - remoteMark
  const remoteGate = gateFor(ctx, "context")
  const remoteHttpAfter = httpDispatchRows(readEvidence(ctx)).filter((row) => row.url.includes("remote.example.invalid")).length
  if (!remoteSwitched) {
    report(ctx, "disclosure.remote-destination-rejected", "blocked", `could not exercise the remote provider: ${remoteNote}`, { gate: remoteGate })
  } else if (remoteHttpAfter > remoteHttpBefore) {
    report(
      ctx,
      "disclosure.remote-destination-rejected",
      "failed",
      `the plugin's http hook recorded ${remoteHttpAfter - remoteHttpBefore} dispatch attempt(s) toward the remote host — the gate did not stop it before dispatch`,
      { gate: remoteGate, remoteHttpBefore, remoteHttpAfter },
    )
  } else {
    reportVerdict(
      ctx,
      "disclosure.remote-destination-rejected",
      disclosureVerdict({
        scenario: "remote destination (f0remote, https://remote.example.invalid/v1)",
        delta: remoteDelta,
        gateDecision: remoteGate === null ? null : remoteGate.decision,
        gateReason: remoteGate === null ? null : remoteGate.reason,
        expectedReasons: ["remote-destination-rejected", "consent-lists-remote-destination"],
      }),
      { gate: remoteGate, remoteHttpBefore, remoteHttpAfter, idle: remoteIdle, prompt: remotePrompt },
    )
  }

  setConsent(sandbox, validConsent(options.fixtureBaseURL))
  const allowMark = fixture.requests.length
  const okSession = await createSession(ctx, "f0-primary", "f0-spike-disclosure-allow")
  const okPrompt = await prompt(ctx, okSession.id, "F0 spike fixture destination probe.")
  const okIdle = await idle(ctx, okSession.id, 45_000)
  const okDelta = fixture.requests.length - allowMark
  const okGate = gateFor(ctx, "context")
  if (okDelta > 0 && okGate !== null && okGate.decision === "allow") {
    report(
      ctx,
      "disclosure.fixture-destination-allowed",
      "passed",
      `with valid loopback fixture evidence the same gate dispatches: ${okDelta} request(s) received, gate reason ${okGate.reason} (control positive for the default-deny gate)`,
      { gate: okGate, idle: okIdle, prompt: okPrompt },
    )
  } else {
    report(
      ctx,
      "disclosure.fixture-destination-allowed",
      "failed",
      `expected dispatch with valid fixture evidence; delta=${okDelta}, gate=${JSON.stringify(okGate)}`,
      { idle: okIdle, prompt: okPrompt },
    )
  }

  ctx.artifacts["sessions"] = { main: session.id, allow: allowSession.id }
  ctx.artifacts["denyOutcomes"] = denyOutcomes
}
