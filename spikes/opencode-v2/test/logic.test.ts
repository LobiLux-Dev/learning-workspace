/**
 * Pure check logic: fixture digest parity with the plugin (vectors captured from real runs),
 * boundary parsing of plugin evidence/control/consent, and the negative-case verdicts that keep
 * a check from turning green without real proof.
 */
import assert from "node:assert/strict"
import { it } from "node:test"
import {
  DIGEST_VECTORS,
  denyVerdict,
  disclosureVerdict,
  hookVerdict,
  isEvidenceRow,
  parseConsent,
  parseControl,
  parseEvidence,
  savedApprovalVerdict,
  spikeDigest,
  stableValue,
  type SavedApprovalStep,
} from "../lib/logic.ts"

it("digest vectors from real runs reproduce plugin/runner parity", () => {
  for (const vector of DIGEST_VECTORS) {
    assert.equal(spikeDigest(vector.operation, vector.payload), vector.digest, vector.operation)
  }
  // key order must not matter (recursive ordering, ASCII fixture data)
  assert.equal(
    spikeDigest("op", { a: 1, b: { c: 2, d: 3 } }),
    spikeDigest("op", { b: { d: 3, c: 2 }, a: 1 }),
  )
  assert.notEqual(
    spikeDigest("op", { note: "x", seq: 1 }),
    spikeDigest("op", { note: "x", seq: 2 }),
    "different input must produce a different sha",
  )
  assert.deepEqual(stableValue({ b: 1, a: 2 }), { a: 2, b: 1 })
})

it("evidence parsing validates rows and skips malformed lines", () => {
  const jsonl = [
    JSON.stringify({ t: 1, type: "plugin.loaded", app: "2.1.3", location: "/tmp/x", options: {} }),
    "not-json",
    JSON.stringify({ t: 2, type: "unknown.type" }),
    JSON.stringify({ t: 3, type: "gate", kind: "title", decision: "block", reason: "hook-block:title", providerID: "p", baseURL: null }),
    JSON.stringify({ t: 4, type: "env.sentinel", present: { A: true, B: false } }),
    JSON.stringify({ t: 5, type: "env.sentinel", present: { A: "not-a-boolean" } }),
    JSON.stringify({ t: 6, type: "assert.end", id: 1, outcome: "nope" }),
  ].join("\n")
  const rows = parseEvidence(jsonl)
  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.type, "plugin.loaded")
  assert.equal(rows[1]?.type, "gate")
  assert.equal(rows[2]?.type, "env.sentinel")
  assert.equal(isEvidenceRow({ t: 1, type: "assert.end", id: 1, outcome: "allowed" }), true)
  assert.equal(isEvidenceRow({ t: 1, type: "assert.end", id: "not-a-number", outcome: "allowed" }), false)
})

it("control and consent parsing rejects malformed input instead of defaulting open", () => {
  assert.deepEqual(parseControl({ block: { title: true } }), { block: { title: true } })
  assert.deepEqual(parseControl({}), {})
  assert.equal(parseControl({ block: { title: "yes" } }), null)
  assert.equal(parseControl("nope"), null)

  const consent = parseConsent({
    fixture: true,
    providerID: "f0fixture",
    destinations: ["http://127.0.0.1:1/v1"],
    purposes: ["tutor"],
    expiresAt: 5,
  })
  assert.equal(consent?.fixture, true)
  assert.equal(parseConsent({ destinations: "not-an-array" }), null)
  assert.equal(parseConsent(null), null)
})

it("deny verdict only passes with policy deny AND denied behaviour", () => {
  const base = {
    action: "shell",
    toolName: "shell",
    registered: true,
    exposed: false,
    effective: "deny" as const,
    effectiveError: null,
    toolState: "missing" as const,
    errorMessage: "",
    sideEffect: false,
  }
  assert.equal(denyVerdict(base).status, "passed")
  assert.equal(
    denyVerdict({ ...base, errorMessage: 'No tool named "shell" is currently available.', toolState: "error" }).status,
    "passed",
  )
  assert.equal(
    denyVerdict({ ...base, errorMessage: "denied by permission rules", toolState: "error", exposed: true }).status,
    "passed",
  )
  assert.equal(denyVerdict({ ...base, toolState: "completed" }).status, "failed")
  assert.equal(denyVerdict({ ...base, sideEffect: true }).status, "failed")
  assert.equal(denyVerdict({ ...base, effective: "allow" }).status, "failed")
  assert.equal(denyVerdict({ ...base, effective: "ask" }).status, "failed")
  assert.equal(denyVerdict({ ...base, effective: null, effectiveError: "boom" }).status, "blocked")
  assert.equal(denyVerdict({ ...base, errorMessage: "weird", toolState: "error", effective: "deny" }).status, "blocked")
})

