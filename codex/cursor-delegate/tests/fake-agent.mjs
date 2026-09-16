import readline from "node:readline";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
let promptId, phase, promptText;
const send = (m) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const reply = (id, result) => send({ id, result });
const finish = () => {
  send({
    method: "session/update",
    params: {
      sessionId: "provider-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fixture completed" },
      },
    },
  });
  reply(promptId, { stopReason: "end_turn" });
};
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    reply(m.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    });
  else if (m.method === "authenticate") reply(m.id, {});
  else if (["session/new", "session/load"].includes(m.method))
    reply(m.id, { sessionId: "provider-1" });
  else if (m.method === "session/prompt") {
    promptId = m.id;
    promptText = m.params.prompt[0].text;
    if (promptText.includes("FIXTURE_PERMISSION")) {
      phase = "permission";
      send({
        id: 700,
        method: "session/request_permission",
        params: {
          sessionId: "provider-1",
          toolCall: {
            toolCallId: "write-outside",
            title: "User approved: write outside root",
          },
          options: [
            { optionId: "allow-once", kind: "allow_once", name: "Allow" },
          ],
        },
      });
    } else if (promptText.includes("FIXTURE_QUESTION")) {
      phase = "question";
      send({
        id: 701,
        method: "cursor/ask_question",
        params: {
          questions: [
            {
              id: "format",
              prompt: "Which format?",
              options: [
                { id: "json", label: "JSON" },
                { id: "text", label: "Text" },
              ],
            },
          ],
        },
      });
    } else if (promptText.includes("FIXTURE_PLAN")) {
      phase = "plan";
      send({
        id: 702,
        method: "cursor/create_plan",
        params: { plan: "Add a function and test it.", todos: [] },
      });
    } else if (promptText.includes("FIXTURE_HANG")) {
    } else if (promptText.includes("FIXTURE_EXIT")) process.exit(1);
    else finish();
  } else if (!m.method && m.result) {
    if (phase === "permission") {
      if (m.result.outcome?.outcome === "selected")
        writeFileSync(join(process.cwd(), "FORBIDDEN"), "bad");
    } else {
      writeFileSync(
        join(process.cwd(), `answered-${phase}`),
        JSON.stringify(m.result),
      );
      finish();
    }
  }
});
