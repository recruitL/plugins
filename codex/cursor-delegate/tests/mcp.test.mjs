import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
test("real stdio MCP process discovers tools and remains fail-closed before configuration", async (t) => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../scripts/server.mjs", import.meta.url))],
    {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill());
  let id = 0;
  const calls = new Map();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    calls.get(m.id)?.(m);
    calls.delete(m.id);
  });
  function call(method, params) {
    const n = ++id;
    return new Promise((resolve) => {
      calls.set(n, resolve);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
      );
    });
  }
  const init = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "cursor-delegate");
  const list = await call("tools/list", {});
  assert.equal(list.result.tools.length, 9);
  assert.ok(!list.result.tools.some((t) => /permission|approve/.test(t.name)));
  const status = await call("tools/call", {
    name: "cursor_status",
    arguments: {},
  });
  assert.equal(JSON.parse(status.result.content[0].text).configured, false);
  const start = await call("tools/call", {
    name: "cursor_start",
    arguments: { cwd: process.cwd() },
  });
  assert.equal(start.result.isError, true);
  assert.match(start.result.content[0].text, /Not configured/);
  const unknown = await call("tools/call", {
    name: "cursor_answer_permission",
    arguments: { user_approved: true },
  });
  assert.equal(unknown.result.isError, true);
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
});
