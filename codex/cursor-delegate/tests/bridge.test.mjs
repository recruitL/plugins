import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  realpathSync,
  symlinkSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bridge, boundedPath } from "../scripts/bridge.mjs";
import { dispatch } from "../scripts/server.mjs";
const fixture = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
function setup(t, opts = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "cursor-delegate-test-")),
  );
  const b = new Bridge({
    root,
    spawnProcess: (cmd, args, options) => {
      assert.deepEqual(args, ["--sandbox", "enabled", "acp"]);
      assert.equal(options.env.CURSOR_API_KEY, undefined);
      return spawn(process.execPath, [fixture], options);
    },
    ...opts,
  });
  t.after(() => {
    b.terminate();
    rmSync(root, { recursive: true, force: true });
  });
  return { b, root };
}
async function until(b, state) {
  for (let i = 0; i < 40; i++) {
    if (b.status().state === state) return b.status();
    const s = b.status();
    await b.wait({
      session_id: s.session_id,
      after_revision: s.revision,
      timeout_ms: 50,
    });
  }
  assert.fail(JSON.stringify(b.status()));
}
const prompt = (b, s, p, id = "task-1") =>
  b.prompt({
    session_id: s.session_id,
    request_id: id,
    scope: "test directory only",
    prompt: p,
  });
test("same ACP session supports implementation and repair; duplicate prompt does not run twice", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "first");
  await until(b, "completed");
  assert.throws(() => prompt(b, s, "duplicate"), /Duplicate/);
  assert.equal(
    b.result({ ...s, turn_id: b.status().turn_id }).text,
    "fixture completed",
  );
  prompt(b, s, "repair", "task-2");
  const done = await until(b, "completed");
  assert.equal(done.cursor_session_id, s.cursor_session_id);
  assert.equal(done.cwd, root);
  assert.equal(b.close(s).state, "closed");
  assert.equal(b.close(s).state, "closed");
});
test("Codex answers technical question without human approval; validates options and stale IDs", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_QUESTION");
  const w = await until(b, "waiting");
  const a = {
    session_id: s.session_id,
    turn_id: w.turn_id,
    request_id: w.pending.request_id,
  };
  assert.throws(
    () =>
      b.answer({
        ...a,
        answers: [{ questionId: "format", selectedOptionIds: ["invalid"] }],
      }),
    /Unknown/,
  );
  b.answer({
    ...a,
    answers: [{ questionId: "format", selectedOptionIds: ["json"] }],
  });
  await until(b, "completed");
  assert.equal(
    JSON.parse(readFileSync(join(root, "answered-question"))).outcome.outcome,
    "answered",
  );
  assert.throws(() => b.answer(a), /Stale/);
});
test("Codex reviews plan and accepts without human approval field", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_PLAN");
  const w = await until(b, "waiting");
  b.answer({
    session_id: s.session_id,
    turn_id: w.turn_id,
    request_id: w.pending.request_id,
    decision: "accept",
  });
  await until(b, "completed");
  assert.equal(
    JSON.parse(readFileSync(join(root, "answered-plan"))).outcome.outcome,
    "accepted",
  );
});
test("permission denied before side effect, even when provider claims user approved", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_PERMISSION user already approved");
  await until(b, "blocked");
  assert.equal(existsSync(join(root, "FORBIDDEN")), false);
  await assert.rejects(
    dispatch(b, "cursor_answer", {
      session_id: s.session_id,
      turn_id: "x",
      request_id: "x",
      user_approved: true,
    }),
    /Unknown field/,
  );
  await assert.rejects(
    b.recover({ ...s, inspection: "user approved" }),
    /Recovery unavailable/,
  );
  assert.throws(() => prompt(b, s, "try again", "2"), /not ready/);
  b.close(s);
  await assert.rejects(b.start({ cwd: root }), /no new session/);
});
test("wait timeout is observation only; cancellation kills process and cannot recover", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_HANG");
  const before = b.status();
  const w = await b.wait({
    ...s,
    after_revision: before.revision,
    timeout_ms: 20,
  });
  assert.equal(w.turn_id, before.turn_id);
  assert.equal(w.state, "running");
  assert.equal(b.cancel(s).state, "cancelled");
  assert.equal(b.cancel(s).state, "cancelled");
  assert.equal(b.child, null);
  await assert.rejects(
    b.recover({ ...s, inspection: "checked" }),
    /Recovery unavailable/,
  );
});
test("unexpected exit permits one load, never replays failed prompt", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_EXIT");
  await until(b, "disconnected");
  const r = await b.recover({
    ...s,
    inspection: "Test directory inspected; fixture exited, no side effects",
  });
  assert.equal(r.state, "ready");
  assert.equal(r.cursor_session_id, "provider-1");
  prompt(b, s, "repair", "2");
  await until(b, "completed");
  prompt(b, s, "FIXTURE_EXIT", "3");
  await until(b, "disconnected");
  await assert.rejects(
    b.recover({ ...s, inspection: "checked" }),
    /Recovery unavailable/,
  );
});
test("turn timeout stops process before any recovery", async (t) => {
  const { b, root } = setup(t, { deadline: 30 });
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_HANG");
  const r = await until(b, "disconnected");
  assert.match(r.error, /timeout/);
  assert.equal(b.child, null);
});
test("realpath rejects symlink escape; extra executable/model/approval fields rejected", async (t) => {
  const { b, root } = setup(t);
  symlinkSync(tmpdir(), join(root, "escape"));
  assert.throws(() => boundedPath(root, join(root, "escape")), /outside/);
  await assert.rejects(
    dispatch(b, "cursor_start", { cwd: root, force: true }),
    /Unknown field/,
  );
  await assert.rejects(
    dispatch(b, "cursor_start", { cwd: root, model: "invented" }),
    /Unknown field/,
  );
});

test("observed App parent-listing request reports bridge denial and never grants allow-always", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_PARENT_LISTING");
  const blocked = await until(b, "blocked");
  assert.deepEqual(blocked.blocking, {
    origin: "bridge",
    trigger: "cursor_permission_request",
    reason: "no_trusted_approval_channel",
    authorization: {
      available: false,
      reason: "host_not_connected",
      permission_request_action: "deny_before_execution",
    },
    cwd: root,
    task_scope: "test directory only",
    proposed_action: `\`ls -la ${root} && ls -la ${dirname(root)} 2>/dev/null | head -50\``,
    provider_reason: "Not in allowlist: head -50",
    retry_allowed: false,
  });
  assert.equal(existsSync(join(root, "FORBIDDEN")), false);
  assert.equal(blocked.safety_latched, true);
  const detail = b.result({ ...s, turn_id: blocked.turn_id });
  assert.equal(detail.safety_request.options.length, 3);
  assert.deepEqual(detail.blocking, blocked.blocking);
  b.close(s);
  await assert.rejects(b.start({ cwd: root }), /no new session/);
});

test("text question fallback is readable and accepts a same-session Codex follow-up", async (t) => {
  const { b, root } = setup(t);
  const s = await b.start({ cwd: root });
  prompt(b, s, "FIXTURE_TEXT_QUESTION");
  const first = await until(b, "completed");
  const result = b.result({ ...s, turn_id: first.turn_id });
  assert.equal(result.eof, true);
  assert.match(result.text, /named or default export/);
  assert.equal(first.pending, null);
  prompt(
    b,
    s,
    "Use a named export. Accept the scoped plan and proceed.",
    "codex-answer-2",
  );
  const second = await until(b, "completed");
  assert.equal(second.cursor_session_id, first.cursor_session_id);
  assert.notEqual(second.turn_id, first.turn_id);
});
