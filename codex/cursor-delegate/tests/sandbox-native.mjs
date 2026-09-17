// Opt-in real OS checks. No Cursor, credentials, model calls or project commands.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { isolatedLaunch } from '../scripts/isolated-launch.mjs';

const [parent, codexPath] = process.argv.slice(2);
assert(parent && codexPath, 'Usage: node tests/sandbox-native.mjs DEDICATED_TEST_PARENT CODEX_BINARY');
const base = mkdtempSync(join(realpathSync(parent), 'outer-native-'));
const workspace = join(base, 'workspace'), outside = join(base, 'outside');
const config = join(base, 'codex');
for (const path of [workspace, outside, config, join(workspace, '.cursor')]) mkdirSync(path);
const original = 'NON_SENSITIVE_SENTINEL';
writeFileSync(join(outside, 'canary.txt'), original);
writeFileSync(join(workspace, '.cursor', 'cli.json'), '{}\n');
symlinkSync(outside, join(workspace, 'escape'), 'dir');
// Use /private/tmp explicitly: the ambient macOS TMPDIR may point elsewhere.
const sharedTmp = mkdtempSync('/private/tmp/outer-native-shared-');
writeFileSync(join(sharedTmp, 'canary.txt'), original);
let connections = 0;
const server = createServer(socket => { connections++; socket.destroy(); });
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const port = server.address().port;
const probe = `import fs from 'node:fs'; import {spawnSync} from 'node:child_process'; import net from 'node:net';
const [out,shared,port]=process.argv.slice(2); const c={};
fs.writeFileSync('inside.txt','inside'); c.inside_write=fs.readFileSync('inside.txt','utf8')==='inside';
function deny(k,fn){try{fn();c[k]=false}catch(e){c[k]=['EPERM','EACCES'].includes(e.code)}}
deny('outside_read_denied',()=>fs.readFileSync(out+'/canary.txt'));
deny('outside_write_denied',()=>fs.writeFileSync(out+'/write.txt','outside'));
deny('symlink_read_denied',()=>fs.readFileSync('escape/canary.txt'));
deny('symlink_write_denied',()=>fs.writeFileSync('escape/link-write.txt','outside'));
deny('protected_config_write_denied',()=>fs.writeFileSync('.cursor/cli.json','modified'));
deny('shared_tmp_read_denied',()=>fs.readFileSync(shared+'/canary.txt'));
deny('shared_tmp_write_denied',()=>fs.writeFileSync(shared+'/write.txt','outside'));
const child=spawnSync(process.execPath,['-e',"try{require('fs').writeFileSync(process.argv[1],'child');process.exit(9)}catch(e){process.exit(['EPERM','EACCES'].includes(e.code)?0:8)}",out+'/child-write.txt'],{encoding:'utf8',timeout:3000});
c.child_write_denied=child.status===0;
c.network_denied=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:Number(port)});const timer=setTimeout(()=>{s.destroy();resolve(false)},2000);s.once('connect',()=>{clearTimeout(timer);s.destroy();resolve(false)});s.once('error',e=>{clearTimeout(timer);resolve(['EPERM','EACCES'].includes(e.code))})});
console.log(JSON.stringify(c)); process.exit(Object.values(c).every(Boolean)?0:1);`;
const probePath = join(workspace, 'probe.mjs');
writeFileSync(probePath, probe);
const launch = isolatedLaunch({ codexPath, workspace, runtimePaths: [process.execPath, '/System/Library/OpenSSL'], command: [process.execPath, probePath, outside, sharedTmp, String(port)] });
writeFileSync(join(base, 'policy.json'), JSON.stringify(launch.state, null, 2));
let stdout = '', stderr = '', timedOut = false;
const child = spawn(launch.executable, launch.args, {
  cwd: launch.cwd, detached: true,
  env: { PATH: '/usr/bin:/bin', HOME: base, CODEX_HOME: config, TMPDIR: workspace },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', b => { stdout += b; });
child.stderr.on('data', b => { stderr += b; });
const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 15000);
const result = await new Promise(ok => { child.on('error', error => ok({code: null, signal: null, error: error.message})); child.on('close', (code, signal) => ok({code, signal})); }).finally(() => clearTimeout(timer));
await new Promise(ok => server.close(ok));
const checks = (() => { try { return JSON.parse(stdout.trim()); } catch { return null; } })();
const receipt = { kind: 'real macOS outer sandbox probe; NOT Cursor or App integration', fixture: base, ...result, timedOut, checks, networkConnections: connections, stderr, outsideEntries: readdirSync(outside), sharedTmpEntries: readdirSync(sharedTmp) };
writeFileSync(join(base, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
assert.equal(result.code, 0); assert.equal(timedOut, false); assert.equal(connections, 0);
assert(checks && Object.values(checks).every(v => v === true));
assert.deepEqual(readdirSync(outside), ['canary.txt']);
assert.deepEqual(readdirSync(sharedTmp), ['canary.txt']);
assert.equal(readFileSync(join(outside, 'canary.txt'), 'utf8'), original);
assert.equal(readFileSync(join(workspace, '.cursor', 'cli.json'), 'utf8'), '{}\n');
