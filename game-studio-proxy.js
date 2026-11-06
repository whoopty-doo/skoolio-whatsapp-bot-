import {hostedFactoryProxy} from './hosted-factory-proxy.js';
// Worker invokes this only after its existing verified Super Admin Access gate.
export async function gameStudioProxy(request, env, fetcher = fetch) {
  const url = new URL(request.url), suffix = url.pathname.slice('/api/admin/game-studio'.length);
  const fail = (error, status) => Response.json({error}, {status, headers:{'Cache-Control':'private, no-store'}});
  const learning = suffix.startsWith('/learning/');
  const learningAllowed = request.method==='GET' && (suffix==='/learning/catalogue'||/^\/learning\/revisions\/[a-z][a-z0-9_.-]{0,99}$/.test(suffix)) || request.method==='POST' && ['/learning/engine-tools','/learning/objects','/learning/preview','/learning/klik','/learning/compose','/learning/generate'].includes(suffix);
  if (url.search || !(request.method === 'GET' && (['/games','/catalogue','/banks','/compositions','/audio','/progression','/reward-bindings','/appearances','/assets'].includes(suffix) || /^\/assets\/import_[a-f0-9]{64}$/.test(suffix) || /^\/audio\/audio_[a-f0-9]{64}$/.test(suffix)) || learningAllowed || request.method === 'POST' && ['/games','/preview','/banks','/compositions','/audio','/progression','/reward-bindings','/appearances','/assets','/composition-preview'].includes(suffix))) return fail('Not found',404);
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return fail('Invalid origin',403);
  const assertion = request.headers.get('CF-Access-JWT-Assertion');
  if (!assertion) return fail('Sign in through Cloudflare Access.',401);
  if(learning&&env.LEARNING_FACTORY_HOSTED_ENABLED==='true')return hostedFactoryProxy(request,env);
  if(learning&&(env.ENVIRONMENT!=='staging'||!env.LEARNING_FACTORY_TEST_API_URL||env.LEARNING_FACTORY_TEST_API_URL===env.PLAYSMART_STORE_API_URL))return fail('An isolated Factory test backend is not configured.',503);
  let base; try { base = new URL(learning?env.LEARNING_FACTORY_TEST_API_URL:env.PLAYSMART_STORE_API_URL); } catch { return fail('The PlaySmart connection is not configured.',503); }
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.run.app') || base.username || base.password || base.pathname !== '/' || base.search || base.hash) return fail('Invalid PlaySmart connection.',503);
  let body;
  if (request.method === 'POST') {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return fail('Game details must be JSON.',415);
    const reader=request.body?.getReader(),chunks=[];let length=0;
    if (!reader) return fail('Missing game details.',400);
    for (;;) { const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>750000){await reader.cancel();return fail('Game is too large.',413);}chunks.push(value); }
    body=new Uint8Array(length);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
  }
  try {
    const response=await fetcher(new URL('/v1/game-factory-admin'+suffix,base),{method:request.method,redirect:'manual',signal:AbortSignal.timeout(suffix==='/learning/compose'?100000:20000),headers:{'CF-Access-JWT-Assertion':assertion,'Content-Type':'application/json'},body});
    if(response.status>=300&&response.status<400 || !response.headers.get('Content-Type')?.startsWith('application/json')) return fail('Unexpected PlaySmart response.',502);
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch { return fail('Game Studio could not connect. Please retry.',502); }
}
