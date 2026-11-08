// Add pinned local emoji fallbacks to the existing Flutter preview build.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'');
assert.ok(process.argv[2],'Usage: node scripts/package-factory-player.mjs FLUTTER_BUILD_WEB');
assert.match(await readFile(root+'/index.html','utf8'),/\/factory-preview\//);
await readFile(root+'/main.dart.js');
const sources=JSON.parse(await readFile(new URL('../factory-preview-fonts.json',import.meta.url)));
for(const entry of sources){
 const target=resolve(root,'preview-fonts',entry.file);
 assert.ok(target.startsWith(root+'/preview-fonts/'));
 let bytes;try{bytes=await readFile(target);}catch{
  const response=await fetch(entry.source,{redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,'Font download failed: '+entry.file);bytes=Buffer.from(await response.arrayBuffer());
 }
 assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,'Font changed: '+entry.file);
 await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
}
console.log('Verified local preview fonts and licence:',sources.length);
