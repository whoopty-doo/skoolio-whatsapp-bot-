import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
export async function learningBrowser(base,{startupTimeoutMs=15000}={}){
 const url=new URL(base);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');assert.equal((await(await fetch(base+'/fixture/health')).json()).synthetic,true);
 const profile=await mkdtemp(join(tmpdir(),'learning-factory-browser-'));
 const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout')),startupTimeoutMs);browser.stderr.on('data',bytes=>{output+=bytes;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});browser.on('error',reject);}).catch(async error=>{browser.kill('SIGKILL');await new Promise(r=>browser.exitCode!==null||browser.signalCode!==null?r():browser.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});throw error;});
 const socket=new WebSocket(endpoint);await new Promise(r=>socket.once('open',r));let next=0;const pending=new Map(),errors=[],network=[];
 socket.on('message',raw=>{const message=JSON.parse(raw);if(message.id){const call=pending.get(message.id);pending.delete(message.id);message.error?call.reject(Error(message.error.message)):call.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);else if(message.method==='Network.requestWillBeSent')network.push(message.params.request.url);else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));else if(message.method==='Network.responseReceived'&&message.params.response.status>=400&&!message.params.response.url.endsWith('/favicon.ico'))errors.push('HTTP '+message.params.response.status+' '+message.params.response.url);});
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 const send=(method,params)=>command(method,params,sessionId);
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Log.enable');
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async(expression,ms=30000)=>{const end=Date.now()+ms;while(!await evaluate(expression)){if(Date.now()>end)throw Error('Timed out: '+expression+'\n'+JSON.stringify(await evaluate("document.getElementById('notice')?.textContent")));await new Promise(r=>setTimeout(r,75));}};
 const click=async id=>{await wait(`document.getElementById(${JSON.stringify(id)})?.disabled===false`);return evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);};
 const set=async(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
 return {send,evaluate,wait,click,set,errors,network,async close(){socket.close();await new Promise(r=>{if(browser.exitCode!==null||browser.signalCode!==null)return r();const timer=setTimeout(()=>browser.kill('SIGKILL'),5000);browser.once('exit',()=>{clearTimeout(timer);r();});browser.kill();});await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}
