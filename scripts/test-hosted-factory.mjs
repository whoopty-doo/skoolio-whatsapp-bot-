import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {accessHeaders,adminConfig} from '../test/helpers.js';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const auth=await accessHeaders(),persistent=await mkdtemp(join(tmpdir(),'factory-durable-test-'));
let artifact=process.argv[2];
if(!artifact){const root=await mkdtemp(join(tmpdir(),'factory-runtime-artifact-'));artifact=join(root,'worker.mjs');const built=await build({entryPoints:['hosted-worker.js'],bundle:true,platform:'node',format:'esm',target:'es2022',write:false});await writeFile(artifact,built.outputFiles[0].text);await copyFile('factory-workspace.generated.js',join(root,'factory-workspace.generated.js'));}
const create=()=>new Miniflare(convertV4MiniflareOptions({modulesRoot:resolve(dirname(artifact)),modules:[{type:'ESModule',path:resolve(artifact)},{type:'ESModule',path:resolve(dirname(artifact),'factory-workspace.generated.js')}],compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],resourcePersistencePath:persistent,isolatedResourcePersistencePath:persistent,name:'hosted-factory-test',
 kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},LEARNING_FACTORY_WORKSPACE:{className:'LearningFactoryCoordinator',useSQLite:true}},
 bindings:{...adminConfig,ENVIRONMENT:'production',LEARNING_FACTORY_HOSTED_ENABLED:'true',FACTORY_VISUAL_ENABLED:'true',NANO_BANANA_MODEL:'gemini-nano-banana-2.1',OPENAI_MODEL:'gpt-4o-mini'},
 outboundService:async request=>{if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});throw Error('Unexpected external request '+new URL(request.url).hostname);}
}));
let runtime=create();
const request=(path,body,headers=auth.headers)=>runtime.dispatchFetch('https://example.com/api/admin/game-studio/learning'+path,{method:body?'POST':'GET',headers:{...headers,Origin:'https://example.com','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
try{
 assert.equal((await request('/catalogue',null,{})).status,401);
 const c=await request('/catalogue');assert.equal(c.status,200);const catalogue=await c.json();assert.equal(catalogue.storage,'private-durable');assert.equal(catalogue.records.length,0);assert.equal(catalogue.composer.providerMode,'unavailable');assert.equal(catalogue.templates.length,2);
 const game=catalogue.templates.find(r=>r.kind==='game').body;
 const saved=await request('/objects',{action:'save',kind:'game',expectedVersion:0,body:game});assert.equal(saved.status,200);const row=(await saved.json()).item;assert.match(row.createdBy,/^access:[a-f0-9]{64}$/);
 const conflict=await request('/objects',{action:'save',id:row.id,expectedVersion:0,body:game});assert.equal(conflict.status,409);
 const races=await Promise.all(['First edit','Second edit'].map(title=>request('/objects',{action:'save',id:row.id,expectedVersion:1,body:{...game,title}})));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 const validate=await request('/objects',{action:'validate',id:row.id,expectedVersion:2});assert.equal(validate.status,200);
 const imageUnavailable=await request('/compose',{version:1,action:'create',kind:'game',brief:'Teach short vowel words using one level',body:game,levels:1,stages:2});assert.equal(imageUnavailable.status,503);
 // No provider calls or production credentials are used in this local persistence test.
 const bad=await runtime.dispatchFetch('https://example.com/api/admin/game-studio/learning/objects',{method:'POST',headers:{...auth.headers,Origin:'https://outside.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,403);
 await runtime.dispose();runtime=create();
 const restored=await(await request('/catalogue')).json();const reopened=restored.records.find(r=>r.id===row.id);assert.equal(reopened.editVersion,3);assert.ok(['First edit','Second edit'].includes(reopened.body.title));assert.ok(reopened.validation);
 assert.equal((await request('/revisions/'+row.id)).status,200);
 console.log('PASS hosted Worker: verified admin gate, empty workspace starter templates, save, conflicting edits, validate, actual persistent runtime restart/reopen, CSRF rejection, no-key fail-closed.');
}finally{await runtime.dispose();}
