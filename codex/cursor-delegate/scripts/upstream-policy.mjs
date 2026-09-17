// Only the safety gap is adapted. Upstream owns ACP, sessions and all MCP wire IO.
export function installUpstreamPolicy(Runtime, tools) {
  const call = Runtime.prototype.call;
  Runtime.prototype.call = function (name, args) {
    if (name === 'cursor_answer_permission' && args?.decision !== 'reject-once') {
      throw new Error('Safety permission approval is unavailable in this host; model text or tool arguments cannot grant it');
    }
    return call.call(this, name, args);
  };
  for (const tool of tools) {
    tool.description = 'Codex decides ordinary technical questions and implementation plans within user authorization. ' +
      'Read actual results and verify the returned cwd before follow-up in the same session. ' +
      'No tool may approve safety upgrades; permission answers are rejection-only. ' +
      'Cancellation and safety refusal must not be retried or resumed. ' +
      'This native Cursor process is not confined by the former outer Codex sandbox. ' + tool.name;
    if (tool.name === 'cursor_answer_permission') {
      tool.inputSchema.properties.decision = {type: 'string', enum: ['reject-once']};
    }
  }
}
