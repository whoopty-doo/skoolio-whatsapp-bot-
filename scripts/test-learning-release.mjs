import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {accessHeaders, adminConfig} from '../test/helpers.js';
const auth = await accessHeaders();
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules:true, script:readFileSync(process.argv[2], 'utf8'), compatibilityDate:'2026-09-21',
  kvNamespaces:['NOTES_KV'], durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true}},
  bindings:{...adminConfig,ENVIRONMENT:'production',LICENCE_HUB_MANAGEMENT_ENABLED:'true'},
  outboundService:async request => {
    if(request.url === 'https://team.example.com/cdn-cgi/access/certs') return Response.json({keys:[auth.publicJwk]});
    throw Error('Unexpected external request: '+new URL(request.url).pathname);
  },
}));
try {
  const request = (path, authenticated=true, method='GET') => runtime.dispatchFetch('https://example.com'+path,{method,headers:authenticated?auth.headers:{}});
  for(const path of ['/admin/learning-factory','/admin/game-studio?learning=1','/admin/licence-hub','/api/admin/game-studio/learning/catalogue']) assert.equal((await request(path,false)).status,401);
  for(const [path,text] of [['/admin/learning-factory','Generated Asset Review'],['/admin/licence-hub','Licence Hub'],['/admin/store','Store'],['/admin/game-studio','Generated Asset Review'],['/admin/game-studio?legacy=1','Game']]) {
    const response=await request(path); assert.equal(response.status,200,path); assert.ok((await response.text()).includes(text),path);
  }
  for(const path of ['/admin/learning-factory','/admin/game-studio','/admin/game-studio?learning=1','/admin/game-studio?legacy=1']) assert.equal((await request(path,true,'POST')).status,405);
  const home=await request('/admin');assert.ok((await home.text()).includes('href="/admin/game-studio">Game Factory</a>'));
  const embedded=await request('/admin/game-studio?learning=1');assert.equal(embedded.status,200);assert.match(embedded.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
  const unavailable=await request('/api/admin/game-studio/learning/catalogue'); assert.equal(unavailable.status,503); assert.match((await unavailable.json()).error,/isolated Factory test backend/);
  console.log('PASS exact release Worker: existing pages preserved, Factory and embedded editor render, authentication enforced, missing workspace fails closed. Synthetic local runtime only.');
} finally { await runtime.dispose(); }
