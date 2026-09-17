// Upstream owns ACP/session lifecycle. This adapter never grants safety upgrades.
import {inspectCommand} from './confined-command.mjs';
class PolicyError extends Error {
  constructor(code,message){super(message);this.error_code=code;}
}
export function installUpstreamPolicy(Runtime, tools, ErrorType=PolicyError) {
  const call=Runtime.prototype.call;
  Runtime.prototype.call=async function(name,args) {
    if(name==='cursor_send_prompt' && typeof args?.prompt==='string') {
      const status=await call.call(this,'cursor_session_status',{session_id:args.session_id});
      // Supply the actual session root, not the host's unrelated workspace.
      // This is routing guidance; the permission checks below remain mandatory.
      args={...args,prompt:`[Bridge execution context] Session cwd: ${JSON.stringify(status.cwd)}. For shell test requests use explicit absolute test-file paths inside this project, without cd or shell composition; do not assume a package subdirectory is the session cwd. Unsupported bridge syntax is not a grant. Stop on native safety refusals or user cancellation.\n\n${args.prompt}`};
    }
    if(name==='cursor_answer_permission' && args?.decision!=='reject-once') {
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
      if(pending.context?.tool_kind?.text!=='execute' || pending.context.tool_kind.truncated || pending.context.title?.truncated) {
        throw new ErrorType('bridge_unsupported','The bridge cannot review this operation or its incomplete context; no permission was sent');
      }
      const review=inspectCommand(pending.context.title?.text,status.cwd,process.execPath);
      if(review.code!=='supported')throw new ErrorType(review.code,review.message);
      const {reason,...forward}=args;
      return call.call(this,name,forward);
    }
    // Native errors/refusals are returned unchanged; never retry automatically.
    return call.call(this,name,args);
  };
  for(const tool of tools) {
    tool.description='Codex coordinates ordinary questions, plans and repairs in one Cursor session. Verify returned cwd; read complete results and inspect real changes. '+
      'Permission answers require review of the actual command and files, plus reason. Missing paths are configuration_mismatch; unsupported forms are bridge_unsupported; outside-project paths are authorization_required and remain blocked. '+
      'Native refusals are preserved; no human escalation route or automatic recovery after refusal/cancellation. '+tool.name;
    if(tool.name==='cursor_answer_permission')tool.inputSchema.properties.reason={type:'string',description:'Required for an ordinary allow-once; explain inspected command/code within existing project authority. Not human approval.'};
  }
}
