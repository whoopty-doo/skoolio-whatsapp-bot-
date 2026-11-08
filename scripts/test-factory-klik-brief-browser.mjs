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
const calls=[],requests=[];
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
  const input=JSON.parse((await request.json()).input);requests.push(input);let output;
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
 // A fresh creation must never send an empty, whitespace or two-character brief.
 await click('dashboard-game');await frame();
 assert.equal(await e("document.getElementById('composer-create').disabled"),true);
 for(const brief of ['', '  ', ' a ']){await set('composer-brief',brief);assert.equal(await e("document.getElementById('composer-create').disabled"),true);}
 await set('composer-brief','Create a two-level spelling Game.');await set('composer-levels',2);
 assert.equal(await e("document.getElementById('composer-create').disabled"),false);
 await click('composer-create');await wait("document.getElementById('notice').textContent.startsWith('Klik draft created')");await ready();await frame();
 const initialCalls=requests.length;
 assert.equal(await e("document.getElementById('flow-content-brief').value"),'');
 assert.equal(await e("document.getElementById('flow-generate-content').disabled"),true);
 // Also guard a programmatic submit: no draft save or provider call may happen.
 await e("document.getElementById('flow-generate-content').onclick()");await ready();
 assert.match(await e("document.getElementById('notice').textContent"),/Tell Klik what to create/);
 assert.equal(requests.length,initialCalls);
 for(const brief of ['', '  ', 'ab']){await set('flow-content-brief',brief);assert.equal(await e("document.getElementById('flow-generate-content').disabled"),true);}
 await click('flow-use-instructions');await ready();
 assert.equal(await e("document.getElementById('flow-generate-content').disabled"),false);
 const suggestion=await e("document.getElementById('flow-content-brief').value");assert.match(suggestion,/Create fresh educational content/);
 await set('flow-content-brief','  Use the spelling word SUN in English and SON in Afrikaans.  ');
 await click('flow-step-3');await ready();await click('flow-step-1');await ready();await frame();
 assert.equal(await e("document.getElementById('flow-content-brief').value"),'  Use the spelling word SUN in English and SON in Afrikaans.  ');
 await click('outline-level-1');await ready();await frame();assert.equal(await e("document.getElementById('flow-content-brief').value"),'');
 await set('flow-content-brief','Create harder words for the second level.');await click('outline-level-0');await ready();await frame();
 assert.match(await e("document.getElementById('flow-content-brief').value"),/SUN/);
 await click('flow-generate-content');await wait("document.getElementById('notice').textContent.startsWith('Learning content updated')");await ready();
 assert.equal(requests.at(-1).brief,'Use the spelling word SUN in English and SON in Afrikaans.');
 await click('flow-step-5');await ready();
 assert.equal(await e("document.getElementById('section-regenerate-details').disabled"),true);
 await set('section-brief-details','Keep this regeneration request after switching tabs.');
 await click('flow-step-1');await ready();await click('flow-step-5');await ready();
 assert.equal(await e("document.getElementById('section-brief-details').value"),'Keep this regeneration request after switching tabs.');
 // The requested Word Power activity uses the same safe, preserved input flow.
 await click('create-pack');await ready();await click('flow-step-1');await ready();
 const packRow=(await api('catalogue')).records.filter(r=>r.kind==='skillPack').at(-1),v=packRow.body.definition.v2;
 const mission=v.missions.find(m=>m.id===v.pack.weeks[0].mission),practice=mission.stages.findIndex(s=>s.kind==='practice');
 await click('outline-activity-'+practice);await ready();
 assert.equal(await e("document.getElementById('flow-generate-content').disabled"),true);
 await click('flow-use-instructions');await ready();
 assert.equal(await e("document.getElementById('flow-generate-content').disabled"),false);
 const packBrief=await e("document.getElementById('flow-content-brief').value");
 await click('tab-details');await ready();await click('flow-step-1');await ready();assert.equal(await e("document.getElementById('flow-content-brief').value"),packBrief);
 await click('flow-generate-content');await wait("document.getElementById('notice').textContent.startsWith('Learning content updated')");await ready();
 assert.equal(requests.at(-1).brief,packBrief);
 assert.equal((await api('catalogue')).records.find(r=>r.id===packRow.id).editVersion,packRow.editVersion+1);
 await screenshot('word-power-content');assert.deepEqual(browser.errors,[]);
 const result={status:'PASS',emptyAndWhitespaceBlocked:true,noProviderCallOnInvalidInput:true,contextShortcut:true,trimmedRequest:true,requestsSurviveNavigation:true,requestsIsolatedPerActivity:true,sectionRequestPreserved:true,wordPowerContentSaved:true,liveProviders:false,ownerSession:false};
 await writeFile(join(evidence,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){if(browser){await writeFile(join(evidence,'failure-state.json'),JSON.stringify(await browser.evaluate("({notice:document.getElementById('notice')?.textContent,html:document.getElementById('workspace')?.innerHTML})")));await writeFile(join(evidence,'browser-errors.json'),JSON.stringify(browser.errors,null,2));await browser.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,'failure.png'),Buffer.from(r.data,'base64')));}throw error;
}finally{await browser?.close();await new Promise(r=>server.close(r));await runtime.dispose();}
