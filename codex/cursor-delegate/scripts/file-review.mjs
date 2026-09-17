import {existsSync,lstatSync,readFileSync,realpathSync,statSync,openSync,readSync,closeSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
// Local materialization and transport are separate from the much smaller review.
export const FILE_BYTES=256*1024, REVIEW_BYTES=16000, WIRE_BYTES=2*1024*1024;
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
      if(lstatSync(target).isSymbolicLink()||outside(realpathSync(target)))return fail('authorization_required','File symlinks or resolved paths require separate review');
      if(!lstatSync(target).isFile())return fail('bridge_unsupported','Expected a regular file');
    } else {
      if(!write)return fail('configuration_mismatch','Requested file does not exist');
      if(outside(realpathSync(dirname(target))))return fail('authorization_required','Resolved parent is outside the project');
    }
  } catch{return fail('configuration_mismatch','File or parent directory is unavailable');}
  return {code:'supported',path:target};
}
function textAt(path){
  if(!existsSync(path))return null;
  if(lstatSync(path).size>FILE_BYTES)throw new Error('capacity_limit: local text materialization supports up to 256 KiB; split the source module before maintenance');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path));
  if(text.includes('\0'))throw new Error('bridge_unsupported: binary text is not supported');
  return text;
}
function snapshot(path){const s=statSync(path,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function readWindow(path,offset,limit){
  const fd=openSync(path,'r'),chunk=Buffer.alloc(65536);let tail=Buffer.alloc(0),line=0,total=0,selected=[];
  try{for(;;){const n=readSync(fd,chunk);total+=n;if(total>32*1024*1024)throw new Error('capacity_limit: locating this range exceeds 32 MiB scan budget');tail=Buffer.concat([tail,chunk.subarray(0,n)]);let end;
    while((end=tail.indexOf(10))!==-1){if(line>=offset)selected.push(tail.subarray(0,end+1));tail=tail.subarray(end+1);line++;if(line>=offset+limit)return decode(selected);}
    if(tail.length>REVIEW_BYTES)throw new Error('capacity_limit: a source line exceeds the inline range budget');
    if(!n){if(line>=offset&&tail.length)selected.push(tail);if(offset>0&&!selected.length)throw new Error('range_required: offset is beyond EOF; choose an existing line (native Read may otherwise fall back to the whole file)');return decode(selected);}
    if(selected.reduce((n,b)=>n+b.length,0)>REVIEW_BYTES)throw new Error('capacity_limit: request fewer read lines');
  }}finally{closeSync(fd);}
}
function decode(parts){const b=Buffer.concat(parts);if(b.length>REVIEW_BYTES)throw new Error('capacity_limit: request fewer read lines');const t=new TextDecoder('utf-8',{fatal:true}).decode(b);if(t.includes('\0'))throw new Error('bridge_unsupported: binary reads are not supported');return t;}
export function inspectFileOperation(operation,cwd) {
  if(!operation||!['read','edit'].includes(operation.kind)||!Array.isArray(operation.files)||!operation.files.length||operation.files.length>16)return fail('bridge_unsupported','A complete read or edit operation is required');
  for(const file of operation.files) {
    const result=reviewPath(file.path,cwd,{write:operation.kind==='edit'});if(result.code!=='supported')return result;
    try {
      const current=operation.kind==='edit'?textAt(result.path):undefined;
      if(operation.kind==='edit') {
        if(typeof file.newText!=='string'||!(file.oldText===null||typeof file.oldText==='string'))return fail('bridge_unsupported','Complete before/after state is required privately');
        if(Buffer.byteLength(file.newText)>FILE_BYTES)return fail('capacity_limit','Proposed source exceeds 256 KiB local materialization limit');
        if(file.newText.includes('\0'))return fail('bridge_unsupported','Binary edits are not supported');
        if(current!==file.oldText)return fail('configuration_mismatch','File changed since the proposed edit; read it again and regenerate the change');
      } else if(file.snapshot!==undefined&&snapshot(result.path)!==file.snapshot)return fail('configuration_mismatch','File changed while its read was awaiting review; request a fresh range');
      else if(file.before!==undefined&&textAt(result.path)!==file.before)return fail('configuration_mismatch','File changed while its read was awaiting review; request a fresh range');
    }catch(error){const [code,...message]=error.message.split(':');return fail(['capacity_limit','bridge_unsupported'].includes(code)?code:'configuration_mismatch',message.join(':')||error.message);}
  }
  return {code:'supported',operation:operation.kind,paths:operation.files.map(f=>resolve(cwd,f.path))};
}
// Complete changed span with three lines of unchanged context; never truncates.
// Distant changes exceeding the review budget must be split into smaller writes.
function changeContext(before,after){
  const a=(before??'').split('\n'),b=after.split('\n');let first=0,tail=0;
  while(first<a.length&&first<b.length&&a[first]===b[first])first++;
  while(tail<a.length-first&&tail<b.length-first&&a[a.length-1-tail]===b[b.length-1-tail])tail++;
  const start=Math.max(0,first-3),oldEnd=Math.min(a.length,a.length-tail+3),newEnd=Math.min(b.length,b.length-tail+3);
  return {start_line:start+1,old_end_line:oldEnd,new_end_line:newEnd,changed_old_start:first+1,changed_old_lines:a.length-tail-first,changed_new_lines:b.length-tail-first,old_text:a.slice(start,oldEnd).join('\n'),new_text:b.slice(start,newEnd).join('\n'),complete_change:true};
}
export function describeFileOperation(operation,cwd){
  const checked=inspectFileOperation(operation,cwd);if(checked.code!=='supported')return {review:checked};
  const files=[];
  for(const file of operation.files){
    const path=resolve(cwd,file.path),before=operation.kind==='edit'?file.oldText:null;
    if(operation.kind==='edit')files.push({path,file_bytes:Buffer.byteLength(before??''),new_file_bytes:Buffer.byteLength(file.newText),change:changeContext(before,file.newText)});
    else {
      const fileBytes=lstatSync(path).size,ranged=file.offset!==undefined||file.limit!==undefined;
      if(ranged&&(!Number.isInteger(file.offset??0)||(file.offset??0)<0||!Number.isInteger(file.limit)||file.limit<1))return {review:fail('range_required','Read requires a non-negative offset and positive explicit limit')};
      if(!ranged&&fileBytes>REVIEW_BYTES)return {review:fail('range_required','Request Read with explicit offset and limit (for example 0 and 60); CLI must announce that range')};
      if(file.editPreparation&&fileBytes>FILE_BYTES)return {review:fail('capacity_limit','Edit preparation exceeds the 256 KiB local edit budget; scoped reads remain available')};
      const offset=file.offset??0,limit=file.limit??Number.MAX_SAFE_INTEGER;
      let excerpt;try{excerpt=readWindow(path,offset,limit);}catch(error){return {review:fail(error.message.startsWith('capacity_limit:')?'capacity_limit':error.message.startsWith('range_required:')?'range_required':'bridge_unsupported',error.message)};}
      files.push({path,file_bytes:fileBytes,...(file.editPreparation?{
        purpose:'edit_preparation',read_scope:'whole_file',write_authorized:false,
        explanation:'Native local replacement must read the whole file internally. This preview is the previously reviewed range, not the full read. The resulting write requires a separate complete-diff review.'
      }:{read_scope:ranged?'line_range':'whole_file'}),range:{offset,limit:ranged?limit:null,start_line:offset+1},selected_bytes:Buffer.byteLength(excerpt),excerpt,complete_range:true});
    }
  }
  const context={kind:operation.kind,files};
  if(Buffer.byteLength(JSON.stringify(context))>REVIEW_BYTES)return {review:fail('capacity_limit','Requested read range or complete changed span exceeds 16 KB review budget; use fewer lines or separate local edits')};
  return {review:checked,context};
}
export function nativeFileOperation(tool) {
  if(tool?.kind==='edit'&&Array.isArray(tool.content)&&tool.content.length&&tool.content.every(x=>x.type==='diff'))return {kind:'edit',files:tool.content.map(({path,oldText,newText})=>({path,oldText,newText}))};
  if(tool?.kind==='read'&&Array.isArray(tool.locations)&&tool.locations.length)return {kind:'read',files:tool.locations.map(({path})=>({path}))};
  return null;
}
export function hookFileOperation(event,cwd) {
  const input=event.tool_input;if(!input||typeof input!=='object')return null;
  const path=input.path??input.file_path,write=['Write','Edit','StrReplace'].includes(event.tool_name);
  if(event.tool_name!=='Read'&&!write)return null;
  const checked=reviewPath(path,cwd,{write});
  if(checked.code!=='supported')return {kind:write?'edit':'read',files:[{path}],blocked:checked};
  if(!write)return {kind:'read',files:[{path:checked.path,snapshot:snapshot(checked.path),offset:input.offset,limit:input.limit}]};
  let before;
  try{before=textAt(checked.path);}catch(error){const [code,...rest]=error.message.split(':');return {kind:write?'edit':'read',files:[{path}],blocked:fail(code==='capacity_limit'?code:'bridge_unsupported',rest.join(':')||error.message)};}
  let after=input.contents??input.content??input.file_text;
  if(typeof after!=='string'&&typeof input.old_string==='string'&&typeof input.new_string==='string'&&before!==null){
    if(!input.old_string||!before.includes(input.old_string))return null;
    if(!input.replace_all&&before.indexOf(input.old_string)!==before.lastIndexOf(input.old_string))return null;
    after=input.replace_all?before.split(input.old_string).join(input.new_string):before.replace(input.old_string,()=>input.new_string);
  }
  return {kind:'edit',files:[{path:checked.path,oldText:before,newText:after}]};
}
