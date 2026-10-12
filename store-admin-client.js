export function storeApp() {
  const $ = id => document.getElementById(id);
  let products = [], scopes = [], selected = null, uploadedAsset = null, busy = false, previewUrl = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
  const notice = (message, error = false) => { $('notice').textContent = message; $('notice').className = error ? 'notice error' : 'notice'; };
  async function api(path, options = {}) {
    const response = await fetch('/api/admin/store' + path, { ...options, signal: AbortSignal.timeout(25000) });
    if (response.redirected || response.status === 401) throw Error('Your sign-in expired. Reload this page to sign in.');
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw Error(data?.error || 'Could not load the store. Please retry.');
    return data;
  }
  function lock(value) {
    busy = value;
    for (const id of ['save', 'publish', 'archive', 'reload', 'new-product', 'image']) $(id).disabled = value;
    $('publish').disabled = value || !selected;
    $('archive').disabled = value || !selected?.published;
    $('kind').disabled = value || !!selected;
    $('image').disabled = value || !!selected?.published;
  }
  function centres(chosen = []) {
    $('centres').replaceChildren();
    const tenant = scopes.find(item => item.id === $('tenant').value);
    for (const centre of tenant?.centres || []) {
      const label = node('label'), input = node('input'); input.type = 'checkbox'; input.value = centre.id; input.checked = chosen.includes(centre.id);
      label.append(input, document.createTextNode(centre.name)); $('centres').append(label);
    }
    $('centres-hint').textContent = tenant ? 'Leave all centres unchecked to include every centre in this tenant.' : 'Available to all PlaySmart centres.';
  }
  function draft() {
    const selectedType = $('kind').value;
    const kind = ['key','planet'].includes(selectedType) ? 'badge' : selectedType;
    const collection = selected?.draft.collection ?? (!selected ? {avatar:'character',frame:'skin',badge:'badge',key:'key',planet:'planet'}[selectedType] : undefined);
    return { name: $('name').value.trim(), description: $('description').value.trim(), kind,
      ...(collection ? {collection} : {}),
      price: Number($('price').value), assetId: uploadedAsset, accentColor: $('kind').value === 'theme' ? $('colour').value : null,
      tenantId: $('tenant').value || null, centreIds: [...$('centres').querySelectorAll('input:checked')].map(item => item.value) };
  }
  function preview() {
    $('preview-name').textContent = $('name').value || 'Your next Cowlaxy collectible';
    $('preview-description').textContent = $('description').value || 'Tell learners what makes it special.';
    $('preview-price').textContent = `${$('price').value || '0'} Moola`;
    $('colour-field').hidden = $('kind').value !== 'theme';
    $('asset-hint').textContent = ['avatar', 'frame', 'badge', 'key', 'planet'].includes($('kind').value)
      ? 'PNG required. Up to 2 MB and 2048 × 2048. Use transparency for avatars, portrait skins and badges.'
      : 'Optional PNG background or preview. Up to 2 MB and 2048 × 2048.';
    $('preview-card').style.borderColor = $('kind').value === 'theme' ? $('colour').value : '#d8e7e4';
    $('preview-image').hidden = !uploadedAsset && !previewUrl;
    if (previewUrl) $('preview-image').src = previewUrl;
    else if (uploadedAsset) $('preview-image').src = `/api/admin/store/assets/${uploadedAsset}.png`;
    else $('preview-image').removeAttribute('src');
  }
  function edit(item) {
    selected = item; uploadedAsset = item?.draft.assetId ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    $('form').reset(); $('image').value = '';
    const values = item?.draft;
    for (const key of ['name', 'description', 'kind', 'price']) if (values) $(key).value = values[key];
    if (['key','planet'].includes(values?.collection)) $('kind').value = values.collection;
    $('tenant').value = values?.tenantId || ''; $('colour').value = values?.accentColor || '#b9a4f2';
    centres(values?.centreIds || []);
    $('editor-heading').textContent = item ? 'Edit collectible' : 'Create a collectible';
    $('state').textContent = item ? `${item.status} · revision ${item.revision}` : 'New draft';
    $('published-note').textContent = item?.published
      ? `Published artwork is preserved for existing owners. Current live price: ${item.published.price} Moola. Save edits, then publish to update the store.`
      : 'Save a draft and preview it before publishing. Learners cannot see drafts.';
    lock(false); preview();
  }
  function render() {
    $('products').replaceChildren();
    for (const item of products) {
      const card = node('button'); card.type = 'button'; card.className = 'product';
      card.append(node('strong', item.draft.name), node('span', `${item.draft.collection || item.draft.kind} · ${item.draft.price} Moola`), node('small', item.status));
      card.addEventListener('click', () => { if (!busy) edit(item); }); $('products').append(card);
    }
    if (!products.length) $('products').append(node('p', 'No custom items yet. Your existing built-in collection stays available in PlaySmart.'));
  }
  async function reload() {
    lock(true); notice('Loading your catalogue…');
    try {
      const [catalogue, available] = await Promise.all([api('/products'), api('/scopes')]); products = catalogue.items; scopes = available.items;
      $('tenant').replaceChildren(); const all = node('option', 'All tenants and centres'); all.value = ''; $('tenant').append(all);
      for (const item of scopes) { const option = node('option', item.name); option.value = item.id; $('tenant').append(option); }
      render(); edit(selected ? products.find(item => item.id === selected.id) : null); notice('Catalogue ready. Publishing makes items available after an app store refresh.');
    } catch (error) { notice(error.message, true); } finally { lock(false); }
  }
  async function save(action) {
    if (busy || !$('form').reportValidity()) return;
    if (action !== 'save' && !selected) return;
    if (action === 'publish' && !confirm(`Publish “${selected.draft.name}” at ${selected.draft.price} Moola? This publishes the saved draft. Save any edits first.`)) return;
    if (action === 'archive' && !confirm('Remove this item from sale? Existing owners keep it.')) return;
    lock(true); notice(action === 'publish' ? 'Publishing…' : 'Saving…');
    try {
      const data = await api('/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...(selected ? { id: selected.id } : {}), revision: selected?.revision ?? 0, action,
        ...(action === 'save' ? { draft: draft() } : {}),
      }) });
      products = [...products.filter(item => item.id !== data.item.id), data.item]; render(); edit(data.item);
      notice(action === 'publish' ? 'Published. Learners can refresh their PlaySmart store to see it.' : action === 'archive' ? 'Archived. Existing ownership is preserved.' : 'Draft saved. Review the preview, then publish when ready.');
    } catch (error) { notice(error.message, true); } finally { lock(false); }
  }
  $('image').addEventListener('change', async () => {
    const file = $('image').files[0]; if (!file || busy) return;
    if (file.type !== 'image/png' || file.size > 2 * 1024 * 1024) { notice('Choose a PNG no larger than 2 MB.', true); return; }
    lock(true); notice('Checking and uploading artwork…');
    try {
      const image = await api('/assets', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file });
      uploadedAsset = image.id; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(file); preview();
      notice(`Artwork uploaded: ${image.width} × ${image.height}. Save the draft to attach it.`);
    } catch (error) { notice(error.message, true); } finally { lock(false); }
  });
  $('form').addEventListener('submit', event => { event.preventDefault(); save('save'); });
  $('form').addEventListener('input', preview);
  $('tenant').addEventListener('change', () => centres());
  $('publish').addEventListener('click', () => save('publish')); $('archive').addEventListener('click', () => save('archive'));
  $('reload').addEventListener('click', reload); $('new-product').addEventListener('click', () => edit(null));
  $('preview-image').addEventListener('error', () => { $('preview-image').hidden = true; notice('Artwork preview could not load. Your draft is still saved.', true); });
  reload();
}
