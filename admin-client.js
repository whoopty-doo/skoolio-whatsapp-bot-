export function dashboardApp(config) {
  const $ = id => document.getElementById(id);
  let page = 1, selected = null, generation = 0, busy = false;
  const labels = config.products;
  const readable = value => String(value || 'Not provided').replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
  const date = value => value && !value.startsWith('1970-') ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not provided';
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; }
  function option(value, label) { const element = node('option', label || (value === 'OPEN' ? 'All open cases' : value === 'RESOLVED_GROUP' ? 'All resolved cases' : readable(value))); element.value = value; return element; }
  function options(id, values, first) { const element = $(id); const current = element.value; element.replaceChildren(...(first ? [option('', first)] : []), ...values.map(value => option(value, labels[value]))); element.value = current; }
  function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'notice error' : 'notice'; }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...options.headers } });
    if (response.status === 401 || response.status === 403) throw new Error('Your Access session has expired. Reload this page to sign in.');
    const data = await response.json().catch(() => null);
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Sign in again to load your cases. Use Reload workspace below.');
    if (!response.ok || !data) throw new Error(data?.error || 'Unable to load support data. Please try again.');
    return data;
  }
  function badge(value, className = '') { return node('span', labels[value] || readable(value), `badge ${String(value || '').toLowerCase()} ${className}`); }
  function renderStats(stats) {
    $('stats').replaceChildren(...[['totalOpen', 'Open cases'], ['newCases', 'New'], ['needsInformation', 'Needs information'], ['investigating', 'Investigating'], ['confirmedBugs', 'Confirmed bugs'], ['fixInProgress', 'Fix in progress'], ['fixReady', 'Fix ready'], ['resolved', 'Resolved']].map(([key, label], index) => {
      const status = ['OPEN', 'NEW', 'NEEDS_INFORMATION', 'INVESTIGATING', 'CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'RESOLVED_GROUP'][index];
      const card = node('button', undefined, `stat ${index === 0 ? 'featured' : ''}`); card.type = 'button'; card.setAttribute('aria-pressed', String($('status').value === status)); card.title = 'Show ' + label.toLowerCase(); card.append(node('span', label), node('strong', stats[key] || 0)); card.addEventListener('click', () => { $('status').value = $('status').value === status ? '' : status; page = 1; load(); $('case-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); return card;
    }));
    $('products').replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const button = node('button', undefined, `product-card ${key.toLowerCase()}`); button.type = 'button'; button.setAttribute('aria-pressed', String($('product').value === key));
      button.append(node('span', label), node('strong', stats.products?.[key] || 0));
      button.addEventListener('click', () => { $('product').value = $('product').value === key ? '' : key; page = 1; load(); }); return button;
    }));
  }
  async function load() {
    const current = ++generation;
    const params = new URLSearchParams({ page, limit: 20 });
    for (const id of ['product', 'status', 'category', 'severity', 'feature_module', 'platform', 'from', 'to', 'q']) if ($(id).value) params.set(id, $(id).value);
    $('refresh').disabled = true; $('cases').setAttribute('aria-busy', 'true'); notice('Loading cases…');
    try {
      const data = await api('/api/admin/cases?' + params);
      if (current !== generation) return;
      renderStats(data.stats);
      options('platform', data.filters.platform, 'All platforms'); options('feature_module', data.filters.feature_module, 'All modules');
      $('cases').replaceChildren();
      for (const item of data.cases) {
        const tr = node('tr'); tr.className = 'case-row'; tr.addEventListener('click', event => { if (!event.target.closest('button')) openCase(item.case_id); }); const first = node('td'); const link = node('button', item.case_id, 'case-link'); link.type = 'button'; link.setAttribute('aria-label', 'Open case ' + item.case_id); link.addEventListener('click', () => openCase(item.case_id)); first.append(link); tr.append(first);
        const productCell = node('td'); productCell.append(badge(item.product)); tr.append(productCell);
        tr.append(node('td', date(item.created_at), 'muted'));
        const status = node('td'); status.append(badge(item.status)); tr.append(status);
        const severity = node('td'); severity.append(badge(item.severity)); tr.append(severity);
        tr.append(node('td', readable(item.category)), node('td', item.feature_module || '—'), node('td', item.ai_summary || item.user_description || 'No summary', 'summary'), node('td', item.platform || '—'), node('td', date(item.updated_at), 'muted'));
        const action = node('td'); const open = node('button', 'Open case →', 'button open-case'); open.type = 'button'; open.addEventListener('click', () => openCase(item.case_id)); action.append(open); tr.append(action);
        $('cases').append(tr);
      }
      if (!data.cases.length) { const tr = node('tr'); const td = node('td', 'No cases match your filters. Try widening your search.', 'empty'); td.colSpan = 11; tr.append(td); $('cases').append(tr); }
      $('count').textContent = `${data.total} ${data.total === 1 ? 'case' : 'cases'}`;
      $('page-label').textContent = `Page ${page} of ${Math.max(1, Math.ceil(data.total / 20))}`;
      $('previous').disabled = page <= 1; $('next').disabled = page * 20 >= data.total;
      $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      notice(''); $('load-error').hidden = true;
    } catch (error) { if (current === generation) { notice(error.message, true); $('load-error').hidden = false; $('count').textContent = 'Unable to load'; const row = node('tr'); const cell = node('td', 'Cases could not be loaded. Retry or reload your signed-in workspace.', 'empty'); cell.colSpan = 11; row.append(cell); $('cases').replaceChildren(row); } }
    finally { if (current === generation) { $('refresh').disabled = false; $('cases').setAttribute('aria-busy', 'false'); } }
  }
  function section(title, content) { const section = node('section', undefined, 'detail-section'); section.append(node('h3', title)); section.append(node('p', content || 'Not provided', 'preserve')); return section; }
  function field(label, value) { const div = node('div', undefined, 'fact'); div.append(node('dt', label), node('dd', value || 'Not provided')); return div; }
  function inputField(id, label, value, multiline = false) {
    const wrapper = node('label', label, 'field'); const input = node(multiline ? 'textarea' : 'input'); input.id = id; input.value = value || ''; if (multiline) input.rows = 3; wrapper.append(input); return wrapper;
  }
  let opening = 0;
  function showCaseTab(name) {
    for (const tab of ['overview', 'history', 'actions']) { const button = $('tab-' + tab); const active = tab === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; $(tab === 'overview' ? 'detail' : 'case-' + tab).hidden = !active; }
  }
  for (const name of ['overview', 'history', 'actions']) { $('tab-' + name).addEventListener('click', () => showCaseTab(name)); $('tab-' + name).addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = ['overview', 'history', 'actions']; const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(name) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; showCaseTab(tabs[index]); $('tab-' + tabs[index]).focus(); }); }
  async function openCase(id) {
    const request = ++opening; notice('Opening ' + id + '…');
    try {
      const data = await api('/api/admin/cases/' + encodeURIComponent(id)); if (request !== opening) return; selected = data.case;
      const item = selected;
      $('case-title').textContent = item.case_id; $('case-subtitle').textContent = `${labels[item.product]} · Created ${date(item.created_at)}`;
      $('case-badges').replaceChildren(badge(item.status), badge(item.severity));
      const details = $('detail'); details.replaceChildren();
      const facts = node('dl', undefined, 'facts');
      for (const [label, value] of [['Module', item.feature_module], ['Category', readable(item.category)], ['Reporter reference', item.reporter_whatsapp_identifier], ['Customer', item.customer_reference], ['Centre', item.centre_reference], ['Platform', item.platform], ['OS', item.os], ['Architecture', item.architecture], ['Version', item.app_version], ['Build', item.build_number], ['Route', item.route], ['Screen', item.screen], ['Sync', item.sync_status], ['Database', item.database_status], ['Updated', date(item.updated_at)]]) facts.append(field(label, value));
      details.append(section('AI summary', item.ai_summary), facts, section('Customer description', item.user_description), section('Reproduction steps', item.reproduction_steps.join('\n')), section('Expected behaviour', item.expected_behaviour), section('Actual behaviour', item.actual_behaviour), section('Sanitized diagnostics', [item.error_message, ...item.sanitized_logs].filter(Boolean).join('\n')), section('Conversation reference', item.conversation_reference.conversationId), section('Related cases', item.related_cases.join(', ')), section('Technical investigation', [item.technical_investigation.result, ...item.technical_investigation.evidence].filter(Boolean).join('\n')), section('Validation', item.technical_investigation.tests.join('\n')));
      if (item.conversation_reference.channel === 'app') {
        const openChat = node('button', 'Open app conversation', 'button primary');
        openChat.type = 'button';
        openChat.addEventListener('click', async () => {
          $('case-dialog').close(); $('app-inbox-button').click();
          const generation = ++appGeneration;
          try { const thread = await api('/api/admin/app-support/' + encodeURIComponent(item.conversation_reference.conversationId)); if (generation === appGeneration) { renderAppThread(thread); $('app-reply-text').value = ''; appReply = null; } }
          catch (error) { $('app-inbox-notice').textContent = error.message; }
        });
        details.append(openChat, node('p', 'Send customer questions and replies in the app conversation. Case notes stay internal.', 'muted'));
      }

      const integration = node('dl', undefined, 'facts'); for (const [label, value] of [['Coding agent', item.coding_agent || 'Not connected'], ['Repository', item.repository], ['Branch', item.branch], ['Pull request', item.pull_request], ['Release', item.release], ['Approval', item.approval ? `Approved ${date(item.approval.approved_at)} by ${item.approval.approved_by}` : 'Awaiting owner review']]) integration.append(field(label, value)); details.append(integration);
      const history = node('section', undefined, 'detail-section'); history.append(node('h3', 'Case history')); const timeline = node('ol', undefined, 'timeline');
      for (const event of [...item.history].reverse()) { const entry = node('li'); entry.append(node('strong', readable(event.action)), node('small', `${date(event.at)} · ${event.actor}`), node('p', event.detail)); timeline.append(entry); } history.append(timeline); $('case-history').replaceChildren(history);
      const form = $('case-form'); form.replaceChildren();
      for (const [key, label, values] of [['status', 'Status', config.statuses], ['product', 'Product', Object.keys(labels)], ['category', 'Category', config.categories], ['severity', 'Severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']]]) {
        const wrapper = node('label', label, 'field'); const select = node('select'); select.id = 'edit-' + key; select.append(...values.map(value => option(value, labels[value]))); select.value = item[key]; wrapper.append(select); form.append(wrapper);
      }
      form.append(inputField('edit-question', 'Question for the reporter', item.pending_question), inputField('edit-notes', 'Owner notes', item.owner_notes, true));
      const technical = node('details'); technical.append(node('summary', 'Investigation and fix evidence'));
      const resultLabel = node('label', 'Investigation result', 'field'); const result = node('select'); result.id = 'edit-result'; result.append(option('', 'Not assessed'), ...['NEEDS_INFORMATION', 'NOT_A_BUG', 'CONFIGURATION_ISSUE', 'DATA_ISSUE', 'CONFIRMED_BUG'].map(value => option(value))); result.value = item.technical_investigation.result; resultLabel.append(result); technical.append(resultLabel);
      for (const [key, label, value, multiline] of [['evidence', 'Evidence (one item per line)', item.technical_investigation.evidence.join('\n'), true], ['tests', 'Validation results (one item per line)', item.technical_investigation.tests.join('\n'), true], ['repository', 'Repository', item.repository], ['branch', 'Branch', item.branch], ['pull_request', 'Pull request URL', item.pull_request], ['release', 'Release reference', item.release]]) technical.append(inputField('edit-' + key, label, value, multiline));
      form.append(technical, node('p', 'Saving an approval records your review. It does not merge or release software.', 'muted'));
      $('save-error').textContent = ''; showCaseTab('overview'); notice(''); if (!$('case-dialog').open) $('case-dialog').showModal();
    } catch (error) { notice(error.message, true); }
  }
  $('save').addEventListener('click', async () => {
    if (!selected || busy) return; busy = true; $('save').disabled = true; $('save-error').textContent = '';
    try {
      const payload = { revision: selected.revision };
      for (const key of ['status', 'product', 'category', 'severity', 'repository', 'branch', 'pull_request', 'release']) if ($('edit-' + key).value !== selected[key]) payload[key] = $('edit-' + key).value;
      if ($('edit-question').value !== selected.pending_question) payload.pending_question = $('edit-question').value;
      if ($('edit-notes').value !== selected.owner_notes) payload.owner_notes = $('edit-notes').value;
      const investigation = { result: $('edit-result').value, evidence: $('edit-evidence').value.split('\n').filter(Boolean), tests: $('edit-tests').value.split('\n').filter(Boolean) };
      if (JSON.stringify(investigation) !== JSON.stringify(selected.technical_investigation)) payload.technical_investigation = investigation;
      if (Object.keys(payload).length === 1) { $('save-error').textContent = 'No changes to save.'; return; }
      await api('/api/admin/cases/' + selected.case_id, { method: 'PATCH', body: JSON.stringify(payload) });
      $('case-dialog').close(); await load(); notice('Saved changes to ' + selected.case_id + '.');
    } catch (error) { $('save-error').textContent = error.message; }
    finally { busy = false; $('save').disabled = false; }
  });
  $('close-dialog').addEventListener('click', () => $('case-dialog').close());
  $('refresh').addEventListener('click', load);
  $('retry-load').addEventListener('click', load); $('reload-workspace').addEventListener('click', () => location.reload());
  $('previous').addEventListener('click', () => { page--; load(); }); $('next').addEventListener('click', () => { page++; load(); });
  options('product', Object.keys(labels), 'All products'); options('status', ['OPEN', ...config.statuses, 'RESOLVED_GROUP'], 'All statuses'); options('category', config.categories, 'All categories');
  for (const id of ['product', 'status', 'category', 'severity', 'platform', 'feature_module', 'from', 'to']) $(id).addEventListener('change', () => { page = 1; load(); });
  let timer; $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 250); });
  $('reset-filters').addEventListener('click', () => { for (const id of ['product', 'status', 'category', 'severity', 'platform', 'feature_module', 'from', 'to', 'q']) $(id).value = ''; page = 1; load(); });
  let guides = [], selectedGuide = null;
  function editGuide(guide) {
    selectedGuide = guide;
    $('guide-product').value = guide?.product || 'PLAYSMART';
    $('guide-title').value = guide?.title || '';
    $('guide-keywords').value = guide?.keywords?.join(', ') || '';
    $('guide-content').value = guide?.content || '';
    $('guide-published').checked = Boolean(guide?.published);
    $('guide-error').textContent = '';
  }
  async function loadGuides(selectedId = '') {
    guides = (await api('/api/admin/guides')).guides;
    $('guide-list').replaceChildren(option('', 'New guide'), ...guides.map(guide => option(guide.id, `${labels[guide.product]} · ${guide.title} (${guide.published ? 'Published' : 'Draft'})`)));
    $('guide-list').value = selectedId;
    editGuide(guides.find(guide => guide.id === selectedId));
  }
  $('guides-button').addEventListener('click', async () => {
    try {
      const [, catalog] = await Promise.all([loadGuides(), api('/api/admin/knowledge')]);
      $('knowledge-summary').replaceChildren(...catalog.collections.map(collection => {
        const docs = catalog.documents.filter(doc => doc.product === collection.product);
        const publicCount = docs.filter(doc => doc.visibility === 'PUBLIC_SUPPORT' && doc.support_safe && doc.document_type !== 'INTERNAL_SUPPORT').length;
        const published = (catalog.ownerGuides || []).filter(doc => doc.product === collection.product).length;
        return section(labels[collection.product], [`${publicCount} bundled public documents · ${published} published owner guides`, ...docs.map(doc => `${doc.title} — ${readable(doc.visibility)} · Updated ${doc.updated_at}`), collection.missing_areas.length ? `Still needed: ${collection.missing_areas.join('; ')}` : ''].filter(Boolean).join('\n'));
      }));
      $('guides-dialog').showModal();
    } catch (error) { notice(error.message, true); }
  });
  $('close-guides').addEventListener('click', () => $('guides-dialog').close());
  $('guide-list').addEventListener('change', () => editGuide(guides.find(guide => guide.id === $('guide-list').value)));
  $('guide-form').addEventListener('submit', async event => {
    event.preventDefault(); $('guide-save').disabled = true; $('guide-list').disabled = true;
    try {
      const payload = { ...(selectedGuide ? { id: selectedGuide.id, revision: selectedGuide.revision } : {}), product: $('guide-product').value, title: $('guide-title').value, keywords: $('guide-keywords').value, content: $('guide-content').value, published: $('guide-published').checked };
      const { guide } = await api('/api/admin/guides', { method: 'POST', body: JSON.stringify(payload) });
      await loadGuides(guide.id); $('guide-error').textContent = guide.published ? 'Saved and available for customer replies.' : 'Saved as a draft. The bot will not use this guide.';
    } catch (error) { $('guide-error').textContent = error.message; }
    finally { $('guide-save').disabled = false; $('guide-list').disabled = false; }
  });
  $('operations-button').addEventListener('click', async () => {
    try { const data = await api('/api/admin/operations'); const body = $('operations-body'); const media = data.media;
      const mediaSummary = media ? [media.configured ? 'Attachment processing: configured' : 'Attachment processing: missing provider configuration', media.outboundConfigured ? 'WhatsApp replies: configured' : 'WhatsApp replies: missing sender configuration', `Voice model: ${media.transcriptionModel}`, `Picture model: ${media.visionModel}`, ...Object.entries(media.queued || {}).map(([key, count]) => `${readable(key)}: ${count}`), `Processed: ${media.diagnostics?.completed || 0} · Failed: ${media.diagnostics?.failed || 0} · Retries: ${media.diagnostics?.retries || 0}`, media.diagnostics?.last ? `Latest: ${media.diagnostics.last.outcome} at ${media.diagnostics.last.at}${media.diagnostics.last.code ? ` — ${media.diagnostics.last.stage}: ${media.diagnostics.last.code}` : ''}` : 'No attachment processing recorded yet.', 'Configuration does not confirm provider availability.'].join('\n') : 'Attachment diagnostics are not available on this server.';
      body.replaceChildren(section('Pictures and voice notes', mediaSummary), section('Notifications', Object.entries(data.notifications).map(([key, count]) => `${readable(key)}: ${count}`).join('\n') || 'No outbound notifications queued.'), section('Coding agents', 'Not connected. Investigation and fix execution require separately configured repository workers.'), section('Knowledge readiness', Object.entries(data.knowledge || {}).map(([product, status]) => `${labels[product] || product}: ${readable(status)}`).join('\n') + '\nOpen Knowledge for documents, coverage gaps and owner guides.'), section('Customer identity', 'Not connected. Private customer documents are not available to the assistant.')); $('operations-dialog').showModal(); } catch (error) { notice(error.message, true); }
  });
  $('close-operations').addEventListener('click', () => $('operations-dialog').close());
  let appThread = null, appCursor = null, appTimer = null, appSending = false, appLoading = false, appReply = null, appGeneration = 0;
  function renderAppThread(thread) {
    appThread = thread;
    $('app-thread-title').textContent = (thread.case?.case_id || 'Guide conversation') + ' · ' + readable(thread.mode);
    $('app-thread-messages').replaceChildren(...thread.messages.map(message => {
      const block = node('section', undefined, 'detail-section');
      block.append(node('strong', ({ user: 'User', assistant: 'AI guide', human: 'Human support', system: 'Support' })[message.role] || 'Support'), node('small', ' · ' + date(message.at)));
      const text = node('p', message.text); text.style.whiteSpace = 'pre-wrap'; block.append(text); return block;
    }));
    $('app-reply-form').hidden = false;
  }
  async function refreshAppInbox(more = false) {
    if (appLoading) return;
    appLoading = true; const generation = appGeneration;
    try {
      const data = await api('/api/admin/app-support' + (more && appCursor ? '?cursor=' + encodeURIComponent(appCursor) : ''));
      if (generation !== appGeneration) return;
      if (!more) $('app-inbox-list').replaceChildren();
      for (const thread of data.threads) {
        const button = node('button', (thread.case_id || 'Guide conversation') + ' · ' + readable(thread.mode) + ' · ' + thread.preview.slice(0, 100), 'button');
        button.type = 'button'; button.style.display = 'block'; button.style.margin = '8px 0';
        button.addEventListener('click', async () => {
          if (appSending) return;
          const selection = ++appGeneration;
          try { const selected = await api('/api/admin/app-support/' + thread.id); if (selection !== appGeneration) return; renderAppThread(selected); $('app-reply-text').value = ''; appReply = null; }
          catch (error) { $('app-inbox-notice').textContent = error.message; }
        });
        $('app-inbox-list').append(button);
      }
      appCursor = data.cursor; $('app-inbox-more').hidden = !appCursor;
      if (appThread && !appSending) {
        const id = appThread.id; const selected = await api('/api/admin/app-support/' + id);
        if (generation === appGeneration && appThread?.id === id) renderAppThread(selected);
      }
      $('app-inbox-notice').textContent = data.threads.length ? 'Inbox updated.' : 'No app conversations yet.';
    } catch (error) { $('app-inbox-notice').textContent = error.message; }
    finally { appLoading = false; }
  }
  let presenceBusy = false;
  async function appPresence() {
    if (presenceBusy) return;
    presenceBusy = true;
    const available = $('app-inbox-dialog').open && $('app-inbox-available').checked;
    try {
      await api('/api/admin/app-support/presence', { method: 'POST', body: JSON.stringify({ available }) });
      $('app-inbox-presence').textContent = available ? 'Available — keep this inbox open. Status expires after 90 seconds without a connection.' : 'Offline — users can leave a message.';
    } catch (error) { $('app-inbox-presence').textContent = 'Availability could not be confirmed. ' + error.message; }
    finally { presenceBusy = false; }
  }
  $('app-inbox-button').addEventListener('click', () => {
    $('app-inbox-dialog').showModal(); refreshAppInbox();
    clearInterval(appTimer);
    appTimer = setInterval(() => { if (!document.hidden) { refreshAppInbox(); if ($('app-inbox-available').checked) appPresence(); } }, 15000);
  });
  $('app-inbox-close').addEventListener('click', () => $('app-inbox-dialog').close());
  $('app-inbox-dialog').addEventListener('close', () => { clearInterval(appTimer); appGeneration++; $('app-inbox-available').checked = false; appPresence(); });
  $('app-inbox-available').addEventListener('change', appPresence);
  $('app-inbox-refresh').addEventListener('click', () => refreshAppInbox());
  $('app-inbox-more').addEventListener('click', () => refreshAppInbox(true));
  $('app-reply-form').addEventListener('submit', async event => {
    event.preventDefault(); if (appSending || !appThread) return;
    const text = $('app-reply-text').value.trim(); if (!text) return;
    if (!appReply || appReply.text !== text || appReply.thread !== appThread.id) appReply = { text, thread: appThread.id, request_id: crypto.randomUUID() };
    appSending = true; $('app-reply-send').disabled = true; $('app-reply-text').disabled = true;
    try {
      const thread = await api('/api/admin/app-support/' + appReply.thread + '/messages', { method: 'POST', body: JSON.stringify(appReply) });
      renderAppThread(thread); $('app-reply-text').value = ''; appReply = null;
      $('app-inbox-notice').textContent = 'Reply saved. The user can read it in the app.';
    } catch (error) { $('app-inbox-notice').textContent = error.message + ' Retry to send the same reply safely.'; }
    finally { appSending = false; $('app-reply-send').disabled = false; $('app-reply-text').disabled = false; }
  });
  load();
}
