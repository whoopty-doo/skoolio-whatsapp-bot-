export function storeApp() {
  const $ = id => document.getElementById(id);
  let products = [], scopes = [], assets = [], selected = null, uploadedAsset = null, busy = false, previewUrl = null, uploadedFormat = 'png';
  const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
  const acquisition = node('select'); acquisition.id = 'acquisition';
  for (const [value,label] of [['PURCHASE_ONLY','Moola purchase'],['UNLOCK_ONLY','XP discovery only'],['PURCHASE_OR_UNLOCK','Moola purchase or XP discovery'],['GRANT_ONLY','Administrator grant only']]) acquisition.append(new Option(label,value));
  const acquisitionField=node('label','How explorers collect it'); acquisitionField.className='field'; acquisitionField.append(acquisition);
  $('price').closest('.two').after(acquisitionField);
  const unlockXp=node('input');unlockXp.id='unlock-xp';unlockXp.type='number';unlockXp.min='1';unlockXp.max='100000000';unlockXp.step='1';
  const unlockField=node('label','Unlock at total XP');unlockField.className='field';unlockField.append(unlockXp,node('small','XP is earned, never spent. Publishing adds this item to the discovery showcase automatically.'));acquisitionField.after(unlockField);
  const usesXp=()=>['UNLOCK_ONLY','PURCHASE_OR_UNLOCK'].includes(acquisition.value);
  const requirement=draft=>draft.acquisitionMode==='UNLOCK_ONLY'?`${draft.unlockXp ?? '—'} XP`:draft.acquisitionMode==='GRANT_ONLY'?'Special reward':`${draft.price} Moola${draft.acquisitionMode==='PURCHASE_OR_UNLOCK'?` or ${draft.unlockXp ?? '—'} XP`:''}`;
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
    $('asset-select').disabled = value || !!selected?.published;
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
    const kind = ({key:'badge',planet:'badge',gadget:'badge',collectible:'badge',background:'theme',avatar_outfit:'frame',avatar_accessory:'frame'})[selectedType] ?? selectedType;
    const collection = selected?.draft.collection ?? (!selected ? {avatar:'character',frame:'skin',badge:'badge',key:'key',planet:'planet',gadget:'badge'}[selectedType] : undefined);
    return { name: $('name').value.trim(), description: $('description').value.trim(), kind,
      ...(collection ? {collection} : {}),
      itemType: selectedType, currency: 'MOOLA', acquisitionMode: acquisition.value, category: $('category').value.trim() || undefined, sortOrder: Number($('sort-order').value),
      ...(usesXp()?{unlockXp:Number(unlockXp.value)}:{}),
      price: acquisition.value==='UNLOCK_ONLY'?0:Number($('price').value), assetId: uploadedAsset, accentColor: ['theme','background'].includes($('kind').value) ? $('colour').value : null,
      tenantId: $('tenant').value || null, centreIds: [...$('centres').querySelectorAll('input:checked')].map(item => item.value) };
  }
  function preview() {
    $('preview-name').textContent = $('name').value || 'Your next Cowlaxy collectible';
    $('preview-description').textContent = $('description').value || 'Tell learners what makes it special.';
    unlockField.hidden=!usesXp();unlockXp.disabled=!usesXp();unlockXp.required=usesXp();
    $('price').disabled=acquisition.value==='UNLOCK_ONLY';$('price').closest('label').hidden=acquisition.value==='UNLOCK_ONLY';
    $('preview-price').textContent = requirement({acquisitionMode:acquisition.value,price:$('price').value||'0',unlockXp:unlockXp.value||'—'});
    $('colour-field').hidden = !['theme','background'].includes($('kind').value);
    $('asset-hint').textContent = ['avatar', 'frame', 'badge', 'key', 'planet','gadget','avatar_outfit','avatar_accessory','collectible'].includes($('kind').value)
      ? 'PNG, JPEG or static WebP required. Up to 2 MB and 2048 × 2048. Use transparency for avatars, portrait skins and badges.'
      : 'Optional PNG, JPEG or static WebP preview. Up to 2 MB and 2048 × 2048.';
    $('preview-card').style.borderColor = ['theme','background'].includes($('kind').value) ? $('colour').value : '#d8e7e4';
    $('preview-image').hidden = !uploadedAsset && !previewUrl;
    if (previewUrl) $('preview-image').src = previewUrl;
    else if (uploadedAsset) $('preview-image').src = `/api/admin/store/assets/${uploadedAsset}.${uploadedFormat}`;
    else $('preview-image').removeAttribute('src');
  }
  function edit(item) {
    selected = item; uploadedAsset = item?.draft.assetId ?? null; uploadedFormat = item?.draft.artwork?.format ?? 'png';
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    $('form').reset(); $('image').value = '';
    const values = item?.draft;
    acquisition.value=values?.acquisitionMode ?? 'PURCHASE_ONLY';
    unlockXp.value=values?.unlockXp ?? '';
    for (const key of ['name', 'description', 'kind', 'price']) if (values) $(key).value = values[key];
    if (values?.itemType) $('kind').value = values.itemType;
    if (['key','planet'].includes(values?.collection)) $('kind').value = values.collection;
    $('category').value = values?.category ?? ''; $('sort-order').value = values?.sortOrder ?? 0;
    $('tenant').value = values?.tenantId || ''; $('colour').value = values?.accentColor || '#b9a4f2';
    centres(values?.centreIds || []);
    $('editor-heading').textContent = item ? 'Edit collectible' : 'Create a collectible';
    $('state').textContent = item ? `${item.status} · revision ${item.revision}` : 'New draft';
    $('published-note').textContent = item?.published
      ? `Published artwork is preserved for existing owners. Live requirement: ${requirement(item.published)}. Save edits, then publish to update the store.`
      : 'Save a draft and preview it before publishing. Learners cannot see drafts.';
    lock(false); preview();
  }
  function render() {
    $('products').replaceChildren();
    for (const item of [...products].sort((a,b)=>(a.draft.sortOrder??0)-(b.draft.sortOrder??0))) {
      const card = node('button'); card.type = 'button'; card.className = 'product';
      card.append(node('strong', item.draft.name), node('span', `${item.draft.itemType || item.draft.collection || item.draft.kind} · ${requirement(item.draft)}`), node('small', item.status));
      card.addEventListener('click', () => { if (!busy) edit(item); }); $('products').append(card);
    }
    if (!products.length) $('products').append(node('p', 'No custom items yet. Your existing built-in collection stays available in PlaySmart.'));
  }
  async function reload() {
    lock(true); notice('Loading your catalogue…');
    try {
      const [catalogue, available, artwork] = await Promise.all([api('/products'), api('/scopes'), api('/assets')]); products = catalogue.items; scopes = available.items; assets = artwork.items;
      $('asset-select').replaceChildren(new Option('Choose uploaded artwork', ''));
      for (const asset of assets) $('asset-select').append(new Option(`${asset.format.toUpperCase()} · ${asset.width} × ${asset.height} · ${asset.id.slice(0,8)}`, asset.id));
      $('tenant').replaceChildren(); const all = node('option', 'All tenants and centres'); all.value = ''; $('tenant').append(all);
      for (const item of scopes) { const option = node('option', item.name); option.value = item.id; $('tenant').append(option); }
      render(); edit(selected ? products.find(item => item.id === selected.id) : null); notice('Catalogue ready. Publishing makes items available after an app store refresh.');
    } catch (error) { notice(error.message, true); } finally { lock(false); }
  }
  async function save(action) {
    if (busy || !$('form').reportValidity()) return;
    if (action !== 'save' && !selected) return;
    const availability=selected?`for ${requirement(selected.draft)}`:'';
    if (action === 'publish' && !confirm(`Publish “${selected.draft.name}” ${availability}? This publishes the saved draft. Save any edits first.`)) return;
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
  $('asset-select').addEventListener('change', () => {
    if (busy || selected?.published) return;
    const asset = assets.find(item => item.id === $('asset-select').value);
    if (!asset) return;
    uploadedAsset = asset.id; uploadedFormat = asset.format;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    preview();
  });
  $('image').addEventListener('change', async () => {
    const file = $('image').files[0]; if (!file || busy) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { notice('Choose PNG, JPEG or static WebP no larger than 2 MB.', true); return; }
    lock(true); notice('Checking and uploading artwork…');
    try {
      const image = await api('/assets', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      uploadedAsset = image.id; uploadedFormat = image.format ?? 'png'; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(file); preview();
      notice(`Artwork uploaded: ${image.width} × ${image.height}. Save the draft to attach it.`);
    } catch (error) { notice(error.message, true); } finally { lock(false); }
  });
  $('form').addEventListener('submit', event => { event.preventDefault(); save('save'); });
  $('form').addEventListener('input', preview);
  acquisition.addEventListener('change',preview);
  $('tenant').addEventListener('change', () => centres());
  $('publish').addEventListener('click', () => save('publish')); $('archive').addEventListener('click', () => save('archive'));
  $('reload').addEventListener('click', reload); $('new-product').addEventListener('click', () => edit(null));
  $('preview-image').addEventListener('error', () => { $('preview-image').hidden = true; notice('Artwork preview could not load. Your draft is still saved.', true); });
  reload();
  setupDiscoveries();

  // Extends the current authenticated Store console. Published product IDs are
  // shared by purchases and XP acquisitions; this form cannot award XP.
  function setupDiscoveries() {
    const section=node('section'); section.className='panel'; section.id='cowlaxy-config';
    section.append(node('h2','Cowlaxy discoveries'),node('p','Upload an item above, choose XP discovery and set its target. Publishing creates its showcase automatically. Store discoveries are edited on their product. Existing discoveries stay owned.'));
    const status=node('p'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    const form=node('form'), rows=node('div'), actions=node('div'); actions.className='actions';
    const add=node('button','＋ Add discovery'), refresh=node('button','Reload journey'), save=node('button','Save journey');
    add.type=refresh.type='button'; save.type='submit'; save.className='primary';
    actions.append(add,refresh,save); form.append(rows,actions);section.append(status,form);document.querySelector('main').append(section);
    let config=null, pending=false;
    function setPending(value) {pending=value; for(const button of [add,refresh,save])button.disabled=value;}
    function field(container,rule,key,label,choices=null,type='text') {
      const wrap=node('label',label);wrap.className='field';
      const input=node(choices ? 'select' : 'input');input.name=key;input.setAttribute('aria-label',label);
      if(choices)for(const [value,title] of choices)input.append(new Option(title,value));
      else {input.type=type;if(type==='number'){input.min='0';input.max=key==='xp'?'100000000':'100000';input.step='1';}else input.maxLength=key==='description'?500:300;}
      if(type==='checkbox')input.checked=rule[key]===true;else input.value=rule[key] ?? '';
      input.required=['id','title','xp','rewardType','rewardId','popupTitle','order'].includes(key);
      input.addEventListener('change',()=>{rule[key]=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value.trim();if(['worldId','characterId','artwork'].includes(key)&&!rule[key])delete rule[key];});
      wrap.append(input);container.append(wrap);
    }
    function renderRules() {
      rows.replaceChildren();
      for(const rule of config.rules) {
        const detail=node('details'), summary=node('summary',`${rule.xp} XP · ${rule.title}`);detail.className='panel';detail.append(summary);
        const grid=node('div');grid.className='two';
        field(grid,rule,'id','Stable rule ID');field(grid,rule,'title','Title');
        field(grid,rule,'xp','Lifetime XP needed',null,'number');field(grid,rule,'order','Order',null,'number');
        field(grid,rule,'rewardType','Reward type',['WORLD','CHARACTER','SKIN','BADGE','COLLECTIBLE','KEY','KEY_FRAGMENT'].map(x=>[x,x]));
        field(grid,rule,'rewardId','Reward ID (world ID or published asset ID)');
        field(grid,rule,'worldId','Learning World',[['','No world'],...['language','memory','reasoning','visual','maths','auditory','attention'].map(x=>[x,x])]);
        field(grid,rule,'characterId','Optional character asset ID');field(grid,rule,'artwork','Optional artwork path');
        field(grid,rule,'description','Description');field(grid,rule,'popupTitle','Reveal title');field(grid,rule,'popupMessage','Reveal message');
        field(grid,rule,'active','Active',null,'checkbox');field(grid,rule,'celebrate','Show discovery celebration',null,'checkbox');
        if(rule.id.startsWith('xp_store_')) {detail.append(node('p','Managed by its Store product. Edit the product and publish to change this discovery.'));for(const input of grid.querySelectorAll('input,select'))input.disabled=true;}
        detail.append(grid);rows.append(detail);
      }
    }
    async function load(){if(pending)return;setPending(true);status.textContent='Loading the Cowlaxy journey…';try{config=await api('/cowlaxy');renderRules();status.textContent=`Journey revision ${config.revision}. Built-in defaults remain available if configuration cannot load.`;}catch(error){status.textContent=error.message;}finally{setPending(false);}}
    add.addEventListener('click',()=>{if(!config||pending)return;config.rules.push({id:'discovery_'+crypto.randomUUID().replaceAll('-',''),title:'New discovery',description:'A new adventure awaits.',active:false,xp:1500,rewardType:'BADGE',rewardId:'',order:config.rules.length,celebrate:true,popupTitle:'NEW DISCOVERY!',popupMessage:'Your curiosity opened a new door.'});renderRules();rows.lastElementChild.open=true;});
    refresh.addEventListener('click',load);
    form.addEventListener('submit',async event=>{event.preventDefault();if(pending||!config||!form.reportValidity())return;setPending(true);status.textContent='Saving journey…';try{config=await api('/cowlaxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});renderRules();status.textContent=`Journey saved, revision ${config.revision}. Players receive discoveries on their next connected refresh.`;}catch(error){status.textContent=error.message;}finally{setPending(false);}});
    load();
  }
}
