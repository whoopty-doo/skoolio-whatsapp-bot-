import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { accessHeaders, adminConfig } from '../test/helpers.js';
const auth = await accessHeaders(); let externalCalls = 0;
const built = await build({ entryPoints:['worker.js'], bundle:true, format:'esm',write:false,platform:'browser',target:'es2022' });
const runtime = new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-09-21',kvNamespaces:['NOTES_KV','RECOVERY_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},SUPPORT_RECOVERY:{className:'StagingRecoveryCoordinator',useSQLite:true}},bindings:{...adminConfig,ENVIRONMENT:'staging',VALIDATE_TWILIO_SIGNATURE:'true',TWILIO_AUTH_TOKEN:'synthetic',COORDINATOR_BOOTSTRAP_APPROVED:'true'},outboundService:async request=>{if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});externalCalls++;return new Response('Provider access disabled',{status:403});}}));
const base='https://skoolio-support-staging.cowleyjared.workers.dev';
const post=suffix=>runtime.dispatchFetch(base+'/api/admin/staging-rehearsal'+suffix,{method:'POST',headers:{...auth.headers,'Content-Type':'application/json'},body:'{}'});
try{
  assert.equal((await runtime.dispatchFetch(base+'/api/admin/cases',auth)).status,200);
  const response=await post('');const report=await response.json();assert.equal(response.status,200,JSON.stringify(report));assert.equal(report.finalCases,2);
  assert.equal((await post('')).status,409);
  let final;
  for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,1000));const r=await post('?finalize=true');final=await r.json();if(r.status===200)break;assert.equal(r.status,202);}
  assert.equal(final.alarmVerification,'PASSED');assert.equal(final.recoveryMode,'hold');assert.equal(final.primaryMode,'live');assert.equal(final.providerAcceptedMessages,0);assert.equal(externalCalls,0);
  const kv=await runtime.getKVNamespace('RECOVERY_KV');assert.equal((await kv.list({prefix:'support-case:'})).keys.filter(k => /^support-case:(?:PS|RS|SA|GS)-\d+$/.test(k.name)).length,2);
  console.log('Actual local workerd: owner-triggered staging rehearsal, durable run lock/report, protected recursive routing, isolated replay, alarm finalization and recovery mirrors passed. External provider calls: 0.');
}finally{await runtime.dispose();}
