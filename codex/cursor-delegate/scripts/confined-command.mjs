// Syntax/scope recognition only: NOT OS confinement or an authorization grant.
// Keep the legacy null-or-command API; diagnostics never grant permissions.
import {realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
const failure=(code,message)=>({code,message});
export function inspectCommand(title,cwd,nodePath) {
  const unsupported=message=>failure('bridge_unsupported',message);
  if(typeof title!=='string'||title.length>4096)return unsupported('Command title is missing or too long');
  let root;
  try {root=realpathSync(cwd);} catch {return failure('configuration_mismatch','Session cwd is unavailable');}
  let command=title.trim();
  if(command.startsWith('`')&&command.endsWith('`'))command=command.slice(1,-1);
  if(/[;&|<>$`\\\r\n*?\[\]{}!~()#\x00]/.test(command))return unsupported('Shell composition or expansion is not supported; no command was approved');
  const words=[];let rest=command;
  while(rest.trim()) {
    const m=/^[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"']+))(?=\s|$)/.exec(rest);
    if(!m)return unsupported('Cannot parse command arguments');
    words.push(m[1]??m[2]??m[3]);rest=rest.slice(m[0].length);
  }
  const outside=target=>{const rel=relative(root,target);return rel==='..'||rel.startsWith('../')||isAbsolute(rel);};
  function inside(path,file=false) {
    if(!path)return unsupported('Empty path');
    const lexical=resolve(root,path);
    if(outside(lexical))return failure('authorization_required','Path is outside this session project; no human authorization route is connected');
    if(path.split('/').includes('..'))return unsupported('Parent path components are not supported');
    let target;
    try {target=realpathSync(lexical);} catch(error) {
      return failure('configuration_mismatch',`Cannot resolve ${JSON.stringify(path)} from session cwd ${JSON.stringify(root)} (${error.code || 'path error'}); confirm the actual file and use its absolute path. No command was approved`);
    }
    if(outside(target))return failure('authorization_required','Resolved path is outside this session project; no human authorization route is connected');
    try {if(file&&!statSync(target).isFile())return failure('configuration_mismatch','Test target is not a regular file');}
    catch {return failure('configuration_mismatch','Test target is unavailable');}
    return {path:target};
  }
  const accepted=(operation,paths)=>({code:'supported',command,operation,paths});
  if(words.length===1&&words[0]==='pwd')return accepted('read',[root]);
  if(words[0]==='ls') {
    const paths=[];
    for(const arg of words.slice(1)) {
      if(/^-[aldh1]+$/.test(arg))continue;
      if(arg.startsWith('-'))return unsupported('Unsupported ls option');
      const result=inside(arg);if(!result.path)return result;paths.push(result.path);
    }
    return accepted('read',paths.length?paths:[root]);
  }
  if((words[0]==='node'||words[0]===nodePath)&&words[1]==='--test'&&words.length>=3&&words.length<=10) {
    const paths=[];
    for(const arg of words.slice(2)) {
      if(arg.startsWith('-')||!arg.match(/\.test\.(mjs|cjs|js)$/))return unsupported('Node tests require explicit test files and no extra execution options');
      const result=inside(arg,true);if(!result.path)return result;paths.push(result.path);
    }
    return accepted('node_test',paths);
  }
  return unsupported('This command form is not supported by the bridge; this is not a native safety refusal');
}
export function confinedCommand(title,cwd,nodePath) {
  const {code,...result}=inspectCommand(title,cwd,nodePath);
  return code==='supported'?result:null;
}
