import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeService, knowledgeForResponse } from '../knowledge.js';

const service = new KnowledgeService();
test('Klik retrieves current roster, calendar, home payload and XP guidance', () => {
  for (const [query, id] of [
    ['Skoolio roster space session mismatch', 'playsmart.roster'],
    ['My Team calendar Google iPhone export', 'playsmart.calendar'],
    ['Hoe werk die kalender skedule?', 'playsmart.calendar'],
    ['parent home lesson payload settings', 'playsmart.home-lessons'],
    ['XP', 'playsmart.rewards'],
    ['Moola unlockables', 'playsmart.rewards'],
  ]) {
    const found = service.search({ product: 'PLAYSMART', query });
    assert.equal(found[0]?.id, id, query);
    assert.ok(found.every(doc => doc.product === 'PLAYSMART'));
    assert.deepEqual(service.search({ product: 'READSMART', query }), []);
  }
});

test('current guidance preserves roster authority, snapshot semantics and export limits', () => {
  const content = id => service.search({product: 'PLAYSMART', query: {
    'playsmart.roster': 'roster spaces slots',
    'playsmart.calendar': 'calendar export Google',
    'playsmart.home-lessons': 'home payload settings',
    'playsmart.rewards': 'XP Moola unlockables',
  }[id]}).find(doc => doc.id === id).content;
  assert.match(content('playsmart.roster'), /Skoolio schedule imports no longer overwrite/);
  assert.match(content('playsmart.home-lessons'), /Later dashboard edits do not rewrite/);
  assert.match(content('playsmart.calendar'), /not a live subscription or two-way sync/);
  assert.match(content('playsmart.rewards'), /not spent or purchased/);
  const projection = JSON.stringify(knowledgeForResponse(service.search({ product: 'PLAYSMART', query: 'parent calendar export' })));
  assert.doesNotMatch(projection, /source|\/Users\/|\/api\/|sourceCommit/);
});
