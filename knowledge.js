const KNOWLEDGE_VERSION = 'playsmart-1.2.1+1';

const records = [
  {
    id: 'architecture.routes', category: 'architecture', title: 'Application routes',
    keywords: ['route', 'screen', 'page', 'navigation', 'where', 'dashboard'],
    content: 'PlaySmart uses a legacy named-route flow by default. Important routes include API login, parent authentication, activation, parent dashboard, institution dashboard, student dashboard, play, reading, spelling, comprehension, perceptual reading, perceptual spelling, evaluation, report card, and ticket. A separate GoRouter game flow also exists but is disabled by default.'
  },
  {
    id: 'students.management', category: 'student_management', title: 'Student management',
    keywords: ['student', 'learner', 'centre', 'roster', 'franchise', 'profile', 'class'],
    content: 'Centre and franchise users work with scoped student rosters. Students can be created, edited, assigned settings, moved between rosters, removed, and given catch-up work. Student dashboards provide lesson setup, play, evaluation, report-card, avatar, and profile actions.'
  },
  {
    id: 'lessons.workflow', category: 'lesson', title: 'Lesson workflow',
    keywords: ['lesson', 'activity', 'play', 'story', 'complete', 'xp', 'progress'],
    content: 'Lesson workflows include story selection, reading, spelling, comprehension, perceptual activities, ticket activities, completion, progress tracking, and XP. Offline lesson and settings writes are queued and retried when synchronization is available.'
  },
  {
    id: 'reading.workflow', category: 'reading', title: 'Reading lessons',
    keywords: ['reading', 'wpm', 'words', 'timing', 'story', 'comprehension', 'pace'],
    content: 'Reading supports word-by-word, line-by-line, page/full-text, automatic timing, and manual timing. It records WPM, story, session, date, and student progress, and can continue into comprehension. Timers pause when the app becomes inactive.'
  },
  {
    id: 'spelling.workflow', category: 'spelling', title: 'Spelling lessons',
    keywords: ['spelling', 'word', 'wrong', 'retry', 'redo', 'answer', 'afrikaans'],
    content: 'Spelling loads story word lists, supports timed display, answer submission, retry/redo behavior, English/Afrikaans feedback, wrong-word tracking, and lesson completion with correct and incorrect totals.'
  },
  {
    id: 'perceptual.reading', category: 'perceptual_reading', title: 'Perceptual reading',
    keywords: ['perceptual', 'reading', 'flash', 'lpm', 'speed', 'PERSEP'],
    content: 'Perceptual reading supports full-page and word-by-word modes with automatic or manual timing. It records WPM/LPM and updates perceptual reading speed settings. Content is bundled with the app.'
  },
  {
    id: 'perceptual.spelling', category: 'perceptual_spelling', title: 'Perceptual spelling',
    keywords: ['perceptual', 'spelling', 'flash', 'typed', 'advanced', 'SPL'],
    content: 'Perceptual spelling displays bundled SPL words for a configurable flash duration, captures typed answers, records correctness, and has standard and advanced routes.'
  },
  {
    id: 'comprehension.workflow', category: 'comprehension', title: 'Comprehension',
    keywords: ['comprehension', 'question', 'answer', 'story', 'redo', 'keyboard'],
    content: 'Comprehension loads story questions, supports previous/next navigation and keyboard submission, tracks first-round wrong answers and redo mode, and stores results locally with session context.'
  },
  {
    id: 'eye.kinetics', category: 'eye_kinetics', title: 'Eye kinetics',
    keywords: ['eye', 'kinetics', 'week', '52', 'programme', 'afrikaans'],
    content: 'Eye kinetics provides a bundled 52-week programme, defaults to the ISO week, persists selected week/date locally, and records completion in the results table.'
  },
  {
    id: 'evaluations.workflow', category: 'evaluation', title: 'Evaluations',
    keywords: ['evaluation', 'assessment', 'dominant', 'auditory', 'wilkins', 'scientific'],
    content: 'Evaluations cover reading, comprehension, form perception, sequence, auditory processing, dominant eye/ear/hand, cross dominance, eye movement notes, spelling, Wilkins, spatial relations, and scientific reports. Evaluation data is stored locally and synchronized separately.'
  },
  {
    id: 'results.reporting', category: 'results', title: 'Results and reports',
    keywords: ['result', 'report', 'report card', 'score', 'accuracy', 'parent'],
    content: 'Results cover reading, spelling, comprehension, perceptual activities, tickets, eye kinetics, and games. Results include scores, accuracy, story/session context, dates, and update metadata, with parent-facing report surfaces and cloud synchronization.'
  },
  {
    id: 'parent.functionality', category: 'parent', title: 'Parent functionality',
    keywords: ['parent', 'guardian', 'invoice', 'schedule', 'notification', 'catch-up'],
    content: 'Parent workflows include linked students, lessons, catch-up work, reports, invoices, notifications, schedules, tenant directories, affiliation requests, and student profile management.'
  },
  {
    id: 'authentication.identity', category: 'authentication', title: 'Authentication',
    keywords: ['login', 'sign in', 'password', 'jwt', 'token', 'session', 'auth'],
    content: 'Authentication supports home and institution login plus token refresh. JWT validation checks expiry, issuer, audience, nbf, and iat. Secure storage recovery clears partial or corrupt records, and expired sessions are redirected to login.'
  },
  {
    id: 'activation.entitlement', category: 'activation', title: 'Activation and licensing',
    keywords: ['activate', 'activation', 'license', 'licence', 'subscription', 'entitlement', 'device'],
    content: 'Institution activation is device-bound and centre/tenant-aware, using product or license keys and backend verification polling. Entitlements support Apple, Google Play, and other subscription sources. Subscription-required users are routed to purchase or recovery flows.'
  },
  {
    id: 'database.sqlite', category: 'database', title: 'Local SQLite database',
    keywords: ['database', 'sqlite', 'offline', 'migration', 'playsmart.db', 'local'],
    content: 'The local database is playsmart.db at schema version 14 and uses sqflite, with desktop FFI. It stores students, parents, franchises, activations, results, progress, evaluations, settings, and sync queue data. Migrations and repair logic run when the database opens.'
  },
  {
    id: 'sync.cloud', category: 'sync', title: 'Cloud and offline synchronization',
    keywords: ['sync', 'cloud', 'offline', 'firebase', 'firestore', 'api', 'queue', 'retry'],
    content: 'The app combines a gateway/API client, a Node API surface, Firebase Auth, Firestore, and an offline SQLite queue. Pending and failed operations are retried. Account-scoped payloads reduce the risk of replaying writes under another account. Direct Node API calls and gateway calls coexist.'
  },
  {
    id: 'errors.recovery', category: 'troubleshooting', title: 'Common recovery paths',
    keywords: ['error', 'failed', 'loading', 'offline', 'retry', 'missing', 'crash', 'stuck'],
    content: 'Known recovery paths include startup auth timeout recovery, secure-storage recovery, expired-session redirects, retry UI for activation and loading, cached parent/player content when sync fails, retryable offline queue entries, evaluation sync failure states, fallback screens for missing route arguments, and non-fatal handling for missing media or lesson assets.'
  },
  {
    id: 'build.platforms', category: 'platform', title: 'Build and platform information',
    keywords: ['android', 'ios', 'macos', 'windows', 'linux', 'web', 'version', 'build'],
    content: 'Flutter targets are present for Android, iOS, macOS, Linux, Windows, and Web. The app version is 1.2.1+1. Platform metadata is not fully aligned: Android still uses a default example application ID, Web branding remains partly default Flutter metadata, and Windows MSIX versioning differs from the Flutter version.'
  }
];

function tokenize(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 2);
}

function searchKnowledge(query, category, limit = 4) {
  const queryTokens = new Set(tokenize(query));
  return records
    .filter((record) => !category || record.category === category)
    .map((record) => {
      const haystack = new Set(tokenize(`${record.title} ${record.category} ${record.keywords.join(' ')} ${record.content}`));
      const score = [...queryTokens].reduce((total, token) => total + (haystack.has(token) ? 1 : 0), 0);
      return { ...record, score };
    })
    .filter((record) => record.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(({ score, ...record }) => ({ ...record, knowledgeVersion: KNOWLEDGE_VERSION }));
}

export { KNOWLEDGE_VERSION, records, searchKnowledge };