/**
 * Pure logic for the F0 spike: fixture canonicalization, boundary validation and the check
 * verdicts. No OpenCode SDK imports — the tests exercise these functions directly so a
 * "green" claim can never depend on a mocked dispatch.
 *
 * Canonicalization note: `stableValue` recursively sorts object keys so the runner and the
 * plugin derive the same SHA-256 over the FICTIONAL fixture payload (ASCII keys/values only).
 * This is deliberately NOT a full RFC 8785 (JCS) implementation and is not claimed as one.
 */
import { createHash } from "node:crypto"
import type {
  DispatchKind,
  EvidenceRow,
  SpikeConsent,
  SpikeControl,
  Verdict,
} from "./contracts.ts"

// -------------------------------------------------------------------------------------------
// Fixture canonicalization + digest vectors captured from real runs
// -------------------------------------------------------------------------------------------

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    const entries = Object.entries(value)
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [key, entry] of entries) out[key] = stableValue(entry)
    return out
  }
  return value
}

export function spikeDigest(operation: string, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue({ operation, payload }))).digest("hex")
}

/** Digests observed in real spike runs — pins plugin/runner parity across implementations. */
export const DIGEST_VECTORS: ReadonlyArray<{
  operation: string
  payload: Record<string, unknown>
  digest: string
}> = [
  {
    operation: "spike-base",
    payload: { note: "fixture-f0", seq: 1 },
    digest: "b594a8b3886e357ce8a37f01355c4fc854c6ab4d0a673294a24bec7de8a1104b",
  },
  {
    operation: "spike-approve",
    payload: { note: "fixture-approve", seq: 1 },
    digest: "92252463a71a3b5e0b451eebd00abec6d17a5eadc9c8bb424adf2d7bab22d182",
  },
  {
    operation: "spike-approve",
    payload: { note: "fixture-approve", seq: 3 },
    digest: "c9d7b9413a7f98ce10ebdce002b806e76cea6b409fb0beff4ed392195d11a1b1",
  },
]

// -------------------------------------------------------------------------------------------
// Boundary validation (unknown → typed)
// -------------------------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return null
    out.push(item)
  }
  return out
}

function isDispatchKind(value: unknown): value is DispatchKind {
  return value === "context" || value === "compaction" || value === "generate" || value === "title"
}

function isEffect(value: unknown): value is "allow" | "deny" | "ask" {
  return value === "allow" || value === "deny" || value === "ask"
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string"
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number"
}

export function isEvidenceRow(value: unknown): value is EvidenceRow {
  if (!isRecord(value)) return false
  if (typeof value["t"] !== "number" || typeof value["type"] !== "string") return false
  switch (value["type"]) {
    case "plugin.loaded":
      return typeof value["app"] === "string" && typeof value["location"] === "string" && isRecord(value["options"])
    case "plugin.unloaded":
      return true
    case "tools.snapshot":
      return asStringArray(value["ids"]) !== null && Array.isArray(value["f0"])
    case "tool.execute.begin":
      return (
        typeof value["tool"] === "string" &&
        typeof value["sessionID"] === "string" &&
        typeof value["actor"] === "string" &&
        typeof value["messageID"] === "string" &&
        typeof value["callID"] === "string" &&
        typeof value["operation"] === "string" &&
        typeof value["digest"] === "string"
      )
    case "tool.execute.end":
      return (
        typeof value["tool"] === "string" &&
        typeof value["actor"] === "string" &&
        typeof value["digest"] === "string" &&
        typeof value["approved"] === "boolean"
      )
    case "assert.begin":
      return (
        typeof value["id"] === "number" &&
        typeof value["sessionID"] === "string" &&
        typeof value["actor"] === "string" &&
        typeof value["action"] === "string" &&
        asStringArray(value["resources"]) !== null
      )
    case "assert.end":
      return (
        typeof value["id"] === "number" &&
        (value["outcome"] === "allowed" || value["outcome"] === "rejected") &&
        (value["message"] === undefined || typeof value["message"] === "string")
      )
    case "evaluate":
      return (
        typeof value["sessionID"] === "string" &&
        isNullableString(value["actor"]) &&
        typeof value["action"] === "string" &&
        asStringArray(value["resources"]) !== null &&
        isEffect(value["effectIn"]) &&
        isEffect(value["effectOut"]) &&
        isNullableNumber(value["correlated"])
      )
    case "gate":
      return (
        isDispatchKind(value["kind"]) &&
        (value["decision"] === "allow" || value["decision"] === "block") &&
        typeof value["reason"] === "string" &&
        typeof value["providerID"] === "string" &&
        isNullableString(value["baseURL"])
      )
    case "model.request":
      return (
        isDispatchKind(value["kind"]) &&
        typeof value["sessionID"] === "string" &&
        typeof value["providerID"] === "string" &&
        typeof value["modelID"] === "string"
      )
    case "http.dispatch":
      return (
        isDispatchKind(value["kind"]) && typeof value["sessionID"] === "string" && typeof value["url"] === "string"
      )
    case "env.sentinel": {
      const present = value["present"]
      if (!isRecord(present)) return false
      return Object.values(present).every((entry) => typeof entry === "boolean")
    }
    default:
      return false
  }
}