it("hook verdict requires both the blocked run and the unblocked control", () => {
  const blockGate = { kind: "title", decision: "block" as const, reason: "hook-block:title" }
  const allowGate = { kind: "title", decision: "allow" as const, reason: "consent-valid-loopback-fixture" }
  const blockedRun = { total: 0, kindCount: 0, kinds: [] as string[], gate: blockGate }
  const control = { total: 1, kindCount: 1, kinds: ["title"], gate: allowGate }
  assert.equal(hookVerdict("title", blockedRun, control).status, "passed")
  assert.equal(hookVerdict("title", { ...blockedRun, total: 1, kindCount: 1, kinds: ["title"] }, control).status, "failed")
  assert.equal(hookVerdict("title", blockedRun, { ...control, total: 0, kindCount: 0, kinds: [] }).status, "blocked")
  assert.equal(
    hookVerdict("title", { ...blockedRun, total: 2, kindCount: 0, kinds: ["unknown"] }, control).status,
    "blocked",
    "no attribution with traffic in the blocked window is not verifiable",
  )
  assert.equal(hookVerdict("title", { ...blockedRun, gate: null }, control).status, "blocked")
  assert.equal(hookVerdict("title", { ...blockedRun, gate: allowGate }, control).status, "blocked")
  assert.equal(hookVerdict("title", { ...blockedRun, gate: { ...blockGate, kind: "context" } }, control).status, "blocked")
  assert.equal(hookVerdict("title", { ...blockedRun, gate: { ...blockGate, reason: "unrelated-failure" } }, control).status, "blocked")
  assert.equal(hookVerdict("title", blockedRun, { ...control, gate: null }).status, "blocked")
  assert.equal(hookVerdict("title", blockedRun, { ...control, gate: blockGate }).status, "blocked")
  assert.equal(hookVerdict("title", { ...blockedRun, total: 2, kinds: ["primary", "unknown"] }, control).status, "blocked")
})

it("saved-approval verdict: no pattern ⇒ blocked, safe outcomes ⇒ passed, any authorization without ask ⇒ failed", () => {
  const rejected: SavedApprovalStep = {
    askObserved: false,
    assertOutcome: "rejected",
    toolState: "error",
    allowToDenyObserved: true,
    evaluateCountBefore: 1,
    evaluateCountAfter: 2,
  }
  const asked: SavedApprovalStep = { ...rejected, askObserved: true, allowToDenyObserved: false }
  const authorizedWithoutAsk: SavedApprovalStep = {
    askObserved: false,
    assertOutcome: "allowed",
    toolState: "completed",
    allowToDenyObserved: true,
    evaluateCountBefore: 1,
    evaluateCountAfter: 3,
  }

  assert.equal(
    savedApprovalVerdict({ savedPattern: { found: false, detail: "none" }, step: rejected, reprobe: null }).status,
    "blocked",
  )
  assert.equal(
    savedApprovalVerdict({ savedPattern: { found: true, detail: "x" }, step: asked, reprobe: null }).status,
    "passed",
  )
  assert.equal(
    savedApprovalVerdict({ savedPattern: { found: true, detail: "x" }, step: rejected, reprobe: null }).status,
    "passed",
  )
  // increasing evaluate counts alone never authorizes a pass
  const failWithoutReprobe = savedApprovalVerdict({
    savedPattern: { found: true, detail: "x" },
    step: authorizedWithoutAsk,
    reprobe: null,
  })
  assert.equal(failWithoutReprobe.status, "failed")
  assert.match(failWithoutReprobe.reason, /re-probe not performed/)

  const confirmed = savedApprovalVerdict({
    savedPattern: { found: true, detail: "x" },
    step: authorizedWithoutAsk,
    reprobe: { performed: true, step: { ...authorizedWithoutAsk, evaluateCountBefore: 3, evaluateCountAfter: 5 } },
    fallbackApplied: "config rewritten to deny",
  })
  assert.equal(confirmed.status, "failed")
  assert.match(confirmed.reason, /confirmed the bypass/)
  assert.match(confirmed.reason, /config rewritten to deny/)

  // rejected without ask and without either documented pattern stays blocked
  assert.equal(
    savedApprovalVerdict({
      savedPattern: { found: true, detail: "x" },
      step: { ...rejected, allowToDenyObserved: false },
      reprobe: null,
    }).status,
    "blocked",
  )
  // authorization after a reject reply is a failure too
  assert.equal(
    savedApprovalVerdict({
      savedPattern: { found: true, detail: "x" },
      step: { ...asked, assertOutcome: "allowed", toolState: "completed" },
      reprobe: null,
    }).status,
    "failed",
  )
})

it("disclosure verdict: dispatch or missing block fails, unexpected block reason is blocked", () => {
  const base = { scenario: "test", expectedReasons: ["default-deny:no-disclosure-evidence"] }
  assert.equal(
    disclosureVerdict({ ...base, delta: 0, gateDecision: "block", gateReason: "default-deny:no-disclosure-evidence" }).status,
    "passed",
  )
  assert.equal(disclosureVerdict({ ...base, delta: 3, gateDecision: "block", gateReason: base.expectedReasons[0] ?? "" }).status, "failed")
  assert.equal(disclosureVerdict({ ...base, delta: 0, gateDecision: "allow", gateReason: "consent-valid" }).status, "failed")
  assert.equal(disclosureVerdict({ ...base, delta: 0, gateDecision: "block", gateReason: "hook-block:context" }).status, "blocked")
  assert.equal(disclosureVerdict({ ...base, delta: 0, gateDecision: null, gateReason: null }).status, "failed")
})
