/**
 * Shared contracts for the F0 OpenCode V2 spike (fixture data only).
 *
 * Imported as types only by the plugin, the runner and the tests, so nothing here may have
 * runtime side effects or depend on the OpenCode SDK. All records describe FICTIONAL data.
 */

// -------------------------------------------------------------------------------------------
// Dispatch flows (spec §11) and plugin control inputs
// -------------------------------------------------------------------------------------------

export type DispatchKind = "context" | "compaction" | "generate" | "title"

/** Flow kind as reported by OpenCode: the agent loop is called `primary`. */
export type FlowKind = DispatchKind | "primary"

/** `<location>/.f0-spike/control.json` — re-read by the plugin on every hook invocation. */
export interface SpikeControl {
  block?: Partial<Record<DispatchKind, boolean>>
}

/**
 * `<location>/.f0-spike/consent.json` — FICTIONAL disclosure evidence for the spike.
 * There is no real consent anywhere in this fixture.
 */
export interface SpikeConsent {
  fixture?: boolean
  providerID?: string
  destinations?: string[]
  purposes?: string[]
  expiresAt?: number
  note?: string
}

/** Env vars the spike must prove are NOT forwarded to the runner or to `opencode serve`. */
export const SENTINEL_ENV_VARS: readonly string[] = [
  "F0_SENTINEL_AWS_SECRET_ACCESS_KEY",
  "F0_SENTINEL_OPENAI_API_KEY",
  "F0_SENTINEL_ANTHROPIC_API_KEY",
  "F0_SENTINEL_HTTPS_PROXY",
  "F0_SENTINEL_NODE_OPTIONS",
  "F0_SENTINEL_LD_LIBRARY_PATH",
]

/** Record written by the plugin. Values are booleans only — never env contents. */
export interface EnvSentinelRow {
  present: Record<string, boolean>
}

// -------------------------------------------------------------------------------------------
// Evidence rows appended by the plugin to `<location>/.f0-spike/evidence.jsonl`
// -------------------------------------------------------------------------------------------

type Row<T> = { t: number } & T
type WithoutT<R> = R extends { t: number } ? Omit<R, "t"> : never

export type EvidenceRowInput =
  | { type: "plugin.loaded"; app: string; location: string; options: Record<string, unknown> }
  | { type: "plugin.unloaded" }
  | {
      type: "tools.snapshot"
      ids: string[]
      f0: Array<{ id: string; codemode?: boolean | null; namespace?: string | null }>
    }
  | {
      type: "tool.execute.begin"
      tool: string
      sessionID: string
      actor: string
      messageID: string
      callID: string
      operation: string
      digest: string
    }
  | { type: "tool.execute.end"; tool: string; actor: string; digest: string; approved: boolean }
  | {
      type: "assert.begin"
      id: number
      sessionID: string
      actor: string
      action: string
      resources: string[]
    }
  | { type: "assert.end"; id: number; outcome: "allowed" | "rejected"; message?: string }
  | {
      type: "evaluate"
      sessionID: string
      actor: string | null
      action: string
      resources: string[]
      effectIn: "allow" | "deny" | "ask"
      effectOut: "allow" | "deny" | "ask"
      correlated: number | null
    }
  | {
      type: "gate"
      kind: DispatchKind
      decision: "allow" | "block"
      reason: string
      providerID: string
      baseURL: string | null
    }
  | { type: "model.request"; kind: FlowKind; sessionID: string; providerID: string; modelID: string }
  | { type: "http.dispatch"; kind: FlowKind; sessionID: string; url: string }
  | ({ type: "env.sentinel" } & EnvSentinelRow)

export type EvidenceRow = Row<EvidenceRowInput>
export type EvidenceInput = WithoutT<EvidenceRow>

// -------------------------------------------------------------------------------------------
// Fixture provider records (loopback, 127.0.0.1 only)
// -------------------------------------------------------------------------------------------

export interface FixtureRequest {
  t: number
  path: string
  kind: string | null
  model: string | null
  stream: boolean
  toolNames: string[]
  tools: unknown
  lastUser: string | null
  messageRoles: Array<string | null>
}

// -------------------------------------------------------------------------------------------
// Check + report shapes
// -------------------------------------------------------------------------------------------

export type CheckStatus = "passed" | "blocked" | "failed"

export interface Check {
  id: string
  status: CheckStatus
  reason: string
  details?: unknown
}

export interface Verdict {
  status: CheckStatus
  reason: string
}

export interface PinCheck {
  name: string
  expected: string
  actual: string | null
  ok: boolean
  source: string
}

export interface PinReport {
  ok: boolean
  checks: PinCheck[]
}

export interface SpikeReport {
  spike: string
  startedAt: string
  finishedAt: string
  spec: string[]
  plan: string
  pins: PinReport
  versions: Record<string, unknown>
  checks: Check[]
  summary: { passed: number; blocked: number; failed: number; total: number }
  fixtureProvider: { baseURL: string; requests: number; byKind: Record<string, number> } | null
  events: Record<string, number>
  artifacts: Record<string, unknown>
  scope: string[]
}
