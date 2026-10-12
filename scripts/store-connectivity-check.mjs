// Read-only probe: synthetic assertion, no customer session or data writes.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const source = `import {storeProxy} from './store-admin-proxy.js';
export default {async fetch() {
  const results=[];
  for(const host of ['playsmart-api-691560694221.us-central1.run.app','playsmart-api-ts7s4dwt6q-uc.a.run.app']) {
    try {const r=await storeProxy(new Request('https://admin.example.test/api/admin/store/products',{
      headers:{'CF-Access-JWT-Assertion':'synthetic-invalid-assertion'}
    }),{PLAYSMART_STORE_API_URL:'https://'+host});results.push({host,status:r.status});}
    catch(e){results.push({host,error:e.name,message:e.message});}
  }
  return Response.json(results);
}};`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const script=built.outputFiles[0].text;
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-21'}));
try {const results=await (await runtime.dispatchFetch('http://localhost/check')).json();console.log(JSON.stringify(results));for(const result of results)assert.equal(result.status,403);}
finally {await runtime.dispose();}
