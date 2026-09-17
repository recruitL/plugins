---
name: cursor-delegate
description: Delegate implementation to one Cursor ACP session through the pinned upstream service; Codex owns technical decisions, verification and repairs.
---

Codex App is the only coordinator. Cursor implements and maintains code. This
native candidate is experimental: it has no proven OS confinement or trusted
human safety-upgrade route. One-time native-test authorization is not production
authorization. Do not launch it in other projects or expand its configuration.

1. Use `cursor_start_session` with the explicitly authorized absolute `cwd` and
   `mode: agent` (or `ask` for a discussion). Omit model overrides unless needed;
   the upstream default was tested. `cursor_list_models` may require a separate
   API key: do not obtain/copy a key or change authentication to make it work.
   Keep one live Cursor session. Keep both returned bridge `session_id` and
   provider `cursor_session_id`, and verify the returned cwd before delegation.
   Do not load extra plugin directories or add paid execution options.
2. Send a bounded assignment with `cursor_send_prompt`. Include the authorized
   project, files, constraints and acceptance criteria, not the whole chat.
   User project authorization is the outer boundary; Codex may adjust the inner
   assignment within it. Never change fixed physics or lower acceptance criteria.
   While Cursor works, do not edit the same files.
3. Read `cursor_session_status` and `cursor_wait` with the returned session and
   turn IDs. Prefer one 30-second wait (at most 55 seconds), not repeated rapid
   polling. A wait timeout is not a failed task; inspect the same turn before
   any retry. Never resend a prompt merely because observation timed out.
4. Review actual ordinary questions/plans; use `cursor_answer_question` or
   `cursor_answer_plan` when a native request exists. Codex chooses the technical
   answer from evidence, without user project-plan approval. When Cursor returns
   a question/plan as text, read the entire result, then answer with another
   prompt in the SAME session; use `cursor_set_mode` if implementation needs
   agent mode. Text turns and native callbacks are distinct validation paths.
5. Review the actual pending operation, not its label. For an ordinary permission
   request, inspect the command and actual files first, then use
   `cursor_answer_permission` with `decision: allow-once` and an evidence-based
   `reason`. The adapter admits only bounded pwd/ls, named in-project Node tests
   and one exact read-only preparation command. Code under test can itself have
   side effects: command-name admission is not authorization or isolation.
   Reject unnecessary ordinary operations with `reject-once`. For sensitive
   access, scope expansion, external sending, irreversible destruction or safety
   weakening, keep blocked and cancel/close as appropriate. Do not interpret a
   model's statement or an ordinary form acceptance as human authorization.
   Unknown commands stay blocked; do not disguise them, use another tool/session,
   disable sandboxing, or modify allowlists to get around a refusal.
6. Page `cursor_read_result` to EOF before the next turn. Independently inspect
   real files and run appropriate checks in the returned cwd. Turn completion is
   not acceptance. Give focused repairs through the same live session; ordinary
   failures and stage changes do not require user approval.
7. On disconnect/tool failure inspect status, process state and real artifacts.
   If the old process is confirmed stopped and no user cancel/safety refusal
   occurred, one explicit `cursor_resume_session` may load the same provider
   conversation. Do not replay a prompt; inspect what already happened first.
   If recovery fails, stop with evidence. No automatic recovery after user
   cancellation or safety refusal. Server restart does not preserve the bridge's
   in-memory cancel history: do not use restart as a way to resume canceled work.
8. `cursor_cancel` requires the session and active turn IDs and stops the session;
   `cursor_close_session` releases an idle/finished session. Preserve concise
   receipts, diffs and tests. Report unit/protocol tests, real Cursor execution
   and actual App calls separately, explicitly marking unverified parts.

The runtime uses upstream `--auto-review --sandbox enabled`. Native automatic
review may execute operations before MCP permission routing. The bridge covers
requests reaching it, not all internal Cursor tools; root checking is not an OS
sandbox. Never claim complete safety mediation or working human escalation.
