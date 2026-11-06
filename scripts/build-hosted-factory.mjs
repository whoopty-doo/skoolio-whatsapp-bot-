import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
const [backend,decoder]=process.argv.slice(2);
if(!backend||!decoder)throw Error('Usage: node scripts/build-hosted-factory.mjs BACKEND_CHECKOUT JPEG_JS_MODULE');
const source=resolve(backend,'src/runtime/hostedLearningFactory.ts'),pipeline=resolve(backend,'src/services/factoryImagePipeline.ts');
const code=`import {HostedLearningFactoryCoordinator} from ${JSON.stringify(source)};
import {boundedJpegDimensions,encodeFactoryPng} from ${JSON.stringify(pipeline)};
import jpeg from ${JSON.stringify(resolve(decoder))};
export class LearningFactoryCoordinator extends HostedLearningFactoryCoordinator {
 constructor(state,env){super(state,env,async bytes=>{const size=boundedJpegDimensions(bytes);if(size.width*size.height>2359296)throw Error('Hosted image decode dimension limit');const image=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:false,tolerantDecoding:false,maxResolutionInMP:2.4,maxMemoryUsageInMB:48});return encodeFactoryPng(image.width,image.height,Buffer.from(image.data),3);});}
}`;
const result=await build({stdin:{contents:code,resolveDir:process.cwd(),sourcefile:'hosted-factory-entry.js'},bundle:true,platform:'node',format:'esm',target:'es2022',write:false,metafile:true,plugins:[{name:'node-schemes',setup(b){b.onResolve({filter:/.*/},args=>builtinModules.includes(args.path)?{path:args.path.startsWith('node:')?args.path:'node:'+args.path,external:true}:undefined);}}]});
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=Object.keys(result.metafile.inputs).filter(p=>p!=='hosted-factory-entry.js');
if(files.some(p=>/firebase-admin|config\/firebase|config\/env|tools\/testing|MockProviders/.test(p)))throw Error('Unexpected production/test dependency in isolated workspace');
const output='// Generated from the existing backend workspace; use scripts/build-hosted-factory.mjs.\nimport {Buffer} from "node:buffer";\n'+result.outputFiles[0].text;
writeFileSync('factory-workspace.generated.js',output);
writeFileSync('factory-workspace.manifest.json',JSON.stringify({sha256:sha(output),decoder:'jpeg-js@0.4.4',inputs:Object.fromEntries(files.map(p=>[p.includes('/backend/')?p.split('/backend/')[1]:p.includes('/tooling/')?'tooling/'+p.split('/tooling/')[1]:p,sha(readFileSync(p))]))},null,2)+'\n');
console.log(JSON.stringify({bytes:output.length,inputs:files.length,sha256:sha(output)}));
