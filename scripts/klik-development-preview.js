// Ephemeral remote development only. No production routes or data bindings.
export default {
 async fetch(request,env){
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(env.ENVIRONMENT!=='development'||env.FACTORY_KLIK_AI_ENABLED!=='true')return reply({error:'Development preview is disabled'},503);
  const url=new URL(request.url);
  if(!env.KLIK_PREVIEW_AUTH||request.headers.get('Authorization')!=='Bearer '+env.KLIK_PREVIEW_AUTH)return reply({error:'Unauthorized'},401);
  if(request.method==='GET'&&url.pathname==='/health')return reply({aiConfigured:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL,temporaryPreview:true});
  if(request.headers.has('Origin'))return reply({error:'Not found'},404);
  const google=url.pathname==='/images'||url.pathname==='/image-health'||url.pathname==='/image-model';
  if(google){
   if(env.FACTORY_NANO_BANANA_ENABLED!=='true')return reply({error:'Image preview is disabled'},503);
   if(request.method==='GET'&&url.pathname==='/image-health')return reply({aiConfigured:!!env.GEMINI_API_KEY,model:env.NANO_BANANA_MODEL,temporaryPreview:true});
   if(!env.GEMINI_API_KEY||!/^gemini-[a-z0-9.-]{1,80}$/.test(env.NANO_BANANA_MODEL||''))return reply({error:'Google image credential or model is unavailable'},503);
   if(request.method==='GET'&&url.pathname==='/image-model'){
    const check=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+env.NANO_BANANA_MODEL,{redirect:'manual',headers:{'x-goog-api-key':env.GEMINI_API_KEY},signal:AbortSignal.timeout(15000)});
    const data=await check.json().catch(()=>({}));return reply({status:check.status,model:data.name||env.NANO_BANANA_MODEL,methods:data.supportedGenerationMethods||[],errorStatus:data.error?.status||null},check.ok?200:check.status);
   }
  }
  if(request.method!=='POST'||!['/responses','/images'].includes(url.pathname))return reply({error:'Not found'},404);
  if(!google&&!env.OPENAI_API_KEY)return reply({error:'Existing Klik provider secret is unavailable'},503);
  const reader=request.body?.getReader();if(!reader)return reply({error:'JSON required'},400);
  let bytes=0;const chunks=[];
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>800000){await reader.cancel();return reply({error:'Too large'},413);}chunks.push(part.value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder().decode(joined));}catch{return reply({error:'Invalid JSON'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'JSON object required'},400);
  if(google){
   if(body.model!==env.NANO_BANANA_MODEL||body.store!==false||Object.keys(body).some(k=>!['model','store','input','response_format'].includes(k))||!Array.isArray(body.input)||body.input.length<1||body.input.length>9||body.input.some(p=>!p||typeof p!=='object'||(p.type==='text'?typeof p.text!=='string'||p.text.length>12000||Object.keys(p).some(k=>!['type','text'].includes(k)):p.type!=='image'||p.mime_type!=='image/png'||typeof p.data!=='string'||p.data.length>44000||!/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)||Object.keys(p).some(k=>!['type','mime_type','data'].includes(k))))||body.response_format?.type!=='image'||body.response_format.mime_type!=='image/jpeg'||body.response_format.delivery!=='inline'||!['1K','2K','4K'].includes(body.response_format.image_size)||!['1:1','3:2','2:3','16:9','9:16'].includes(body.response_format.aspect_ratio)||Object.keys(body.response_format).some(k=>!['type','mime_type','delivery','image_size','aspect_ratio'].includes(k)))return reply({error:'Bounded image generation only'},400);
   try{
    const upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(180000),headers:{'x-goog-api-key':env.GEMINI_API_KEY,'Api-Revision':'2026-05-20','Content-Type':'application/json','User-Agent':'PlaySmart-Factory/1.0'},body:JSON.stringify(body)});
    if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return reply({error:'Provider redirect refused'},502);}
    return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Factory-Image-Source':'google'}});
   }catch{return reply({error:'Google image provider unavailable'},502);}
  }
  if(body.model!==env.OPENAI_MODEL||body.store!==false||body.max_output_tokens!==16384||body.text?.format?.type!=='json_object'||typeof body.input!=='string'||typeof body.instructions!=='string'||Object.keys(body).some(k=>!['model','store','max_output_tokens','text','instructions','input'].includes(k)))return reply({error:'Bounded composition only'},400);
  try{
   const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(180000),headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json','User-Agent':'PlaySmart-Klik-Factory/1.0'},body:JSON.stringify(body)});
   if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return reply({error:'Provider redirect refused'},502);}
   return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Klik-Provider-Request-Id':upstream.headers.get('x-request-id')||'unavailable','X-Klik-Response-Source':'openai'}});
  }catch{return reply({error:'Provider unavailable'},502);}
 }
};
