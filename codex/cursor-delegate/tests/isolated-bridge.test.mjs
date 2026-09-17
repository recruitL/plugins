import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Bridge} from '../scripts/bridge.mjs';
const fake=fileURLToPath(new URL('./fake-agent.mjs',import.meta.url));
const login='https://cursor.com/loginDeepControl?challenge='+'A'.repeat(43)+'&uuid=11111111-1111-4111-8111-111111111111&mode=login&redirectTarget=cli';
function setup(t,prepareOverride){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'isolated-bridge-')));
 let deliver,rejectUrl,cancellations=0;
 const url=new Promise((yes,no)=>{deliver=yes;rejectUrl=no});url.catch(()=>{});
 const prepared={executable:process.execPath,args:[fake],env:{FIXTURE_DEFER_AUTH:'1'},network:'test only',handoff:{url},cancel:()=>{cancellations++;rejectUrl(new Error('cancelled'))}};
 const runtime={codexPath:'/test/codex',prepare:prepareOverride??(async()=>prepared)};
 const b=new Bridge({root,isolatedRuntime:runtime});
 t.after(async()=>{b.terminate();await b.stopping;rmSync(root,{recursive:true,force:true})});
 return {root,b,prepared,deliver,rejectUrl,get cancellations(){return cancellations}};
}
async function state(b,wanted){
 for(let n=0;n<30;n++){const s=b.status();if(s.state===wanted)return s;await b.wait({session_id:s.session_id,after_revision:s.revision,timeout_ms:50})}
 assert.fail('Did not reach '+wanted+'; state='+b.status().state);
}
test('isolated start exposes login wait, rejects dispatch, then clears URL only after native authentication',async t=>{
 const x=setup(t),s=await x.b.start({cwd:x.root});assert.equal(s.state,'starting');
 await state(x.b,'authenticating');x.deliver(login);const waiting=await state(x.b,'awaiting_login');assert.equal(waiting.login_url,login);
 assert.throws(()=>x.b.prompt({session_id:s.session_id,request_id:'early',scope:'test',prompt:'do work'}),/not ready/);
 x.b.send({id:999,method:'test/release_auth'});const ready=await state(x.b,'ready');assert.equal(ready.login_url,null);assert.equal(ready.cursor_session_id,'provider-1');
});
test('cancel during login stops the process, removes URL and forbids recovery',async t=>{
 const x=setup(t),s=await x.b.start({cwd:x.root});await state(x.b,'authenticating');x.deliver(login);await state(x.b,'awaiting_login');
 assert.equal(x.b.cancel(s).state,'cancelled');await x.b.stopping;assert.equal(x.b.child,null);assert.equal(x.b.status().login_url,null);assert(x.cancellations>0);
 await assert.rejects(x.b.recover({...s,inspection:'checked'}),/no automatic recovery/);
});
test('handoff failure terminates authentication without automatic retry',async t=>{
 const x=setup(t);await x.b.start({cwd:x.root});await state(x.b,'authenticating');x.rejectUrl(new Error('test timeout'));
 const s=await state(x.b,'failed');await x.b.stopping;assert.equal(s.login_url,null);assert.equal(x.b.child,null);
});
test('cancel while preparing prevents a delayed process launch',async t=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});const x=setup(t,()=>waiting);let spawns=0;x.b.spawnProcess=()=>{spawns++;throw new Error('Unexpected spawn')};const s=await x.b.start({cwd:x.root});x.b.cancel(s);release(x.prepared);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(x.b.status().state,'cancelled');assert.equal(x.b.child,null);assert.equal(spawns,0);assert.equal(x.cancellations,1);
});

test('production isolation requirement refuses legacy startup before spawning',async t=>{
 const x=setup(t);x.b.isolatedRuntime=undefined;x.b.requireIsolation=true;
 let spawns=0;x.b.spawnProcess=()=>{spawns++;throw new Error('Unexpected spawn')};
 assert.equal(x.b.status().execution_available,false);
 await assert.rejects(x.b.start({cwd:x.root}),/Explicit OS isolation is required/);assert.equal(spawns,0);
});

test('Codex reviews a confined test once; this cannot choose allow-always or expand scope',async t=>{
 const x=setup(t);x.prepared.confinedCommands=true;x.prepared.nodePath=process.execPath;
 writeFileSync(join(x.root,'add.test.mjs'),'// test fixture');
 const s=await x.b.start({cwd:x.root});await state(x.b,'authenticating');x.b.send({id:999,method:'test/release_auth'});await state(x.b,'ready');
 x.b.prompt({session_id:s.session_id,request_id:'test',scope:'fixture',prompt:'FIXTURE_HANG'});
 // Ensure the fake provider has entered its turn before injecting its permission request.
 await new Promise(ok=>setTimeout(ok,30));
 x.b.receive({id:701,method:'session/request_permission',params:{sessionId:'provider-1',toolCall:{kind:'execute',title:'`node --test add.test.mjs`'},options:[{kind:'allow_always',optionId:'never-this'},{kind:'allow_once',optionId:'once-only'}]}});
 const pending=x.b.status();assert.equal(pending.pending.kind,'confined_command');
 const answer={session_id:s.session_id,turn_id:pending.turn_id,request_id:pending.pending.request_id,decision:'accept'};
 assert.throws(()=>x.b.answer(answer),/reason required/);
 x.b.answer({...answer,reason:'Inspected the fixture; this runs its tests within the already isolated workspace.'});await state(x.b,'completed');
 const reply=JSON.parse(readFileSync(join(x.root,'answered-undefined'),'utf8'));assert.deepEqual(reply.outcome,{outcome:'selected',optionId:'once-only'});
 assert.throws(()=>x.b.answer({...answer,reason:'repeat'}),/Stale/);
});
