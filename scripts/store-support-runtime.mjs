import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { accessHeaders, adminConfig } from '../test/helpers.js';
const auth=await accessHeaders();
let storeCalls=0,redirect=false;
const built=await build({entryPoints:['worker.js'],bundle:true,format:'esm',write:false,platform:'browser',target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({
  modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-09-21',
  kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true}},
  bindings:{...adminConfig,ENVIRONMENT:'development',VALIDATE_TWILIO_SIGNATURE:'false',COORDINATOR_BOOTSTRAP_APPROVED:'true',APP_SUPPORT_ENABLED:'true',PLAYSMART_STORE_API_URL:'https://synthetic-store.run.app'},
  outboundService:async request=>{
    if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});
    assert.equal(request.url,'https://synthetic-store.run.app/v1/store-admin/products');
    assert.equal(request.headers.get('CF-Access-JWT-Assertion'),auth.headers['CF-Access-JWT-Assertion']);
    storeCalls++;
    return redirect?new Response(null,{status:302,headers:{Location:'https://outside.example.test'}}):Response.json({schemaVersion:1,items:[]});
  }
}));
try {
  const admin=path=>runtime.dispatchFetch('https://example.com'+path,{headers:auth.headers});
  const page=await admin('/admin');assert.equal(page.status,200);const html=await page.text();assert.match(html,/App support inbox/);assert.match(html,/href="\/admin\/store"/);
  assert.equal((await admin('/admin/store')).status,200);
  assert.equal((await runtime.dispatchFetch('https://example.com/api/app-support/session')).status,401);
  assert.equal((await runtime.dispatchFetch('https://example.com/api/admin/store/products')).status,401);
  const store=await admin('/api/admin/store/products');assert.equal(store.status,200);assert.deepEqual((await store.json()).items,[]);assert.equal(storeCalls,1);
  redirect=true;assert.equal((await admin('/api/admin/store/products')).status,502);assert.equal(storeCalls,2);
  console.log('PASS actual Workers runtime: app support and store coexist, both admin entries render, Access remains required, store fetch succeeds and redirects are blocked. No external requests.');
}finally {await runtime.dispose();}
