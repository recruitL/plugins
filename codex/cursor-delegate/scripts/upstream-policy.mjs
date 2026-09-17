// Upstream owns ACP/session lifecycle. This adapter never grants safety upgrades.
import {inspectCommand} from './confined-command.mjs';
import {nativeFileOperation,inspectFileOperation} from './file-review.mjs';
import {createReviewGate} from './review-gate.mjs';
class PolicyError extends Error {
  constructor(code,message){super(message);this.error_code=code;}
}
export function installUpstreamPolicy(Runtime, tools, ErrorType=PolicyError, identity={}) {
  const call=Runtime.prototype.call;
  const attach=session=>{
    if(!session||session.reviewAttached)return;session.reviewAttached=true;
    const callback=session.callback;
    session.callback=function(message){
      callback.call(this,message);
      if(message.method!=='session/request_permission')return;
      const pending=this.active?.pending.get(String(message.id));
      if(!pending)return;
      const tool=message.params?.toolCall;
      if(Buffer.byteLength(JSON.stringify(tool))>60000){pending.context.review={code:'bridge_unsupported',message:'Operation exceeds review size limit'};return;}
      const operation=nativeFileOperation(tool);
      if(operation){pending.context.operation=operation;pending.context.review=inspectFileOperation(operation,this.cwd);}
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
        } finally {this.reviewStarting=false;}
      };
    }
    const environment=Runtime.prototype.childEnvironment;
    Runtime.prototype.childEnvironment=async function(signal){return {...await environment.call(this,signal),CURSOR_REVIEW_SOCKET:this.reviewGate.socketPath};};
    const shutdown=Runtime.prototype.shutdown;
    Runtime.prototype.shutdown=async function(){for(const s of this.sessions.values())this.reviewGate?.cancel(s);await shutdown.call(this);await this.reviewGate?.close();};
  }
  Runtime.prototype.call=async function(name,args) {
    if(['cursor_cancel','cursor_close_session'].includes(name))this.reviewGate?.cancel(this.sessions.get(args?.session_id));
    if(name==='cursor_send_prompt' && typeof args?.prompt==='string') {
      const status=await call.call(this,'cursor_session_status',{session_id:args.session_id});
      // Supply the actual session root, not the host's unrelated workspace.
      // This is routing guidance; the permission checks below remain mandatory.
      args={...args,prompt:`[Bridge execution context] Session cwd: ${JSON.stringify(status.cwd)}. For shell test requests use explicit absolute test-file paths inside this project, without cd or shell composition; do not assume a package subdirectory is the session cwd. Unsupported bridge syntax is not a grant. Stop on native safety refusals or user cancellation.\n\n${args.prompt}`};
    }
    if(name==='cursor_answer_permission') {
      const live=this.sessions?.get(args?.session_id);
      const entry=live?.active?.turn_id===args?.turn_id?live.active.pending.get(args.request_id):null;
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
    if(['cursor_start_session','cursor_resume_session','cursor_session_status'].includes(name))return {...result,bridge:{...identity,file_review:'cursor_pre_tool_use',...this.reviewGate?.stats()}};
    return result;
  };
  for(const tool of tools) {
    tool.description='Codex coordinates ordinary questions, plans and repairs in one Cursor session. Verify returned cwd; read complete results and inspect real changes. '+
      'Read/edit requests include file paths and before/after text; review them, then answer allow-once with reason. The blocking Cursor hook routes ordinary file maintenance through this queue; it does not override native permissions. Missing paths are configuration_mismatch; unsupported forms are bridge_unsupported; outside-project paths are authorization_required and remain blocked. '+
      'Native refusals are preserved; no human escalation route or automatic recovery after refusal/cancellation. '+tool.name;
    if(tool.name==='cursor_answer_permission')tool.inputSchema.properties.reason={type:'string',description:'Required for an ordinary allow-once; explain inspected command/code within existing project authority. Not human approval.'};
  }
}