export function parseEvidence(jsonl: string): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  for (const line of jsonl.split("\n")) {
    if (line.trim().length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (isEvidenceRow(parsed)) rows.push(parsed)
  }
  return rows
}

/** Unknown JSON → control; anything unexpected falls back to "block nothing" only if valid. */
export function parseControl(raw: unknown): SpikeControl | null {
  if (!isRecord(raw)) return null
  const block = raw["block"]
  if (block === undefined) return {}
  if (!isRecord(block)) return null
  const parsed: Partial<Record<DispatchKind, boolean>> = {}
  for (const kind of ["context", "compaction", "generate", "title"] as const) {
    const value = block[kind]
    if (value === undefined) continue
    if (typeof value !== "boolean") return null
    parsed[kind] = value
  }
  return { block: parsed }
}

/** Unknown JSON → consent evidence. Returns null when the file is absent or malformed. */
export function parseConsent(raw: unknown): SpikeConsent | null {
  if (!isRecord(raw)) return null
  const consent: SpikeConsent = {}
  if (raw["fixture"] !== undefined) {
    if (typeof raw["fixture"] !== "boolean") return null
    consent.fixture = raw["fixture"]
  }
  if (raw["providerID"] !== undefined) {
    const providerID = asString(raw["providerID"])
    if (providerID === null) return null
    consent.providerID = providerID
  }
  if (raw["destinations"] !== undefined) {
    const destinations = asStringArray(raw["destinations"])
    if (destinations === null) return null
    consent.destinations = destinations
  }
  if (raw["purposes"] !== undefined) {
    const purposes = asStringArray(raw["purposes"])
    if (purposes === null) return null
    consent.purposes = purposes
  }
  if (raw["expiresAt"] !== undefined) {
    if (typeof raw["expiresAt"] !== "number") return null
    consent.expiresAt = raw["expiresAt"]
  }
  if (raw["note"] !== undefined) {
    const note = asString(raw["note"])
    if (note === null) return null
    consent.note = note
  }
  return consent
}

// -------------------------------------------------------------------------------------------
// Check verdicts (pure, unit-tested)
// -------------------------------------------------------------------------------------------

export interface DenyVerdictInput {
  action: string
  toolName: string
  registered: boolean
  exposed: boolean
  effective: "allow" | "deny" | "ask" | null
  effectiveError: string | null
  toolState: "completed" | "error" | "missing"
  errorMessage: string
  sideEffect: boolean
}

const PERMISSION_ERROR = /(denied|permission|not allowed|disallowed|forbidden|unauthorized)/i
const UNAVAILABLE_ERROR = /No tool named .* is currently available/i

