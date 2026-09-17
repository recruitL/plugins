// A blocking Cursor preToolUse hook. Transport failure denies, never approves.
import {connect} from 'node:net';
let done=false,socket;
function finish(reply){if(done)return;done=true;clearTimeout(timer);socket?.destroy();const allowed=reply?.permission==='allow';process.stdout.write(JSON.stringify(allowed?{permission:'allow'}:{permission:'deny',user_message:reply?.message||'Codex review unavailable',agent_message:reply?.message||'Stop: Codex review unavailable'})+'\n');process.exitCode=allowed?0:2;process.stdin.destroy();}
const timer=setTimeout(()=>finish({message:'Codex review timed out; operation not approved'}),110000);
process.on('uncaughtException',()=>finish());process.on('unhandledRejection',()=>finish());
let input='';
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>60000)finish({message:'Operation too large for review'});});
process.stdin.on('end',()=>{
 if(done)return;
 try {
  const event=JSON.parse(input);
  socket=connect(process.env.CURSOR_REVIEW_SOCKET);
  socket.on('error',()=>finish());socket.on('end',()=>finish());
  socket.on('connect',()=>socket.write(JSON.stringify({cwd:event.cwd,conversation_id:event.conversation_id,tool_name:event.tool_name,tool_input:event.tool_input,tool_use_id:event.tool_use_id})+'\n'));
  let response='';socket.on('data',chunk=>{response+=chunk;if(response.includes('\n')){try{finish(JSON.parse(response.split('\n')[0]));}catch{finish();}}});
 } catch {finish();}
});
