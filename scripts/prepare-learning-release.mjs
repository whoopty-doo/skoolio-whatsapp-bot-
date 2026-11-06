// Add the reviewed Factory source to an exact deployed Worker without replacing
// independently released Store, Licence Hub, support, or authentication code.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';

export function overlayLearningFactory(baseline, addition) {
  const edits = [
    ['const admin = url.pathname === "/admin/licence-hub"', 'const admin = url.pathname === "/admin/learning-factory" || url.pathname === "/admin/licence-hub"'],
    ['      if (url.pathname === "/admin/game-studio")', '      if (url.pathname === "/admin/learning-factory") return request.method === "GET" ? LearningFactoryRelease.learningStudioResponse() : jsonResponse({error:"Method not allowed"},405);\n      if (url.pathname.startsWith("/api/admin/game-studio/learning/")) return LearningFactoryRelease.gameStudioProxy(request,env);\n      if (url.pathname === "/admin/game-studio" && url.searchParams.get("learning") !== "1" && url.searchParams.get("legacy") !== "1") return request.method === "GET" ? LearningFactoryRelease.learningStudioResponse() : jsonResponse({error:"Method not allowed"},405);\n      if (url.pathname === "/admin/game-studio" && url.searchParams.get("learning") === "1") return request.method === "GET" ? LearningFactoryRelease.universalStudioResponse({embedded:true}) : jsonResponse({error:"Method not allowed"},405);\n      if (url.pathname === "/admin/game-studio")'],
    ['<a class="nav-item" href="/admin/licence-hub">Licence Hub</a><a class="nav-item" href="/admin/game-studio">Game Studio</a>', '<a class="nav-item" href="/admin/licence-hub">Licence Hub</a><a class="nav-item" href="/admin/game-studio">Game Factory</a>'],
    ['// admin-release/worker.js', addition + '\n// admin-release/worker.js'],
  ];
  if (baseline.includes('LearningFactoryRelease')) throw Error('Factory overlay already present');
  let candidate = baseline;
  for (const [before, after] of edits) {
    if (candidate.split(before).length !== 2) throw Error('Live Worker shape changed; review required');
    candidate = candidate.replace(before, () => after);
  }
  let restored = candidate;
  for (const [before, after] of [...edits].reverse()) restored = restored.replace(after, () => before);
  if (restored !== baseline) throw Error('Live Worker preservation failed');
  return candidate;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baselinePath, expectedHash, outputPath] = process.argv.slice(2);
  if (!baselinePath || !/^[a-f0-9]{64}$/.test(expectedHash || '') || !outputPath) throw Error('Usage: node scripts/prepare-learning-release.mjs BASELINE EXPECTED_SHA256 OUTPUT');
  const baseline = readFileSync(baselinePath, 'utf8');
  const sha = value => createHash('sha256').update(value).digest('hex');
  if (sha(baseline) !== expectedHash) throw Error('Live Worker baseline drift');
  const addition = await build({stdin:{contents:"export {learningStudioResponse} from './learning-studio.js'; export {universalStudioResponse} from './universal-studio.js'; export {gameStudioProxy} from './game-studio-proxy.js';", resolveDir:fileURLToPath(new URL('../', import.meta.url)), sourcefile:'learning-release-entry.js'}, bundle:true, format:'iife', globalName:'LearningFactoryRelease', platform:'browser', target:'es2022', write:false});
  const candidate = overlayLearningFactory(baseline, addition.outputFiles[0].text);
  writeFileSync(outputPath, candidate, {mode:0o600, flag:'wx'});
  console.log(JSON.stringify({baselineSha256:expectedHash,candidateSha256:sha(candidate),exactInverse:true,backendGateUnchanged:true}));
}
