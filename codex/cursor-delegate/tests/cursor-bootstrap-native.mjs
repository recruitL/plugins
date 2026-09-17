// Opt-in actual ACP bootstrap under explicit OS isolation. No prompt or login.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { isolatedCursorLaunch } from '../scripts/isolated-launch.mjs';

const [parent, codexPath, agentPath, probeMode] = process.argv.slice(2);
assert(parent && codexPath && agentPath,
  'Usage: node tests/cursor-bootstrap-native.mjs SHORT_TEST_PARENT CODEX_BINARY CURSOR_AGENT');
assert(probeMode === undefined || probeMode === 'memory-auth', 'Unknown bootstrap probe mode');
const base = mkdtempSync(join(realpathSync(parent), 'cb-'));
const workspace = join(base, 'workspace'); mkdirSync(workspace);
for (const name of ['.cursor', 'data', 'cache', 'tmp', 'codex']) mkdirSync(join(workspace, name));
writeFileSync(join(workspace, '.cursor', 'cli-config.json'), JSON.stringify({
  version: 1, editor: { vimMode: false }, permissions: { allow: [], deny: [] },
}));
const launch = isolatedCursorLaunch({ codexPath, workspace, agentPath });
if (probeMode === 'memory-auth') {
  launch.env.AGENT_CLI_CREDENTIAL_STORE = 'memory';
  launch.env.NO_OPEN_BROWSER = '1';
}
const receipt = { kind: 'real Cursor bootstrap in explicit OS sandbox; NOT App integration',
  workspace, network: 'restricted', credential_access_expanded: false,
  model_prompt_sent: false, tls_verification: 'enabled; Node bundled public CA roots' };
const child = spawn(launch.executable, launch.args, {
  cwd: launch.cwd, env: launch.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '', stderrBytes = 0, nextId = 0, ended = false;
const pending = new Map();
const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
function failPending(reason) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
  pending.clear();
}
child.stdin.on('error', () => { failPending('stdin_failed'); stop(); });
child.stderr.on('data', b => { stderrBytes += b.length; }); // Never persist provider diagnostics or credentials.
child.stdout.on('data', b => {
  buffer += b.toString();
  if (buffer.length > 1024 * 1024) { failPending('protocol_size_limit'); stop(); return; }
  for (;;) {
    const newline = buffer.indexOf('\n'); if (newline < 0) break;
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    let message; try { message = JSON.parse(line); } catch { continue; }
    if (message.id != null && message.method) {
      receipt.unexpected_client_request = true;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
        error: { code: -32601, message: 'Bootstrap probe rejects client operations' } }) + '\n');
      failPending('unexpected_client_request'); stop(); return;
    }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
  }
});
const exited = new Promise(resolve => {
  child.once('error', () => { receipt.spawn_error = true; failPending('process_start_failure'); });
  child.once('close', (code, signal) => {
    ended = true; receipt.process_exit = { code, signal }; failPending('process_exited'); resolve();
  });
});
function rpc(method, params) {
  if (ended) return Promise.reject(new Error('process_exited'));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('observation_timeout')); }, 18000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const summary = message => message.error
  ? { ok: false, error_code: message.error.code,
      category: /auth/i.test(message.error.message ?? '') ? 'authentication_required' : 'provider_error' }
  : { ok: true, session_created: typeof message.result?.sessionId === 'string' };
try {
  const init = await rpc('initialize', { protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'codex-isolated-bootstrap-probe', version: '0.1.0' } });
  receipt.initialize = summary(init);
  if (!init.error && probeMode === 'memory-auth') {
    receipt.authentication_mode = 'native in-memory store; browser opening disabled';
    const auth = await rpc('authenticate', { methodId: 'cursor_login' });
    // ACP puts details in error.data. Never persist login URLs, PKCE state or tokens.
    receipt.authenticate = { ok: !auth.error, error_code: auth.error?.code,
      unknown_method: /Unknown authentication method/.test(JSON.stringify(auth.error ?? {})),
      browser_handoff_required: /Failed to open browser for login/.test(JSON.stringify(auth.error ?? {})) };
  }
  if (!init.error) receipt.session_new = summary(await rpc('session/new', { cwd: workspace, mcpServers: [] }));
} catch (error) { receipt.failure = error.message; }
finally {
  stop(); await exited; receipt.stderr_bytes = stderrBytes;
  receipt.bootstrap_passed = receipt.initialize?.ok === true && receipt.session_new?.ok === true
    && !receipt.unexpected_client_request && !receipt.failure;
  writeFileSync(join(base, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = receipt.bootstrap_passed ? 0 : 1;
}
