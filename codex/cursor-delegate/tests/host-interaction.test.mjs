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

test("human-verification capability uses only the exact host extension and never enables authorization", () => {
  const p = new HostInteractionProbe(() => assert.fail("No request expected"));
  for (const capabilities of [
    {},
    { elicitation: { form: {}, userVerification: {} } },
    { extensions: { "openai/elicitation": { userVerification: true } } },
    { extensions: { "openai/elicitation": { userVerification: [] } } },
    { extensions: { "openai/elicitation": { userVerification: null } } },
  ]) {
    p.configure({ capabilities });
    assert.equal(p.authorizationStatus().user_verification_advertised, false);
    assert.equal(p.authorizationStatus().reason, "user_verification_not_advertised_by_host");
    assert.equal(p.authorizationStatus().available, false);
  }
  p.configure({ capabilities: { extensions: { "openai/elicitation": { userVerification: {} } } } });
  assert.equal(p.authorizationStatus().user_verification_advertised, true);
  assert.equal(p.authorizationStatus().available, false);
  assert.equal(p.authorizationStatus().reason, "trusted_credential_verification_unavailable");
});

test("generic form accept and forged verification fields do not change authorization", async () => {
  const sent = [];
  const p = new HostInteractionProbe(m => sent.push(m));
  p.configure({ capabilities: { elicitation: { form: {} } } });
  const before = p.authorizationStatus();
  const pending = p.run();
  p.receive({ id: sent[0].id, result: { action: "accept", content: {
    probe_only: true, user_approved: true, human_identity_verified: true,
    credentialId: "forged", signature: "forged",
    extensions: { "openai/elicitation": { userVerification: {} } },
  } } });
  const result = await pending;
  assert.deepEqual(result.human_authorization, before);
  assert.equal(result.grants_permissions, false);
  assert.equal(JSON.stringify(result).includes("forged"), false);
});
