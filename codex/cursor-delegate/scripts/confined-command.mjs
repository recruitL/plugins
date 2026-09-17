// This recognizes only ordinary operations already contained by an explicit OS
// profile. It never authorizes an expanded filesystem/network scope or approval
// setting. Codex must still review each proposed operation and its input files.
import {realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
export function confinedCommand(title,cwd,nodePath) {
  if(typeof title!=='string'||title.length>4096)return null;
  let command=title.trim();
  if(command.startsWith('`')&&command.endsWith('`'))command=command.slice(1,-1);
  if(/[;&|<>$`\\\r\n*?\[\]{}!~()#]/.test(command))return null;
  const words=[];let rest=command;
  while(rest.trim()) {
    const m=/^[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"']+))(?=\s|$)/.exec(rest);
    if(!m)return null;words.push(m[1]??m[2]??m[3]);rest=rest.slice(m[0].length);
  }
  function inside(path,file=false) {
    try {
      if(!path||path.split('/').includes('..'))return null;
      const target=realpathSync(resolve(cwd,path)),rel=relative(cwd,target);
      if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))return null;
      if(file&&!statSync(target).isFile())return null;
      return target;
    } catch {return null;}
  }
  if(words.length===1&&words[0]==='pwd')return {command,operation:'read',paths:[cwd]};
  if(words[0]==='ls') {
    const paths=[];
    for(const arg of words.slice(1)) {
      if(/^-[aldh1]+$/.test(arg))continue;
      if(arg.startsWith('-'))return null;
      const path=inside(arg);if(!path)return null;paths.push(path);
    }
    return {command,operation:'read',paths:paths.length?paths:[cwd]};
  }
  if((words[0]==='node'||words[0]===nodePath)&&words[1]==='--test'&&words.length>=3&&words.length<=10) {
    const paths=[];
    for(const arg of words.slice(2)) {
      if(arg.startsWith('-')||!arg.match(/\.test\.(mjs|cjs|js)$/))return null;
      const path=inside(arg,true);if(!path)return null;paths.push(path);
    }
    return {command,operation:'node_test',paths};
  }
  return null;
}
