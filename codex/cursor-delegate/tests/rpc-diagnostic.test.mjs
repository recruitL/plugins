import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcDiagnostic} from '../scripts/rpc-diagnostic.mjs';
test('diagnostics use fixed labels, not raw errors, URLs, paths or secrets',()=>{
 const error={code:-32603,message:'Internal error',data:{message:'ENOENT: SECRET_PATH bearer SECRET_TOKEN',cause:{message:'UNABLE_TO_VERIFY_LEAF_SIGNATURE https://secret.test/?verifier=SECRET'}}};
 assert.deepEqual(rpcDiagnostic(error,'authenticate'),{method:'authenticate',code:-32603,signals:['ENOENT','UNABLE_TO_VERIFY_LEAF_SIGNATURE'],detail_withheld:true});
 assert.doesNotMatch(JSON.stringify(rpcDiagnostic(error,'SECRET_METHOD')),/SECRET|secret\.test/);
});
test('unknown errors stay unclassified and nested cyclic provider data stays bounded',()=>{
 const e={message:'arbitrary private text'};e.cause=e;
 assert.deepEqual(rpcDiagnostic(e,'session/new'),{method:'session/new',code:null,signals:[],detail_withheld:true});
});

test('method-policy diagnostics distinguish HTTP denial without exposing raw provider text',()=>{
 assert.deepEqual(rpcDiagnostic({code:-32603,data:{details:'[permission_denied] HTTP 403 SECRET'}},'authenticate').signals,['http_403','permission_denied']);
 assert.deepEqual(rpcDiagnostic({data:'Method not allowed in limited mode.'},'authenticate').signals,['method_policy_denied']);
});
