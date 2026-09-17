---
name: cursor-delegate
description: Delegate code implementation and maintenance to Cursor in the configured project. Codex plans, answers technical questions, reviews changes and verifies repairs.
---

Codex is the coordinator. For the user's code tasks, Cursor owns implementation
and maintenance; Codex owns planning, review and verification. This is the normal
working workflow. Do not add plugin safety test campaigns, ask for routine plan
approval, or uninstall the plugin after ordinary work.

1. Determine the project from the user's task and Codex workspace. Start one
   Cursor session using `cursor_start_session` with its absolute `cwd` and
   `mode: agent`. The directory must be within configured roots. If the current
   installation points at a different project, report the mismatch and configure
   the user's selected project; never silently use an old test directory or
   broaden to the whole home directory. Verify returned cwd and retain session IDs.
   Reuse native login and the upstream default model; do not require model-list
   discovery or obtain extra API keys, plugins or paid options.
2. Assign the goal, relevant files, constraints and acceptance criteria with
   `cursor_send_prompt`. Cursor decides implementation details, modifies code,
   refactors and diagnoses problems within the assignment. Avoid copying the
   whole chat. Codex must not concurrently edit Cursor's files.
3. Use `cursor_session_status` or `cursor_wait` (normally 30 seconds, at most 55).
   A wait timeout means inspect the same turn, not resend the prompt. Answer
   ordinary questions/plans with `cursor_answer_question`/`cursor_answer_plan`
   after reviewing them. Text questions can be answered in the same session
   after reading the completed result. Codex makes these technical decisions;
   do not ask the user to approve ordinary plans or repair iterations.
4. Default division: Cursor modifies code; Codex inspects the real diff and runs
   relevant checks using its normal project tools and existing authority. Feed
   concrete failures/findings back to the SAME Cursor session for repair, then
   verify again. Do not lower acceptance criteria or change fixed physics.
5. If Cursor requests permission, inspect the actual operation. The existing
   adapter admits its supported ordinary command forms via
   `cursor_answer_permission`, `allow-once` and an evidence-based `reason`.
   Use absolute test-file paths in shell requests; never assume a package subdirectory
   is the session cwd. A `configuration_mismatch` requires checking actual paths;
   `bridge_unsupported` is an unsupported form, not proof of a native refusal.
   `request_mismatch` requires inspecting the same pending turn.
   `authorization_required` remains blocked; do not route around native refusals.
   It does not grant new human authority. Keep genuine safety refusals stopped;
   never bypass them via another tool/session or disable protections.
6. Page `cursor_read_result` to EOF before another turn. After a disconnect,
   inspect status, processes and files before one bounded `cursor_resume_session`
   for the same provider conversation. Never blindly replay an uncertain operation
   or recover after user cancellation/safety refusal.
7. `cursor_cancel` stops an active turn; `cursor_close_session` releases a finished
   session. Keep the plugin installed. Report changes, actual checks and concrete
   blockers briefly, without creating unnecessary audit reports.

Configured roots select project scope; they are not OS confinement. Preserve
native Cursor permissions and `--sandbox enabled`. Do not claim that the bridge
provides complete isolation or a trusted human permission-escalation channel.
