// The Worker verifies the existing owner Access session before calling this proxy.
export async function novaProxy(request, env, fetcher=fetch) {
 const url=new URL(request.url),suffix=url.pathname.slice('/api/admin/novas'.length);
 const fail=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
 if(suffix!=='/catalogue'||url.search)return fail('Not found.',404);
 if(!['GET','POST'].includes(request.method))return fail('Method not allowed.',405);
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return fail('Invalid origin.',403);
 if(request.method==='POST'&&request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return fail('JSON details required.',415);
 const assertion=request.headers.get('CF-Access-JWT-Assertion');if(!assertion)return fail('Sign in through Cloudflare Access.',401);
 let base;try{base=new URL(env.PLAYSMART_STORE_API_URL);}catch{return fail('The PlaySmart connection is not configured.',503);}
 if(base.protocol!=='https:'||base.username||base.password||base.port||base.search||base.hash||base.pathname!=='/'||!base.hostname.endsWith('.run.app'))return fail('The PlaySmart connection is invalid.',503);
 let body;
 if(request.method==='POST'){
  const reader=request.body?.getReader();if(!reader)return fail('Details required.',400);const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return fail('Details are too large.',413);}chunks.push(value);}
  body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
 }
 try{
  const response=await fetcher(new URL('/v1/nova-admin/catalogue',base),{method:request.method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'CF-Access-JWT-Assertion':assertion,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body});
  if(response.status>=300&&response.status<400||!response.headers.get('Content-Type')?.startsWith('application/json'))return fail('The catalogue returned an unexpected response.',502);
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return fail('The catalogue could not be reached. Refresh before retrying.',502);}
}
