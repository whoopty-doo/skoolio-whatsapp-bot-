// Owner must confirm the marked business details and practices before publication.
const business = '[LEGAL BUSINESS NAME — owner confirmation required]';
const contact = '[PRIVACY CONTACT EMAIL — owner confirmation required]';
const draft = '<aside role="note"><strong>Draft for owner review — not yet published.</strong> Business details, retention periods and the deletion process must be confirmed before use in store listings.</aside>';

const policy = `
<h1>PlaySmart Privacy Policy</h1>
<p>Last updated: 2 October 2026</p>
<p>This policy explains how ${business}, providing PlaySmart under the Skoolio brand (“we”, “us”), handles personal information in the PlaySmart mobile and desktop apps and related registration and support services. Privacy contact: <strong>${contact}</strong>.</p>
<h2>Information we collect and why</h2>
<ul>
<li><strong>Accounts and registration:</strong> names, usernames, email addresses, phone numbers, authentication identifiers, account roles, centre membership and parent–learner relationships, as supplied by you or your authorised centre. We use these to register and authenticate users, manage access and communicate about the service.</li>
<li><strong>Learner information:</strong> learner profiles and educational information supplied during registration or by an authorised parent or centre, lesson answers, assessments, scores, progress and report cards. We use these to deliver learning activities, record progress and provide reports to authorised users.</li>
<li><strong>Rewards and purchases:</strong> XP, Moola balances, achievements, selected avatars, collectibles, purchase records, subscription status and transaction verification information. We use these to provide and restore entitlements and prevent duplicate or invalid transactions. Apple or Google processes purchases made through its store; we do not receive your full payment card details from those purchases.</li>
<li><strong>Optional location:</strong> when you choose the nearby-centre registration feature and grant permission, we obtain your device coordinates and send them with registration information to find a suitable centre. You can revoke location permission in your device settings; this feature will then be unavailable.</li>
<li><strong>Technical information:</strong> app version, operating system, device information, notification tokens, network request information (including IP addresses) and operational/error logs. We use this information to operate, secure, troubleshoot and deliver notifications for the service.</li>
<li><strong>Support:</strong> messages, case details and any attachments you choose to send, together with relevant app/platform information. We use these to answer questions, investigate problems and provide human support.</li>
<li><strong>Local storage:</strong> the app stores settings, sign-in information and learning data on your device to support sessions and offline use. Relevant results are synchronised when connectivity is available.</li>
</ul>
<h2>Who can access information</h2>
<p>Authorised parents, guardians and centre staff can access information appropriate to their relationship and role. Staff and service providers may access information needed to operate and support PlaySmart. Exporting or sharing a report sends it to the destination you select; please choose recipients carefully.</p>
<p>Our service uses Google/Firebase for authentication, data hosting and push notifications; Cloudflare for hosting and support infrastructure; Apple and Google for app distribution and store purchases; and Skoolio systems for registration, centre administration and service integration. Where AI support is enabled, OpenAI processes support content to produce answers. Where you choose the ElevenLabs read-aloud option, answer text is sent to ElevenLabs to generate audio. Device read-aloud uses the device’s speech service. WhatsApp support, when used, also involves WhatsApp/Meta and Twilio.</p>
<p>We may disclose information when legally required, to respond to lawful requests or to protect users and the service. [OWNER CONFIRMATION REQUIRED: confirm provider contracts and safeguards, whether any additional providers or analytics are used, and that personal information is not sold or used for targeted advertising.]</p>
<h2>AI support and voice</h2>
<p>AI support is optional assistance and can make mistakes. Avoid sending passwords, payment details, or unnecessary identifying information about children. The service attempts to redact common sensitive details, but redaction cannot guarantee anonymity. Support content and case records may be retained to continue a conversation and investigate an issue. Cloud read-aloud sends answer text for speech generation; it is not a recording of your microphone.</p>
<h2>Children and educational records</h2>
<p>PlaySmart is an educational service used by learners, including children, with parents, guardians and reading centres. Adults who supply a child’s information must have the authority to do so. A parent or guardian may contact us or the learner’s centre to request access, correction or deletion, or raise a concern about an unauthorised account. We may verify the adult’s identity and relationship before releasing or changing information.</p>
<p>[OWNER CONFIRMATION REQUIRED: specify supported age groups, how required parental authorisation is obtained, and the respective responsibilities of Skoolio and each centre for learner records.]</p>
<h2>Permissions and choices</h2>
<p>You can control location and notification permissions through your device settings. Disabling a permission may prevent its associated feature from working. You can choose whether to use support, cloud read-aloud, or report export. Withdrawing a permission does not automatically delete information already held; contact us to request deletion.</p>
<h2>Retention and deletion</h2>
<p>We retain information for the purposes described above, including providing learning history, managing accounts, resolving support issues and meeting legal obligations. [OWNER CONFIRMATION REQUIRED: insert the actual retention periods or criteria for accounts, learner records, support cases and provider-held content, transaction/security records, and backup expiry. Confirm deletion turnaround and any legal retention exceptions.]</p>
<p>To request deletion of your PlaySmart account and associated data, follow our <a href="/account-deletion">account deletion instructions</a>. Deleting the app from your device does not delete your account or server records. Subscription cancellation is managed separately through the store where you subscribed.</p>
<h2>Security and international processing</h2>
<p>We use authenticated access, role-based restrictions and encrypted network connections to protect information. No system can guarantee absolute security. Service providers may process information outside South Africa. [OWNER CONFIRMATION REQUIRED: confirm hosting locations and applicable contractual or other safeguards for cross-border transfers.]</p>
<h2>Your privacy rights</h2>
<p>Depending on applicable law, including South Africa’s Protection of Personal Information Act (POPIA), you may request access to or correction of personal information, request deletion, object to certain processing or withdraw consent where processing relies on it. These rights can be subject to legal limits. Contact <strong>${contact}</strong>; we may need to verify your identity. You may also raise a complaint with South Africa’s <a href="https://inforegulator.org.za/">Information Regulator</a>.</p>
<h2>Changes and contact</h2>
<p>We will update the date above when this policy changes and provide further notice where required. Direct privacy questions and requests to ${business} at <strong>${contact}</strong>.</p>`;

