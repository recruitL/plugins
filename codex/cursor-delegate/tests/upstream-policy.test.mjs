import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installUpstreamPolicy} from '../scripts/upstream-policy.mjs';
import {inspectCommand,confinedCommand} from '../scripts/confined-command.mjs';
function fixture(t){
 const cwd=realpathSync(mkdtempSync(join(tmpdir(),'upstream-policy-')));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,'package/tests'),{recursive:true});writeFileSync(join(cwd,'package/tests/prepare-cli.test.mjs'),'');
 const calls=[];const state={title:'pwd',kind:'execute',truncated:false};
 class Runtime {async call(name,args){if(name==='cursor_session_status')return {cwd,active_turn:{turn_id:'t',pending:[{request_id:'p',kind:'permission',context:{title:{text:state.title,truncated:state.truncated},tool_kind:{text:state.kind}}}]}};calls.push({name,args});return {forwarded:true}}}
 const tools=[{name:'cursor_answer_permission',inputSchema:{properties:{}}}];
 installUpstreamPolicy(Runtime,tools);const runtime=new Runtime();
 const args={session_id:'s',turn_id:'t',request_id:'p',decision:'allow-once',reason:'Inspected actual command and files within existing project authority'};
 return {cwd,calls,state,runtime,args};
}
test('real maintenance regression: package-relative test path reports configuration mismatch, qualified paths work',async t=>{
 const {cwd,calls,state,runtime,args}=fixture(t);
 state.title='`node --test tests/prepare-cli.test.mjs`';
 await assert.rejects(runtime.call('cursor_answer_permission',args),e=>e.error_code==='configuration_mismatch'&&e.message.includes(cwd));
 assert.equal(calls.length,0);
 for(state.title of ['node --test package/tests/prepare-cli.test.mjs',`node --test "${cwd}/package/tests/prepare-cli.test.mjs"`])await runtime.call('cursor_answer_permission',args);
 assert.equal(calls.length,2);assert.ok(!('reason' in calls[0].args));
});
test('unsupported syntax, outside paths and stale requests remain separate and never forward a grant',async t=>{
 const {calls,state,runtime,args}=fixture(t);
 for(const [title,code] of [
  ['ls -la && cat package.json 2>/dev/null || echo "NO_PACKAGE_JSON"','bridge_unsupported'],
  ['cat package.json','bridge_unsupported'],
  ['node --test ../outside.test.mjs','authorization_required'],
  ['node --test missing.test.mjs','configuration_mismatch'],
  ['node -e "process.exit()"','bridge_unsupported']
 ]){state.title=title;await assert.rejects(runtime.call('cursor_answer_permission',args),e=>e.error_code===code,title);}
 await assert.rejects(runtime.call('cursor_answer_permission',{...args,request_id:'stale'}),e=>e.error_code==='request_mismatch');
 for(const extra of [{user_approved:true},{decision:'allow-always'},{reason:''}])await assert.rejects(runtime.call('cursor_answer_permission',{...args,...extra}),e=>e.error_code==='invalid_args');
 assert.equal(calls.length,0);
 state.title='pwd';state.truncated=true;
 await assert.rejects(runtime.call('cursor_answer_permission',args),e=>e.error_code==='bridge_unsupported');
 assert.equal(calls.length,0);
 await runtime.call('cursor_answer_permission',{...args,decision:'reject-once'});
 assert.equal(calls.length,1);
});
test('symlink escapes remain authorization-required and legacy API stays null-or-command',t=>{
 const {cwd}=fixture(t);const outside=realpathSync(mkdtempSync(join(tmpdir(),'outside-policy-')));t.after(()=>rmSync(outside,{recursive:true,force:true}));
 writeFileSync(join(outside,'escape.test.mjs'),'');symlinkSync(join(outside,'escape.test.mjs'),join(cwd,'escape.test.mjs'));
 assert.equal(inspectCommand('node --test escape.test.mjs',cwd,process.execPath).code,'authorization_required');
 assert.equal(confinedCommand('node --test escape.test.mjs',cwd,process.execPath),null);
 assert.deepEqual(confinedCommand('pwd',cwd,process.execPath),{command:'pwd',operation:'read',paths:[cwd]});
});
test('dispatch supplies actual session cwd without mutating caller arguments or approving execution',async t=>{
 const {cwd,calls,runtime}=fixture(t);const args={session_id:'s',prompt:'Maintain package'};
 await runtime.call('cursor_send_prompt',args);
 assert.equal(args.prompt,'Maintain package');assert.equal(calls.length,1);
 assert.equal(calls[0].name,'cursor_send_prompt');assert.ok(calls[0].args.prompt.includes(JSON.stringify(cwd)));
 assert.ok(calls[0].args.prompt.endsWith(args.prompt));assert.match(calls[0].args.prompt,/absolute test-file paths/);
 await runtime.call('cursor_answer_plan',{decision:'accept'});assert.equal(calls[1].name,'cursor_answer_plan');
});
test('native errors pass through unchanged and are not retried',async()=>{
 const error=new Error('native refusal');let count=0;
 class Runtime {async call(){count++;throw error;}}
 installUpstreamPolicy(Runtime,[]);
 await assert.rejects(new Runtime().call('cursor_wait',{}),e=>e===error);assert.equal(count,1);
});
