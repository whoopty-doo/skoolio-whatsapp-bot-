// Isolated acceptance of the exact release Worker and compiled Flutter player.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {accessHeaders,adminConfig} from '../test/helpers.js';
import {missionPlanFixture} from '../test/mission-plan-fixture.js';
import {learningBrowser} from './learning-browser-session.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,extname} from 'node:path';
const [releaseArg,assetsArg,evidenceArg]=process.argv.slice(2);
assert.ok(releaseArg&&assetsArg&&evidenceArg);
const release=resolve(releaseArg),assets=resolve(assetsArg),evidence=resolve(evidenceArg);
await mkdir(evidence,{recursive:true});
const live=process.env.FACTORY_LIVE_ACCEPTANCE==='true';
const previewOrigin='http://127.0.0.1:8812';
const previewAuth=live?(await readFile(process.env.KLIK_DEV_PREVIEW_AUTH_FILE,'utf8')).trim().split('=')[1]:null;
const providerHeaders={'Authorization':'Bearer '+previewAuth,'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'};
const calls=[];
const auth=await accessHeaders({exp:Math.floor(Date.now()/1000)+3600});
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.wav':'audio/wav','.woff2':'font/woff2','.otf':'font/otf','.ttf':'font/ttf'};
const runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:release,modules:['candidate.mjs','factory-workspace.generated.js','factory-preview.js'].map(path=>({type:'ESModule',path:join(release,path)})),compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],name:'factory-player-browser',kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},LEARNING_FACTORY_WORKSPACE:{className:'LearningFactoryCoordinator',useSQLite:true}},bindings:{...adminConfig,ENVIRONMENT:'production',LEARNING_FACTORY_HOSTED_ENABLED:'true',FACTORY_VISUAL_ENABLED:'true',OPENAI_API_KEY:'synthetic-test-only',OPENAI_MODEL:'gpt-4o-mini',GEMINI_API_KEY:'synthetic-transport-marker',NANO_BANANA_MODEL:'gemini-nano-banana-2.1',TINA_ELEVENLABS_API_KEY:'synthetic-transport-marker',TINA_ELEVENLABS_VOICE_ID:'approved-tina'},serviceBindings:{FACTORY_PREVIEW_ASSETS:async request=>{
 const path=decodeURIComponent(new URL(request.url).pathname).replace(/^\/factory-preview\//,'');
 const file=resolve(assets,path);if(!file.startsWith(assets+'/'))return new Response('Not found',{status:404});
 try{const bytes=await readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}},outboundService:async request=>{
 if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});
 if(live){
  const route=request.url==='https://api.openai.com/v1/responses'?'/responses':request.url==='https://generativelanguage.googleapis.com/v1beta/interactions'?'/images':request.url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')?'/voice':request.url.startsWith('https://api.elevenlabs.io/v1/sound-generation?')?'/sound?format=wav_16000':null;
  assert.ok(route,'Only approved generation endpoints may be called');const body=await request.text();await writeFile(join(evidence,'provider-request-'+(calls.length+1)+'.json'),body,{mode:0o600});const response=await fetch(previewOrigin+route,{method:'POST',headers:providerHeaders,body,signal:AbortSignal.timeout(240000)});const bytes=await response.arrayBuffer();calls.push({route,status:response.status});await writeFile(join(evidence,'provider-'+calls.length+(route==='/voice'||route.startsWith('/sound')?'.audio':'.json')),new Uint8Array(bytes),{mode:0o600});return new Response(bytes,{status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')||'application/json'}});
 }
 if(request.url==='https://generativelanguage.googleapis.com/v1beta/interactions'&&process.env.FACTORY_RECORDED_IMAGE_FILE)return new Response(await readFile(process.env.FACTORY_RECORDED_IMAGE_FILE),{headers:{'Content-Type':'application/json'}});
 if(request.url==='https://api.openai.com/v1/responses'){
  const input=JSON.parse((await request.json()).input);let output;
  if(input.request){output=missionPlanFixture(input.bodyTemplate,input.request.kind==='game'?input.request.levels:input.request.stages);if(input.request.kind==='game'){output.kind='game';output.body.definition.stages.forEach(s=>{s.engine=input.request.engine||'rocket';});}}
  else if(typeof input.engine==='string')output={instruction:{en:'Spell SUN',af:'Spel SON'},word:{en:'SUN',af:'SON'},items:[]};
  else output={instruction:input.activity.content.instruction,passage:input.activity.content.passage,items:input.activity.content.items.map(({id,...i})=>i)};
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
 }
 if(request.url.startsWith('https://api.elevenlabs.io/')){const b=Buffer.alloc(64044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(64000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return new Response(b);}
 throw Error('External network forbidden: '+new URL(request.url).hostname);
}}));
const server=createServer(async(req,res)=>{try{
 if(req.url==='/fixture/health'){res.setHeader('Content-Type','application/json');res.end('{"synthetic":true}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);
 const response=await runtime.dispatchFetch('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:{...req.headers,...(/^\/(admin(?:\/|$)|api\/admin\/)/.test(req.url)?auth.headers:{})},...chunks.length?{body:Buffer.concat(chunks)}:{}});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(500);res.end('Isolated test request failed');console.error(error.message);}});
let browser;
try{
 assert.equal((await runtime.dispatchFetch('https://example.com/factory-preview/index.html')).status,401);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,body)=>{const r=await fetch(base+'/api/admin/game-studio/learning/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{}});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 const c=await api('catalogue'),game=c.templates.find(x=>x.kind==='game').body,pack=c.templates.find(x=>x.kind==='skillPack').body;

 browser=await learningBrowser(base,{startupTimeoutMs:60000});const {evaluate:e,wait,click,set,send}=browser;
 const ready=()=>wait("document.body.getAttribute('aria-busy')==='false'");
 const frame=()=>wait("document.getElementById('game-editor-frame')?.dataset.ready==='true'");
 const frameClick=async selector=>{await ready();await frame();await wait(`!!document.getElementById('game-editor-frame').contentDocument.querySelector(${JSON.stringify(selector)})`);await e(`document.getElementById('game-editor-frame').contentDocument.querySelector(${JSON.stringify(selector)}).click()`);};
 const screenshot=async name=>{console.log('Verified screen: '+name);await e('window.scrollTo(0,0)');await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,name+'.png'),Buffer.from(r.data,'base64')));};
 await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('dashboard-game')?.disabled===false");await screenshot('dashboard');
 await click('dashboard-game');await frame();await frameClick('[data-engine=memory]');await click('flow-step-1');await ready();
 assert.deepEqual(await e("[...document.getElementById('flow-learning-path').options].map(o=>o.value)"),['pairs']);
 await click('tab-details');await frame();await frameClick('[data-engine=rocket]');await set('object-title','Guided spelling adventure');await set('composer-brief','Create a two-level rocket spelling game for Grade 2. First spell CAT, then SHIP. Friendly space adventure. Use 0 obstacles and no finish portal.');await set('composer-levels',2);await screenshot('blueprint');
 await click('composer-create');await wait("document.getElementById('notice').textContent.startsWith('Klik draft created')",240000);await ready();await frame();
 assert.equal(await e("document.querySelectorAll('[id^=outline-level-]').length"),2);
 const gameId=(await api('catalogue')).records.filter(r=>r.kind==='game').at(-1).id;
 const before=(await api('catalogue')).records.find(r=>r.id===gameId).body;
 await set('flow-learning-path','spelling');await set('flow-content-brief','Use the spelling word SUN in English and SON in Afrikaans. Spell the complete three-letter word.');await click('flow-generate-content');await wait("document.getElementById('notice').textContent.startsWith('Learning content updated')",240000);await ready();await frame();
 const changed=(await api('catalogue')).records.find(r=>r.id===gameId).body;assert.deepEqual(changed.definition.levels[1],before.definition.levels[1]);assert.deepEqual(changed.definition.levels[0].config.rules[0].values.en,['S','U','N']);await screenshot('learning');
 await click('flow-step-3');await ready();await click('flow-progression-level');await wait("document.getElementById('notice').textContent.startsWith('Added level')");assert.equal(await e("document.querySelectorAll('[id^=outline-level-]').length"),3);await click('outline-level-0');await ready();await screenshot('progression');
 await click('flow-step-2');await ready();await frame();
 if(live||process.env.FACTORY_RECORDED_IMAGE_FILE){
  await set('flow-art-type','background');await set('flow-art-brief','A calm violet and cyan alien planet vista for a spelling adventure. Rounded friendly distant hills, warm golden stars, spacious dark centre, no text, no characters.');await click('flow-generate-art');await wait("document.getElementById('notice').textContent==='Artwork ready for your review.'",240000);await ready();await screenshot('artwork-review');
  await e("document.getElementById('flow-media-reviewed').checked=true");await click('flow-approve-media');await wait("document.getElementById('notice').textContent==='Approved asset attached to this draft.'",60000);await ready();
 }
 await click('flow-media-audio');await ready();await set('flow-audio-kind','soundEffect');await set('flow-audio-text','A short soft magical chime, friendly and bright, for discovering a star.');await set('flow-audio-seconds',1);await click('flow-generate-audio');await wait("document.getElementById('notice').textContent.startsWith('Audio ready')",120000);await ready();
 await send('Runtime.evaluate',{expression:"document.getElementById('flow-audio-player').play()",awaitPromise:true,userGesture:true});await wait("document.getElementById('flow-audio-player').ended",20000);await e("document.getElementById('flow-media-reviewed').checked=true");await set('flow-asset-target','prompt');await click('flow-approve-media');await wait("document.getElementById('notice').textContent==='Approved asset attached to this draft.'",30000);await ready();await screenshot('scene-audio');
 const mediaPreview=await api('preview',{id:gameId});await writeFile(join(evidence,'preview.json'),JSON.stringify(mediaPreview));if(live||process.env.FACTORY_RECORDED_IMAGE_FILE)assert.ok(mediaPreview.worldImage,'Approved background must reach runtime preview');
 await click('tab-preview');await ready();await click('open-preview');await wait("document.getElementById('preview-status')?.textContent.startsWith('Ready to play')||document.getElementById('notice').classList.contains('error')",90000);assert.equal(await e("document.getElementById('notice').classList.contains('error')"),false,await e("document.getElementById('notice').textContent"));await ready();await new Promise(r=>setTimeout(r,1000));await screenshot('play');await e("document.getElementById('runtime-preview').scrollIntoView({block:'center'})");await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,'play-artwork.png'),Buffer.from(r.data,'base64')));
 await click('flow-step-5');await ready();await set('review-note','Isolated browser acceptance: checked content, generated media and actual runtime loading.');await click('approve');await wait("document.getElementById('notice').textContent==='Recorded approve.'");await click('publish-test');await wait("document.getElementById('notice').textContent.includes('immutable TEST revision')");
 assert.equal((await api('revisions/'+gameId)).items.length,1);
 await click('create-mission');await frame();await click('flow-add-stage');await wait("document.getElementById('notice').textContent.startsWith('Added stage')");assert.equal(await e("document.querySelectorAll('[id^=outline-stage-]').length"),3);
 await click('create-pack');await ready();await click('flow-add-week');await wait("document.getElementById('notice').textContent.startsWith('Added week')");
 const packRow=(await api('catalogue')).records.filter(r=>r.kind==='skillPack').at(-1),v=packRow.body.definition.v2;assert.equal(v.pack.weeks.length,2);const m=v.pack.weeks.map(w=>v.missions.find(m=>m.id===w.mission));assert.ok(m[0].stages.filter(s=>s.game).every(s=>!m[1].stages.some(t=>t.game===s.game)));
 const practice=m[1].stages.findIndex(s=>s.kind==='practice');await click('outline-activity-'+practice);await ready();await click('flow-step-1');await ready();await set('flow-content-brief','Refresh the instructions for this existing practice activity. Preserve the answers and their correct letter tiles.');await click('flow-generate-content');await wait("document.getElementById('notice').textContent.startsWith('Learning content updated')",240000);await ready();await screenshot('skill-pack');
 const packAfter=(await api('catalogue')).records.find(r=>r.id===packRow.id);assert.equal(packAfter.body.definition.v2.pack.weeks.length,2);assert.deepEqual(packAfter.body.definition.v2.games.filter(g=>m[0].stages.some(s=>s.game===g.id)),v.games.filter(g=>m[0].stages.some(s=>s.game===g.id)));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('mobile');assert.ok(await e('document.documentElement.scrollWidth<=window.innerWidth+1'),'Mobile horizontal overflow');
 assert.deepEqual(browser.errors,[]);assert.deepEqual([...new Set(browser.network.filter(u=>/^https?:/.test(u)&&!u.startsWith(base+'/')))],[]);
 const result={status:'PASS',liveProviders:live,providerCalls:calls,engineSpecificPaths:true,scopedContentRegeneration:true,independentWeeks:true,stageAndLevelAddition:true,approvedAudioAttachment:true,artworkApproval:!!(live||process.env.FACTORY_RECORDED_IMAGE_FILE),actualFlutterPreview:true,immutableTestPublication:true,mobileLayout:true,ownerSession:false};await writeFile(join(evidence,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){if(browser){await writeFile(join(evidence,'failure-state.json'),JSON.stringify(await browser.evaluate("({notice:document.getElementById('notice')?.textContent,html:document.getElementById('workspace')?.innerHTML})")));await writeFile(join(evidence,'browser-errors.json'),JSON.stringify(browser.errors,null,2));await browser.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,'failure.png'),Buffer.from(r.data,'base64')));}throw error;
}finally{await browser?.close();await new Promise(r=>server.close(r));await runtime.dispose();}
