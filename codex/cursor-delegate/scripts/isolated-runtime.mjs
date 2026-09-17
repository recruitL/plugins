// Opt-in runtime. Official Cursor protocol/authentication remains in Cursor.
// Only user-level server configuration can select this launcher; tools cannot.
import {mkdirSync,lstatSync,realpathSync,existsSync,writeFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import net from 'node:net';
import {isolatedCursorLaunch} from './isolated-launch.mjs';
import {createLoginHandoff} from './login-handoff.mjs';

function directory(parent,name) {
  const path=join(parent,name);
  try {mkdirSync(path);} catch(e) {if(e.code!=='EEXIST')throw e;}
  if(!lstatSync(path).isDirectory()||realpathSync(path)!==path)throw new Error('Symlinked runtime directory');
  return path;
}
function createOnce(path,content) {
  if(existsSync(path))throw new Error('Runtime already prepared; use a fresh authorized test directory');
  writeFileSync(path,content,{flag:'wx',mode:0o600});
}
export class IsolatedRuntime {
  constructor({codexPath,networkEnabled=false}={}) {
    if(!isAbsolute(codexPath??''))throw new Error('Absolute Codex sandbox executable required');
    this.codexPath=realpathSync(codexPath);this.networkEnabled=networkEnabled;
  }
  async prepare({workspace,agentPath}) {
    const launch=isolatedCursorLaunch({codexPath:this.codexPath,workspace,agentPath});
    const root=launch.cwd;
    // Deliberately refuse an existing configuration rather than silently replacing it.
    directory(root,'.cursor');
    for(const name of ['data','cache','tmp'])directory(root,name);
    // Native login updates privacy/model preferences. Keep this disposable config
    // writable inside the confined cache; it is NOT the security boundary.
    // Original project .cursor and outer permission-profile files stay read-only.
    const config=directory(join(root,'cache'),'cli');
    const protectedRoot=directory(root,'.codex');
    const codexHome=directory(protectedRoot,'outer-runtime');
    createOnce(join(config,'cli-config.json'),JSON.stringify({version:1,editor:{vimMode:false},permissions:{allow:[],deny:[]}})+'\n');
    const node=launch.args[launch.args.indexOf('--')+1];
    const handoff=createLoginHandoff({workspace:root,nodePath:node,timeoutMs:30000});
    Object.assign(launch.env,handoff.env,{AGENT_CLI_CREDENTIAL_STORE:'memory',
      PATH:handoff.bin+':'+node.slice(0,node.lastIndexOf('/'))+':/usr/bin:/bin',CODEX_HOME:codexHome,CURSOR_CONFIG_DIR:config});
    try {
      if(this.networkEnabled) {
        const reservation=net.createServer();
        await new Promise((ok,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',ok)});
        const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));
        const proxy='http://127.0.0.1:'+port,q=JSON.stringify;
        const fsRules=launch.state.permissionProfile.file_system.entries.map(entry=>{
          const p=entry.path;return q(p.type==='special'?':minimal':p.type==='path'?p.path:p.pattern)+' = '+q(entry.access);
        }).join('\n');
        const settings='enabled = true\nallow_upstream_proxy = false\nenable_socks5 = false\nenable_socks5_udp = false\nproxy_url = '+q(proxy)+'\n';
        // No ambient proxy, local-network access, wildcard domains or model-specific endpoint.
        // api2.cursor.sh is the installed official build's authentication/backend default.
        const toml='[features.network_proxy]\n'+settings+'[permissions.cursor.filesystem]\n'+fsRules+'\n[permissions.cursor.network]\n'+settings+'mode = "limited"\nallow_local_binding = false\n[permissions.cursor.network.domains]\n"api2.cursor.sh" = "allow"\n';
        createOnce(join(codexHome,'config.toml'),toml);
        launch.args=['sandbox','-P','cursor','-C',root,'--include-managed-config','--',...launch.args.slice(launch.args.indexOf('--')+1)];
      }
      return {...launch,handoff,confinedCommands:true,nodePath:node,network:this.networkEnabled?'native proxy: api2.cursor.sh only':'denied',
        cancel:()=>handoff.cancel()};
    } catch(error) {handoff.cancel();throw error;}
  }
}
