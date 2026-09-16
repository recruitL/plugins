import { Bridge } from "./bridge.mjs";
import { pathToFileURL } from "node:url";
import { HostInteractionProbe } from "./host-interaction.mjs";
const str = { type: "string", minLength: 1, maxLength: 100000 };
const sid = { session_id: str };
function tool(
  name,
  description,
  properties,
  required = Object.keys(properties),
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}
export const tools = [
  tool(
    "cursor_probe_host_interaction",
    "Diagnostic only: ask the host to show a harmless native form. Does not start Cursor, grant permissions or unlock sessions. A response alone does not prove human interaction. Invoke only for explicit integration testing.",
    {},
  ),
  tool(
    "cursor_status",
    "Read actual workspace, execution state and safety policy. No execution.",
    {},
  ),
  tool(
    "cursor_start",
    "Start one Cursor ACP session in configured root using native sandbox. No model override. Fails closed on permission requests.",
    { cwd: str },
  ),
  tool(
    "cursor_prompt",
    "Delegate or request repairs in SAME ready session. Unique request_id prevents duplicate submission. Codex owns scope and technical decisions. Never concurrently edit Cursor-owned files.",
    { ...sid, request_id: str, scope: str, prompt: str },
  ),
  tool(
    "cursor_wait",
    "Wait for a revision (max 55s). A wait timeout does not cancel or retry work.",
    {
      ...sid,
      after_revision: { type: "integer", minimum: 0 },
      timeout_ms: { type: "integer", minimum: 0, maximum: 55000 },
    },
    ["session_id", "after_revision"],
  ),
  tool(
    "cursor_answer",
    "Codex answers ordinary questions/plans based on user scope. Not a human approval API: cannot authorize extra access. Inspect actual content before answering.",
    {
      ...sid,
      turn_id: str,
      request_id: str,
      decision: { type: "string", enum: ["accept", "reject"] },
      reason: str,
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionId: str,
            selectedOptionIds: { type: "array", items: str },
          },
          required: ["questionId", "selectedOptionIds"],
          additionalProperties: false,
        },
      },
    },
    ["session_id", "turn_id", "request_id"],
  ),
  tool(
    "cursor_result",
    "Read latest turn result in pages before independently verifying files/tests. Read prior result before sending next prompt.",
    { ...sid, turn_id: str, offset: { type: "integer", minimum: 0 } },
    ["session_id", "turn_id"],
  ),
  tool(
    "cursor_cancel",
    "Stop execution and process group. Cancellation is terminal and cannot be recovered.",
    sid,
  ),
  tool(
    "cursor_close",
    "Close session and process group; retain last receipt until next start.",
    sid,
  ),
  tool(
    "cursor_recover",
    "One bounded session/load after unexpected disconnect only. Inspect actual files/process state first. Does NOT replay any task. Never use for cancellation or safety denial.",
    { ...sid, inspection: str },
  ),
];
function validate(schema, value) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Expected object");
    for (const key of schema.required ?? [])
      if (!(key in value)) throw Error(`Missing ${key}`);
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) throw Error(`Unknown field ${k}`);
      validate(schema.properties[k], v);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 100)
      throw Error("Invalid array");
    for (const v of value) validate(schema.items, v);
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? 100000) ||
      (schema.enum && !schema.enum.includes(value))
    )
      throw Error("Invalid string");
  } else if (
    schema.type === "integer" &&
    (!Number.isInteger(value) ||
      value < schema.minimum ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    throw Error("Invalid integer");
}
export async function dispatch(bridge, name, args, host) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw Error("Unknown tool");
  validate(t.inputSchema, args);
  if (name === "cursor_probe_host_interaction") {
    if (!host) throw Error("Host transport unavailable");
    return await host.run();
  }
  if (name === "cursor_status" && host)
    return { ...bridge.status(), host_interaction: host.status() };
  return await bridge[name.slice(7)](args);
}
export function serve() {
  const bridge = new Bridge({
    root: process.env.CURSOR_DELEGATE_ROOT,
    command: process.env.CURSOR_AGENT_COMMAND || "agent",
  });
  let buffer = "",
    initialized = false,
    inflight = 0;
  const send = (msg) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const host = new HostInteractionProbe(send);
  async function handle(m) {
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") {
      send({ id: null, error: { code: -32600, message: "Invalid request" } });
      return;
    }
    if (host.receive(m)) return;
    if (m.id === undefined) return;
    try {
      let result;
      if (m.method === "initialize") {
        if (initialized) throw Error("Already initialized");
        initialized = true;
        result = {
          protocolVersion: host.configure(m.params),
          capabilities: { tools: {} },
          serverInfo: { name: "cursor-delegate", version: "0.1.0" },
          instructions:
            "Codex coordinates ordinary plans/questions. Native Cursor permissions fail closed; no approval tool. Status before any recovery. Do not infer completion from protocol success.",
        };
      } else if (!initialized) throw Error("Initialize first");
      else if (m.method === "ping") result = {};
      else if (m.method === "tools/list") result = { tools };
      else if (m.method === "tools/call") {
        try {
          const data = await dispatch(
            bridge,
            m.params?.name,
            m.params?.arguments ?? {},
            host,
          );
          result = { content: [{ type: "text", text: JSON.stringify(data) }] };
        } catch (e) {
          result = {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: e.message,
                  state: bridge.status(),
                }),
              },
            ],
          };
        }
      } else {
        send({
          id: m.id,
          error: { code: -32601, message: "Method not found" },
        });
        return;
      }
      send({ id: m.id, result });
    } catch (e) {
      send({ id: m.id, error: { code: -32602, message: e.message } });
    }
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data) => {
    buffer += data;
    if (buffer.length > 1048576) {
      bridge.terminate();
      process.exitCode = 1;
      process.stdin.destroy();
      return;
    }
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const m = JSON.parse(line);
        if (++inflight > 16) {
          --inflight;
          send({
            id: m.id,
            error: { code: -32000, message: "Too many requests" },
          });
          continue;
        }
        handle(m).finally(() => --inflight);
      } catch {
        send({ id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
  });
  process.stdin.on("end", () => {
    host.cancel();
    bridge.stop("closed");
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      bridge.terminate();
      process.exit();
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  serve();
