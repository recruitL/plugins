import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateLoginUrl,createLoginHandoff} from '../scripts/login-handoff.mjs';
const valid='https://cursor.com/loginDeepControl?challenge='+'A'.repeat(43)+'&uuid=11111111-1111-4111-8111-111111111111&mode=login&redirectTarget=cli';
function fixture(t){const path=mkdtempSync(join(tmpdir(),'cursor-login-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
test('only the exact official login destination and public PKCE fields are accepted',()=>{
 assert.equal(validateLoginUrl(valid),valid);
 for(const value of [valid.replace('https:','http:'),valid.replace('cursor.com','cursor.com.example.org'),valid.replace('cursor.com','evil@cursor.com'),valid+'&token=secret',valid+'&mode=login',valid+'#token',valid.replace('redirectTarget=cli','redirectTarget=https://evil.invalid'),valid.replace('/loginDeepControl','/other'),valid.replace('A'.repeat(43),'x')])assert.throws(()=>validateLoginUrl(value));
});
test('one helper invocation hands off only a validated public URL and consumes its file',async t=>{
 const workspace=fixture(t),handoff=createLoginHandoff({workspace,nodePath:process.execPath});t.after(()=>handoff.cancel());
 const r=spawnSync(join(handoff.bin,'open'),[valid],{env:handoff.env,encoding:'utf8'});
 assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
 assert.equal(await handoff.url,valid);assert.equal(existsSync(join(workspace,'tmp/cursor-login-url.json')),false);
 assert.throws(()=>createLoginHandoff({workspace,nodePath:process.execPath}));
});
test('arbitrary open invocations are rejected without a handoff or browser launch',async t=>{
 const workspace=fixture(t),handoff=createLoginHandoff({workspace,nodePath:process.execPath});
 const r=spawnSync(join(handoff.bin,'open'),['-a','Terminal'],{env:handoff.env});assert.equal(r.status,1);
 assert.equal(existsSync(join(workspace,'tmp/cursor-login-url.json')),false);
 handoff.cancel();await assert.rejects(handoff.url,/cancelled/);
});
test('timeout and cancellation are terminal; no retry or execution is granted',async t=>{
 const a=createLoginHandoff({workspace:fixture(t),nodePath:process.execPath,timeoutMs:10});await assert.rejects(a.url,/timed out/);a.cancel();
 const b=createLoginHandoff({workspace:fixture(t),nodePath:process.execPath});b.cancel();b.cancel();await assert.rejects(b.url,/cancelled/);
});
test('symlinked spool directories are rejected before helper installation',t=>{
 const workspace=fixture(t),outside=fixture(t);mkdirSync(join(workspace,'.codex'));symlinkSync(outside,join(workspace,'tmp'));
 assert.throws(()=>createLoginHandoff({workspace,nodePath:process.execPath}),/Symlinked/);
 assert.equal(existsSync(join(workspace,'.codex/login-bin/open')),false);
});

test('symlinked protected parent never creates files in its target',t=>{
 const workspace=fixture(t),outside=fixture(t);symlinkSync(outside,join(workspace,'.codex'));
 assert.throws(()=>createLoginHandoff({workspace,nodePath:process.execPath}),/Symlinked/);
 assert.equal(existsSync(join(outside,'login-bin')),false);
});
