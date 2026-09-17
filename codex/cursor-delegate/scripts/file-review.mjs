import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
const fail=(code,message)=>({code,message});
export function reviewPath(path,cwd,{write=false}={}) {
  if(typeof path!=='string'||!path||path.includes('\0'))return fail('bridge_unsupported','Missing file path');
  const root=realpathSync(cwd),target=resolve(root,path);
  const outside=p=>{const r=relative(root,p);return r==='..'||r.startsWith('../')||isAbsolute(r);};
  if(outside(target))return fail('authorization_required','Operation is outside the authorized project');
  const parts=relative(root,target).split('/');
  if(parts.some(p=>['.git','.cursor','.codex','.agents','.ssh'].includes(p)||/^\.env(?:\.|$)/.test(p))||write&&parts.at(-1)==='AGENTS.md')return fail('authorization_required','Credentials, agent rules and permission configuration require human authorization');
  try {
    if(existsSync(target)) {
      if(lstatSync(target).isSymbolicLink())return fail('authorization_required','File symlinks require separate review');
      if(outside(realpathSync(target)))return fail('authorization_required','Resolved file is outside the project');
      if(lstatSync(target).size>60000)return fail('bridge_unsupported','File exceeds inline review limit');
      if(!lstatSync(target).isFile())return fail('bridge_unsupported','Expected a regular file');
    } else {
      if(!write)return fail('configuration_mismatch','Requested file does not exist');
      if(outside(realpathSync(dirname(target))))return fail('authorization_required','Resolved parent is outside the project');
    }
  } catch{return fail('configuration_mismatch','File or parent directory is unavailable');}
  return {code:'supported',path:target};
}
export function inspectFileOperation(operation,cwd) {
  if(!operation||!['read','edit'].includes(operation.kind)||!Array.isArray(operation.files)||!operation.files.length||operation.files.length>16)return fail('bridge_unsupported','A complete read or edit operation is required');
  for(const file of operation.files) {
    const result=reviewPath(file.path,cwd,{write:operation.kind==='edit'});if(result.code!=='supported')return result;
    if(operation.kind==='edit') {
      if(typeof file.newText!=='string'||!(file.oldText===null||typeof file.oldText==='string'))return fail('bridge_unsupported','Complete before/after text is required');
      const current=existsSync(result.path)?readFileSync(result.path,'utf8'):null;
      if(current!==file.oldText)return fail('configuration_mismatch','File changed since the proposed edit; read it again before approval');
    }
  }
  return {code:'supported',operation:operation.kind,paths:operation.files.map(f=>resolve(cwd,f.path))};
}
export function nativeFileOperation(tool) {
  if(tool?.kind==='edit'&&Array.isArray(tool.content)&&tool.content.length&&tool.content.every(x=>x.type==='diff'))return {kind:'edit',files:tool.content.map(({path,oldText,newText})=>({path,oldText,newText}))};
  if(tool?.kind==='read'&&Array.isArray(tool.locations)&&tool.locations.length)return {kind:'read',files:tool.locations.map(({path})=>({path}))};
  return null;
}
export function hookFileOperation(event,cwd) {
  const input=event.tool_input;
  if(!input||typeof input!=='object')return null;
  const path=input.path??input.file_path;
  if(event.tool_name==='Read')return {kind:'read',files:[{path}]};
  if(['Write','Edit','StrReplace'].includes(event.tool_name)) {
    const checked=reviewPath(path,cwd,{write:true});if(checked.code!=='supported')return {kind:'edit',files:[{path}],blocked:checked};
    const before=existsSync(checked.path)?readFileSync(checked.path,'utf8'):null;
    let after=input.contents??input.content??input.file_text;
    if(typeof after!=='string'&&typeof input.old_string==='string'&&typeof input.new_string==='string'&&before!==null) {
      if(!input.old_string||!before.includes(input.old_string))return null;
      if(!input.replace_all&&before.indexOf(input.old_string)!==before.lastIndexOf(input.old_string))return null;
      after=input.replace_all?before.split(input.old_string).join(input.new_string):before.replace(input.old_string,()=>input.new_string);
    }
    return {kind:'edit',files:[{path:checked.path,oldText:before,newText:after}]};
  }
  return null;
}
