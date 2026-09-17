import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/prepare-upstream-install.mjs',import.meta.url));
function run(args=[],cwd){
 return spawnSync(process.execPath,[script,...args],{encoding:'utf8',cwd});
}
function assertCleanFailure(r){
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/./);
 assert.doesNotMatch(r.stderr,/\n\s+at /);
 assert.doesNotMatch(r.stdout,/\n\s+at /);
}
function listing(dir){
 return readdirSync(dir,{withFileTypes:true}).map(e=>e.isDirectory()?'d:'+e.name:'f:'+e.name).sort();
}

test('standalone --help exits 0 with usage and leaves cwd unchanged',t=>{
 const base=mkdtempSync(join(tmpdir(),'prepare-cli-help-'));
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const before=listing(base);
 const r=run(['--help'],base);
 assert.equal(r.status,0);
 assert.match(r.stdout,/^Usage: node scripts\/prepare-upstream-install\.mjs /);
 assert.equal(r.stderr,'');
 assert.deepEqual(listing(base),before);
});

test('standalone -h exits 0 with the same usage text',()=>{
 const r=run(['-h']);
 assert.equal(r.status,0);
 assert.match(r.stdout,/^Usage: node scripts\/prepare-upstream-install\.mjs /);
 assert.equal(r.stderr,'');
});

test('no arguments exits non-zero with a concise usage error',()=>{
 const r=run();
 assertCleanFailure(r);
 assert.match(r.stderr,/^Usage: node scripts\/prepare-upstream-install\.mjs /);
});

test('wrong argument counts exit non-zero without a stack',()=>{
 for(const args of [
  ['/tmp/workspace'],
  ['/tmp/workspace','/tmp/upstream'],
  ['/tmp/workspace','/tmp/upstream',process.execPath],
  ['/tmp/workspace','/tmp/upstream',process.execPath,'/tmp/parent/cursor-delegate','extra'],
 ]){
  const r=run(args);
  assertCleanFailure(r);
  assert.match(r.stderr,/^Usage: /);
 }
});

test('help mixed with extra args exits non-zero with usage',()=>{
 for(const args of [
  ['--help','extra'],
  ['-h','extra'],
  ['--help','/tmp/workspace','/tmp/upstream',process.execPath,'/tmp/parent/cursor-delegate'],
 ]){
  const r=run(args);
  assertCleanFailure(r);
  assert.match(r.stderr,/^Usage: /);
  assert.equal(r.stdout,'');
 }
});

test('help embedded among four positionals is not treated as success',()=>{
 for(const args of [
  ['/tmp/workspace','/tmp/upstream',process.execPath,'--help'],
  ['/tmp/workspace','--help',process.execPath,'/tmp/parent/cursor-delegate'],
 ]){
  const r=run(args);
  assertCleanFailure(r);
  assert.doesNotMatch(r.stdout,/^Usage:/);
  assert.match(r.stderr,/must be an absolute path/);
 }
});

test('prepare validation failure exits non-zero without a stack',t=>{
 const base=mkdtempSync(join(tmpdir(),'prepare-cli-fail-'));
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const destination=join(base,'cursor-delegate');
 mkdirSync(destination);
 const r=run([base,base,process.execPath,destination]);
 assertCleanFailure(r);
 assert.match(r.stderr,/Destination exists/);
 assert.doesNotMatch(r.stderr,/at prepare/);
});
