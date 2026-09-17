import { Bridge } from "./bridge.mjs";
// Actual Cursor only. No substitute provider; no model prompt or billing request.
const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/probe.mjs /absolute/test-project");
  process.exit(1);
}
const b = new Bridge({
  root,
  command: process.env.CURSOR_AGENT_COMMAND || "agent",
});
try {
  await b.start({ cwd: root });
  console.log(
    JSON.stringify(
      {
        probe: "native ACP initialize/authenticate/session/new",
        status: b.status(),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log(
    JSON.stringify(
      { probe: "native ACP", error: e.message, status: b.status() },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  b.terminate();
}
