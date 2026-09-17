import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installUpstreamPolicy} from '../scripts/upstream-policy.mjs';
test('upstream adapter admits reviewed ordinary requests, never forged human authority or scope expansion',async t=>{
 const cwd=realpathSync(mkdtempSync(join(tmpdir(),'upstream-policy-')));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 writeFileSync(join(cwd,'package.json'),'{}');writeFileSync(join(cwd,'add.test.mjs'),'');
 const calls=[];let title='pwd';
 class Runtime {async call(name,args){if(name==='cursor_session_status')return {cwd,active_turn:{turn_id:'t',pending:[{request_id:'p',kind:'permission',context:{title:{text:title,truncated:false},tool_kind:{text:'execute'}}}]}};calls.push({name,args});return {forwarded:true}}}
 const tools=[{name:'cursor_answer_permission',inputSchema:{properties:{decision:{enum:['allow-once','reject-once']}}}}];
 installUpstreamPolicy(Runtime,tools);const runtime=new Runtime();
 const args={session_id:'s',turn_id:'t',request_id:'p',decision:'allow-once',reason:'Inspected actual command and files; existing project authority'};
 for(const extra of [{user_approved:true},{decision:'allow-always'},{reason:''},{request_id:'fake'}])await assert.rejects(runtime.call('cursor_answer_permission',{...args,...extra}));
 assert.equal(calls.length,0);
 for(title of ['pwd','node --test add.test.mjs','`ls -la && cat package.json 2>/dev/null || echo "NO_PACKAGE_JSON"`'])await runtime.call('cursor_answer_permission',args);
 assert.equal(calls.length,3);assert.ok(!('reason' in calls[0].args));
 for(title of ['cat ../secret','node --test ../outside.test.mjs','ls -la; touch ../outside','curl https://example.com','node -e "process.exit()"'])await assert.rejects(runtime.call('cursor_answer_permission',args),/no approval route/);
 assert.equal(calls.length,3);
 await runtime.call('cursor_answer_plan',{decision:'accept'});assert.equal(calls.length,4);
});
