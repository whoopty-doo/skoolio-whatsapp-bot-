import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {factoryPreviewResponse} from '../factory-preview.js';
import {accessHeaders,adminConfig} from './helpers.js';

test('browser player requires the existing verified admin identity before any asset access',async(t)=>{
 const auth=await accessHeaders();
 t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[auth.publicJwk]}));
 let calls=0;
 const env={...adminConfig,FACTORY_PREVIEW_ASSETS:{async fetch(request){calls++;assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('CF-Access-JWT-Assertion'),null);return new Response('compiled player',{headers:{'Content-Type':'application/javascript'}});}}};
 for(const path of ['/factory-preview/index.html','/factory-preview/main.dart.js','/factory-preview/canvaskit/canvaskit.wasm']){
  assert.equal((await worker.fetch(new Request('https://example.com'+path),env)).status,401);
 }
 assert.equal(calls,0);
 const r=await worker.fetch(new Request('https://example.com/factory-preview/main.dart.js',{headers:{...auth.headers,Cookie:'synthetic'}}),env);
 assert.equal(r.status,200);assert.equal(await r.text(),'compiled player');assert.equal(calls,1);
 assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
 assert.equal(r.headers.get('Content-Type'),'application/javascript');
 assert.equal((await worker.fetch(new Request('https://example.com/factory-preview/main.dart.js',{method:'POST',headers:auth.headers}),env)).status,405);
 assert.equal(calls,1);
});

test('player fails visibly without assets and preserves missing-file status and HEAD semantics',async()=>{
 const req=method=>new Request('https://example.com/factory-preview/',{method});
 assert.equal((await factoryPreviewResponse(req('GET'),{})).status,503);
 const env={FACTORY_PREVIEW_ASSETS:{async fetch(r){assert.equal(new URL(r.url).pathname,'/factory-preview/index.html');return new Response('missing',{status:404});}}};
 assert.equal((await factoryPreviewResponse(req('GET'),env)).status,404);
 assert.equal(await(await factoryPreviewResponse(req('HEAD'),env)).text(),'');
});
