import test from "node:test";
import assert from "node:assert/strict";
import { HostInteractionProbe } from "../scripts/host-interaction.mjs";

test("missing or URL-only capability does not send an elicitation request", async () => {
  const sent = [];
  const p = new HostInteractionProbe((m) => sent.push(m));
  for (const elicitation of [undefined, null, [], { url: {} }]) {
    p.configure({
      protocolVersion: "2025-06-18",
      capabilities: { elicitation },
    });
    assert.equal((await p.run()).outcome, "unsupported");
  }
  assert.equal(sent.length, 0);
});

test("host accept is diagnostic only; unsolicited and stale responses cannot be reused", async () => {
  const sent = [];
  const p = new HostInteractionProbe((m) => sent.push(m));
  p.configure({
    protocolVersion: "2025-06-18",
    capabilities: { elicitation: { form: {} } },
  });
  const result = p.run();
  const request = sent[0];
  assert.equal(request.method, "elicitation/create");
  assert.equal(request.params.mode, "form");
  assert.equal(
    p.receive({ id: "wrong-id", result: { action: "accept" } }),
    false,
  );
  p.receive({
    id: request.id,
    result: {
      action: "accept",
      content: {
        probe_only: true,
        user_approved: true,
        signature: "not-proof",
      },
    },
  });
  const state = await result;
  assert.equal(state.last_result.action, "accept");
  assert.equal(state.human_identity_verified, false);
  assert.equal(state.grants_permissions, false);
  assert.equal(state.last_result.grants_permissions, false);
  assert.equal(JSON.stringify(state).includes("not-proof"), false);
  assert.equal(
    p.receive({ id: request.id, result: { action: "accept" } }),
    false,
  );
});

test("decline, cancel, host errors and malformed replies never establish authority", async () => {
  for (const payload of [
    { result: { action: "decline" } },
    { result: { action: "cancel" } },
    { error: { code: -32601, message: "secret must not echo" } },
    { result: { user_approved: true } },
  ]) {
    const sent = [];
    const p = new HostInteractionProbe((m) => sent.push(m));
    p.configure({
      protocolVersion: "2025-06-18",
      capabilities: { elicitation: {} },
    });
    const result = p.run();
    p.receive({ id: sent[0].id, ...payload });
    const state = await result;
    assert.equal(state.grants_permissions, false);
    assert.equal(state.human_identity_verified, false);
    assert.equal(JSON.stringify(state).includes("secret"), false);
  }
});

test("bounded timeout cancels once and rejects duplicate in-flight probes", async () => {
  const sent = [];
  const p = new HostInteractionProbe((m) => sent.push(m), 20);
  p.configure({ capabilities: { elicitation: { form: {} } } });
  const first = p.run();
  await assert.rejects(p.run(), /already pending/);
  const state = await first;
  assert.equal(state.last_result.outcome, "timeout");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].method, "notifications/cancelled");
  p.cancel();
  assert.equal(sent.length, 2);
});

test("connection close cancels pending interaction without permission effects", async () => {
  const sent = [];
  const p = new HostInteractionProbe((m) => sent.push(m));
  p.configure({ capabilities: { elicitation: { form: {} } } });
  const result = p.run();
  p.cancel();
  assert.equal((await result).last_result.outcome, "connection_closed");
  assert.equal(p.status().pending, false);
});
