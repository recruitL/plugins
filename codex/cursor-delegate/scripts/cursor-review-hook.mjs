// Bounded fail-closed transport; interruption reason is not an authorization verdict.
import {connect} from 'node:net';
import {WIRE_BYTES} from './file-review.mjs';
let done=false,socket;
function finish(reply){
 if(done)return;done=true;clearTimeout(timer);socket?.destroy();
 const allowed=reply?.permission==='allow',code=reply?.code??'bridge_disconnected';
 const message=reply?.message??`${code}: review delivery failed; operation not executed by this hook. Stop and let Codex inspect state, do not infer a human or native safety refusal.`;
 process.stdout.write(JSON.stringify(allowed?{permission:'allow'}:{permission:'deny',user_message:message,agent_message:message})+'\n');
 process.exitCode=allowed?0:2;process.stdin.destroy();
}
// Gate deadline is 90s; transport watchdog 110s; native hook timeout 120s.
const timer=setTimeout(()=>finish({code:'bridge_disconnected',message:'bridge_disconnected: no review response before transport deadline; stop and inspect state before retry'}),110000);
process.on('uncaughtException',()=>finish());process.on('unhandledRejection',()=>finish());
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>WIRE_BYTES)finish({code:'capacity_limit',message:'capacity_limit: hook input exceeds 2 MiB; operation not executed; reduce the edit'});});
process.stdin.on('end',()=>{
 if(done)return;
 try {
  const event=JSON.parse(input);input='';
  socket=connect(process.env.CURSOR_REVIEW_SOCKET);socket.setEncoding('utf8');socket.on('error',()=>finish());socket.on('end',()=>finish());
  socket.on('connect',()=>socket.write(JSON.stringify({cwd:event.cwd,conversation_id:event.conversation_id,tool_name:event.tool_name,tool_input:event.tool_input,tool_use_id:event.tool_use_id})+'\n'));
  let response='';socket.on('data',chunk=>{response+=chunk;if(Buffer.byteLength(response)>16000){finish();return;}if(response.includes('\n')){try{finish(JSON.parse(response.split('\n')[0]));}catch{finish();}}});
 }catch{finish();}
});
