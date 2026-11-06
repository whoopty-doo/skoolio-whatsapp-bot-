// Called only after the Worker's existing cryptographic Super Admin check.
export async function hostedFactoryProxy(request,env){
 const fail=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
 if(env.LEARNING_FACTORY_HOSTED_ENABLED!=='true'||!env.LEARNING_FACTORY_WORKSPACE)return fail('The hosted Factory workspace is unavailable.',503);
 const url=new URL(request.url),prefix='/api/admin/game-studio/learning';
 if(!url.pathname.startsWith(prefix+'/')||url.search)return fail('Not found',404);
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return fail('Invalid origin',403);
 const assertion=request.headers.get('CF-Access-JWT-Assertion');let email;
 try{email=JSON.parse(atob(assertion.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).email?.trim().toLowerCase();}catch{}
 if(!email)return fail('Verified administrator required.',401);
 let body;
 if(request.method==='POST'){
  if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return fail('JSON required',415);
  const reader=request.body?.getReader();if(!reader)return fail('JSON required',400);const chunks=[];let bytes=0;
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>750000){await reader.cancel();return fail('Request too large',413);}chunks.push(part.value);}
  body=new Uint8Array(bytes);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
 }
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const id=env.LEARNING_FACTORY_WORKSPACE.idFromName('learning-factory-authoring-v1');
 return env.LEARNING_FACTORY_WORKSPACE.get(id).fetch(new Request('https://factory.internal'+url.pathname.slice(prefix.length),{method:request.method,headers:{'Content-Type':'application/json','X-Factory-Actor':'access:'+hash},body}));
}
