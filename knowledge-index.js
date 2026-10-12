const STOP = new Set('a an the and or for with this that these those how can do does did are is was were be been you your our my me i we want would could should help please product playsmart readsmart skoolio admin about what when where why have has had some any just need tell know show use using question current clarification voice note transcription screenshot description extracted ai'.split(' '));
const ALIASES = { spelling: 'spelling', spell: 'spelling', spel: 'spelling', reading: 'reading', read: 'reading', lees: 'reading', leesspoed: 'speed', speed: 'speed', spoed: 'speed', stadiger: 'speed', sync: 'sync', syncing: 'sync', synced: 'sync', synchronization: 'sync', synchronisation: 'sync', sinkroniseer: 'sync', reports: 'report', reporting: 'report', verslag: 'report', learners: 'learner', students: 'learner', student: 'learner', leerling: 'learner', leerders: 'learner', settings: 'setting', instellings: 'setting', lessons: 'lesson', les: 'lesson', lesse: 'lesson', words: 'word', woorde: 'word', results: 'result', uitslae: 'result', tenants: 'tenant', retries: 'retry', retrying: 'retry', login: 'login', aanmeld: 'login' };
export function knowledgeTokens(value) {
  return [...new Set(String(value || '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 2 && !STOP.has(token)).map(token => ALIASES[token] || token))].slice(0, 200);
}
export function indexKnowledgeDocument(doc) {
  return { topic: knowledgeTokens(`${doc.title} ${doc.module} ${doc.keywords.join(' ')} ${(doc.troubleshooting?.symptoms || []).join(' ')}`), module: knowledgeTokens(doc.module), body: knowledgeTokens(doc.content) };
}
export class LocalKnowledgeIndex {
  constructor(documents, prepared = {}) {
    this.documents = documents;
    this.postings = new Map();
    for (const doc of documents) {
      const terms = prepared[doc.id] || indexKnowledgeDocument(doc);
      if (!this.postings.has(doc.product)) this.postings.set(doc.product, new Map());
      const product = this.postings.get(doc.product);
      for (const token of new Set([...terms.topic, ...terms.body])) {
        if (!product.has(token)) product.set(token, new Map());
        product.get(token).set(doc.id, terms.module?.includes(token) ? 7 : terms.topic.includes(token) ? 3 : 1);
      }
    }
  }
  search({ product, query, limit = 8, allowedIds }) {
    const tokens = knowledgeTokens(query);
    if (!tokens.length) return [];
    const scores = new Map(), postings = this.postings.get(product);
    for (const token of tokens) for (const [id, weight] of postings?.get(token) || []) {
      if (!allowedIds.has(id)) continue;
      const score = scores.get(id) || { score: 0, matches: 0, topic: 0 };
      score.score += weight; score.matches++; if (weight >= 3) score.topic++;
      scores.set(id, score);
    }
    return [...scores].filter(([, s]) => s.topic > 0 && s.matches / tokens.length >= 0.2)
      .map(([id, s]) => ({ id, score: s.score, confidence: Math.min(0.95, 0.3 + 0.5 * s.matches / tokens.length + 0.05 * Math.min(s.topic, 3)) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
