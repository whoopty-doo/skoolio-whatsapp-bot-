import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('Factory release replacement preserves adjoining live code with and without a newline',()=>{
 const root=mkdtempSync(join(tmpdir(),'factory-release-boundary-'));
 try{
  for(const separator of ['','\n']){
   const before='// Unrelated live module\nconst beforeFactory=1;\n',after=separator+'var supportSentinel="PRESERVE";\nexport {supportSentinel};\n';
   writeFileSync(join(root,'baseline-candidate.mjs'),before+'var LearningFactoryRelease = (() => {\nreturn {};\n})();'+after);
   writeFileSync(join(root,'baseline-factory-preview.js'),'export const previewSentinel=true;\n');
   execFileSync(process.execPath,['scripts/prepare-factory-flow.mjs',root,join(root,'release')],{stdio:'pipe'});
   const result=readFileSync(join(root,'release/candidate.mjs'),'utf8');
   assert.ok(result.startsWith(before));assert.ok(result.endsWith(after));
   execFileSync(process.execPath,['--check',join(root,'release/candidate.mjs')],{stdio:'pipe'});
   assert.equal(readFileSync(join(root,'release/factory-preview.js'),'utf8'),'export const previewSentinel=true;\n');
   assert.equal(readFileSync(join(root,'release/factory-workspace.generated.js'),'utf8'),readFileSync('factory-workspace.generated.js','utf8'));
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
