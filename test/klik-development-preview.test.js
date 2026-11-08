import test from 'node:test';
import assert from 'node:assert/strict';
import preview from '../scripts/klik-development-preview.js';
const env={ENVIRONMENT:'development',FACTORY_KLIK_AI_ENABLED:'true',KLIK_PREVIEW_AUTH:'synthetic-session',OPENAI_API_KEY:'synthetic-provider-key',OPENAI_MODEL:'gpt-4o-mini'};
const body={model:env.OPENAI_MODEL,store:false,max_output_tokens:16384,text:{format:{type:'json_object'}},instructions:'Return JSON only.',input:'Test content'};
const request=(value=body,headers={})=>new Request('https://preview.invalid/responses',{method:'POST',headers:{Authorization:'Bearer '+env.KLIK_PREVIEW_AUTH,...headers},body:JSON.stringify(value)});
test('preview requires development opt-in and private session; health never exposes credentials',async()=>{
 assert.equal((await preview.fetch(request(),{...env,ENVIRONMENT:'production'})).status,503);
 assert.equal((await preview.fetch(request(),{...env,FACTORY_KLIK_AI_ENABLED:'false'})).status,503);
 assert.equal((await preview.fetch(request(body,{Authorization:'Bearer foreign'}),env)).status,401);
 const health=await preview.fetch(new Request('https://preview.invalid/health',{headers:{Authorization:'Bearer '+env.KLIK_PREVIEW_AUTH}}),env);
 assert.deepEqual(await health.json(),{aiConfigured:true,model:env.OPENAI_MODEL,audioConfigured:false,temporaryPreview:true});
 assert.equal((await preview.fetch(request(body,{Origin:'https://foreign.invalid'}),env)).status,404);
});
test('edge fetch uses supported redirect mode, application identity and existing secret; preserves upstream error classification',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'manual');
  assert.equal(options.headers['User-Agent'],'PlaySmart-Klik-Factory/1.0');assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);
  assert.ok(!options.body.includes(env.KLIK_PREVIEW_AUTH));assert.deepEqual(JSON.parse(options.body),body);
  return Response.json({error:{code:'invalid_api_key'}},{status:401,headers:{'x-request-id':'synthetic-request'}});
 });
 const response=await preview.fetch(request(),env);assert.equal(response.status,401);assert.equal(response.headers.get('X-Klik-Response-Source'),'openai');assert.equal(response.headers.get('X-Klik-Provider-Request-Id'),'synthetic-request');assert.equal(calls,1);
});
test('redirects, model changes, tool calls and oversized requests never bypass the bounded provider path',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}});});
 assert.equal((await preview.fetch(request(),env)).status,502);assert.equal(calls,1);
 for(const value of [{...body,model:'unapproved'},{...body,tools:[{type:'function'}]},{...body,input:'x'.repeat(800001)}])assert.ok([400,413].includes((await preview.fetch(request(value),env)).status));
 assert.equal(calls,1);
});

test('native schema requests retain private preview bounds and strict provider format',async t=>{
 const format={type:'json_schema',name:'klik_composition',strict:true,schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}};
 let calls=0;t.mock.method(globalThis,'fetch',async(_url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body).text.format,format);return Response.json({status:'completed'});});
 assert.equal((await preview.fetch(request({...body,text:{format}}),env)).status,200);
 for(const bad of [{...format,strict:false},{...format,name:'unapproved'},{...format,schema:{type:'object',additionalProperties:true}},{...format,schema:{...format.schema,description:'x'.repeat(100001)}}]){
  assert.equal((await preview.fetch(request({...body,text:{format:bad}}),env)).status,400);
 }
 assert.equal(calls,1);
});

