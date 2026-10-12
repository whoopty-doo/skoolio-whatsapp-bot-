// An open case is context, not permission to append every later problem to it.
export function caseRelationship({ message, active, reference, issue, attachment, feature }) {
  if (reference) return 'follow_up';
  if (/\b(?:(?:new|another|different|separate|unrelated) (?:issue|problem|case|bug)|(?:nuwe|ander|aparte) (?:probleem|fout|saak))\b/i.test(message) || /^(?:bug|issue|problem|feedback)\s*:/i.test(message)) return 'new';
  const oldFeature = active.feature_module?.toLowerCase();
  if (issue && feature && oldFeature && feature.toLowerCase() !== oldFeature) return 'new';
  if (/\b(?:same (?:issue|problem|case)|still|again|also happens|happens too|too|dieselfde|steeds|nog steeds)\b/i.test(message)) return 'follow_up';
  if (attachment) return 'follow_up';
  if (!issue) return active.pending_question ? 'follow_up' : 'none';
  if (feature && oldFeature && feature.toLowerCase() === oldFeature) {
    // A self-contained report about the same screen can describe a different
    // fault. Ask instead of silently combining it with the active case.
    return /^(?:it|this|that|dit)\b/i.test(message) ? 'follow_up' : 'clarify';
  }
  if (active.pending_question && !oldFeature && !/\b(?:play\s?smart|read\s?smart|rsmart|skoolio)\b/i.test(message)) return 'follow_up';
  if (/^(?:it|this|that|dit)\b/i.test(message)) return 'clarify';
  return 'new';
}