/** shell/edit/execute/subagent must be denied by policy AND behave as denied. */
export function denyVerdict(input: DenyVerdictInput): Verdict {
  const behaviourDenied =
    (UNAVAILABLE_ERROR.test(input.errorMessage) && !input.exposed) ||
    (input.toolState === "error" && PERMISSION_ERROR.test(input.errorMessage)) ||
    (input.toolState === "missing" && !input.exposed)

  if (input.sideEffect) {
    return {
      status: "failed",
      reason: `${input.action}/${input.toolName}: side effect produced despite deny-by-default`,
    }
  }
  if (input.toolState === "completed") {
    return { status: "failed", reason: `${input.action}/${input.toolName}: tool EXECUTED despite deny-by-default` }
  }
  if (input.effective === "allow" || input.effective === "ask") {
    return {
      status: "failed",
      reason: `action ${input.action} evaluates to ${input.effective} (expected deny) — policy does not deny`,
    }
  }
  if (input.effective === null) {
    return {
      status: "blocked",
      reason: `action ${input.action}: policy probe unavailable (${input.effectiveError ?? "unknown error"}) — denial not certified`,
    }
  }
  if (behaviourDenied) {
    const behaviour =
      input.toolState === "error"
        ? `call rejected: ${input.errorMessage.slice(0, 160)}`
        : `no executable tool part produced (registered=${input.registered}, exposed=${input.exposed})`
    return {
      status: "passed",
      reason: `action ${input.action} evaluates deny; tool ${input.toolName}: ${behaviour}`,
    }
  }
  return {
    status: "blocked",
    reason: `action ${input.action}/${input.toolName}: inconclusive (state=${input.toolState}, exposed=${input.exposed}) — denial not certified`,
  }
}

export interface HookWindow {
  total: number
  kindCount: number
  kinds: string[]
  gate: { kind: string; decision: "allow" | "block"; reason: string } | null
}

/**
 * A hook check passes only with BOTH: the unblocked control dispatched the flow and the blocked
 * run produced none of it. Anything unobservable is `blocked`, never `passed`.
 */
export function hookVerdict(kind: string, negative: HookWindow, positive: HookWindow, gateKind = kind === "primary" ? "context" : kind): Verdict {
  // attribution must hold for EACH window that carries traffic
  const negativeAttributed = negative.total === 0 || (negative.kinds.length > 0 && negative.kinds.every((entry) => entry !== "unknown"))
  const positiveAttributed = positive.total === 0 || (positive.kinds.length > 0 && positive.kinds.every((entry) => entry !== "unknown"))

  if (!negativeAttributed) {
    return {
      status: "blocked",
      reason: `${kind}: ${negative.total} request(s) in the blocked window without x-f0-kind attribution — dispatch source unverified`,
    }
  }
  if (negative.kindCount > 0) {
    return {
      status: "failed",
      reason: `${kind}: ${negative.kindCount} request(s) of kind=${kind} reached the fixture while the hook was blocking`,
    }
  }
  if (negative.gate?.kind !== gateKind || negative.gate.decision !== "block" || negative.gate.reason !== `hook-block:${gateKind}`) {
    return {
      status: "blocked",
      reason: `${kind}: no matching block decision from the hook in the blocked window — absence of requests alone proves nothing`,
    }
  }
  if (positive.gate?.kind !== gateKind || positive.gate.decision !== "allow" || positive.gate.reason !== "consent-valid-loopback-fixture") {
    return {
      status: "blocked",
      reason: `${kind}: unblocked control did not reach the matching allow gate — hook blocking unverified`,
    }
  }
  if (positive.kindCount > 0) {
    return {
      status: "passed",
      reason: `${kind}: matching block/allow gates observed; unblocked control dispatched ${positive.kindCount} request(s) of kind=${kind}; blocked run produced none (blocked window total=${negative.total})`,
    }
  }
  if (!positiveAttributed) {
    return {
      status: "blocked",
      reason: `${kind}: unblocked control produced ${positive.total} request(s) but the flow cannot be isolated — blocking unverified`,
    }
  }
  return {
    status: "blocked",
    reason: `${kind}: flow never dispatched even when unblocked — hook blocking unverified`,
  }
}

export interface SavedApprovalStep {
  askObserved: boolean
  assertOutcome: "allowed" | "rejected" | null
  toolState: "completed" | "error" | "missing"
  allowToDenyObserved: boolean
  evaluateCountBefore: number
  evaluateCountAfter: number
}

export interface SavedApprovalInput {
  /** The reply "always" must really have persisted a saved pattern (from permission.saved.list). */
  savedPattern: { found: boolean; detail: string }
  step: SavedApprovalStep
  /** A second, independent re-probe is mandatory whenever the first one authorized. */
  reprobe: { performed: boolean; step: SavedApprovalStep } | null
  fallbackApplied?: string
}

