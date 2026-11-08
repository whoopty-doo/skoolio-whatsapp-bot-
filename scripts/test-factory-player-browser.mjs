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
const auth=await accessHeaders({exp:Math.floor(Date.now()/1000)+3600});
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.wav':'audio/wav','.woff2':'font/woff2','.otf':'font/otf','.ttf':'font/ttf'};
const runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:release,modules:['candidate.mjs','factory-workspace.generated.js','factory-preview.js'].map(path=>({type:'ESModule',path:join(release,path)})),compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],name:'factory-player-browser',kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},LEARNING_FACTORY_WORKSPACE:{className:'LearningFactoryCoordinator',useSQLite:true}},bindings:{...adminConfig,ENVIRONMENT:'production',LEARNING_FACTORY_HOSTED_ENABLED:'true',FACTORY_VISUAL_ENABLED:'true',OPENAI_API_KEY:'synthetic-test-only',OPENAI_MODEL:'gpt-4o-mini'},serviceBindings:{FACTORY_PREVIEW_ASSETS:async request=>{
 const path=decodeURIComponent(new URL(request.url).pathname).replace(/^\/factory-preview\//,'');
 const file=resolve(assets,path);if(!file.startsWith(assets+'/'))return new Response('Not found',{status:404});
 try{const bytes=await readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}},outboundService:async request=>{
 if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});
 if(request.url==='https://api.openai.com/v1/responses'){const input=JSON.parse((await request.json()).input);return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(missionPlanFixture(input.bodyTemplate,2))}]}]});}
 throw Error('External network forbidden: '+new URL(request.url).hostname);
}}));
const server=createServer(async(req,res)=>{try{
 if(req.url==='/fixture/health'){res.setHeader('Content-Type','application/json');res.end('{"synthetic":true}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);
 const response=await runtime.dispatchFetch('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:{...req.headers,...auth.headers},...chunks.length?{body:Buffer.concat(chunks)}:{}});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(500);res.end('Isolated test request failed');console.error(error.message);}});
let browser;
try{
 assert.equal((await runtime.dispatchFetch('https://example.com/factory-preview/index.html')).status,401);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,body)=>{const r=await fetch(base+'/api/admin/game-studio/learning/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{}});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 const c=await api('catalogue'),game=c.templates.find(x=>x.kind==='game').body,pack=c.templates.find(x=>x.kind==='skillPack').body;
 const rows=[];
 for(const [kind,body]of [['game',game],['skillPack',pack]])rows.push((await api('objects',{action:'save',kind,expectedVersion:0,body})).item);
 rows.push((await api('compose',{version:1,action:'create',kind:'mission',brief:'Two-stage browser gameplay regression',body:{...game,definition:{stages:[]}},levels:1,stages:2})).item);
 for(const row of rows)await api('objects',{id:row.id,expectedVersion:row.editVersion,action:'validate'});
 browser=await learningBrowser(base,{startupTimeoutMs:60000});const {evaluate:e,wait,click,send}=browser;
 const results=[];
 for(const row of rows){
  await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('notice')?.textContent.includes('ready for isolated testing')");
  await click('open-'+row.id);await click('tab-preview');await click('open-preview');
  await wait("document.getElementById('preview-status')?.textContent.startsWith('Ready to play')",90000);
  await wait("!!document.getElementById('runtime-preview').contentDocument.querySelector('flt-glass-pane')",20000);
  await e("document.getElementById('runtime-preview').contentDocument.querySelector('flt-semantics-placeholder')?.click()");
  await new Promise(r=>setTimeout(r,1500));
  await e("document.getElementById('runtime-preview').scrollIntoView({block:'center'})");
  await new Promise(r=>setTimeout(r,150));
  const frameDoc="document.getElementById('runtime-preview').contentDocument";
  const hasText=text=>`${frameDoc}.body.innerText.includes(${JSON.stringify(text)})`;
  const press=async text=>{
   const locate=`(()=>{const frame=document.getElementById('runtime-preview'),nodes=[...frame.contentDocument.querySelectorAll('[role=button],[role=option]')];const node=nodes.find(n=>(n.getAttribute('aria-label')||n.innerText||'').trim()===${JSON.stringify(text)});if(!node)return null;const a=node.getBoundingClientRect(),b=frame.getBoundingClientRect();return {x:b.x+a.x+a.width/2+1,y:b.y+a.y+a.height/2+1};})()`;
   await wait(`!!${locate}`,10000);const point=await e(locate);assert.ok(point.x>0&&point.x<1400&&point.y>0&&point.y<1100,'Control outside browser viewport: '+text);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
   await new Promise(r=>setTimeout(r,80));
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  };
  if(row.kind==='skillPack'){
   await press('Start the mission');await wait(hasText('1 of 7 stages completed'));await press('Pause');await wait(hasText('Resume'));await press('Resume');
  }else{
   await press('Start / resume');await wait(`!${hasText('Start / resume')}`);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
   await new Promise(r=>setTimeout(r,300));
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await wait(hasText('Start / resume'));await press('Start / resume');await wait(`!${hasText('Start / resume')}`);await press('Pause');await wait(hasText('Start / resume'));
   if(row.kind==='mission'){await press('Letter rescue 1');await press('Letter rescue 2');await wait(hasText('Letter rescue 2'));await press('Start / resume');await wait(`!${hasText('Start / resume')}`);await press('Pause');}
  }
  await e("document.getElementById('runtime-preview').scrollIntoView({block:'center'})");
  const state=await e("({status:document.getElementById('preview-status').textContent,text:document.getElementById('runtime-preview').contentDocument.body.innerText,semantics:document.getElementById('runtime-preview').contentDocument.querySelector('flt-semantics-host')?.outerHTML.slice(0,30000)})");
  await writeFile(join(evidence,row.kind+'-state.json'),JSON.stringify(state,null,2));
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,row.kind+'.png'),Buffer.from(r.data,'base64')));
  results.push({kind:row.kind,loaded:true,startPauseResume:true,keyboard:row.kind!=='skillPack',stageSwitch:row.kind==='mission'});
 }
 await send('Runtime.evaluate',{expression:"document.getElementById('runtime-preview').requestFullscreen()",awaitPromise:true,userGesture:true});await wait("document.fullscreenElement?.id==='runtime-preview'");await e("document.exitFullscreen()");
 await writeFile(join(evidence,'browser-errors.json'),JSON.stringify(browser.errors,null,2));
 assert.deepEqual(browser.errors,[]);
 assert.deepEqual([...new Set(browser.network.filter(url=>/^https?:/.test(url)&&!url.startsWith(base+'/')))],[]);
 console.log(JSON.stringify({status:'PASS',results,fullscreen:true,externalGameplayRequests:0,ownerSession:false}));
}catch(error){if(browser){await writeFile(join(evidence,'failure-state.json'),JSON.stringify(await browser.evaluate("document.getElementById('runtime-preview')?.contentDocument?.body?.innerHTML")));await writeFile(join(evidence,'browser-errors.json'),JSON.stringify(browser.errors,null,2));await browser.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,'failure.png'),Buffer.from(r.data,'base64')));}throw error;
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}
