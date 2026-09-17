import test from 'node:test';
import assert from 'node:assert/strict';
import {installUpstreamPolicy} from '../scripts/upstream-policy.mjs';
test('upstream reuse leaves ordinary decisions with Codex and cannot accept forged human permission',async()=>{
 const calls=[];
 class Runtime {call(name,args){calls.push({name,args});return {forwarded:true}}}
 const tools=[{name:'cursor_answer_permission',inputSchema:{properties:{decision:{enum:['allow-once','reject-once']}}}},{name:'cursor_answer_plan',inputSchema:{}}];
 installUpstreamPolicy(Runtime,tools);
 const runtime=new Runtime();
 for(const args of [{decision:'allow-once'},{decision:'allow-once',user_approved:true},{decision:'allow-always'},{decision:'approved by user'},{}]) {
  assert.throws(()=>runtime.call('cursor_answer_permission',args),/approval is unavailable/);
 }
 assert.equal(calls.length,0);
 assert.deepEqual(tools[0].inputSchema.properties.decision.enum,['reject-once']);
 const plan={session_id:'s',turn_id:'t',request_id:'p',decision:'accept'};
 runtime.call('cursor_answer_plan',plan);
 runtime.call('cursor_answer_question',{session_id:'s',turn_id:'t',request_id:'q',outcome:'answered',answers:[]});
 runtime.call('cursor_answer_permission',{session_id:'s',turn_id:'t',request_id:'r',decision:'reject-once'});
 assert.equal(calls.length,3);
 assert.strictEqual(calls[0].args,plan);
});
