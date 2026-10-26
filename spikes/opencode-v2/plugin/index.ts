/**
 * F0 spike plugin — OpenCode V2 (2.1.3) isolated smoke for Learning Workspace.
 *
 * Scope (docs/implementation-plan.md §F0, spec §8.2/§9.1/§11):
 *  - direct tool in namespace `f0` with `codemode: false`
 *  - reads the runtime actor from the executor context
 *  - `ctx.permission.assert` with action `learning.approve`, resource `<operation>:<sha256>`;
 *    `save` stays `[]` in the normal path (spec §8.2) and is only non-empty in the ADVERSARIAL
 *    saved-approval probe, which is a fixture scenario, never a product Core grant
 *  - `ctx.permission.hook("evaluate")` correlates the evaluation with the assert and converts an
 *    effective `allow` into `deny` (a configured deny never reaches the hook; it is final upstream)
 *  - `context` / `compaction` / `generate` / `title` session hooks attempt to stop dispatch
 *  - default-deny disclosure gate: no fixture evidence ⇒ unconditional reject; only loopback
 *    fixture destinations can ever pass (remote destinations always reject). The product gate
 *    stays closed: no real provider, no product integration.
 *
 * Fixture only: fictional data. It does NOT implement F1 grants, pedagogical agents, or any
 * product integration.
 *
 * Evidence is appended to `<location>/.f0-spike/evidence.jsonl`; `control.json` and
 * `consent.json` are re-read on every invocation so the runner can flip gates between phases
 * without reloading the plugin. Env sentinel checks record BOOLEANS only, never values.
 */
import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  SENTINEL_ENV_VARS,
  type DispatchKind,
  type EvidenceInput,
  type SpikeConsent,
  type SpikeControl,
} from "../lib/contracts.ts"
import { isRecord, parseConsent, parseControl, spikeDigest } from "../lib/logic.ts"

interface ProbeInput {
  operation: string
  payload: unknown
  approve: boolean
  save: string[]
}

interface PendingAssert {
  id: number
  resources: string[]
}

function loopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"
}

/** Boundary validation for the model-supplied tool input (no casts). */
function parseProbeInput(raw: unknown): ProbeInput | null {
  if (!isRecord(raw)) return null
  const operation = raw["operation"]
  const payload = raw["payload"]
  if (typeof operation !== "string") return null
  if (payload === null || typeof payload !== "object") return null
  const approve = raw["approve"]
  if (approve !== undefined && typeof approve !== "boolean") return null
  const save = raw["save"]
  const parsedSave: string[] = []
  if (save !== undefined) {
    if (!Array.isArray(save)) return null
    for (const entry of save) {
      if (typeof entry !== "string") return null
      parsedSave.push(entry)
    }
  }
  return { operation, payload, approve: approve === true, save: parsedSave }
}

