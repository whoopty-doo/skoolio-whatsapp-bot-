import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {gameStudioResponse} from '../game-studio.js';
import {gameStudioProxy} from '../game-studio-proxy.js';
import {GAME_STUDIO_SCRIPT} from '../game-studio-client.generated.js';
const env={PLAYSMART_STORE_API_URL:'https://synthetic-factory.run.app'};
const request=(path='/games',method='GET',headers={},body='{}')=>new Request('https://admin.example.test/api/admin/game-studio'+path,{method,headers:{'CF-Access-JWT-Assertion':'synthetic','Origin':'https://admin.example.test','Content-Type':'application/json','Cookie':'do-not-forward','Authorization':'do-not-forward',...headers},...(method==='POST'?{body}:{})});
test('Game Studio page and APIs retain existing Super Admin gate',async()=>{
 for(const path of ['/admin/game-studio','/api/admin/game-studio/games','/api/admin/game-studio/preview'])assert.equal((await worker.fetch(new Request('https://admin.example.test'+path),{})).status,401);
});
test('five-step creator offers real templates and bounded content fields without a JSON editor',async()=>{
 const response=gameStudioResponse(),html=await response.text();
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 for(let step=0;step<5;step++)assert.ok(html.includes(`data-step="${step}"`));
 for(const template of ['rocket_letters','matching','memory_pairs'])assert.ok(html.includes(template));
 assert.ok(html.includes('word-en'));assert.ok(html.includes('word-af'));assert.ok(html.includes('centres'));
 assert.ok(!GAME_STUDIO_SCRIPT.includes('innerHTML'));assert.ok(GAME_STUDIO_SCRIPT.includes('textContent'));
});
test('proxy fixes upstream routes, sends only existing Access assertion and rejects redirects',async()=>{
 for(const [path,method] of [['/games','GET'],['/games','POST'],['/preview','POST']]){
  const response=await gameStudioProxy(request(path,method),env,async(url,options)=>{
   assert.equal(String(url),env.PLAYSMART_STORE_API_URL+'/v1/game-factory-admin'+path);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['CF-Access-JWT-Assertion'],'synthetic');return Response.json({contractVersion:1});
  });assert.equal(response.status,200);
 }
 assert.equal((await gameStudioProxy(request(),env,async()=>new Response('',{status:302,headers:{Location:'https://elsewhere.example'}}))).status,502);
});
test('proxy rejects foreign origins unexpected routes oversized requests and missing configuration',async()=>{
 const noFetch=async()=>{throw Error('must not call upstream');};
 assert.equal((await gameStudioProxy(request('/games','POST',{Origin:'https://foreign.example'}),env,noFetch)).status,403);
 assert.equal((await gameStudioProxy(request('/games?url=evil'),env,noFetch)).status,404);
 assert.equal((await gameStudioProxy(request('/admin'),env,noFetch)).status,404);
 assert.equal((await gameStudioProxy(request('/games','POST',{},'x'.repeat(750001)),env,noFetch)).status,413);
 assert.equal((await gameStudioProxy(request(),{},noFetch)).status,503);
});
