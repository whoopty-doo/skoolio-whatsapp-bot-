export function gameStudioApp() {
  const $=id=>document.getElementById(id);
  let step=0,selected=null,items=[],scopes=[],busy=false;
  let newDraftId='factory_'+crypto.randomUUID().replaceAll('-','');
  const worlds=['moon','crystal','lava','jungle','frozen','factory','saturn','nebula'];
  const pictures={rocket:'🚀',planet:'🪐',crystal:'💎',robot:'🤖',alien:'👽',asteroid:'☄️'};
  const notice=(message,error=false)=>{ $('notice').textContent=message;$('notice').classList.toggle('error',error); };
  async function api(path,body){
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Please retry.');return value;
  }
  function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
  for(const world of worlds) option($('world'),world,world[0].toUpperCase()+world.slice(1));
  function pairs(rows){
    $('pairs').replaceChildren();
    for(const [index,row] of rows.entries()){
      const line=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Pair '+(index+1);line.append(legend);
      for(const [key,label] of [['en','English word'],['af','Afrikaanse woord'],['targetEn','English target'],['targetAf','Afrikaanse teiken']]){
        const l=document.createElement('label'),input=document.createElement('input');l.textContent=label;input.dataset.field=key;input.maxLength=key.startsWith('target')?40:30;input.required=true;
        input.value=row[key]||'';l.append(input);line.append(l);
      }
      const l=document.createElement('label'),select=document.createElement('select');l.textContent='Picture';select.dataset.field='picture';for(const [key,label] of Object.entries(pictures))option(select,key,label+' '+key);select.value=row.picture;l.append(select);line.append(l);
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove pair';remove.onclick=()=>{if($('pairs').children.length>2)line.remove();else notice('Keep at least two pairs.',true);};line.append(remove);$('pairs').append(line);
    }
  }
  function readPairs(){return [...$('pairs').children].map(row=>{const v={};for(const input of row.querySelectorAll('[data-field]'))v[input.dataset.field]=input.value.trim();return v;});}
  function centres(chosen=[]){$('centres').replaceChildren();for(const c of scopes.find(t=>t.id===$('tenant').value)?.centres||[]){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=chosen.includes(c.id);l.append(input,document.createTextNode(c.name));$('centres').append(l);}}
  function read(){
    const kind=$('audience').value,rows=readPairs();
    return {template:$('template').value,title:{en:$('title-en').value.trim(),af:$('title-af').value.trim()},description:{en:$('description-en').value.trim(),af:$('description-af').value.trim()},word:{en:$('word-en').value.trim(),af:$('word-af').value.trim()},
      pairs:rows.map(p=>({label:{en:p.en,af:p.af},target:{en:p.targetEn,af:p.targetAf},picture:p.picture})),world:$('world').value,
      levels:[...document.querySelectorAll('#levels input:checked')].map(x=>Number(x.value)),category:$('category').value,primarySkill:$('skill').value,
      ageMin:Number($('age-min').value),ageMax:Number($('age-max').value),guidance:{en:$('guidance-en').value.trim(),af:$('guidance-af').value.trim()},
      audience:{kind,tenantId:kind==='public'?null:$('tenant').value,centreIds:kind==='centres'?[...$('centres').querySelectorAll('input:checked')].map(x=>x.value):[]}};
  }
  function fill(d){
    for(const [id,v] of Object.entries({'template':d.template,'title-en':d.title.en,'title-af':d.title.af,'description-en':d.description.en,'description-af':d.description.af,'word-en':d.word.en,'word-af':d.word.af,'world':d.world,'category':d.category,'skill':d.primarySkill,'age-min':d.ageMin,'age-max':d.ageMax,'guidance-en':d.guidance.en,'guidance-af':d.guidance.af,'audience':d.audience.kind,'tenant':d.audience.tenantId||''}))$(id).value=v;
    for(const input of document.querySelectorAll('#levels input'))input.checked=d.levels.includes(Number(input.value));
    pairs(d.pairs.map(p=>({en:p.label.en,af:p.label.af,targetEn:p.target.en,targetAf:p.target.af,picture:p.picture})));centres(d.audience.centreIds);show();
  }
  function show(){document.querySelectorAll('[data-step]').forEach((el,i)=>el.hidden=i!==step);$('step-title').textContent=['1 · Choose your engine','2 · Add educational content','3 · Choose your world','4 · Skills, levels and audience','5 · Preview and publish'][step];$('back').disabled=step===0||busy;$('next').hidden=step===4;$('publish').hidden=step!==4;$('word-fields').hidden=$('template').value!=='rocket_letters';$('pair-fields').hidden=$('template').value==='rocket_letters';$('tenant-fields').hidden=$('audience').value==='public';$('centres').hidden=$('audience').value!=='centres';$('archive').disabled=!selected||busy;$('status').textContent=selected?`${selected.status} · saved edit ${selected.editRevision} · published revision ${selected.publishedRevision}`:'New draft';}
  async function preview(){const {game}=await api('/api/admin/game-studio/preview',read());$('preview').replaceChildren();const title=document.createElement('h3');title.textContent=game.title.en+' / '+game.title.af;$('preview').append(title);const info=document.createElement('p');info.textContent=`${game.category} · ${game.primarySkill.replaceAll('_',' ')} · ${read().world} · levels ${read().levels.join(', ')} · practice only`;$('preview').append(info);
    const board=document.createElement('div');board.className='preview-board';board.dataset.world=read().world;
    const draft=read(),labels=draft.template==='rocket_letters'?[...draft.word.en.toUpperCase(),...draft.word.af.toUpperCase()]:draft.pairs.flatMap(p=>draft.template==='matching'?[p.label.en+' → '+p.target.en,p.label.af+' → '+p.target.af]:[pictures[p.picture],p.label.en+' / '+p.label.af]);
    for(const label of labels){const card=document.createElement('span');card.textContent=label;board.append(card);}$('preview').append(board);
  }
  function list(){const select=$('saved');select.replaceChildren();option(select,'','Create a new game');for(const item of items)option(select,item.id,item.draft.title.en+' · '+item.status);select.value=selected?.id||'';}
  async function guarded(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;show();}}
  async function save(){const response=await api('/api/admin/game-studio/games',{id:selected?.id??newDraftId,expectedRevision:selected?.editRevision??0,action:'save',draft:read()});selected=response.item;items=items.filter(i=>i.id!==selected.id).concat(selected);list();notice('Draft saved. Published revisions are unchanged.');}
  $('next').onclick=()=>guarded(async()=>{if(step===3)await preview();step=Math.min(4,step+1);show();$('step-title').focus();});
  $('back').onclick=()=>{step=Math.max(0,step-1);show();$('step-title').focus();};
  $('save').onclick=()=>guarded(save);
  $('publish').onclick=()=>guarded(async()=>{await preview();await save();selected=(await api('/api/admin/game-studio/games',{id:selected.id,expectedRevision:selected.editRevision,action:'publish'})).item;items=items.filter(i=>i.id!==selected.id).concat(selected);list();notice('Published revision '+selected.publishedRevision+'. Refresh the authorised Arcade to play.');});
  $('archive').onclick=()=>guarded(async()=>{selected=(await api('/api/admin/game-studio/games',{id:selected.id,expectedRevision:selected.editRevision,action:'archive'})).item;items=items.filter(i=>i.id!==selected.id).concat(selected);list();notice('Archived. Existing observations remain stored.');});
  $('saved').onchange=()=>{selected=items.find(i=>i.id===$('saved').value)||null;if(!selected)newDraftId='factory_'+crypto.randomUUID().replaceAll('-','');step=0;fill(selected?.draft||defaults);};
  $('template').onchange=show;$('audience').onchange=show;$('tenant').onchange=()=>centres();
  $('add-pair').onclick=()=>{const rows=readPairs();if(rows.length<8)pairs([...rows,{en:'Star',af:'Ster',targetEn:'Star',targetAf:'Ster',picture:'planet'}]);};
  const defaults={template:'rocket_letters',title:{en:'Fruit flight',af:'Vrugtevlug'},description:{en:'Collect the letters in order.',af:'Versamel die letters in volgorde.'},word:{en:'APPLE',af:'APPEL'},pairs:[{label:{en:'Rocket',af:'Vuurpyl'},target:{en:'Space vehicle',af:'Ruimtevoertuig'},picture:'rocket'},{label:{en:'Planet',af:'Planeet'},target:{en:'World',af:'Wêreld'},picture:'planet'}],world:'moon',levels:[1],category:'words',primarySkill:'word_recognition',ageMin:6,ageMax:12,guidance:{en:'Advisory practice guidance, not an age norm.',af:'Oefenriglyn, nie ’n ouderdomsnorm nie.'},audience:{kind:'centres',tenantId:null,centreIds:[]}};
  fill(defaults);
  guarded(async()=>{const [catalogue,audiences]=await Promise.all([api('/api/admin/game-studio/games'),api('/api/admin/store/scopes')]);items=catalogue.items;scopes=audiences.items;for(const t of scopes)option($('tenant'),t.id,t.name);centres();list();notice('Choose a template or open a saved draft.');});
}
