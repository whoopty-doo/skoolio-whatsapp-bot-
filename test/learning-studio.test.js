import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {learningStudioResponse} from '../learning-studio.js';
import {universalStudioResponse} from '../universal-studio.js';
import {LEARNING_STUDIO_SCRIPT} from '../learning-studio-client.generated.js';
import {gameStudioProxy} from '../game-studio-proxy.js';
test('Learning Factory presents both modes and shared libraries behind the existing admin gate',async()=>{
 const response=learningStudioResponse(),html=await response.text();
 for(const text of ['Create Game','Create Skill Pack','Worlds','Assets','Skills','Engines','Klik Creator','Generated Asset Review','Published','Revisions'])assert.ok(html.includes(text));
 assert.match(html,/ISOLATED TEST/);assert.match(response.headers.get('Content-Security-Policy'),/frame-src 'self'/);assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.doesNotThrow(()=>new Function('return '+LEARNING_STUDIO_SCRIPT));assert.ok(!LEARNING_STUDIO_SCRIPT.includes('innerHTML'));
 for(const path of ['/admin/learning-factory','/api/admin/game-studio/learning/catalogue','/api/admin/game-studio/learning/generate','/api/admin/game-studio/learning/klik'])assert.equal((await worker.fetch(new Request('https://synthetic.invalid'+path),{})).status,401);
});
test('embedded Game editor permits only same-origin framing; regular editor stays unframeable',()=>{
 assert.match(universalStudioResponse().headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.match(universalStudioResponse({embedded:true}).headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
});
test('new authoring proxy fails closed without distinct staging backend; only fixed methods are forwarded',async()=>{
 const make=(path,method='GET')=>new Request('https://studio.invalid/api/admin/game-studio/learning/'+path,{method,headers:{Origin:'https://studio.invalid','Content-Type':'application/json','CF-Access-JWT-Assertion':'synthetic'},...method==='POST'?{body:'{}'}:{}});
 const deny=async()=>{throw Error('No upstream call permitted');};
 for(const env of [{},{ENVIRONMENT:'production',LEARNING_FACTORY_TEST_API_URL:'https://test.run.app'},{ENVIRONMENT:'staging',PLAYSMART_STORE_API_URL:'https://same.run.app',LEARNING_FACTORY_TEST_API_URL:'https://same.run.app'}])assert.equal((await gameStudioProxy(make('catalogue'),env,deny)).status,503);
 const env={ENVIRONMENT:'staging',LEARNING_FACTORY_TEST_API_URL:'https://isolated.run.app'};
 for(const [path,method]of [['catalogue','GET'],['objects','POST'],['generate','POST'],['klik','POST'],['engine-tools','POST'],['preview','POST'],['revisions/lf_test','GET']])assert.equal((await gameStudioProxy(make(path,method),env,async(url,options)=>{assert.equal(String(url),'https://isolated.run.app/v1/game-factory-admin/learning/'+path);assert.deepEqual(Object.keys(options.headers).sort(),['CF-Access-JWT-Assertion','Content-Type']);return Response.json({ok:true});})).status,200);
 for(const path of ['catalogue?url=other','generate','revisions/../../secrets'])assert.equal((await gameStudioProxy(make(path),env,deny)).status,404);
});

test('M5 discovery is opt-in and embedded editor receives installed capabilities',()=>{
 assert.match(LEARNING_STUDIO_SCRIPT,/catalogue\.engineCapabilities/);
 assert.match(LEARNING_STUDIO_SCRIPT,/engineCapabilities:catalogue\.engineCapabilities/);
 assert.match(LEARNING_STUDIO_SCRIPT,/Klik autonomous generation is disabled/);
});
