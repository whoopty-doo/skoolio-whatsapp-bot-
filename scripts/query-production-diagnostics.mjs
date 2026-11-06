import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('wrangler.production.reviewed.json', 'utf8'));
const auth = await readFile('/Users/jaredcowley/Library/Preferences/.wrangler/config/default.toml', 'utf8');
const token = process.env.CLOUDFLARE_API_TOKEN || auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/observability/telemetry/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ queryId: 'skoolio-media-diagnostic', dry: true, view: 'events', limit: 100, timeframe: { from: Date.now() - 30 * 60000, to: Date.now() }, parameters: { filters: [{ key: '$metadata.service', type: 'string', operation: 'eq', value: 'skoolio-whatsapp-bot' }] } }), signal: AbortSignal.timeout(20000) });
const data = await response.json();
console.log(JSON.stringify({status:response.status,success:data.success,resultKeys:Object.keys(data.result || {}),errors:data.errors?.map(e=>({code:e.code,message:e.message}))}));
if (!response.ok) process.exit(1);
const events = data.result?.events?.events || data.result?.events || [];
if(!Array.isArray(events)) {console.log(JSON.stringify({eventKeys:Object.keys(events)}));process.exit(0);}
for(const event of events){
 const workers=event.$workers || {}, metadata=event.$metadata || {}, source=event.source || event;
 let message; try {message=typeof source.message==='string'?JSON.parse(source.message):source.message;}catch{}
 const record={at:event.timestamp || metadata.timestamp,trigger:metadata.trigger,outcome:workers.outcome,eventType:workers.eventType,status:workers.event?.response?.status};
 const known=message?.event || source.event;
 if(['media_extraction_failed','notification_outcome','media_processing_summary'].includes(known)) {
  const item=message?.event?message:source;
  record.diagnostic=Object.fromEntries(['event','code','stage','status','retry','attempt','reason','outcome','pending','failed','completed'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]]));
 }
 if(record.diagnostic || record.outcome && record.outcome!=='ok')console.log(JSON.stringify(record));
}
console.log(JSON.stringify({events:events.length,firstEventKeys:Object.keys(events[0]||{})}));
