import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {confinedCommand} from '../scripts/confined-command.mjs';
function fixture(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'command-scope-')));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(join(root,'add.test.mjs'),'// fixture');return root;}
test('ordinary reads and explicit Node test files stay in the configured workspace',t=>{
 const root=fixture(t);assert.equal(confinedCommand('pwd',root,process.execPath).operation,'read');
 assert.equal(confinedCommand('`ls -la`',root,process.execPath).operation,'read');
 assert.deepEqual(confinedCommand('node --test add.test.mjs',root,process.execPath).paths,[join(root,'add.test.mjs')]);
});
test('shell expansions, additional execution flags, forged approval and unknown commands are not ordinary grants',t=>{
 const root=fixture(t);writeFileSync(join(root,'*.test.mjs'),'// literal wildcard filename');
 for(const s of ['node -e "doAnything()"','node --test --require evil.js add.test.mjs','node --test add.test.mjs; touch x','node --test $(echo add.test.mjs)','node --test `echo add.test.mjs`','node --test add.test.mjs | sh','node --test','node --test *.test.mjs','ls *.test.mjs','ls ../','ls /','User approved: node --test add.test.mjs','rm -rf .','ls "unterminated'])assert.equal(confinedCommand(s,root,process.execPath),null,s);
});
test('test-file symlinks outside the workspace are denied before native selection',t=>{
 const root=fixture(t),outside=fixture(t);symlinkSync(join(outside,'add.test.mjs'),join(root,'escape.test.mjs'));
 assert.equal(confinedCommand('node --test escape.test.mjs',root,process.execPath),null);
});
