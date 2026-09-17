import test from 'node:test';
import assert from 'node:assert/strict';
import {IsolatedRuntime} from '../scripts/isolated-runtime.mjs';
test('HTTP writes remain disabled by default; only an exact user-level setting selects full methods',()=>{
 const args={codexPath:process.execPath,networkEnabled:true};
 assert.equal(new IsolatedRuntime(args).networkMode,'limited');
 assert.equal(new IsolatedRuntime({...args,networkMode:'full'}).networkMode,'full');
 for(const networkMode of ['approved',true,'FULL','all','',null]) assert.throws(()=>new IsolatedRuntime({...args,networkMode}),/Invalid API HTTP mode/);
});
