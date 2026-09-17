// One-shot transport for Cursor's public PKCE login URL. No credential access,
// browser launch, permission grant or model turn. Caller must keep authentication
// separate from task execution and terminate Cursor on cancellation or timeout.
import { constants, mkdirSync, writeFileSync, openSync, readFileSync, closeSync,
  fstatSync, lstatSync, unlinkSync, watch, realpathSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export function validateLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 1024) throw new Error('Invalid login URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid login URL'); }
  const entries = [...url.searchParams];
  const keys = new Set(entries.map(([key]) => key));
  if (url.origin !== 'https://cursor.com' || url.username || url.password || url.hash
    || url.pathname !== '/loginDeepControl' || entries.length !== 4 || keys.size !== 4
    || !['challenge', 'uuid', 'mode', 'redirectTarget'].every(key => keys.has(key))
    || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('challenge'))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.searchParams.get('uuid'))
    || url.searchParams.get('mode') !== 'login' || url.searchParams.get('redirectTarget') !== 'cli') {
    throw new Error('Unexpected login destination or parameters');
  }
  return url.href;
}

export function createLoginHandoff({ workspace, nodePath, timeoutMs = 15000 }) {
  if (!isAbsolute(workspace) || !isAbsolute(nodePath) || /\s/.test(nodePath)) {
    throw new Error('Absolute workspace and whitespace-free Node path required');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid handoff deadline');
  const root = realpathSync(workspace), node = realpathSync(nodePath);
  if (/\s/.test(node)) throw new Error('Whitespace in resolved Node path');
  function directory(parent, name) {
    const path = join(parent, name);
    try { mkdirSync(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    // Validate each existing component BEFORE creating anything beneath it.
    if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) throw new Error('Symlinked handoff directory');
    return path;
  }
  const protectedRoot = directory(root, '.codex');
  const bin = directory(protectedRoot, 'login-bin'), spool = directory(root, 'tmp');
  const target = join(spool, 'cursor-login-url.json');
  if (existsSync(target)) throw new Error('A login handoff already exists');
  const helper = `#!${node}\nimport {writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const validateLoginUrl=${validateLoginUrl.toString()};
try {
  if(process.argv.length!==3)throw new Error('One login URL required');
  const url=validateLoginUrl(process.argv[2]);
  const target=process.env.CURSOR_LOGIN_HANDOFF_FILE;
  if(!target)throw new Error('No active login handoff');
  const temp=target+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,JSON.stringify({url}),{flag:'wx',mode:0o600});linkSync(temp,target);}
  finally {try{unlinkSync(temp)}catch{}}
} catch {process.exitCode=1;}
`;
  // The outer sandbox makes .codex read-only before Cursor is started.
  writeFileSync(join(bin, 'open'), helper, { flag: 'wx', mode: 0o700 });
  let settled = false, timer, watcher, resolveUrl, rejectUrl;
  const url = new Promise((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject; });
  // Callers may await ACP initialize before awaiting the URL; retain rejection.
  url.catch(() => {});
  function finish(error, value) {
    if (settled) return;
    settled = true; clearTimeout(timer); watcher?.close();
    if (error) rejectUrl(error); else resolveUrl(value);
  }
  function read() {
    if (settled) return;
    let fd;
    try {
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 2048) throw new Error('Invalid handoff file');
      const message = JSON.parse(readFileSync(fd, 'utf8'));
      if (!message || Object.keys(message).join() !== 'url') throw new Error('Invalid handoff message');
      const value = validateLoginUrl(message.url);
      closeSync(fd); fd = undefined; unlinkSync(target);
      finish(null, value);
    } catch (error) {
      if (error.code !== 'ENOENT') finish(new Error('Invalid login handoff'));
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  watcher = watch(spool, () => read());
  watcher.on('error', () => finish(new Error('Login handoff watcher failed')));
  timer = setTimeout(() => finish(new Error('Login handoff timed out')), timeoutMs);
  read();
  return { url, bin, env: { CURSOR_LOGIN_HANDOFF_FILE: target },
    cancel: () => finish(new Error('Login handoff cancelled')) };
}
