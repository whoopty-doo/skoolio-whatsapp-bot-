import { validateKnowledgeDocument } from './knowledge-schema.js';
import { parseObject, sanitize } from './privacy.js';

export async function listSupportGuides(store) {
  const page = await store.list({ prefix: 'support-guide:', limit: 100 });
  return (await Promise.all(page.keys.map(key => store.get(key.name).then(parseObject)))).filter(Boolean);
}

export async function saveSupportGuide(store, input) {
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  if (!['PLAYSMART', 'READSMART', 'SKOOLIO_ADMIN'].includes(input.product)) fail('Choose a product.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) fail('A title of up to 120 characters is required.');
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 6000) fail('Instructions of up to 6000 characters are required.');
  if (typeof input.published !== 'boolean') fail('Choose whether this guide is published.');
  if (typeof input.keywords !== 'string' || input.keywords.length > 500) fail('Keywords must be text of up to 500 characters.');
  if (input.id !== undefined && !/^guide-owner-[a-f0-9-]{36}$/.test(input.id)) fail('Invalid guide identifier.');
  const id = input.id || `guide-owner-${crypto.randomUUID()}`;
  const existing = parseObject(await store.get(`support-guide:${id}`));
  if (input.id && !existing) fail('Guide not found.', 404);
  if (existing && input.revision !== existing.revision) fail('This guide changed. Reload it before saving.', 409);
  if (!existing && (await listSupportGuides(store)).length >= 100) fail('The guide limit of 100 has been reached. Edit an existing guide instead.');
  const guide = { id, product: input.product, title: sanitize(input.title, 120), content: sanitize(input.content, 6000), keywords: sanitize(input.keywords, 500).split(',').map(word => word.trim()).filter(Boolean), published: input.published, revision: (existing?.revision || 0) + 1, updated_at: new Date().toISOString(), version: String((existing?.revision || 0) + 1), support_safe: true, visibility: 'PUBLIC_SUPPORT', document_type: 'HOW_TO', module: 'how_to', source: 'owner-authored' };
  if (!guide.title || !guide.content) fail('A title and instructions are required.');
  const document = ownerGuideDocument({ ...guide, published: true });
  if (!document || validateKnowledgeDocument(document).length) fail('Review the guide metadata, keywords and content; remove private details or credentials.');
  await store.put(`support-guide:${id}`, JSON.stringify(guide));
  return guide;
}

// Compatibility adapter for previously saved owner guides, not a second store.
export function ownerGuideDocument(guide) {
  if (!guide || guide.published !== true || guide.source !== 'owner-authored' || !['PUBLIC', 'PUBLIC_SUPPORT'].includes(guide.visibility) || guide.support_safe === false || !['SUPPORT_GUIDE', 'HOW_TO'].includes(guide.document_type)) return null;
  return { id: guide.id, product: guide.product, module: guide.module || 'how_to', title: guide.title, content: guide.content, keywords: guide.keywords?.length ? guide.keywords : [guide.title], document_type: 'HOW_TO', version: guide.version || String(guide.revision || 1), updated_at: guide.updated_at, source: 'owner-authored', visibility: 'PUBLIC_SUPPORT', support_safe: true };
}
