import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {hookFileOperation,describeFileOperation,inspectFileOperation,REVIEW_BYTES} from '../scripts/file-review.mjs';
import {createReviewGate} from '../scripts/review-gate.mjs';
import {installUpstreamPolicy} from '../scripts/upstream-policy.mjs';
function root(t){const dir=realpathSync(mkdtempSync('/tmp/cursor-range-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
const large=()=> '# retained source documentation\n'.repeat(4000)+'def value():\n    return 1\n';
test('large source: bounded read metadata, complete local diff and stale-state check',t=>{
 const cwd=root(t),path=join(cwd,'module.py'),before=large();writeFileSync(path,before);
 let op=hookFileOperation({tool_name:'Read',tool_input:{file_path:path,offset:4000,limit:2}},cwd);
 const view=describeFileOperation(op,cwd);assert.equal(view.review.code,'supported');assert.ok(view.context.files[0].file_bytes>60000);assert.equal(view.context.files[0].excerpt,'def value():\n    return 1\n');assert.ok(Buffer.byteLength(JSON.stringify(view))<2000);
 assert.equal(describeFileOperation(hookFileOperation({tool_name:'Read',tool_input:{file_path:path}},cwd),cwd).review.code,'range_required');
 op=hookFileOperation({tool_name:'Write',tool_input:{file_path:path,content:before.replace('return 1','return 2')}},cwd);
 const diff=describeFileOperation(op,cwd);assert.equal(diff.review.code,'supported');assert.equal(diff.context.files[0].change.complete_change,true);assert.match(diff.context.files[0].change.new_text,/return 2/);assert.ok(Buffer.byteLength(JSON.stringify(diff))<2000);
 writeFileSync(path,before+'# concurrent\n');assert.equal(inspectFileOperation(op,cwd).code,'configuration_mismatch');
});
test('file size, selected bytes and changed-span budget are independent; UTF-8 is not truncated',t=>{
 const cwd=root(t),path=join(cwd,'big.py');writeFileSync(path,'# large\n'.repeat(100000));
 const read=hookFileOperation({tool_name:'Read',tool_input:{file_path:path,offset:0,limit:2}},cwd);
 assert.equal(describeFileOperation(read,cwd).review.code,'supported'); // >256 KiB total, small read
 assert.equal(describeFileOperation(hookFileOperation({tool_name:'Read',tool_input:{file_path:path,offset:100001,limit:1}},cwd),cwd).review.code,'range_required');
 const unicode='# 文档🙂\n'.repeat(5000);writeFileSync(path,unicode);
 assert.equal(describeFileOperation(hookFileOperation({tool_name:'Read',tool_input:{file_path:path,offset:0,limit:5000}},cwd),cwd).review.code,'capacity_limit');
 const op=hookFileOperation({tool_name:'Write',tool_input:{file_path:path,content:unicode+'x'.repeat(REVIEW_BYTES)}},cwd);
 assert.equal(describeFileOperation(op,cwd).review.code,'capacity_limit');
});
async function fixture(t,options){
 const cwd=root(t),path=join(cwd,'module.py');writeFileSync(path,large());let wake;
 const turn={turn_id:'turn',pending:new Map()};
 const session={id:'s',cwd,cursorSessionId:'provider',session_state:'live',active:turn,admissionOpen:true,reviewCalls:new Map(),emit(){wake?.()},turnState(_t,s){turn.turn_status=s},actionEnvelope(){return {turn_status:turn.turn_status}}};
 class Runtime {constructor(){this.sessions=new Map([['s',session]]);}async call(name){if(name==='cursor_session_status')return {cwd,active_turn:session.active?{turn_id:'turn',pending:[...turn.pending.values()].map(({request_id,kind,context})=>({request_id,kind,context}))}:null};return {};}}
 installUpstreamPolicy(Runtime,[]);const runtime=new Runtime();runtime.reviewGate=await createReviewGate(runtime,options);t.after(()=>runtime.reviewGate.close());
 async function request(event){
  const child=spawn(process.execPath,[new URL('../scripts/cursor-review-hook.mjs',import.meta.url).pathname],{env:{...process.env,CURSOR_REVIEW_SOCKET:runtime.reviewGate.socketPath},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
  let output='';child.stdout.on('data',b=>output+=b);const exited=once(child,'exit');const arrived=new Promise(r=>wake=r);
  child.stdin.end(JSON.stringify({conversation_id:'provider',...event}));
  return {child,arrived,exited,reply:()=>JSON.parse(output),entry:()=>[...turn.pending.values()][0]};
 }
 const answer=(id,decision='allow-once')=>runtime.call('cursor_answer_permission',{session_id:'s',turn_id:'turn',request_id:id,decision,reason:'Inspected exact local edit'});
 return {cwd,path,session,turn,runtime,request,answer};
}
test('real hook transport carries >60 KB privately; ACP range joins the right read and review stays small',async t=>{
 const f=await fixture(t);f.session.reviewCalls.set('read-id',{title:'Read module.py (4002 - 4003)',rawInput:{path:f.path}});
 let req=await f.request({tool_use_id:'read-id',tool_name:'Read',tool_input:{file_path:f.path}});await req.arrived;
 assert.equal(req.entry().context.operation.files[0].range.offset,4000);await f.answer(req.entry().request_id);await req.exited;assert.equal(req.reply().permission,'allow');
 req=await f.request({tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 2')}});await req.arrived;
 assert.ok(Buffer.byteLength(JSON.stringify(req.entry().context))<REVIEW_BYTES);assert.ok(!JSON.stringify(req.entry().context).includes('retained source documentation\n'.repeat(10)));
 await f.answer(req.entry().request_id);await req.exited;assert.equal(req.reply().permission,'allow');
 assert.equal(readFileSync(f.path,'utf8'),large()); // a hook is permission, not an executor
});
test('timeout is not rejection: no write, late answer expires, stale state visible, fresh reviewed request works',async t=>{
 const f=await fixture(t,{reviewMs:80});let req=await f.request({tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 2')}});await req.arrived;const id=req.entry().request_id;
 await req.exited;assert.match(req.reply().user_message,/review_timeout/);assert.equal(f.turn.pending.size,0);assert.equal(readFileSync(f.path,'utf8'),large());
 await assert.rejects(f.answer(id),e=>e.error_code==='review_expired');
 f.session.active=null;let result=f.runtime.reviewGate.stats(f.session).review_outcomes.at(-1);assert.equal(result.execution,'not_executed');assert.equal(result.state_check.code,'supported');assert.equal(result.retry,'inspect_state_then_send_one_fresh_request');
 writeFileSync(f.path,large()+'# changed\n');result=f.runtime.reviewGate.stats(f.session).review_outcomes.at(-1);assert.equal(result.state_check.code,'configuration_mismatch');
 f.session.active=f.turn;req=await f.request({tool_name:'Write',tool_input:{file_path:f.path,content:readFileSync(f.path,'utf8').replace('return 1','return 2')}});await req.arrived;await f.answer(req.entry().request_id);await req.exited;assert.equal(req.reply().permission,'allow');
});
test('explicit rejection and user cancellation remain distinct and are never retry instructions',async t=>{
 const f=await fixture(t);
 for(const code of ['codex_rejected','user_cancelled']){
  const req=await f.request({tool_name:'Read',tool_input:{file_path:f.path,offset:4000,limit:2}});await req.arrived;
  if(code==='codex_rejected')await f.answer(req.entry().request_id,'reject-once');else f.runtime.reviewGate.cancel(f.session);
  await req.exited;assert.match(req.reply().user_message,new RegExp(code));const result=f.runtime.reviewGate.stats(f.session).review_outcomes.at(-1);assert.equal(result.code,code);assert.equal(result.retry,'no_automatic_retry');
 }
});
test('startup failure cleans project hook configuration',async t=>{
 const cwd=root(t),data=root(t);
 class Runtime {
  constructor(){this.env={CURSOR_DATA_DIR:data};this.sessions=new Map();this.live=new Set();}
  canonicalCwd(p){return p;}
  async start(){throw new Error('simulated spawn failure');}
  async resume(a){return this.start(a);}
  async childEnvironment(){return {};}
  async shutdown(){}
  async call(name,args){if(name==='cursor_start_session')return this.start(args);}
 }
 installUpstreamPolicy(Runtime,[]);const r=new Runtime();
 await assert.rejects(r.call('cursor_start_session',{cwd,mode:'agent'}),/spawn failure/);
 const path=join(data,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,''),'.cursor/hooks.json');assert.equal(existsSync(path),false);await r.shutdown();
});

test('native lifecycle cancellation and idle shutdown release only this hook',async t=>{
 const cwd=root(t),data=root(t);
 class Runtime {
  constructor(){this.env={CURSOR_DATA_DIR:data};this.sessions=new Map();this.live=new Set();}
  canonicalCwd(p){return p;}
  async start(){const runtime=this;const session={id:'s',runtime,session_state:'live',callback(){},async shutdown(){this.session_state='tombstone';runtime.live.delete('s');},async terminalize(){await this.shutdown();}};this.sessions.set('s',session);this.live.add('s');return {session_id:'s'};}
  async resume(a){return this.start(a);}
  async childEnvironment(){return {};}
  async shutdown(){}
  async call(name,args){if(name==='cursor_start_session')return this.start(args);}
 }
 installUpstreamPolicy(Runtime,[]);const r=new Runtime();
 for(const action of ['cancel','idle']){await r.call('cursor_start_session',{cwd,mode:'agent'});const path=r.reviewGate.stats().hook_config;assert.equal(existsSync(path),true);const s=r.sessions.get('s');if(action==='cancel')await s.terminalize(null,'cancelled','cancelled');else await s.shutdown();assert.equal(existsSync(path),false);}
 await r.shutdown();
});

test('disconnect before approval cannot execute and is not an explicit refusal; approval without tool completion stays unknown',async t=>{
 const f=await fixture(t);let req=await f.request({tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 2')}});await req.arrived;
 req.child.kill('SIGTERM');await req.exited;
 for(let i=0;i<20&&f.turn.pending.size;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.turn.pending.size,0);let record=f.runtime.reviewGate.stats(f.session).review_outcomes.at(-1);assert.equal(record.code,'bridge_disconnected');assert.equal(record.execution,'not_executed');assert.equal(readFileSync(f.path,'utf8'),large());
 req=await f.request({tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 2')}});await req.arrived;await f.answer(req.entry().request_id);await req.exited;
 record=f.runtime.reviewGate.stats(f.session).review_outcomes.at(-1);assert.equal(record.code,'approved');assert.equal(record.execution,'unknown');assert.equal(record.retry,'no_automatic_retry');
});

test('native edit preparation is a separately reviewed whole-file read; stale bases cannot write',async t=>{
 const f=await fixture(t),id='native-edit';
 f.session.reviewCalls.set(id,{kind:'edit',title:'Edit module.py',rawInput:{path:f.path}});
 let req=await f.request({tool_use_id:id,tool_name:'Read',tool_input:{file_path:f.path}});await req.exited;assert.match(req.reply().user_message,/range_required/);
 req=await f.request({tool_use_id:'range',tool_name:'Read',tool_input:{file_path:f.path,offset:4000,limit:2}});await req.arrived;await f.answer(req.entry().request_id);await req.exited;f.runtime.reviewGate.completeTool(f.session,'range');
 req=await f.request({tool_use_id:id,tool_name:'Read',tool_input:{file_path:f.path}});await req.arrived;
 let file=req.entry().context.operation.files[0];assert.equal(file.purpose,'edit_preparation');assert.equal(file.read_scope,'whole_file');assert.equal(file.write_authorized,false);assert.equal(file.excerpt,'def value():\n    return 1\n');
 await f.answer(req.entry().request_id);await req.exited;assert.equal(req.reply().permission,'allow');
 req=await f.request({tool_use_id:id,tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 2')}});await req.arrived;assert.equal(req.entry().context.operation.kind,'edit');await f.answer(req.entry().request_id);await req.exited;
 writeFileSync(f.path,large()+'# concurrent change\n');
 req=await f.request({tool_use_id:id,tool_name:'Write',tool_input:{file_path:f.path,content:large().replace('return 1','return 3')}});await req.exited;assert.match(req.reply().user_message,/configuration_mismatch/);assert.match(readFileSync(f.path,'utf8'),/concurrent change/);
 // A plain model Read must not inherit the preparation exception.
 req=await f.request({tool_use_id:'ordinary-read',tool_name:'Read',tool_input:{file_path:f.path}});await req.exited;assert.match(req.reply().user_message,/range_required/);
});

test('UTF-8 code points split across hook stdin and socket chunks are preserved',async t=>{
 const f=await fixture(t);const next=large().replace('return 1','return "文🙂"');
 const event={conversation_id:'provider',tool_name:'Write',tool_input:{file_path:f.path,content:next}};
 const bytes=Buffer.from(JSON.stringify(event)),cut=bytes.indexOf(Buffer.from('文'))+1;
 const child=spawn(process.execPath,[new URL('../scripts/cursor-review-hook.mjs',import.meta.url).pathname],{env:{...process.env,CURSOR_REVIEW_SOCKET:f.runtime.reviewGate.socketPath},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 let output='';child.stdout.on('data',b=>output+=b);const exited=once(child,'exit');
 child.stdin.write(bytes.subarray(0,cut));await new Promise(r=>setTimeout(r,30));child.stdin.end(bytes.subarray(cut));
 for(let i=0;i<100&&!f.turn.pending.size;i++)await new Promise(r=>setTimeout(r,5));
 let entry=[...f.turn.pending.values()][0];assert.ok(entry);assert.match(entry.context.operation.files[0].change.new_text,/文🙂/);await f.answer(entry.request_id);await exited;assert.equal(JSON.parse(output).permission,'allow');
 const {connect}=await import('node:net');const socket=connect(f.runtime.reviewGate.socketPath);socket.on('error',()=>{});await once(socket,'connect');let reply='';socket.on('data',b=>reply+=b);const closed=once(socket,'close');
 socket.write(bytes.subarray(0,cut));await new Promise(r=>setTimeout(r,30));socket.write(Buffer.concat([bytes.subarray(cut),Buffer.from('\n')]));
 for(let i=0;i<100&&!f.turn.pending.size;i++)await new Promise(r=>setTimeout(r,5));
 entry=[...f.turn.pending.values()][0];assert.ok(entry);assert.match(entry.context.operation.files[0].change.new_text,/文🙂/);await f.answer(entry.request_id);await closed;assert.equal(JSON.parse(reply).permission,'allow');
});
