// Opt-in actual MCP/Cursor login-wait test. Cancels before login; no model prompt.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import readline from 'node:readline';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const [parent,codexPath,agentPath]=process.argv.slice(2);
if(!parent||!codexPath||!agentPath)throw new Error('Usage: node tests/mcp-native-isolated.mjs SHORT_TEST_PARENT CODEX_BINARY CURSOR_AGENT');
const workspace=mkdtempSync(join(parent,'app-'));
const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/server.mjs',import.meta.url))],{env:{HOME:homedir(),PATH:'/usr/bin:/bin',CURSOR_DELEGATE_ROOT:workspace,CURSOR_AGENT_COMMAND:agentPath,CURSOR_DELEGATE_CODEX_SANDBOX:codexPath,CURSOR_DELEGATE_NETWORK:'cursor-api'},stdio:['pipe','pipe','pipe']});
let next=0;const pending=new Map();let stderrBytes=0;child.stderr.on('data',b=>stderrBytes+=b.length);
readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);p.resolve(m)}});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP observation timeout'))},20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})}
async function tool(name,args={}){const r=await rpc('tools/call',{name,arguments:args});if(r.error)throw new Error('MCP error');return r.result.isError?{tool_error:true}:JSON.parse(r.result.content[0].text)}
const receipt={kind:'real MCP stdio + real isolated Cursor; NOT App UI test',workspace,network:'native proxy: api2.cursor.sh only',browser_opened:false,login_completed:false,model_prompt_sent:false};
let session;
try{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'native-isolated-mcp-probe',version:'1'}});
 const start=await tool('cursor_start',{cwd:workspace});session=start.session_id;receipt.start=start.state;
 let status=start;const deadline=Date.now()+18000;
 while(!['awaiting_login','failed','blocked','cancelled'].includes(status.state)&&Date.now()<deadline){status=await tool('cursor_wait',{session_id:session,after_revision:status.revision,timeout_ms:1000})}
 receipt.login_wait={state:status.state,validated_url_present:typeof status.login_url==='string'&&status.login_url.startsWith('https://cursor.com/loginDeepControl?'),cwd_matches:status.cwd===workspace};
 if(status.state!=='awaiting_login')throw new Error('Did not reach login wait');
 const pid=status.pid;
 await new Promise(ok=>setTimeout(ok,5000));const after=await tool('cursor_status');receipt.still_waiting_after_native_poll=after.state==='awaiting_login';if(!receipt.still_waiting_after_native_poll)throw new Error('Native authentication failed before user login');
 receipt.early_prompt_rejected=(await tool('cursor_prompt',{session_id:session,request_id:'too-early',scope:'empty test directory',prompt:'This must be rejected before sending to Cursor.'})).tool_error===true;
 const cancelled=await tool('cursor_cancel',{session_id:session});receipt.cancelled=cancelled.state==='cancelled'&&cancelled.login_url===null;
 const end=Date.now()+3000;let alive=true;while(alive&&Date.now()<end){try{process.kill(pid,0);await new Promise(ok=>setTimeout(ok,50))}catch(e){if(e.code==='ESRCH')alive=false;else throw e}}
 receipt.process_stopped=!alive;receipt.recovery_rejected=(await tool('cursor_recover',{session_id:session,inspection:'Cancelled login process is stopped; entry must reject recovery.'})).tool_error===true;
}catch(e){receipt.failure=e.message}
finally{
 if(session)try{await tool('cursor_close',{session_id:session})}catch{}
 child.stdin.end();await new Promise(ok=>child.once('close',ok));receipt.stderr_bytes=stderrBytes;
 receipt.passed=receipt.login_wait?.state==='awaiting_login'&&receipt.login_wait.validated_url_present&&receipt.login_wait.cwd_matches&&receipt.early_prompt_rejected&&receipt.cancelled&&receipt.process_stopped&&receipt.recovery_rejected&&!receipt.failure;
 writeFileSync(workspace+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));process.exitCode=receipt.passed?0:1;
}