test('Nano Banana uses existing Google secret with private session, fixed model and bounded JPEG request',async t=>{
 const google={...env,FACTORY_NANO_BANANA_ENABLED:'true',GEMINI_API_KEY:'synthetic-google-key',NANO_BANANA_MODEL:'gemini-nano-banana-2.1'};
 const value={model:google.NANO_BANANA_MODEL,store:false,input:[{type:'text',text:'Space cover'}],response_format:{type:'image',mime_type:'image/jpeg',aspect_ratio:'1:1',image_size:'1K'}};
 const req=(body=value,headers={})=>new Request('https://preview.invalid/images',{method:'POST',headers:{Authorization:'Bearer '+env.KLIK_PREVIEW_AUTH,...headers},body:JSON.stringify(body)});
 let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(options.headers['x-goog-api-key'],google.GEMINI_API_KEY);assert.equal(options.headers['Api-Revision'],'2026-05-20');assert.equal(options.redirect,'manual');assert.ok(!options.body.includes(google.GEMINI_API_KEY));return Response.json({status:'completed',steps:[]});});
 assert.equal((await preview.fetch(req(),google)).status,200);assert.equal(calls,1);
 for(const bad of [{...value,model:'unapproved'},{...value,tools:[]},{...value,input:[{type:'image',uri:'https://foreign.invalid'}]},{...value,response_format:{...value.response_format,mime_type:'image/png'}}])assert.equal((await preview.fetch(req(bad),google)).status,400);
 assert.equal((await preview.fetch(req(value,{Origin:'https://foreign.invalid'}),google)).status,404);
 assert.equal((await preview.fetch(req(),{...google,FACTORY_NANO_BANANA_ENABLED:'false'})).status,503);
 assert.equal(calls,1);
 const health=await preview.fetch(new Request('https://preview.invalid/image-health',{headers:{Authorization:'Bearer '+env.KLIK_PREVIEW_AUTH}}),google);const text=await health.text();assert.ok(!text.includes(google.GEMINI_API_KEY));assert.equal(JSON.parse(text).aiConfigured,true);
});

test('audio preview keeps the approved voice and sound format server-side and rejects expanded requests',async t=>{
 const audio={...env,TINA_ELEVENLABS_API_KEY:'synthetic-audio-key',TINA_ELEVENLABS_VOICE_ID:'approved-tina'};
 const sound={text:'A soft chime.',duration_seconds:1,loop:false,model_id:'eleven_text_to_sound_v2',prompt_influence:.3};
 const voice={text:'Find the sun.',language_code:'en',model_id:'eleven_v3',voice_settings:{stability:.5,similarity_boost:.75}};
 const req=(path,body,headers={})=>new Request('https://preview.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+env.KLIK_PREVIEW_AUTH,...headers},body:JSON.stringify(body)});
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(url);assert.equal(options.headers['xi-api-key'],audio.TINA_ELEVENLABS_API_KEY);assert.equal(options.redirect,'manual');assert.ok(!options.body.includes(audio.TINA_ELEVENLABS_API_KEY));return new Response(new Uint8Array([0,0]));});
 assert.equal((await preview.fetch(req('/sound?format=wav_16000',sound),audio)).status,200);
 assert.equal((await preview.fetch(req('/voice',voice),audio)).status,200);
 assert.deepEqual(calls,['https://api.elevenlabs.io/v1/sound-generation?output_format=wav_16000','https://api.elevenlabs.io/v1/text-to-speech/approved-tina?output_format=pcm_16000']);
 for(const bad of [{...sound,duration_seconds:30},{...sound,voice_id:'foreign'},{...sound,loop:true},{...sound,model_id:'unapproved'}])assert.equal((await preview.fetch(req('/sound',bad),audio)).status,400);
 assert.equal((await preview.fetch(req('/voice',{...voice,language_code:'unknown'}),audio)).status,400);
 assert.equal((await preview.fetch(req('/sound',sound,{Authorization:'Bearer foreign'}),audio)).status,401);
 assert.equal((await preview.fetch(req('/sound',sound,{Origin:'https://foreign.invalid'}),audio)).status,404);
 assert.equal((await preview.fetch(req('/sound',sound),env)).status,503);
 assert.equal(calls.length,2);
});
