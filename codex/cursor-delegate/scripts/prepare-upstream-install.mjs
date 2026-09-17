// Prepare a reviewable package plus in-project runtime directories. No Cursor process or host configuration changes.
import {cpSync,existsSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isAbsolute,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
export const UPSTREAM_REVISION='ce257353ecae9061fe45d084cb80e2d0c46207cd';
export function prepare({workspace,upstream,agent,destination,node=process.execPath}) {
  for(const [name,path] of Object.entries({workspace,upstream,agent,destination,node})) {
    if(typeof path!=='string'||!isAbsolute(path))throw Error(`${name} must be an absolute path`);
  }
  if(basename(destination)!=='cursor-delegate')throw Error('Destination folder must be named cursor-delegate');
  if(existsSync(destination))throw Error('Destination exists; prepare into a new directory, never overwrite an installed plugin');
  const root=realpathSync(workspace), checkout=realpathSync(upstream), binary=realpathSync(agent);
  if(!statSync(root).isDirectory()||!statSync(checkout).isDirectory()||!statSync(binary).isFile())throw Error('Invalid workspace, checkout or CLI');
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:checkout,encoding:'utf8',timeout:5000}).trim();
  if(git('rev-parse','HEAD')!==UPSTREAM_REVISION||git('status','--porcelain','--untracked-files=no'))throw Error('Use the pinned, unmodified upstream checkout');
  const source=fileURLToPath(new URL('../',import.meta.url));
  mkdirSync(join(destination,'scripts'),{recursive:true,mode:0o700});
  for(const name of ['config','data','tmp'])mkdirSync(join(root,name),{recursive:true,mode:0o700});
  for(const name of ['upstream-entry.mjs','upstream-policy.mjs','confined-command.mjs'])cpSync(join(source,'scripts',name),join(destination,'scripts',name));
  for(const name of ['.codex-plugin','skills','README.md','UPSTREAM-REUSE.md','VERIFICATION.md'])cpSync(join(source,name),join(destination,name),{recursive:true});
  const config={mcpServers:{'cursor-delegate':{command:realpathSync(node),cwd:'.',args:['scripts/upstream-entry.mjs'],env:{
    CURSOR_SUBAGENT_UPSTREAM:checkout,CURSOR_SUBAGENT_ALLOWED_ROOTS:JSON.stringify([root]),CURSOR_AGENT_COMMAND:binary,
    CURSOR_CONFIG_DIR:join(root,'config'),CURSOR_DATA_DIR:join(root,'data'),TMPDIR:join(root,'tmp')
  }}}};
  writeFileSync(join(destination,'.mcp.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  const manifest=JSON.parse(readFileSync(join(destination,'.codex-plugin/plugin.json'),'utf8'));
  if(manifest.name!=='cursor-delegate')throw Error('Unexpected plugin identifier');
  return {destination,workspace:root,upstream_revision:UPSTREAM_REVISION,installed:false,cursor_started:false};
}
const USAGE='Usage: node scripts/prepare-upstream-install.mjs ABS_WORKSPACE ABS_UPSTREAM ABS_CURSOR_CLI ABS_NEW_PARENT/cursor-delegate';
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])) {
  const args=process.argv.slice(2);
  try {
    if(args.length===1&&(args[0]==='--help'||args[0]==='-h')){console.log(USAGE);process.exitCode=0;}
    else {
      const [workspace,upstream,agent,destination,...extra]=args;
      if(extra.length||!destination)throw Error(USAGE);
      console.log(JSON.stringify(prepare({workspace,upstream,agent,destination}),null,2));
    }
  } catch(error) {
    console.error(error instanceof Error?error.message:String(error));
    process.exitCode=1;
  }
}
