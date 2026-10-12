import test from 'node:test';
import assert from 'node:assert/strict';
import { storeProxy } from '../store-admin-proxy.js';
import { storeAdminResponse } from '../store-admin.js';
import worker from '../worker.js';
const env={PLAYSMART_STORE_API_URL:'https://synthetic-store.us-central1.run.app'};
function request(path='/products',method='GET',extra={}){
  return new Request('https://admin.example.test/api/admin/store'+path,{method,
    headers:{'CF-Access-JWT-Assertion':'synthetic-assertion','Origin':'https://admin.example.test','Content-Type':path==='/assets'?'image/png':'application/json','Cookie':'never-forward-this','Authorization':'never-forward-this',...extra},
    ...(method==='POST'?{body:path==='/assets'?new Uint8Array([137,80,78,71]):JSON.stringify({revision:0,action:'save'})}:{})});
}
test('store admin page and API retain the existing Access gate',async()=>{
  for(const path of ['/admin/store','/api/admin/store/products']){
    const response=await worker.fetch(new Request('https://admin.example.test'+path),{});
    assert.equal(response.status,401);
  }
});
test('proxy is fixed to store routes and forwards no cookies or unrelated credentials',async()=>{
  let calls=0;
  const result=await storeProxy(request('/products','POST'),env,async(url,options)=>{
    calls++;assert.equal(String(url),env.PLAYSMART_STORE_API_URL+'/v1/store-admin/products');
    assert.equal(options.headers['CF-Access-JWT-Assertion'],'synthetic-assertion');
    assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.redirect,'manual');assert.equal(options.method,'POST');
    return Response.json({item:{revision:1}});
  });
  assert.equal(result.status,200);assert.equal(calls,1);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
  for(const path of ['/licenses','/products?target=elsewhere','/assets/not-a-hash.png']){
    const response=await storeProxy(request(path),env,async()=>{throw Error('Must not call upstream');});
    assert.equal(response.status,404);
  }
});
test('foreign origin, missing assertion, invalid target and oversized uploads fail before forwarding',async()=>{
  const noFetch=async()=>{throw Error('Must not call upstream');};
  assert.equal((await storeProxy(request('/products','POST',{Origin:'https://outside.test'}),env,noFetch)).status,403);
  const unauth=request();unauth.headers.delete('CF-Access-JWT-Assertion');assert.equal((await storeProxy(unauth,env,noFetch)).status,401);
  assert.equal((await storeProxy(request(),{},noFetch)).status,503);
  assert.equal((await storeProxy(request(),{PLAYSMART_STORE_API_URL:'https://outside.test'},noFetch)).status,503);
  const large=new Request('https://admin.example.test/api/admin/store/assets',{method:'POST',headers:request('/assets','POST').headers,body:new Uint8Array(2*1024*1024+1)});
  assert.equal((await storeProxy(large,env,noFetch)).status,413);
});
test('upload bytes and private preview content are preserved; unexpected upstream HTML is rejected',async()=>{
  const result=await storeProxy(request('/assets','POST'),env,async(_url,options)=>{
    assert.deepEqual([...options.body],[137,80,78,71]);return Response.json({id:'a'.repeat(64)},{status:201});
  });assert.equal(result.status,201);
  const preview=await storeProxy(request('/assets/'+'a'.repeat(64)+'.png'),env,async()=>new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'image/png'}}));
  assert.equal(preview.headers.get('Content-Type'),'image/png');assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())],[1,2]);
  assert.equal((await storeProxy(request(),env,async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}))).status,502);
});
test('store page has restrictive CSP, upload limits and explicit draft/publish controls',async()=>{
  const response=storeAdminResponse(),html=await response.text();
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(html,/Publish saved draft/);assert.match(html,/accept="image\/png"/);
  assert.match(html,/Archive/);assert.match(html,/id="centres"/);assert.doesNotMatch(html,/unsafe-inline/);
});

test('upstream redirects are never followed with the Access assertion',async()=>{
  let calls=0;
  const response=await storeProxy(request(),env,async(_url,options)=>{
    calls++;assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://outside.example.test'}});
  });
  assert.equal(response.status,502);assert.equal(calls,1);
  assert.match((await response.json()).error,/unexpected redirect/);
});
