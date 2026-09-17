import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {prepare} from '../scripts/prepare-upstream-install.mjs';

test('preparation refuses ambiguous paths and never overwrites an existing destination',t=>{
 const base=mkdtempSync(join(tmpdir(),'cursor-package-input-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const destination=join(base,'cursor-delegate');mkdirSync(destination);writeFileSync(join(destination,'sentinel'),'original');
 const args={workspace:base,upstream:base,agent:process.execPath,destination};
 assert.throws(()=>prepare({...args,workspace:'.'}),/absolute/);
 assert.throws(()=>prepare(args),/Destination exists/);
 assert.equal(readFileSync(join(destination,'sentinel'),'utf8'),'original');
});

test('prepared package loads the pinned real upstream MCP without starting Cursor',{
 skip:!process.env.CURSOR_PACKAGE_TEST_UPSTREAM,timeout:15000
},async t=>{
 const base=mkdtempSync(join(tmpdir(),'cursor-package-mcp-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const workspace=join(base,'project');mkdirSync(workspace);
 const marker=join(base,'unexpected-cli-execution');const agent=join(base,'fake-agent');
 writeFileSync(agent,'#!/bin/sh\ntouch '+JSON.stringify(marker)+'\nexit 99\n',{mode:0o700});
 const destination=join(base,'cursor-delegate');
 const prepared=prepare({workspace,upstream:process.env.CURSOR_PACKAGE_TEST_UPSTREAM,agent,destination});
 assert.equal(prepared.installed,false);assert.equal(prepared.cursor_started,false);
 assert.equal(existsSync(join(destination,'scripts/server.mjs')),false);
 const config=JSON.parse(readFileSync(join(destination,'.mcp.json'),'utf8')).mcpServers['cursor-delegate'];
 assert.deepEqual(config.args,['scripts/upstream-entry.mjs']);
 for(const key of ['CURSOR_CONFIG_DIR','CURSOR_DATA_DIR','TMPDIR'])assert.ok(config.env[key].startsWith(prepared.workspace+'/'));
 assert.ok(existsSync(config.env.TMPDIR));
 const child=spawn(config.command,config.args,{cwd:destination,env:{PATH:process.env.PATH,HOME:base,...config.env},stdio:['pipe','pipe','pipe']});
 const exited=once(child,'exit');let stderr='';child.stderr.on('data',d=>{stderr+=d});t.after(()=>child.kill());
 let id=0;const pending=new Map();
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{const m=JSON.parse(line);const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m)}});
 child.on('exit',()=>{for(const p of pending.values())p.reject(Error('MCP exited before reply: '+stderr));pending.clear()});
 function call(method,params){const n=++id;return new Promise((resolve,reject)=>{pending.set(n,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n')})}
 const init=await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'package-test',version:'1'}});assert.equal(init.result.serverInfo.name,'cursor-subagent');
 const listed=await call('tools/list',{});const tools=listed.result.tools;
 assert.equal(tools.length,14);assert.ok(tools.some(x=>x.name==='cursor_start_session'));assert.ok(!tools.some(x=>x.name==='cursor_start'));
 const skill=readFileSync(join(destination,'skills/cursor-delegate/SKILL.md'),'utf8');
 for(const name of new Set(skill.match(/cursor_[a-z_]+/g)))if(name!=='cursor_session_id')assert.ok(tools.some(x=>x.name===name),'Skill mentions undiscovered tool '+name);
 const spoof=await call('tools/call',{name:'cursor_answer_permission',arguments:{session_id:'missing',turn_id:'t',request_id:'p',decision:'allow-once',reason:'approved',user_approved:true}});assert.equal(spoof.result.isError,true);
 const outside=await call('tools/call',{name:'cursor_start_session',arguments:{cwd:base,mode:'agent'}});assert.equal(outside.result.isError,true);assert.match(outside.result.content[0].text,/outside allowed roots/);
 child.stdin.end();const [code]=await exited;assert.equal(code,0,stderr);assert.equal(existsSync(marker),false);
});