const deletion = `
<h1>Delete your PlaySmart account and data</h1>
<p>PlaySmart is provided by ${business} under the Skoolio brand.</p>
<h2>Request deletion without the app</h2>
<p>Email <strong>${contact}</strong> with the subject “PlaySmart account deletion”. Include your account email or username and, if relevant, your centre name. Tell us whether you want your account and associated data deleted, or only specific information. Do not send your password, payment card details or a child’s assessment records in the initial request.</p>
<p>For a learner account, a parent, guardian or authorised centre representative should make the request. We may ask for information needed to verify identity and authority over the account.</p>
<h2>In the app</h2>
<p>If your account screen offers <strong>Delete account</strong>, you can initiate deletion there and follow the confirmation steps. If that option is unavailable for your account role, use the email request above.</p>
<h2>What happens to your information</h2>
<p>[OWNER CONFIRMATION REQUIRED: specify which account/profile, learner progress, rewards, support and linked-system records are deleted or anonymised; which records must be retained and why; their retention periods; and the time to fulfil a verified request. Confirm the mailbox is monitored and the full deletion process works.]</p>
<p>Uninstalling PlaySmart does not delete server records. Account deletion does not itself cancel an Apple or Google subscription; manage that subscription through your App Store or Google Play account.</p>
<p><a href="/privacy">Read the PlaySmart Privacy Policy</a></p>`;

export function privacyPage(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const isDeletion = new URL(request.url).pathname.replace(/\/$/, '') === '/account-deletion';
  const title = isDeletion ? 'PlaySmart account deletion' : 'PlaySmart Privacy Policy';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;background:#f6f8fb;color:#182337;font:17px/1.7 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:40px 24px 80px}nav{margin-bottom:28px}a{color:#174ab5}h1,h2{line-height:1.25}h1{font-size:2.3rem}h2{margin-top:2em;font-size:1.4rem}li{margin:14px 0}aside{padding:18px;background:#fff0ca;border-left:4px solid #986900}strong{overflow-wrap:anywhere}@media print{body{background:white}main{padding:0}}</style></head><body><main><nav aria-label="Legal pages"><a href="/privacy">Privacy policy</a> · <a href="/account-deletion">Account deletion</a></nav>${draft}${isDeletion ? deletion : policy}</main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
