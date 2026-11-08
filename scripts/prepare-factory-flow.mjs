// Replace only the existing Factory UI/proxy bundle and its private workspace.
// Unrelated live Support/LicenceHub modules and the compiled player are preserved.
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [baseline,out]=process.argv.slice(2);assert.ok(baseline&&out);
const original=await readFile(join(baseline,'baseline-candidate.mjs'),'utf8');
const start=original.indexOf('var LearningFactoryRelease = (() => {');
assert.ok(start>0);assert.equal(original.indexOf('var LearningFactoryRelease = (() => {',start+1),-1);
const end=original.indexOf('\n})();',start)+7;assert.ok(end>start);
const built=await build({stdin:{contents:"export {learningStudioResponse} from './learning-studio.js'; export {universalStudioResponse} from './universal-studio.js'; export {gameStudioProxy} from './game-studio-proxy.js';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'LearningFactoryRelease',platform:'browser',target:'es2022',write:false});
const updated=original.slice(0,start)+built.outputFiles[0].text.trimEnd()+original.slice(end);
const sha=x=>createHash('sha256').update(x).digest('hex');
await mkdir(out,{recursive:true});await writeFile(join(out,'candidate.mjs'),updated);
await copyFile(join(baseline,'baseline-factory-preview.js'),join(out,'factory-preview.js'));
await copyFile('factory-workspace.generated.js',join(out,'factory-workspace.generated.js'));
const manifest={baseline:sha(original),candidate:sha(updated),factoryBundle:sha(built.outputFiles[0].contents),preservedBeforeFactory:sha(original.slice(0,start)),preservedAfterFactory:sha(original.slice(end)),workspace:sha(await readFile('factory-workspace.generated.js')),changes:['One guided engine-aware creation workspace','Scoped Klik educational content generation','Contextual Nano Banana and ElevenLabs review and attachment','Independent levels, stages and weeks']};
await writeFile(join(out,'source-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
