// Explicit isolated acceptance: real provider, local Workers runtime, synthetic
// admin assertion. Never claims owner-session or normal-app/native acceptance.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {accessHeaders,adminConfig} from '../test/helpers.js';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
if(process.env.FACTORY_LIVE_ACCEPTANCE!=='true')throw Error('Explicit FACTORY_LIVE_ACCEPTANCE=true required');
const origin=new URL(process.env.KLIK_DEV_PREVIEW_URL||'http://127.0.0.1:8808');
assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.pathname,'/');assert.ok(!origin.username&&!origin.password&&!origin.search&&!origin.hash);
const token=(await readFile(process.env.KLIK_DEV_PREVIEW_AUTH_FILE,'utf8')).match(/^KLIK_PREVIEW_AUTH=([a-f0-9]{64})\s*$/)?.[1];assert.ok(token);
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const health=await fetch(new URL('/health',origin),{headers,redirect:'error'});assert.equal(health.status,200);
const config=await health.json();assert.equal(config.temporaryPreview,true);assert.equal(config.aiConfigured,true);
const auth=await accessHeaders(),root=await mkdtemp(join(tmpdir(),'factory-live-acceptance-')),persistent=join(root,'storage'),artifact=join(root,'worker.mjs');
const built=await build({entryPoints:['hosted-worker.js'],bundle:true,platform:'node',format:'esm',target:'es2022',write:false});await writeFile(artifact,built.outputFiles[0].text);await copyFile('factory-workspace.generated.js',join(root,'factory-workspace.generated.js'));
let calls=0;
const create=()=>new Miniflare(convertV4MiniflareOptions({modulesRoot:root,modules:[{type:'ESModule',path:artifact},{type:'ESModule',path:join(root,'factory-workspace.generated.js')}],compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],resourcePersistencePath:persistent,isolatedResourcePersistencePath:persistent,name:'isolated-live-factory-acceptance',kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},LEARNING_FACTORY_WORKSPACE:{className:'LearningFactoryCoordinator',useSQLite:true}},
 bindings:{...adminConfig,ENVIRONMENT:'production',LEARNING_FACTORY_HOSTED_ENABLED:'true',FACTORY_VISUAL_ENABLED:'true',OPENAI_MODEL:config.model,OPENAI_API_KEY:'preview-transport-marker-not-a-credential'},
 outboundService:async request=>{
  if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});
  assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.method,'POST');calls++;
  const body=await request.text();await writeFile(join(root,`provider-request-${calls}.json`),body,{mode:0o600});
  const response=await fetch(new URL('/responses',origin),{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(180000)});
  const bytes=await response.arrayBuffer();await writeFile(join(root,`provider-response-${calls}.json`),new Uint8Array(bytes),{mode:0o600});
  return new Response(bytes,{status:response.status,headers:{'Content-Type':'application/json'}});
 }
}));
let runtime=create();
const request=(path,body)=>runtime.dispatchFetch('https://example.com/api/admin/game-studio/learning'+path,{method:body?'POST':'GET',headers:{...auth.headers,Origin:'https://example.com','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const json=async response=>{const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
try{
 const catalogue=await json(await request('/catalogue'));assert.equal(catalogue.records.length,0);
 const template=catalogue.templates.find(r=>r.kind==='game').body;
 const composed=await json(await request('/compose',{version:1,action:'create',kind:'mission',brief:process.env.FACTORY_ACCEPTANCE_BRIEF||'Create a two-stage space rescue mission for Grade 2 spelling. Use the rocket engine, collect the correct letters, avoid asteroids and reach a rescue portal. Teach CAT first and SHIP next.',body:{...template,title:'New Mission',definition:{stages:[]}},levels:1,stages:2}));
 const row=composed.item;assert.equal(row.status,'DRAFT');assert.equal(row.body.definition.stages.length,2);assert.equal(row.provenance.provider,'openai:responses');assert.equal(row.provenance.model,config.model);
 const expectedEngines=process.env.FACTORY_ACCEPTANCE_ENGINES?.split(',')||(!process.env.FACTORY_ACCEPTANCE_BRIEF?['rocket','rocket']:null);
 if(expectedEngines)assert.deepEqual(row.body.definition.stages.map(s=>s.definition.engine),expectedEngines);
 const edited=await json(await request('/compose',{version:1,action:'replace',id:row.id,expectedVersion:row.editVersion,section:'details',value:{title:row.body.title+' — reviewed draft',description:row.body.description}}));
 const preview=await json(await request('/preview',{id:row.id}));assert.equal(preview.mission.length,2);
 await runtime.dispose();runtime=create();
 const reopened=(await json(await request('/catalogue'))).records.find(r=>r.id===row.id);assert.equal(reopened.body.title,edited.item.body.title);assert.equal(reopened.editVersion,edited.item.editVersion);
 const result={status:'PASS',model:config.model,liveProviderCalls:calls,title:row.body.title,engines:row.body.definition.stages.map(s=>s.definition.engine||s.definition.template),stages:2,draftSave:true,edit:true,compiledNativePreview:true,persistentRestartReopen:true,scope:'isolated Workers runtime with synthetic admin assertion',ownerLiveSession:false,nativeGameplay:false,evidenceDirectory:root};
 await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await runtime.dispose();}