function authorized(step: SavedApprovalStep): boolean {
  return step.assertOutcome === "allowed" || step.toolState === "completed"
}

/**
 * §8.2 smoke for the pinned version: a saved pattern must never authorize by itself.
 * Pass ONLY via (a) new ask + reply reject → rejected, or (b) evaluate allow→deny → rejected.
 * Any authorization without an ask fails, even when evaluate records increased.
 */
export function savedApprovalVerdict(input: SavedApprovalInput): Verdict {
  const { step } = input

  if (!input.savedPattern.found) {
    return {
      status: "blocked",
      reason: `reply "always" persisted no saved pattern (${input.savedPattern.detail}) — the bypass scenario cannot be exercised; approval not certified`,
    }
  }

  if (authorized(step) && !step.askObserved) {
    const reprobe = input.reprobe
    const confirmed =
      reprobe !== null && reprobe.performed && !reprobe.step.askObserved && authorized(reprobe.step)
    return {
      status: "failed",
      reason:
        `authorization WITHOUT ask observed (assert=${step.assertOutcome}, tool=${step.toolState}) even though ` +
        `evaluate went ${step.evaluateCountBefore}->${step.evaluateCountAfter}; re-probe ` +
        `${reprobe?.performed ? (confirmed ? "confirmed the bypass" : "did not reproduce it") : "not performed"}` +
        `${input.fallbackApplied ? `; fallback: ${input.fallbackApplied}` : ""}`,
    }
  }

  if (step.askObserved) {
    if (step.assertOutcome === "rejected" && step.toolState !== "completed") {
      return {
        status: "passed",
        reason: `saved pattern did not authorize: a fresh ask was published and reply "reject" left the assert rejected (tool=${step.toolState}); evaluate ${step.evaluateCountBefore}->${step.evaluateCountAfter} is corroboration only`,
      }
    }
    if (authorized(step)) {
      return { status: "failed", reason: `assert authorized after a reject reply (tool=${step.toolState})` }
    }
    return { status: "blocked", reason: `ask observed but the outcome is inconclusive (assert=${step.assertOutcome})` }
  }

  if (step.allowToDenyObserved && step.assertOutcome === "rejected" && step.toolState !== "completed") {
    return {
      status: "passed",
      reason: `saved pattern resolved to allow and evaluate converted it to deny: assert rejected without any ask (tool=${step.toolState})`,
    }
  }

  if (step.assertOutcome === "rejected" && step.toolState !== "completed" && !step.allowToDenyObserved) {
    return {
      status: "blocked",
      reason: "assert rejected without ask, but neither documented pattern (new ask + reject, or allow→deny) was verified",
    }
  }

  return {
    status: "blocked",
    reason: `inconclusive saved-approval outcome (ask=${step.askObserved}, assert=${step.assertOutcome}, tool=${step.toolState})`,
  }
}

export interface DisclosureInput {
  scenario: string
  delta: number
  gateDecision: "allow" | "block" | null
  gateReason: string | null
  expectedReasons: string[]
}

/** Disclosure gate: dispatched ⇒ failed; not blocked ⇒ failed; blocked for another reason ⇒ blocked. */
export function disclosureVerdict(input: DisclosureInput): Verdict {
  if (input.delta > 0) {
    return {
      status: "failed",
      reason: `${input.scenario}: ${input.delta} request(s) dispatched although the gate should reject`,
    }
  }
  if (input.gateDecision !== "block") {
    return {
      status: "failed",
      reason: `${input.scenario}: gate did not block (decision=${input.gateDecision ?? "missing"})`,
    }
  }
  if (input.gateReason !== null && input.expectedReasons.includes(input.gateReason)) {
    return {
      status: "passed",
      reason: `${input.scenario}: rejected before dispatch (gate=${input.gateReason}, 0 requests)`,
    }
  }
  return {
    status: "blocked",
    reason: `${input.scenario}: blocked for an unexpected reason (${input.gateReason ?? "missing"}) — scenario not exercised`,
  }
}
