/**
 * Ephemeral OpenAI-compatible fixture provider for the F0 spike.
 *
 * Listens on 127.0.0.1 only (no external network), records every request it receives — including
 * the `x-f0-kind` header injected by the plugin — and answers scripted responses so the real
 * agent loop can call tools. Data is fictional.
 */
import http from "node:http"
import type { FixtureRequest } from "./contracts.ts"
import { isRecord } from "./logic.ts"

export interface FixtureProvider {
  readonly baseURL: string
  readonly port: number
  readonly requests: FixtureRequest[]
  close(): Promise<void>
}

interface BuiltMessage {
  readonly role: "assistant"
  readonly content: string | null
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string
    readonly type: "function"
    readonly function: { readonly name: string; readonly arguments: string }
  }>
}

interface BuiltCompletion {
  readonly message: BuiltMessage
  readonly finish_reason: "stop" | "tool_calls"
}

const SENTINEL = /\[\[F0CALL ([0-9a-z]+) (\{.*?\})\]\]/

function toolNameOf(tool: unknown): string | null {
  if (!isRecord(tool)) return null
  const fn = tool["function"]
  if (isRecord(fn) && typeof fn["name"] === "string") return fn["name"]
  if (typeof tool["name"] === "string") return tool["name"]
  return null
}

function lastUserText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isRecord(message) && message["role"] === "user") {
      const content = message["content"]
      return typeof content === "string" ? content : ""
    }
  }
  return ""
}

/** Decides the scripted completion: one tool call per sentinel nonce, then a final text. */
function buildCompletion(body: Record<string, unknown>, issued: Set<string>): BuiltCompletion {
  const rawMessages = body["messages"]
  const messages: unknown[] = Array.isArray(rawMessages) ? rawMessages : []
  const match = SENTINEL.exec(lastUserText(messages))
  const nonce = match?.[1]
  const specText = match?.[2]
  if (nonce !== undefined && specText !== undefined && !issued.has(nonce)) {
    issued.add(nonce)
    let spec: unknown
    try {
      spec = JSON.parse(specText)
    } catch {
      spec = null
    }
    if (isRecord(spec) && typeof spec["name"] === "string") {
      const input = spec["input"] ?? {}
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${nonce}`,
              type: "function",
              function: { name: spec["name"], arguments: JSON.stringify(input) },
            },
          ],
        },
        finish_reason: "tool_calls",
      }
    }
  }
  return { message: { role: "assistant", content: "F0-OK" }, finish_reason: "stop" }
}

function sendCompletion(res: http.ServerResponse, body: Record<string, unknown>, built: BuiltCompletion): void {
  const created = Math.floor(Date.now() / 1000)
  const model = typeof body["model"] === "string" ? body["model"] : "f0-model"
  const usage = { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }

  if (body["stream"] === true) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    const base = { id: "chatcmpl-f0", object: "chat.completion.chunk", created, model }
    const write = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    write({
      ...base,
      choices: [
        { index: 0, delta: { role: "assistant", content: built.message.content ?? "" }, finish_reason: null },
      ],
    })
    const calls = built.message.tool_calls
    if (calls !== undefined) {
      write({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.id,
                type: call.type,
                function: call.function,
              })),
            },
            finish_reason: null,
          },
        ],
      })
    }
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: built.finish_reason }] })
    const streamOptions = body["stream_options"]
    if (isRecord(streamOptions) && streamOptions["include_usage"] === true) {
      write({ ...base, choices: [], usage })
    }
    res.write("data: [DONE]\n\n")
    res.end()
    return
  }

  res.writeHead(200, { "content-type": "application/json" })
  res.end(
    JSON.stringify({
      id: "chatcmpl-f0",
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: built.message, finish_reason: built.finish_reason }],
      usage,
    }),
  )
}

export async function startFixtureProvider(): Promise<FixtureProvider> {
  const requests: FixtureRequest[] = []
  const issued = new Set<string>()

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let parsed: unknown = {}
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : {}
      } catch {
        parsed = {}
      }
      const body: Record<string, unknown> = isRecord(parsed) ? parsed : {}
      const url = (req.url ?? "/").split("?")[0] ?? "/"

      if (url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ id: "f0-model", object: "model", created: 0, owned_by: "f0-fixture" }],
          }),
        )
        return
      }

      if (!url.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: `f0-fixture: unknown path ${url}` }))
        return
      }

      const rawTools = body["tools"]
      const tools: unknown[] | null = Array.isArray(rawTools) ? rawTools : null
      const rawMessages = body["messages"]
      const messages: unknown[] = Array.isArray(rawMessages) ? rawMessages : []

      const lastUser = [...messages].reverse().find(
        (message) => isRecord(message) && message["role"] === "user",
      )
      const lastUserContent = isRecord(lastUser) ? lastUser["content"] : null

      requests.push({
        t: Date.now(),
        path: url,
        kind: typeof req.headers["x-f0-kind"] === "string" ? req.headers["x-f0-kind"] : null,
        model: typeof body["model"] === "string" ? body["model"] : null,
        stream: body["stream"] === true,
        toolNames: tools === null ? [] : tools.map(toolNameOf).filter((name): name is string => name !== null),
        tools: tools,
        lastUser: typeof lastUserContent === "string" ? lastUserContent.slice(0, 300) : null,
        messageRoles: messages.map((message) =>
          isRecord(message) && typeof message["role"] === "string" ? message["role"] : null,
        ),
      })

      sendCompletion(res, body, buildCompletion(body, issued))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("f0-spike: fixture provider did not bind a port")
  }
  const port = address.port

  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/** Reserves an ephemeral loopback port and releases it (raced only against the same host). */
export async function freeLoopbackPort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve)
  })
  const address = probe.address()
  const port = address === null || typeof address === "string" ? 0 : address.port
  await new Promise<void>((resolve) => {
    probe.close(() => resolve())
  })
  return port
}
