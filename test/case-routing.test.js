import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { CaseRepository } from '../support-cases.js';
const cases = f => new CaseRepository(f.store()).list();

test('distinct PlaySmart problems receive new IDs without a new-issue command', async () => {
  const f = setup();
  await f.send('Bug: Playsmart has an issue');
  await f.send('PlaySmart spelling crashes when I press Start');
  await f.send('PlaySmart login rejects my password');
  const items = await cases(f);
  assert.deepEqual(new Set(items.map(x => x.case_id)), new Set(['PS-000001', 'PS-000002', 'PS-000003']));
  assert.equal(items.find(x => x.case_id === 'PS-000001').user_description, 'Bug: Playsmart has an issue');
  assert.match(items.find(x => x.case_id === 'PS-000002').user_description, /spelling/);
  assert.match(items.find(x => x.case_id === 'PS-000003').user_description, /login/);
});
test('same-screen ambiguity saves the report until the customer chooses new or same', async () => {
  for (const choice of ['new issue', 'same issue']) {
    const f = setup(); await f.send('ReadSmart reading crashes on Start');
    const report = 'ReadSmart reading shows the wrong result after finishing';
    const question = await (await f.send(report)).text(); assert.match(question, /separate issue/);
    assert.equal((await cases(f)).length, 1);
    assert.doesNotMatch((await cases(f))[0].user_description, /wrong result/);
    assert.match(await (await f.send('yes')).text(), /new issue/);
    const reply = await (await f.send(choice)).text();
    assert.equal((await cases(f)).length, choice === 'new issue' ? 2 : 1);
    assert.match(reply, choice === 'new issue' ? /RS-000002/ : /RS-000001/);
    assert.ok((await cases(f)).some(x => x.user_description.includes(report)));
  }
});
test('pending questions do not swallow another feature; clear follow-ups and case references keep the original ID', async () => {
  const f = setup(); await f.send('PlaySmart login fails');
  await f.send('It still fails on Windows too'); assert.equal((await cases(f)).length, 1);
  await f.send('Spelling crashes when I press Start'); assert.equal((await cases(f)).length, 2);
  await f.send('PS-000001 it also happens on Android'); assert.equal((await cases(f)).length, 2);
  assert.match((await cases(f)).find(x => x.case_id === 'PS-000001').user_description, /Android/);
  assert.match(await (await f.send('status PS-000002')).text(), /PS-000002/);
});
test('another problem and Afrikaans separate-problem wording create a fresh case', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes');
  await f.send('Another problem: spelling shows a blank screen');
  await f.send('Nuwe probleem: PlaySmart spelling werk nie');
  assert.equal((await cases(f)).length, 3);
});