export default Plugin.define({
  id: "f0-spike",
  async setup(ctx) {
    const stateDir = join(ctx.location.directory, ".f0-spike")
    mkdirSync(stateDir, { recursive: true })
    const evidenceFile = join(stateDir, "evidence.jsonl")

    const record = (row: EvidenceInput): void => {
      try {
        appendFileSync(evidenceFile, JSON.stringify({ t: Date.now(), ...row }) + "\n")
      } catch {
        // Evidence must never break the host runtime.
      }
    }

    const readJson = (name: string): unknown => {
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(stateDir, name), "utf8"))
        return parsed
      } catch {
        return null
      }
    }

    record({
      type: "plugin.loaded",
      app: ctx.app.version,
      location: ctx.location.directory,
      options: ctx.options,
    })

    // Env sentinel regression: booleans only, values are never read into evidence.
    const present: Record<string, boolean> = {}
    for (const name of SENTINEL_ENV_VARS) {
      present[name] = typeof process !== "undefined" && process.env[name] !== undefined
    }
    record({ type: "env.sentinel", present })

    // --- correlation state between asserts and permission evaluations ------------------------
    let assertSeq = 0
    const pendingAsserts: PendingAssert[] = []

    // --- direct tool, namespace f0, codemode false -------------------------------------------
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "f0", description: "F0 spike probe tools (fixture)" })
      editor.add({
        name: "probe",
        description:
          "F0 spike probe: records the runtime actor and, when approve is true, asserts the " +
          "learning.approve permission bound to the SHA-256 of operation+payload.",
        input: {
          type: "object",
          properties: {
            operation: { type: "string" },
            payload: { type: "object", additionalProperties: true },
            approve: { type: "boolean" },
            save: { type: "array", items: { type: "string" } },
          },
          required: ["operation", "payload"],
          additionalProperties: false,
        },
        options: { namespace: "f0", codemode: false },
        execute: async (raw, exec) => {
          const input = parseProbeInput(raw)
          if (input === null) throw new Error("f0-spike: invalid probe input")
          const digest = spikeDigest(input.operation, input.payload)
          const resources = [`${input.operation}:${digest}`]

          record({
            type: "tool.execute.begin",
            tool: "f0_probe",
            sessionID: exec.sessionID,
            actor: exec.agent,
            messageID: exec.messageID,
            callID: exec.id,
            operation: input.operation,
            digest,
          })

          if (input.approve) {
            const pending: PendingAssert = { id: ++assertSeq, resources }
            pendingAsserts.push(pending)
            record({
              type: "assert.begin",
              id: pending.id,
              sessionID: exec.sessionID,
              actor: exec.agent,
              action: "learning.approve",
              resources,
            })
            try {
              await ctx.permission.assert({
                sessionID: exec.sessionID,
                agent: exec.agent,
                source: { type: "tool", messageID: exec.messageID, id: exec.id },
                action: "learning.approve",
                resources,
                save: input.save,
                metadata: { operation: input.operation, digest, spike: "f0" },
              })
              record({ type: "assert.end", id: pending.id, outcome: "allowed" })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              record({ type: "assert.end", id: pending.id, outcome: "rejected", message })
              throw error
            } finally {
              const at = pendingAsserts.findIndex((entry) => entry.id === pending.id)
              if (at >= 0) pendingAsserts.splice(at, 1)
            }
          }

          record({
            type: "tool.execute.end",
            tool: "f0_probe",
            actor: exec.agent,
            digest,
            approved: input.approve,
          })
          return { content: `F0-PROBE-OK actor=${exec.agent} session=${exec.sessionID} digest=${digest}` }
        },
      })
    })

    const registered = await ctx.tool.list()
    record({
      type: "tools.snapshot",
      ids: registered.map((tool) => tool.id),
      f0: registered
        .filter((tool) => tool.id === "f0_probe")
        .map((tool) => ({
          id: tool.id,
          codemode: tool.options?.codemode ?? null,
          namespace: tool.options?.namespace ?? null,
        })),
    })

    // --- permission evaluate hook ------------------------------------------------------------
    await ctx.permission.hook("evaluate", (event) => {
      const effectIn = event.effect
      let correlated: number | null = null
      for (const entry of pendingAsserts) {
        if (
          entry.resources.length === event.resources.length &&
          entry.resources.every((resource, index) => event.resources[index] === resource)
        ) {
          correlated = entry.id
          break
        }
      }
      if (event.action === "learning.approve" && effectIn === "allow") {
        event.effect = "deny"
        event.message = "f0-spike: effective allow converted to deny (spec 8.2)"
      }
      record({
        type: "evaluate",
        sessionID: event.sessionID,
        actor: event.agent ?? null,
        action: event.action,
        resources: [...event.resources],
        effectIn,
        effectOut: event.effect,
        correlated,
      })
    })

    // --- disclosure gate for every model dispatch flow ---------------------------------------
    const resolveBaseURL = async (providerID: string): Promise<string | undefined> => {
      try {
        const providers = await ctx.provider.list()
        const found = providers.data.find((entry) => entry.id === providerID)
        if (found?.settings === undefined) return undefined
        const settings: unknown = found.settings
        if (!isRecord(settings)) return undefined
        const baseURL = settings["baseURL"]
        return typeof baseURL === "string" ? baseURL : undefined
      } catch {
        return undefined
      }
    }

    const gate = async (kind: DispatchKind, providerID: string): Promise<void> => {
      const control: SpikeControl = parseControl(readJson("control.json")) ?? {}
      const consent: SpikeConsent | null = parseConsent(readJson("consent.json"))
      const baseURL = await resolveBaseURL(providerID)
      let host = ""
      try {
        host = baseURL === undefined ? "" : new URL(baseURL).hostname
      } catch {
        host = ""
      }

      let decision: "allow" | "block" = "allow"
      let reason = "consent-valid-loopback-fixture"

      if (control.block?.[kind] === true) {
        decision = "block"
        reason = `hook-block:${kind}`
      } else if (consent === null) {
        decision = "block"
        reason = "default-deny:no-disclosure-evidence"
      } else if (consent.fixture !== true) {
        decision = "block"
        reason = "default-deny:non-fixture-evidence"
      } else if (!(consent.purposes ?? []).includes("tutor")) {
        decision = "block"
        reason = "default-deny:purpose-not-granted"
      } else if (consent.expiresAt === undefined || consent.expiresAt <= Date.now()) {
        decision = "block"
        reason = "default-deny:evidence-expired"
      } else if (consent.providerID !== providerID) {
        decision = "block"
        reason = "provider-out-of-scope"
      } else if (baseURL === undefined || !loopbackHost(host)) {
        decision = "block"
        reason = "remote-destination-rejected"
      } else if ((consent.destinations ?? []).some((entry) => !isLoopback(entry))) {
        decision = "block"
        reason = "consent-lists-remote-destination"
      } else if (!(consent.destinations ?? []).includes(baseURL)) {
        decision = "block"
        reason = "destination-not-approved"
      }

      record({ type: "gate", kind, decision, reason, providerID, baseURL: baseURL ?? null })
      if (decision === "block") throw new Error(`f0-spike: dispatch blocked for ${kind}: ${reason}`)
    }

    for (const kind of ["context", "compaction", "generate", "title"] as const) {
      await ctx.session.hook(kind, (event) => gate(kind, event.model.providerID))
    }

    // --- dispatch attribution: mark every outbound provider request with its flow kind --------
    await ctx.session.hook("model.request", (event) => {
      event.headers["x-f0-kind"] = event.kind
      record({
        type: "model.request",
        kind: event.kind,
        sessionID: event.sessionID,
        providerID: event.model.providerID,
        modelID: event.model.id,
      })
    })

    await ctx.session.hook("http.request", (event) => {
      try {
        event.request.headers.set("x-f0-kind", event.kind)
      } catch {
        // Header injection is attribution only; failure must not break dispatch.
      }
      record({ type: "http.dispatch", kind: event.kind, sessionID: event.sessionID, url: event.request.url })
    })

    return () => {
      record({ type: "plugin.unloaded" })
    }
  },
})

function isLoopback(entry: string): boolean {
  try {
    const host = new URL(entry).hostname
    return loopbackHost(host)
  } catch {
    return false
  }
}
