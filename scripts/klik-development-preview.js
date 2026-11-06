// Ephemeral remote development only. No production routes or data bindings.
export default {
 async fetch(request,env){
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(env.ENVIRONMENT!=='development'||env.FACTORY_KLIK_AI_ENABLED!=='true')return reply({error:'Development preview is disabled'},503);
  const url=new URL(request.url);
  if(!env.KLIK_PREVIEW_AUTH||request.headers.get('Authorization')!=='Bearer '+env.KLIK_PREVIEW_AUTH)return reply({error:'Unauthorized'},401);
  if(request.method==='GET'&&url.pathname==='/health')return reply({aiConfigured:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL,temporaryPreview:true});
  if(request.method!=='POST'||url.pathname!=='/responses'||request.headers.has('Origin'))return reply({error:'Not found'},404);
  if(!env.OPENAI_API_KEY)return reply({error:'Existing Klik provider secret is unavailable'},503);
  const reader=request.body?.getReader();if(!reader)return reply({error:'JSON required'},400);
  let bytes=0;const chunks=[];
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>800000){await reader.cancel();return reply({error:'Too large'},413);}chunks.push(part.value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder().decode(joined));}catch{return reply({error:'Invalid JSON'},400);}
  if(body.model!==env.OPENAI_MODEL||body.store!==false||body.max_output_tokens!==16384||body.text?.format?.type!=='json_object'||typeof body.input!=='string'||typeof body.instructions!=='string'||Object.keys(body).some(k=>!['model','store','max_output_tokens','text','instructions','input'].includes(k)))return reply({error:'Bounded composition only'},400);
  try{
   const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json','User-Agent':'PlaySmart-Klik-Factory/1.0'},body:JSON.stringify(body)});
   if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return reply({error:'Provider redirect refused'},502);}
   return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Klik-Provider-Request-Id':upstream.headers.get('x-request-id')||'unavailable','X-Klik-Response-Source':'openai'}});
  }catch{return reply({error:'Provider unavailable'},502);}
 }
};
