// Upstream owns ACP/session lifecycle. This adapter never grants safety upgrades.
import {inspectCommand} from './confined-command.mjs';
import {nativeFileOperation,inspectFileOperation,describeFileOperation} from './file-review.mjs';
import {createReviewGate} from './review-gate.mjs';
class PolicyError extends Error {
  constructor(code,message){super(message);this.error_code=code;}
}
export function installUpstreamPolicy(Runtime, tools, ErrorType=PolicyError, identity={}) {
  const call=Runtime.prototype.call;
  const attach=session=>{
    if(!session||session.reviewAttached)return;session.reviewAttached=true;
    session.reviewCalls=new Map();
    const callback=session.callback,shutdown=session.shutdown,terminalize=session.terminalize;
    if(shutdown)session.shutdown=async function(...args){
      this.runtime.reviewGate?.cancel(this,'bridge_disconnected');
      try{return await shutdown.apply(this,args);}finally{if(!this.runtime.live.size)this.runtime.reviewGate?.releaseProject();}
    };
    if(terminalize)session.terminalize=async function(turn,status,reason){
      this.runtime.reviewGate?.cancel(this,status==='cancelled'?'user_cancelled':status==='timed_out'?'turn_timeout':'bridge_disconnected');
      return terminalize.call(this,turn,status,reason);
    };
    session.callback=function(message){
      const update=message.method==='session/update'?message.params?.update:null;
      if(update?.toolCallId&&['tool_call','tool_call_update'].includes(update.sessionUpdate)){
        const old=this.reviewCalls.get(update.toolCallId)??{};
        this.reviewCalls.set(update.toolCallId,{...old,...(update.title?{title:update.title}:{}),...(update.kind?{kind:update.kind}:{}),...(update.rawInput?{rawInput:update.rawInput}:{})});
        if(this.reviewCalls.size>64)this.reviewCalls.delete(this.reviewCalls.keys().next().value);
        if(update.status==='completed')this.runtime.reviewGate?.completeTool(this,update.toolCallId);
      }
      callback.call(this,message);
      if(message.method!=='session/request_permission')return;
      const pending=this.active?.pending.get(String(message.id));if(!pending)return;
      const operation=nativeFileOperation(message.params?.toolCall);
      if(operation){const described=describeFileOperation(operation,this.cwd);pending.context.operation=described.context;pending.context.review=described.review;pending.bridgeReview=()=>described.review.code==='supported'?inspectFileOperation(operation,this.cwd):described.review;}
    };
  };
  if(Runtime.prototype.start) {
    for(const method of ['start','resume']) {
      const original=Runtime.prototype[method];
      Runtime.prototype[method]=async function(args){
        if(this.reviewStarting||this.live.size)throw new ErrorType('resource_limit','One Cursor execution session is supported');
        const cwd=this.canonicalCwd(args?.cwd);
        this.reviewStarting=true;
        try {
          this.reviewGate??=await createReviewGate(this);
          this.reviewGate.prepareProject(cwd);
          const result=await original.call(this,args);
          attach(this.sessions.get(result.session_id));return result;
        } finally {this.reviewStarting=false;if(!this.live.size)this.reviewGate?.releaseProject();}
      };
    }
    const environment=Runtime.prototype.childEnvironment;
    Runtime.prototype.childEnvironment=async function(signal){return {...await environment.call(this,signal),CURSOR_REVIEW_SOCKET:this.reviewGate.socketPath};};
    const shutdown=Runtime.prototype.shutdown;
    Runtime.prototype.shutdown=async function(){for(const s of this.sessions.values())this.reviewGate?.cancel(s);await shutdown.call(this);await this.reviewGate?.close();};
  }
  Runtime.prototype.call=async function(name,args) {
    const target=this.sessions?.get(args?.session_id);
    if(name==='cursor_close_session'&&Object.keys(args??{}).length===1)this.reviewGate?.cancel(target,'session_closed');
    if(name==='cursor_cancel'&&target?.active?.turn_id===args?.turn_id&&Object.keys(args??{}).length===2)this.reviewGate?.cancel(target,'user_cancelled');
    if(name==='cursor_send_prompt' && typeof args?.prompt==='string') {
      const status=await call.call(this,'cursor_session_status',{session_id:args.session_id});
      // Supply the actual session root, not the host's unrelated workspace.
      // This is routing guidance; the permission checks below remain mandatory.
      args={...args,prompt:`[Bridge execution context] Session cwd: ${JSON.stringify(status.cwd)}. For shell test requests use explicit absolute test-file paths inside this project, without cd or shell composition; do not assume a package subdirectory is the session cwd. Unsupported bridge syntax is not a grant. Use explicit offset and limit for large Read requests. Before each new local edit after the file changes, including repairs, read the current target range again. A review_timeout or capacity_limit means the hook did not execute that request; stop that attempt and let Codex inspect status before one fresh request. Never automatically replay writes. Stop on native safety refusals, explicit Codex rejection, or user cancellation.\n\n${args.prompt}`};
    }
    if(name==='cursor_answer_permission') {
      const live=this.sessions?.get(args?.session_id);
      const entry=live?.active?.turn_id===args?.turn_id?live.active.pending.get(args.request_id):null;
      const expired=this.reviewGate?.outcome(args?.request_id);
      if(!entry&&expired?.session_id===args?.session_id)throw new ErrorType('review_expired',`${expired.code}: request is no longer valid; inspect session status and file state before any fresh request`);
      if(args?.decision==='reject-once'){if(entry?.bridgeAnswer){entry.bridgeAnswer(false);return live.actionEnvelope(live.active);}const {reason,...forward}=args;return call.call(this,name,forward);}
      if(args?.decision!=='allow-once' || typeof args.reason!=='string' || !args.reason.trim()
        || Object.keys(args).some(k=>!['session_id','turn_id','request_id','decision','reason'].includes(k))) {
        throw new ErrorType('invalid_args','An ordinary permission answer requires a review reason; no human-approval fields are accepted');
      }
      const status=await call.call(this,'cursor_session_status',{session_id:args.session_id});
      const turn=status.active_turn;
      const pending=turn?.pending?.find(p=>p.request_id===args.request_id);
      if(turn?.turn_id!==args.turn_id || pending?.kind!=='permission') {
        throw new ErrorType('request_mismatch','No matching live permission request; inspect the same session before answering');
      }
      if(pending.context.tool_kind?.truncated || pending.context.title?.truncated)throw new ErrorType('bridge_unsupported','Operation context is incomplete');
      const review=entry?.bridgeReview?entry.bridgeReview():pending.context.operation?inspectFileOperation(pending.context.operation,status.cwd):pending.context.review??(pending.context.tool_kind?.text==='execute'?inspectCommand(pending.context.title?.text,status.cwd,process.execPath):{code:'bridge_unsupported',message:'Operation has no complete file or command representation'});
      if(review.code!=='supported')throw new ErrorType(review.code,review.message);
      if(entry?.bridgeAnswer){if(live.active?.turn_id!==args.turn_id||live.active.pending.get(args.request_id)!==entry)throw new ErrorType('request_mismatch','Operation is no longer pending');entry.bridgeAnswer(true);return live.actionEnvelope(live.active);}
      const {reason,...forward}=args;
      return call.call(this,name,forward);
    }
    // Native errors/refusals are returned unchanged; never retry automatically.
    const result=await call.call(this,name,args);
    if(name==='cursor_close_session'&&!this.live?.size)this.reviewGate?.releaseProject();
    if(['cursor_start_session','cursor_resume_session','cursor_session_status','cursor_wait','cursor_read_result'].includes(name))return {...result,bridge:{...identity,file_review:'cursor_pre_tool_use',...this.reviewGate?.stats(this.sessions?.get(args?.session_id??result.session_id))}};
    return result;
  };
  for(const tool of tools) {
    tool.description='Codex coordinates ordinary questions, plans and repairs in one Cursor session. Verify returned cwd; read complete results and inspect real changes. '+
      'Read requests show exact line ranges; edit preparation explicitly declares a whole-file internal read with a scoped preview and grants no write. Edits show the complete changed span with line locations and context, not entire large files. Review this context then answer allow-once with reason. Inspect review_outcomes after review_timeout or bridge_disconnected: expired requests never execute, and no write is replayed automatically. Capacity limits are not safety refusals. Native refusals and explicit rejection/cancellation must not be recovered automatically. The blocking Cursor hook routes ordinary file maintenance through this queue; it does not override native permissions. Missing paths are configuration_mismatch; unsupported forms are bridge_unsupported; outside-project paths are authorization_required and remain blocked. '+
      'Native refusals are preserved; no human escalation route or automatic recovery after refusal/cancellation. '+tool.name;
    if(tool.name==='cursor_answer_permission')tool.inputSchema.properties.reason={type:'string',description:'Required for an ordinary allow-once; explain inspected command/code within existing project authority. Not human approval.'};
  }
}
