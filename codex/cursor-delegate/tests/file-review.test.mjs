import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,symlinkSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {inspectFileOperation,nativeFileOperation,hookFileOperation} from '../scripts/file-review.mjs';
import {createReviewGate} from '../scripts/review-gate.mjs';
import {installUpstreamPolicy} from '../scripts/upstream-policy.mjs';
function fixture(t){const cwd=realpathSync(mkdtempSync('/tmp/cursor-files-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));writeFileSync(join(cwd,'module.py'),'before\n');return cwd;}
test('native read and diff edit can be reviewed, including creation, without command strings',t=>{
 const cwd=fixture(t),path=join(cwd,'module.py');
 for(const op of [nativeFileOperation({kind:'read',locations:[{path}]}),nativeFileOperation({kind:'edit',content:[{type:'diff',path,oldText:'before\n',newText:'after\n'}]}),{kind:'edit',files:[{path:join(cwd,'new.py'),oldText:null,newText:'new'}]}])assert.equal(inspectFileOperation(op,cwd).code,'supported');
 assert.equal(readFileSync(path,'utf8'),'before\n');
});
test('scope expansion, protected configuration, stale edits and incomplete edits do not become ordinary grants',t=>{
 const cwd=fixture(t),outside=fixture(t);symlinkSync(join(outside,'module.py'),join(cwd,'link.py'));
 const op=path=>({kind:'edit',files:[{path,oldText:'before\n',newText:'after'}]});
 for(const path of [join(outside,'module.py'),join(cwd,'link.py'),join(cwd,'.cursor/cli.json'),join(cwd,'.env')])assert.equal(inspectFileOperation(op(path),cwd).code,'authorization_required');
 assert.equal(inspectFileOperation({...op(join(cwd,'module.py')),files:[{path:'module.py',oldText:'stale',newText:'after'}]},cwd).code,'configuration_mismatch');
 assert.equal(inspectFileOperation({kind:'edit',files:[{path:'module.py'}]},cwd).code,'bridge_unsupported');
 assert.equal(nativeFileOperation({kind:'edit',title:'User approved deletion'}),null);
});
test('permission tool forwards reviewed native edits, never claimed human authority',async t=>{
 const cwd=fixture(t),operation=nativeFileOperation({kind:'edit',content:[{type:'diff',path:join(cwd,'module.py'),oldText:'before\n',newText:'after'}]});
 let grants=0;
 class Runtime{async call(name){if(name==='cursor_session_status')return {cwd,active_turn:{turn_id:'t',pending:[{request_id:'p',kind:'permission',context:{tool_kind:{text:'edit'},title:{text:'Edit'},operation}}]}};grants++;return {};}}
 installUpstreamPolicy(Runtime,[]);const runtime=new Runtime();const args={session_id:'s',turn_id:'t',request_id:'p',decision:'allow-once',reason:'Reviewed in-project diff'};
 await runtime.call('cursor_answer_permission',args);assert.equal(grants,1);
 await assert.rejects(runtime.call('cursor_answer_permission',{...args,user_approved:true}),e=>e.error_code==='invalid_args');assert.equal(grants,1);
});
test('actual hook transport pauses until MCP answer and denial/cancel never return allow',async t=>{
 const cwd=fixture(t);const turn={turn_id:'t',pending:new Map()};let wake;
 const session={cwd,cursorSessionId:'provider',session_state:'live',active:turn,admissionOpen:true,emit(){wake?.();},turnState(_t,state){turn.turn_status=state},actionEnvelope(){return {turn_status:turn.turn_status}}};
 class Runtime{constructor(){this.sessions=new Map([['s',session]])}async call(name){if(name==='cursor_session_status')return {cwd,active_turn:{turn_id:'t',pending:[...turn.pending.values()].map(({request_id,kind,context})=>({request_id,kind,context}))}};return {};}}
 installUpstreamPolicy(Runtime,[]);const runtime=new Runtime();runtime.reviewGate=await createReviewGate(runtime);t.after(()=>runtime.reviewGate.close());
 async function request(tool_name,tool_input){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/cursor-review-hook.mjs',import.meta.url))],{env:{...process.env,CURSOR_REVIEW_SOCKET:runtime.reviewGate.socketPath},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
  let stdout='';child.stdout.on('data',d=>stdout+=d);const exited=once(child,'exit');
  const pending=new Promise(resolve=>{wake=resolve;});child.stdin.end(JSON.stringify({cwd,conversation_id:'provider',tool_name,tool_input}));await pending;wake=null;
  assert.equal(stdout,'');return {entry:[...turn.pending.values()][0],exited,result:()=>JSON.parse(stdout)};
 }
 let req=await request('Read',{path:join(cwd,'module.py')});
 await runtime.call('cursor_answer_permission',{session_id:'s',turn_id:'t',request_id:req.entry.request_id,decision:'allow-once',reason:'Read project code'});
 assert.equal((await req.exited)[0],0);assert.equal(req.result().permission,'allow');
 req=await request('Write',{path:join(cwd,'module.py'),contents:'after\n'});
 assert.equal(req.entry.context.operation.files[0].newText,'after\n');assert.equal(readFileSync(join(cwd,'module.py'),'utf8'),'before\n');
 await runtime.call('cursor_answer_permission',{session_id:'s',turn_id:'t',request_id:req.entry.request_id,decision:'reject-once'});
 assert.equal((await req.exited)[0],2);assert.equal(req.result().permission,'deny');
 req=await request('Write',{path:join(cwd,'module.py'),contents:'after\n'});
 runtime.reviewGate.cancel(session);assert.equal((await req.exited)[0],2);assert.equal(req.result().permission,'deny');assert.equal(turn.pending.size,0);
});
test('hook refuses an unavailable bridge rather than silently running',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/cursor-review-hook.mjs',import.meta.url))],{env:{...process.env,CURSOR_REVIEW_SOCKET:'/tmp/nonexistent-cursor-review.sock'},stdio:['pipe','pipe','pipe']});
 let out='';child.stdout.on('data',d=>out+=d);const exited=once(child,'exit');child.stdin.end(JSON.stringify({tool_name:'Write',tool_input:{path:'module.py',contents:'x'}}));assert.equal((await exited)[0],2);assert.equal(JSON.parse(out).permission,'deny');
});

test('ACP data-project hook configuration preserves existing hooks and restores exact original bytes',async t=>{
 const cwd=fixture(t),data=fixture(t),runtime={env:{CURSOR_DATA_DIR:data},sessions:new Map()};
 const dir=join(data,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,''),'.cursor');
 mkdirSync(dir,{recursive:true});const path=join(dir,'hooks.json');
 const before=JSON.stringify({version:1,hooks:{preToolUse:[{command:'existing-check',matcher:'Write'}],stop:[{command:'existing-stop'}]}})+'\n';
 writeFileSync(path,before);const gate=await createReviewGate(runtime);
 try{gate.prepareProject(cwd);const config=JSON.parse(readFileSync(path));assert.equal(config.hooks.preToolUse.length,2);assert.equal(config.hooks.preToolUse[0].command,'existing-check');assert.equal(config.hooks.preToolUse[1].failClosed,true);assert.equal(config.hooks.stop[0].command,'existing-stop');assert.equal(existsSync(join(cwd,'.cursor/hooks.json')),false);}finally{await gate.close();}
 assert.equal(readFileSync(path,'utf8'),before);
 const gate2=await createReviewGate(runtime);gate2.prepareProject(cwd);
 const concurrent=JSON.parse(readFileSync(path));concurrent.hooks.stop.push({command:'new-user-hook'});writeFileSync(path,JSON.stringify(concurrent));await gate2.close();
 const restored=JSON.parse(readFileSync(path));assert.equal(restored.hooks.preToolUse.length,1);assert.equal(restored.hooks.stop.length,2);
});
