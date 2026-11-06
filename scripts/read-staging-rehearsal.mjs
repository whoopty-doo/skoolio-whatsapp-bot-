// Read-only Cloudflare polling. Saves synthetic snapshots privately, never tokens.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { validateSnapshot } from '../recovery.js';
const token=(await readFile('/Users/jaredcowley/Library/Preferences/.wrangler/config/default.toml','utf8')).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw new Error('Cloudflare login required');
const base='https://api.cloudflare.com/client/v4/accounts/9a735099f119c54fac3674b6d165b5c9/storage/kv/namespaces/015fcf45ef6a4f058b8b1b88fb0b0584/values/';
const read=async key=>{const response=await fetch(base+encodeURIComponent(key),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(response.status===404)return null;if(!response.ok)throw new Error(`Read-only staging report HTTP ${response.status}`);return response.json();};
console.log('Waiting for the owner-triggered staging rehearsal report.');
const deadline=Date.now()+10*60*1000;let report;
while(Date.now()<deadline){report=await read('staging-rehearsal:latest');if(report?.status==='FAILED'||(report?.status==='PASSED'&&report.alarmVerification==='PASSED'))break;await new Promise(r=>setTimeout(r,5000));}
if(!report)throw new Error('No completed owner-triggered rehearsal yet; production is unchanged');
if(!/^[a-f0-9]{12}$/.test(report.run))throw new Error('Unexpected staging run identifier');
const directory=`.artifacts/staging-cutover/server-${report.run}`;await mkdir(directory,{recursive:true,mode:0o700});
await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(report.status==='PASSED'&&report.alarmVerification==='PASSED'){
  for(const name of ['before','held','after']){const snapshot=await read(`staging-rehearsal:${report.run}:${name}`);await validateSnapshot(snapshot);await writeFile(`${directory}/${name}.private.json`,JSON.stringify(snapshot),{mode:0o600});}
  console.log(JSON.stringify({...report,artifacts:directory},null,2));
}else{console.log(JSON.stringify({status:report.status,primaryHeld:report.primaryHeld,alarmVerification:report.alarmVerification,error:report.error,artifacts:directory},null,2));process.exitCode=1;}
