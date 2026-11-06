// Self-contained for nonce-protected inline embedding; no stored customer data.
export function moolaClient() {
  const $ = id => document.getElementById(id);
  let selected = null, submitting = false, reviewed = null, pending = null, historyGeneration = 0;
  const pendingKey = 'playsmart.pendingAdminMoolaAward.v1';
  try { pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { /* Report storage failure before submitting. */ }
  let rows = [], complete = false, loading = false, generation = 0, controller;
  const format = units => {
    if (!Number.isSafeInteger(units)) return 'Unavailable';
    const value = BigInt(units), negative = value < 0n, absolute = negative ? -value : value;
    const fraction = String(absolute % 1000n).padStart(3, '0').replace(/0+$/, '');
    return `${negative ? '−' : ''}${(absolute / 1000n).toLocaleString()}${fraction ? '.' + fraction : ''}`;
  };
  const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
  const resetLabel = row => row.reset.status === 'confirmed' ? 'Reset recorded'
    : row.reset.status === 'not_recorded' ? 'No archive found' : 'History needs review';
  function options(id, entries) {
    const select = $(id), previous = select.value;
    select.replaceChildren(new Option(id === 'tenant' ? 'All tenants' : 'All centres', ''));
    for (const [value, name] of [...entries].sort((a, b) => a[1].localeCompare(b[1]))) select.add(new Option(name, value));
    if (entries.has(previous)) select.value = previous;
  }
  function render() {
    options('tenant', new Map(rows.filter(r => r.scope).map(r => [r.scope.tenantId, r.tenantName])));
    const tenant = $('tenant').value;
    options('centre', new Map(rows.filter(r => r.scope && (!tenant || r.scope.tenantId === tenant))
      .map(r => [r.scope.tenantId + '/' + r.scope.centreId, r.centreName])));
    const centre = $('centre').value, term = $('search').value.trim().toLocaleLowerCase();
    const visible = rows.filter(row => (!tenant || row.scope?.tenantId === tenant)
      && (!centre || row.scope?.tenantId + '/' + row.scope?.centreId === centre)
      && (!term || [row.learnerName, row.scope?.studentId, row.centreName, row.tenantName].join(' ').toLocaleLowerCase().includes(term))
      && ($('balance').value !== 'positive' || row.current?.balanceMoolaUnits > 0)
      && ($('history').value !== 'confirmed' || row.reset.status === 'confirmed')
      && ($('history').value !== 'review' || row.reset.status !== 'confirmed' || !row.current));
    $('resume-award').hidden = !pending;
    $('loaded').textContent = rows.length.toLocaleString();
    $('positive').textContent = rows.filter(r => r.current?.balanceMoolaUnits > 0).length.toLocaleString();
    $('reset-count').textContent = rows.filter(r => r.reset.status === 'confirmed').length.toLocaleString();
    $('coverage').textContent = complete ? 'All recorded reward accounts loaded.'
      : 'Partial results — search, filters and counts cover loaded accounts only.';
    $('matches').textContent = `${visible.length.toLocaleString()} matching learners${visible.length > 100 ? ' · showing the first 100; narrow your search' : ''}`;
    $('rows').replaceChildren();
    for (const row of visible.slice(0, 100)) {
      const tr = document.createElement('tr');
      for (const value of [row.learnerName, row.centreName, row.current ? format(row.current.balanceMoolaUnits) : 'Needs review', resetLabel(row)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      const td = document.createElement('td'), button = document.createElement('button');
      button.textContent = 'View details'; button.setAttribute('aria-label', `View details for ${row.learnerName}`);
      button.addEventListener('click', () => detail(row)); td.append(button); tr.append(td); $('rows').append(tr);
    }
    $('empty').hidden = visible.length !== 0;
    $('empty').textContent = loading ? 'Loading recorded accounts…' : complete ? 'No recorded accounts match these filters.' : 'No matches in the accounts loaded so far.';
  }
  function detail(row) {
    selected = row; $('open-award').disabled = !row.current || !row.scope;
    loadHistory(row);
    $('detail-title').textContent = row.learnerName;
    $('detail-values').replaceChildren();
    const entries = [ ['Tenant', row.tenantName], ['Centre recorded on account', row.centreName], ['Learner ID', row.scope?.studentId ?? 'Needs review'],
      ['Current Moola', row.current ? format(row.current.balanceMoolaUnits) : 'Unavailable — account needs review'],
      ['Earned / awarded in current scheme', row.current ? format(row.current.earnedMoolaUnits) : 'Unavailable'],
      ['Spent in current scheme', row.current ? format(row.current.spentMoolaUnits) : 'Unavailable'],
      ['Current XP', row.current?.xp.total?.toLocaleString() ?? 'Unavailable'],
      ['Account revision', row.current?.revision?.toLocaleString() ?? 'Unavailable'], ['Reset history', resetLabel(row)] ];
    if (row.reset.status === 'confirmed') entries.push(['Reset recorded at', date(row.reset.at)],
      ['Moola before reset (earned minus spent)', format(row.reset.previousBalanceMoolaUnits)], ['Moola immediately after reset', format(row.reset.openingBalanceMoolaUnits)],
      ['XP before / after reset', `${row.reset.previousXp.toLocaleString()} / ${row.reset.openingXp.toLocaleString()}`], ['Reset operator', 'Not recorded in the archive']);
    if (row.reset.waivedOverspendUnits > 0) entries.push(['Archived test overspend adjustment', format(row.reset.waivedOverspendUnits)]);
    for (const [name, value] of entries) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; $('detail-values').append(dt, dd); }
    $('detail').showModal();
  }
  async function loadHistory(row) {
    const own = ++historyGeneration;
    $('award-history').textContent = 'Loading awards…';
    try {
      const response = await fetch('/api/admin/moola/accounts/' + encodeURIComponent(row.accountId) + '/awards', { cache: 'no-store' });
      if (!response.ok) throw Error('Award history unavailable. Retry by reopening details.');
      const data = await response.json(); if (own !== historyGeneration) return;
      $('award-history').replaceChildren();
      for (const entry of data.items) {
        const text = document.createElement('p');
        text.textContent = `${date(entry.acceptedAt)} · +${format(entry.amountMoolaUnits)} Moola · ${format(entry.balanceBeforeUnits)} → ${format(entry.balanceAfterUnits)} · ${entry.reason} · Administrator: ${entry.actor} · Receipt: ${entry.requestId}`;
        $('award-history').append(text);
      }
      if (!data.items.length) $('award-history').textContent = 'No administrative awards recorded.';
      if (data.hasMore) $('award-history').append(document.createTextNode('Showing the latest 25 administrative awards.'));
    } catch (error) { if (own === historyGeneration) $('award-history').textContent = error.message; }
  }
  function awardForm(locked) {
    $('award-amount').disabled = locked; $('award-reason').disabled = locked;
    $('review-award').hidden = locked; $('confirm-award').hidden = !locked;
    $('confirm-award').disabled = submitting;
    $('cancel-award').disabled = submitting;
    $('cancel-award').textContent = pending ? 'Close — keep pending request' : 'Cancel';
  }
  function openAward(row) {
    if (pending && pending.accountId !== row.accountId) {
      $('notice').textContent = 'Resolve the pending award before starting another.'; return;
    }
    selected = row; reviewed = pending ? { ...pending } : null;
    $('detail').close(); $('award-title').textContent = 'Award Moola';
    $('award-target').textContent = `${row.learnerName} · ${row.centreName} · ${row.tenantName} · Learner ${row.scope.studentId}`;
    $('award-balance').textContent = `Last loaded balance: ${format(row.current.balanceMoolaUnits)} Moola`;
    $('award-amount').value = pending?.amountMoola ?? ''; $('award-reason').value = pending?.reason ?? '';
    $('award-status').textContent = pending ? 'This award has an unresolved result. Retry the same request; it cannot award twice.' : '';
    $('award-review').textContent = pending ? `Check award of ${pending.amountMoola} Moola. The original request will be reused.` : '';
    $('confirm-award').textContent = pending ? 'Retry same award' : 'Confirm award';
    awardForm(Boolean(pending)); $('award-dialog').showModal();
  }
  function reviewAward() {
    const amount = $('award-amount').value.trim().replace(',', '.');
    const reason = $('award-reason').value.trim();
    if (!/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,3})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1000 || reason.length < 3 || reason.length > 500) {
      $('award-status').textContent = 'Enter 0.001–1,000 Moola (up to three decimal places) and a reason of 3–500 characters.'; return;
    }
    const [whole, fraction = ''] = amount.split('.'), units = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
    reviewed = { accountId: selected.accountId, requestId: crypto.randomUUID(), amountMoola: amount, reason, expectedRevision: selected.current.revision };
    $('award-review').textContent = `Confirm +${format(units)} Moola for ${selected.learnerName} at ${selected.centreName}. Balance: ${format(selected.current.balanceMoolaUnits)} → ${format(selected.current.balanceMoolaUnits + units)}. Reason: ${reason}`;
    $('award-status').textContent = ''; awardForm(true);
  }
  async function confirmAward() {
    if (submitting || !reviewed) return;
    // Persist the exact intent before sending. Lost responses/reloads must reuse
    // its ID and payload; no credentials or account list are persisted.
    try { sessionStorage.setItem(pendingKey, JSON.stringify(reviewed)); }
    catch { $('award-status').textContent = 'Browser session storage is unavailable. Enable it before awarding Moola.'; return; }
    pending = { ...reviewed }; submitting = true; awardForm(true); render();
    $('award-status').textContent = 'Recording award…';
    try {
      const response = await fetch('/api/admin/moola/awards', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === 'REWARDS_ACCOUNT_CHANGED') {
          sessionStorage.removeItem(pendingKey); pending = null; reviewed = null;
          $('award-dialog').close(); await load();
          $('notice').textContent = 'The balance changed. No award was applied. Open the learner and review again.'; return;
        }
        throw Error(data.error || 'Award could not be confirmed.');
      }
      if (!data.audit || data.audit.requestId !== pending.requestId || data.audit.accountId !== pending.accountId) throw Error('Unexpected award response.');
      const audit = data.audit;
      sessionStorage.removeItem(pendingKey); pending = null; reviewed = null;
      $('award-status').textContent = `${data.replayed ? 'Already recorded — no duplicate award.' : 'Award recorded.'} +${format(audit.amountMoolaUnits)} Moola. Balance after award: ${format(audit.balanceAfterUnits)}. Receipt: ${audit.requestId}`;
      $('confirm-award').hidden = true; $('cancel-award').textContent = 'Done';
      await load();
    } catch (error) {
      $('award-status').textContent = `${error.message} Result not confirmed. Use Retry same award; do not start a replacement award.`;
      $('confirm-award').textContent = 'Retry same award';
    } finally {
      submitting = false; $('confirm-award').disabled = false; $('cancel-award').disabled = false; render();
    }
  }
  async function load() {
    const own = ++generation; controller?.abort(); controller = new AbortController();
    rows = []; complete = false; loading = true; $('detail').close(); $('notice').textContent = 'Loading Moola accounts…'; render();
    let cursor = null; const cursors = new Set(), ids = new Set();
    try {
      // Hard ceiling bounds a single visit. Do not claim complete coverage at the ceiling.
      for (let page = 0; page < 100; page++) {
        const response = await fetch('/api/admin/moola/accounts' + (cursor ? '?after=' + encodeURIComponent(cursor) : ''), { cache: 'no-store', signal: controller.signal });
        if (own !== generation) return;
        if (response.status === 401 || response.status === 403) { rows = []; throw Error('Your administrator session has expired or access was denied. Sign in to the admin again.'); }
        if (!response.ok) throw Error('Accounts could not be fully loaded. Refresh to retry.');
        const data = await response.json();
        if (own !== generation) return;
        if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 100
          || data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(data.nextCursor) || cursors.has(data.nextCursor))) throw Error('Account pagination needs review.');
        for (const row of data.items) if (!ids.has(row.accountId)) { ids.add(row.accountId); rows.push(row); }
        cursor = data.nextCursor; complete = cursor === null;
        $('notice').textContent = complete ? `Loaded ${rows.length.toLocaleString()} accounts. Last refresh: ${date(data.fetchedAt)}.` : `Loading accounts… ${rows.length.toLocaleString()} loaded.`;
        render(); if (complete) break; cursors.add(cursor);
      }
      if (!complete) $('notice').textContent = 'Reached the 10,000-account limit. Results are incomplete; contact support for a larger report.';
    } catch (error) { if (own === generation) $('notice').textContent = error.message; }
    finally { if (own === generation) { loading = false; render(); } }
  }
  for (const id of ['tenant', 'centre', 'balance', 'history']) $(id).addEventListener('change', render);
  $('search').addEventListener('input', render);
  $('refresh').addEventListener('click', load);
  $('open-award').addEventListener('click', () => { if (selected?.current && selected.scope) openAward(selected); });
  $('review-award').addEventListener('click', reviewAward);
  $('confirm-award').addEventListener('click', confirmAward);
  $('cancel-award').addEventListener('click', () => { if (!submitting) $('award-dialog').close(); });
  $('award-dialog').addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
  $('resume-award').addEventListener('click', () => {
    const row = rows.find(row => row.accountId === pending?.accountId);
    if (row?.current && row.scope) openAward(row);
    else $('notice').textContent = 'The pending award’s account is not loaded. Refresh accounts before resuming.';
  });
  $('close-detail').addEventListener('click', () => $('detail').close());
  window.addEventListener('pagehide', () => { generation++; controller?.abort(); rows = []; $('detail').close(); $('detail-values').replaceChildren(); render(); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
}
