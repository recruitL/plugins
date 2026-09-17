// Upstream owns ACP/session lifecycle. This adapter never grants safety upgrades.
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {confinedCommand} from './confined-command.mjs';
function ordinaryCommand(title,cwd) {
  const simple=confinedCommand(title,cwd,process.execPath);
  if(simple) return simple;
  // Exact read-only preparation observed from the real provider. No general
  // shell-composition admission. The package may not redirect through a symlink.
  const command=title?.replace(/^`(.*)`$/s,'$1');
  if(command==='ls -la && cat package.json 2>/dev/null || echo "NO_PACKAGE_JSON"') {
    try {if(realpathSync(join(cwd,'package.json'))===join(cwd,'package.json'))return {operation:'read'};} catch {}
  }
  return null;
}
export function installUpstreamPolicy(Runtime, tools) {
  const call=Runtime.prototype.call;
  Runtime.prototype.call=async function(name,args) {
    if(name==='cursor_answer_permission' && args?.decision!=='reject-once') {
      if(args?.decision!=='allow-once' || typeof args.reason!=='string' || !args.reason.trim()
        || Object.keys(args).some(k=>!['session_id','turn_id','request_id','decision','reason'].includes(k))) {
        throw new Error('An ordinary permission answer requires a review reason; no human-approval fields are accepted');
      }
      const status=await call.call(this,'cursor_session_status',{session_id:args.session_id});
      const turn=status.active_turn;
      const pending=turn?.pending?.find(p=>p.request_id===args.request_id);
      if(turn?.turn_id!==args.turn_id || pending?.kind!=='permission'
        || pending.context?.tool_kind?.text!=='execute' || pending.context.title?.truncated
        || !ordinaryCommand(pending.context.title?.text,status.cwd)) {
        throw new Error('Safety upgrade or unsupported operation: no approval route; keep blocked');
      }
      const {reason,...forward}=args;
      return call.call(this,name,forward);
    }
    return call.call(this,name,args);
  };
  for(const tool of tools) {
    tool.description='Codex decides ordinary questions/plans and reviews actual code before bounded in-project commands. '+
      'For allow-once, supply reason; runtime checks the actual pending operation, never a claimed human approval. '+
      'Unknown/safety upgrades stay blocked; no human authorization route. Read complete results and verify cwd. '+
      'No automatic resume after user cancellation or safety refusal. Native Cursor is not enclosed in the former outer OS sandbox. '+tool.name;
    if(tool.name==='cursor_answer_permission')tool.inputSchema.properties.reason={type:'string',description:'Required for an ordinary allow-once; explain inspected command/code within existing project authority. Not human approval.'};
  }
}
