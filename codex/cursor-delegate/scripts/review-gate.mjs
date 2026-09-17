import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,realpathSync,existsSync,readFileSync,lstatSync,rmdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hookFileOperation,inspectFileOperation,describeFileOperation,WIRE_BYTES} from './file-review.mjs';
import {inspectCommand} from './confined-command.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function createReviewGate(runtime,{reviewMs=90000}={}) {
 const directory=mkdtempSync('/tmp/codex-cursor-review-');chmodSync(directory,0o700);
 const socketPath=join(directory,'r.sock');
 const command=quote(process.execPath)+' '+quote(fileURLToPath(new URL('./cursor-review-hook.mjs',import.meta.url)));
 const hook={command,matcher:'^(Read|Write|Edit|StrReplace|Delete|Shell)$',timeout:120,failClosed:true};
 let project;
 function restoreProject(){
  if(!project)return;
  const {path,before,installed,createdDir}=project;
  // Never overwrite concurrent user edits. Remove only this exact hook entry.
  if(existsSync(path)&&!lstatSync(path).isSymbolicLink()){
   const current=readFileSync(path,'utf8');
   if(current===installed){if(before===null)rmSync(path);else writeFileSync(path,before);}
   else {const config=JSON.parse(current);if(Array.isArray(config.hooks?.preToolUse)){config.hooks.preToolUse=config.hooks.preToolUse.filter(h=>JSON.stringify(h)!==JSON.stringify(hook));writeFileSync(path,JSON.stringify(config,null,2)+'\n');}}
  }
  if(createdDir){try{rmdirSync(join(project.hookRoot,'.cursor'));}catch{}}
  project=undefined;
 }
 function prepareProject(cwd){
  if(project?.cwd===cwd)return;
  restoreProject();
  // Cursor 2026.09.15 ACP passes its data project directory to the hook loader.
  const dataRoot=runtime.env?.CURSOR_DATA_DIR||join(homedir(),'.cursor');
  const hookRoot=join(dataRoot,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,''));
  const dir=join(hookRoot,'.cursor'),path=join(dir,'hooks.json');
  if(existsSync(dir)&&lstatSync(dir).isSymbolicLink()||existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('Refusing symlink hook configuration');
  const before=existsSync(path)?readFileSync(path,'utf8'):null;
  const config=before===null?{version:1,hooks:{}}:JSON.parse(before);
  if(config.version!==1||!config.hooks||typeof config.hooks!=='object'||Array.isArray(config.hooks)||config.hooks.preToolUse&&!Array.isArray(config.hooks.preToolUse))throw new Error('Unsupported existing project hook configuration');
  const createdDir=!existsSync(dir);mkdirSync(dir,{recursive:true});
  if(before!==null)writeFileSync(join(directory,'project-hooks.backup.json'),before,{mode:0o600});
  config.hooks.preToolUse=[...(config.hooks.preToolUse??[]),hook];
  const installed=JSON.stringify(config,null,2)+'\n';writeFileSync(path,installed);
  project={cwd,hookRoot,path,before,installed,createdDir};
 }
 const sockets=new Set(),records=[];let count=0;
 const note=(session,turn,id,code,operation,toolId)=>{
  const record={session_id:session?.id,turn_id:turn?.turn_id,request_id:id,code,tool_use_id:toolId,
   execution:code==='approved'?'unknown':'not_executed',operation};
  records.push(record);if(records.length>16)records.shift();return record;
 };
 const server=createServer(socket=>{
  socket.setEncoding('utf8');sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  let buffer='',received=false,settled=false,timer,session,turn,pending;
  const finish=(permission,code,message)=>{if(!socket.destroyed)socket.end(JSON.stringify({permission,code,message})+'\n');};
  const end=(allow,code,message)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(pending){
    if(turn.pending.get(pending.request_id)===pending){turn.pending.delete(pending.request_id);session.emit('pending',turn.turn_id,{action:'removed',request_id:pending.request_id,request_kind:'permission'});if(session.active===turn&&!turn.pending.size)session.turnState(turn,'running');}
    note(session,turn,pending.request_id,code,pending.privateOperation,pending.toolId);
   }
   finish(allow?'allow':'deny',code,message??(allow?'Reviewed':`${code}: operation NOT EXECUTED. Stop this attempt and let Codex inspect session status; this is not a new human authorization.`));
  };
  socket.setTimeout(10000,()=>end(false,'bridge_disconnected','Input frame was not received completely; operation not executed'));
  socket.on('close',()=>{if(!settled)end(false,'bridge_disconnected');});
  socket.on('data',data=>{
   if(received)return;buffer+=data;if(Buffer.byteLength(buffer)>WIRE_BYTES){received=true;end(false,'capacity_limit','Hook transport exceeds 2 MiB; reduce the proposed operation');return;}
   if(!buffer.includes('\n'))return;received=true;socket.setTimeout(0);
   try {
    const event=JSON.parse(buffer.split('\n')[0]);buffer='';
    const matches=[...runtime.sessions.values()].filter(s=>s.session_state==='live'&&s.active&&s.admissionOpen&&(event.conversation_id?s.cursorSessionId===event.conversation_id:s.cwd===realpathSync(event.cwd)));
    if(matches.length!==1){end(false,'configuration_mismatch','No unambiguous active Codex session');return;}
    session=matches[0];turn=session.active;
    if(event.cwd&&![session.cwd,project?.hookRoot].includes(realpathSync(event.cwd))){end(false,'configuration_mismatch','Hook workspace mismatch');return;}
    if(turn.pending.size>=8){end(false,'capacity_limit','Too many pending operations');return;}
    // Pinned CLI card displays offset+1, but its executor treats offset as 1-based.
    // Recover the actual zero-based range, not the off-by-one display label.
    if(event.tool_name==='Read'&&event.tool_input?.offset===undefined&&event.tool_input?.limit===undefined){
     const card=session.reviewCalls?.get(event.tool_use_id),range=card?.title?.match(/ \((\d+) - (\d+)\)$/);
     if(range&&card.rawInput?.path&&resolve(session.cwd,card.rawInput.path)===resolve(session.cwd,event.tool_input.file_path??event.tool_input.path))event.tool_input={...event.tool_input,offset:Math.max(0,Number(range[1])-2),limit:Number(range[2])-Number(range[1])+1};
    }
    let operation=hookFileOperation(event,session.cwd);
    const card=session.reviewCalls?.get(event.tool_use_id);
    const editCard=card?.kind==='edit'&&card.rawInput?.path&&operation?.files?.[0]?.path===resolve(session.cwd,card.rawInput.path);
    if(editCard&&event.tool_name==='Read'&&!operation.blocked){
     // StrReplace's native executor reads the whole source before its Write hook.
     // Review that distinct read honestly; a prior scoped read is context, not a grant.
     const prior=records.findLast(r=>r.session_id===session.id&&r.code==='approved'&&r.execution==='tool_completed'&&r.operation?.kind==='read'&&!r.operation.files[0].editPreparation&&r.operation.files[0].path===operation.files[0].path);
     if(prior&&inspectFileOperation(prior.operation,session.cwd).code==='supported'){
      operation.files[0]={...operation.files[0],editPreparation:true,offset:prior.operation.files[0].offset,limit:prior.operation.files[0].limit};
     }else operation.blocked={code:'range_required',message:'Edit preparation needs a fresh reviewed scoped Read of this file first'};
    }
    if(editCard&&operation?.kind==='edit'&&!operation.blocked){
     const preparation=records.findLast(r=>r.session_id===session.id&&r.tool_use_id===event.tool_use_id&&r.code==='approved'&&r.operation?.files?.[0]?.editPreparation);
     if(!preparation||inspectFileOperation(preparation.operation,session.cwd).code!=='supported')operation.blocked={code:'configuration_mismatch',message:'Edit base changed or no reviewed preparation exists; reread the file and regenerate this edit'};
    }
    const described=operation?.blocked?{review:operation.blocked}:operation?describeFileOperation(operation,session.cwd):{review:event.tool_name==='Shell'?inspectCommand(event.tool_input?.command,session.cwd,process.execPath):{code:'bridge_unsupported',message:'Unsupported tool input'}};
    const request_id='hook:'+randomUUID();count++;
    const recheck=()=>operation?.blocked??(operation?inspectFileOperation(operation,session.cwd):inspectCommand(event.tool_input?.command,session.cwd,process.execPath));
    pending={request_id,kind:'permission',toolId:event.tool_use_id,privateOperation:operation,
      context:{source:'cursor_pre_tool_use',title:{text:event.tool_name,truncated:false},tool_kind:{text:operation?.kind??'execute',truncated:false},choices:['allow-once','reject-once'],operation:described.context,review:described.review,expires_at:new Date(Date.now()+reviewMs).toISOString(),tool_input:event.tool_name==='Shell'?event.tool_input:undefined},bridgeReview:recheck,
      bridgeAnswer:(allow,code=allow?'approved':'codex_rejected')=>end(allow,code)};
    if(described.review.code!=='supported'){end(false,described.review.code,`${described.review.code}: ${described.review.message}. Operation NOT EXECUTED; ask Codex for a smaller or fresh request, not human safety approval.`);return;}
    turn.pending.set(request_id,pending);session.emit('pending',turn.turn_id,{action:'added',request_id,request_kind:'permission'});session.turnState(turn,'waiting_for_input');
    timer=setTimeout(()=>end(false,'review_timeout'),reviewMs);
   }catch(error){end(false,'configuration_mismatch',`Review context unavailable: ${error.message}`);}
  });
 });
 try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});chmodSync(socketPath,0o600);}catch(error){server.close();rmSync(directory,{recursive:true,force:true});throw error;}
 let closing;
 return {prepareProject,releaseProject:restoreProject,socketPath,
  completeTool(session,id){for(const r of records)if(r.session_id===session.id&&r.tool_use_id===id&&r.code==='approved')r.execution='tool_completed';},
  outcome(id){return records.findLast(r=>r.request_id===id);},
  stats(session){return {hook_requests:count,hook_config:project?.path??null,review_outcomes:records.filter(r=>!session||r.session_id===session.id).map(({operation,...r})=>({...r,state_check:operation?inspectFileOperation(operation,session?.cwd??project?.cwd):null,request_valid:false,retry: ['review_timeout','bridge_disconnected','capacity_limit','range_required'].includes(r.code)?(session?.active?'wait_for_turn_end':'inspect_state_then_send_one_fresh_request'):'no_automatic_retry'}))};},
  cancel(session,code='user_cancelled'){for(const p of [...(session?.active?.pending.values()??[])])if(p.bridgeAnswer)p.bridgeAnswer(false,code);},
  close(){return closing??=(async()=>{for(const s of runtime.sessions.values())this.cancel(s,'session_closed');for(const s of sockets)s.destroy();restoreProject();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});})();}};
}
