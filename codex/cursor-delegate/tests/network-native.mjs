// Opt-in native proxy boundary test. Loopback traffic only; no Cursor or credentials.
// Explicit http.Agent prevents injected proxy settings from double-proxying the probe.
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
const [parent,codexPath]=process.argv.slice(2);
if(!parent||!codexPath)throw new Error('Usage: node tests/network-native.mjs DEDICATED_TEST_PARENT CODEX_BINARY');
const base=mkdtempSync(join(realpathSync(parent),'net-'));
const workspace=join(base,'workspace'),config=join(base,'codex');mkdirSync(workspace);mkdirSync(config);
let requests=0;
const origin=http.createServer((req,res)=>{requests++;res.end('LOCAL_CANARY')});
await new Promise((ok,fail)=>{origin.once('error',fail);origin.listen(0,'127.0.0.1',ok)});
const originPort=origin.address().port;
const reservation=net.createServer();await new Promise(ok=>reservation.listen(0,'127.0.0.1',ok));
// Fail on a port collision; do not retry or replace an existing listener.
const proxyPort=reservation.address().port;await new Promise(ok=>reservation.close(ok));
const q=JSON.stringify;
const fsEntries={':minimal':'read',[realpathSync(process.execPath)]:'read','/System/Library/OpenSSL':'read',[workspace]:'write',[config]:'deny','/tmp/**':'deny','/private/tmp/**':'deny','/var/tmp/**':'deny','/private/var/tmp/**':'deny'};
const toml='[features.network_proxy]\nenabled = true\nallow_upstream_proxy = false\nenable_socks5 = false\nenable_socks5_udp = false\nproxy_url = '+q('http://127.0.0.1:'+proxyPort)+'\n[permissions.probe.filesystem]\n'+Object.entries(fsEntries).map(([k,v])=>q(k)+' = '+q(v)).join('\n')+'\n[permissions.probe.network]\nenabled = true\nmode = "limited"\nallow_local_binding = false\nallow_upstream_proxy = false\nenable_socks5 = false\nenable_socks5_udp = false\nproxy_url = '+q('http://127.0.0.1:'+proxyPort)+'\n[permissions.probe.network.domains]\n"127.0.0.1" = "allow"\n"localhost" = "deny"\n';
writeFileSync(join(config,'config.toml'),toml);
const code=`import http from 'node:http';import net from 'node:net';
const port=Number(process.argv[2]);const proxy=process.env.HTTP_PROXY||process.env.http_proxy;const checks={proxy_environment_present:!!proxy};
async function request(url){if(!proxy)return {status:0}; const p=new URL(proxy);return await new Promise(ok=>{const r=http.get({hostname:p.hostname,port:p.port,path:url,agent:new http.Agent(),headers:{Host:new URL(url).host}},res=>{let body='';res.on('data',b=>{body+=b});res.on('end',()=>ok({status:res.statusCode,canary:body==='LOCAL_CANARY',diagnostic:res.statusCode===200?null:body.slice(0,600)}))});r.setTimeout(3000,()=>r.destroy());r.on('error',e=>ok({status:0,error:e.code}))})}
const a=await request('http://127.0.0.1:'+port+'/canary');checks.allowed_origin=a.status===200&&a.canary;
const d=await request('http://127.0.0.2:'+port+'/canary');checks.unlisted_origin_denied=d.status===403;const explicit=await request('http://localhost:'+port+'/canary');checks.explicit_domain_denied=explicit.status===403&&JSON.parse(explicit.diagnostic??'{}').reason==='denied';
checks.direct_socket_denied=await new Promise(ok=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(2000,()=>{s.destroy();ok(false)});s.on('connect',()=>{s.destroy();ok(false)});s.on('error',e=>ok(['EPERM','EACCES'].includes(e.code)))});
console.log(JSON.stringify({checks,allowed:a,denied:d,explicit}));process.exit(Object.values(checks).every(Boolean)?0:1);`;
const childPath=join(workspace,'probe.mjs');writeFileSync(childPath,code);
const child=spawn(realpathSync(codexPath),['sandbox','-P','probe','-C',workspace,'--include-managed-config','--',realpathSync(process.execPath),childPath,String(originPort)],{cwd:workspace,detached:true,env:{HOME:base,CODEX_HOME:config,PATH:'/usr/bin:/bin',TMPDIR:workspace},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',timedOut=false;
child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL')}catch{}},15000);
const result=await new Promise(ok=>{child.once('error',()=>ok({spawn_error:true}));child.once('close',(code,signal)=>ok({code,signal}))});clearTimeout(timer);
await new Promise(ok=>origin.close(ok));
let observed;try{observed=JSON.parse(stdout.trim())}catch{observed=null}
const receipt={kind:'native Codex managed network proxy; localhost canary only; no Cursor or credentials',base,...result,timedOut,requests,observed,stderr};
writeFileSync(join(base,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
process.exitCode=result.code===0&&requests===1?0:1;
