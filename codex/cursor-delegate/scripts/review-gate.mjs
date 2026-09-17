import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,realpathSync,existsSync,readFileSync,lstatSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hookFileOperation,inspectFileOperation} from './file-review.mjs';
import {inspectCommand} from './confined-command.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function createReviewGate(runtime) {
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
 const sockets=new Set();let count=0;
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  let buffer='',received=false;
  const finish=(permission,message)=>{if(!socket.destroyed)socket.end(JSON.stringify({permission,message})+'\n');};
  socket.setTimeout(115000,()=>{finish('deny','Review expired');socket.destroy();});
  socket.on('data',data=>{
   if(received)return;buffer+=data;if(Buffer.byteLength(buffer)>64000){received=true;finish('deny','Review input exceeds limit');return;}
   if(!buffer.includes('\n'))return;received=true;
   try {
    const event=JSON.parse(buffer.split('\n')[0]);
    const sessions=[...runtime.sessions.values()].filter(s=>s.session_state==='live'&&s.active&&s.admissionOpen&&(event.conversation_id?s.cursorSessionId===event.conversation_id:s.cwd===realpathSync(event.cwd)));
    if(sessions.length!==1){finish('deny','No unambiguous active Codex session');return;}
    const session=sessions[0],turn=session.active;
    if(event.cwd&&![session.cwd,project?.hookRoot].includes(realpathSync(event.cwd))){finish('deny','Hook workspace mismatch');return;}
    if(event.conversation_id&&event.conversation_id!==session.cursorSessionId){finish('deny','Cursor conversation mismatch');return;}
    if(turn.pending.size>=8){finish('deny','Too many pending operations');return;}
    const operation=hookFileOperation(event,session.cwd);
    const review=operation?.blocked??(operation?inspectFileOperation(operation,session.cwd):event.tool_name==='Shell'?inspectCommand(event.tool_input?.command,session.cwd,process.execPath):{code:'bridge_unsupported',message:'Unsupported tool input; no operation approved'});
    const request_id='hook:'+randomUUID();
    const pending={request_id,kind:'permission',context:{source:'cursor_pre_tool_use',title:{text:event.tool_name,truncated:false},tool_kind:{text:operation?.kind??'execute',truncated:false},choices:['allow-once','reject-once'],operation,review,tool_input:event.tool_name==='Shell'?event.tool_input:undefined},bridgeReview:()=>operation?.blocked??(operation?inspectFileOperation(operation,session.cwd):inspectCommand(event.tool_input?.command,session.cwd,process.execPath))};
    pending.bridgeAnswer=allow=>{turn.pending.delete(request_id);session.emit('pending',turn.turn_id,{action:'removed',request_id,request_kind:'permission'});if(session.active===turn&&!turn.pending.size)session.turnState(turn,'running');finish(allow?'allow':'deny',allow?undefined:'Codex declined this operation');};
    turn.pending.set(request_id,pending);count++;session.emit('pending',turn.turn_id,{action:'added',request_id,request_kind:'permission'});session.turnState(turn,'waiting_for_input');
    socket.on('close',()=>{if(turn.pending.get(request_id)===pending)pending.bridgeAnswer(false);});
   }catch{finish('deny','Malformed or unavailable review context');}
  });
 });
 try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});chmodSync(socketPath,0o600);}catch(error){server.close();rmSync(directory,{recursive:true,force:true});throw error;}
 let closing;
 return {prepareProject,releaseProject:restoreProject,socketPath,stats:()=>({hook_requests:count,hook_config:project?.path??null}),cancel(session){for(const p of [...(session?.active?.pending.values()??[])])if(p.bridgeAnswer)p.bridgeAnswer(false);},close(){return closing??=(async()=>{for(const s of sockets)s.destroy();restoreProject();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});})();}};
}
