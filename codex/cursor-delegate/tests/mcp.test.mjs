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
  assert.equal(list.result.tools.length, 10);
  assert.ok(!list.result.tools.some((t) => /permission|approve/.test(t.name)));
  const status = await call("tools/call", {
    name: "cursor_status",
    arguments: {},
  });
  assert.equal(JSON.parse(status.result.content[0].text).configured, false);
  const probe = await call("tools/call", {
    name: "cursor_probe_host_interaction",
    arguments: {},
  });
  assert.equal(JSON.parse(probe.result.content[0].text).outcome, "unsupported");
  const spoof = await call("tools/call", {
    name: "cursor_probe_host_interaction",
    arguments: { user_approved: true },
  });
  assert.equal(spoof.result.isError, true);
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

test("real MCP stdio round-trips a diagnostic form without starting Cursor", async (t) => {
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
  const pending = new Map();
  let forms = 0;
  const send = (m) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    if (m.method === "elicitation/create") {
      forms++;
      assert.equal(m.params.mode, "form");
      send({ id: m.id, result: { action: "decline" } });
      return;
    }
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      send({ id: n, method, params });
    });
  const init = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { elicitation: { form: {} } },
    clientInfo: { name: "simulated-host", version: "1" },
  });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const response = await call("tools/call", {
    name: "cursor_probe_host_interaction",
    arguments: {},
  });
  const data = JSON.parse(response.result.content[0].text);
  assert.equal(forms, 1);
  assert.equal(data.last_result.action, "decline");
  assert.equal(data.grants_permissions, false);
  assert.equal(data.human_identity_verified, false);
  const status = JSON.parse(
    (await call("tools/call", { name: "cursor_status", arguments: {} })).result
      .content[0].text,
  );
  assert.equal(status.state, "idle");
  assert.equal(status.configured, false);
  assert.equal(status.host_interaction.last_result.action, "decline");
  assert.equal(status.host_interaction.human_authorization.available, false);
  assert.equal(status.host_interaction.human_authorization.user_verification_advertised, false);
  assert.equal(status.host_interaction.human_authorization.reason, "user_verification_not_advertised_by_host");
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
});
