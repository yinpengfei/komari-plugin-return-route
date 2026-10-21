'use strict';
(()=>{
 if(window.__komariReturnRoute)return;window.__komariReturnRoute=true;
 const ui=window.KomariReturnRoutePresentation,carriers={CT:'电信',CU:'联通',CM:'移动'},letters={CT:'电',CU:'联',CM:'移'};
 let summaries=new Map(),enabled=true,timer,observer,queued=false,dialog,detailState,detailKey='';
 function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 function familySelect(compact){const s=el('select');s.setAttribute('aria-label',compact?'回程 IP 版本':'详情 IP 版本');for(const n of [4,6]){const o=el('option',(compact?'V':'IPv')+n);o.value=String(n);s.append(o);}return s;}
 function setFamily(uuid,family){for(const p of document.querySelectorAll('.rr-home-panel'))if(p.dataset.uuid===uuid)p.dataset.family=String(family);mount();}
 function ensureDialog(){
  if(dialog)return;
  dialog=el('dialog',undefined,'rr-detail-dialog');dialog.setAttribute('aria-labelledby','rr-detail-title');
  const head=el('header',undefined,'rr-detail-head'),title=el('strong');title.id='rr-detail-title';
  const close=el('button','×','rr-detail-close');close.type='button';close.setAttribute('aria-label','关闭回程详情');close.onclick=()=>dialog.close();head.append(title,close);
  const controls=el('div',undefined,'rr-detail-controls'),select=familySelect(false);controls.append(el('span','协议'),select);select.onchange=()=>{if(!detailState)return;detailState.family=Number(select.value);setFamily(detailState.uuid,select.value);renderDetails();};
  dialog.append(head,controls,el('div',undefined,'rr-detail-body'),el('p','仅代表所选目标的回程；逐跳证据仅管理员可在后台查看。','rr-detail-note'));
  dialog.addEventListener('close',()=>{const previous=detailState;detailState=null;detailKey='';if(previous){const p=[...document.querySelectorAll('.rr-home-panel')].find(p=>p.dataset.uuid===previous.uuid);p?.querySelector(previous.carrier?'[data-carrier="'+previous.carrier+'"]':'.rr-more')?.focus();}});
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  document.body.append(dialog);
 }
 function openDetails(item,family,carrier){ensureDialog();detailState={uuid:item.uuid,family,carrier};detailKey='';renderDetails();if(!dialog.open)dialog.showModal();}
 function renderDetails(){
  if(!dialog?.open&&!detailState)return;
  const item=summaries.get(detailState?.uuid);if(!item){dialog?.close();return;}
  const rows=item.results.filter(r=>r.family===detailState.family),state=ui.status(item,rows),key=JSON.stringify(item)+'|'+detailState.family+'|'+state.kind+'|'+rows.map(r=>ui.expired(r)).join(',');
  if(key===detailKey)return;detailKey=key;
  dialog.querySelector('#rr-detail-title').textContent=(item.name||'节点')+' · 回程详情';dialog.querySelector('select').value=String(detailState.family);
  const body=dialog.querySelector('.rr-detail-body');body.replaceChildren();body.append(el('p',state.text,'rr-detail-state rr-state-'+state.kind));
  for(const code of ['CT','CU','CM']){
   const section=el('section',undefined,'rr-detail-carrier'+(detailState.carrier===code?' rr-detail-selected':''));section.append(el('h3',carriers[code]));const matches=rows.filter(r=>r.carrier===code);
   if(!matches.length)section.append(el('p','待检测／未配置','rr-detail-note'));
   for(const r of matches){
    const entry=el('div',undefined,'rr-detail-entry'),line=el('div',undefined,'rr-detail-result');line.append(el('span',r.region||r.target_name||'所选目标'),el('strong',r.label));entry.append(line);
    if(r.target_name&&r.target_name!==r.region)entry.append(el('p','目标：'+r.target_name,'rr-detail-note'));
    entry.append(el('p','采集：'+(r.observed_at?new Date(r.observed_at).toLocaleString():'—')+(ui.expired(r)?' · 已过期':''),'rr-detail-note'));
    if(r.partial)entry.append(el('p','路径不完整，仅根据已响应跳点判断。','rr-detail-warning'));
    if(r.explanation)entry.append(el('p',r.explanation,'rr-detail-warning'));section.append(entry);
   }
   body.append(section);
  }
 }
 function draw(card,item,glass){
  let panel=card.querySelector(':scope > .rr-home-panel');
  if(panel&&panel.dataset.uuid!==item.uuid){panel.remove();panel=null;}
  if(!panel){
   panel=el('section',undefined,'rr-home-panel'+(glass?' rr-glass':''));panel.setAttribute('aria-label','三网回程摘要');panel.dataset.family='4';panel.dataset.uuid=item.uuid;
   panel.addEventListener('click',e=>e.stopPropagation());panel.addEventListener('keydown',e=>e.stopPropagation());
   panel.append(el('span','回程','rr-caption'),familySelect(true));
   const chips=el('div',undefined,'rr-chips');for(const code of ['CT','CU','CM']){const b=el('button',undefined,'rr-chip');b.type='button';b.dataset.carrier=code;b.append(el('span',letters[code],'rr-carrier rr-carrier-'+code),el('span',undefined,'rr-chip-value'));chips.append(b);}panel.append(chips);
   const state=el('span',undefined,'rr-status');state.setAttribute('role','img');const more=el('button','ⓘ','rr-more');more.type='button';more.setAttribute('aria-label','回程详情');more.title='查看回程详情';panel.append(state,more);card.append(panel);
  }
  const family=Number(panel.dataset.family),rows=item.results.filter(r=>r.family===family),state=ui.status(item,rows),key=JSON.stringify(item)+'|'+family+'|'+state.kind+'|'+rows.map(r=>ui.expired(r)).join(',');
  if(panel.dataset.key===key)return;panel.dataset.key=key;
  const select=panel.querySelector('select');select.value=String(family);select.onchange=()=>{panel.dataset.family=select.value;draw(card,summaries.get(item.uuid)||item,glass);};
  for(const b of panel.querySelectorAll('.rr-chip')){const code=b.dataset.carrier,value=ui.carrier(rows,code);b.querySelector('.rr-chip-value').textContent=value.text;b.className='rr-chip rr-tone-'+value.tone;b.title=carriers[code]+'：'+value.description+'；点击查看详情';b.setAttribute('aria-label',carriers[code]+'回程：'+value.description+'，查看详情');b.onclick=()=>openDetails(summaries.get(item.uuid)||item,Number(panel.dataset.family),code);}
  const marker=panel.querySelector('.rr-status');marker.className='rr-status rr-state-'+state.kind;marker.title=state.text;marker.setAttribute('aria-label','回程状态：'+state.text);
  panel.querySelector('.rr-more').onclick=()=>openDetails(summaries.get(item.uuid)||item,Number(panel.dataset.family),null);
 }
 function mount(){if(!enabled||!ui||!window.KomariReturnRouteCards)return;const matches=window.KomariReturnRouteCards.matchCards(document,[...summaries.values()]),hosts=new Set(matches.map(m=>m.card));document.querySelectorAll('.rr-home-panel').forEach(p=>{if(!hosts.has(p.parentElement))p.remove();});for(const {card,node,glass} of matches)draw(card,node,glass);if(detailState)renderDetails();}
 function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;mount();},150);}
 function stop(){enabled=false;clearInterval(timer);observer?.disconnect();dialog?.close();dialog?.remove();document.querySelectorAll('.rr-home-panel').forEach(e=>e.remove());window.__komariReturnRoute=false;}
 async function update(){if(document.hidden)return;try{const res=await fetch('/api/plugins/return-route/summary',{credentials:'same-origin',cache:'no-store'});if(res.status===404){stop();return;}if(!res.ok){summaries=new Map();mount();return;}const data=await res.json();summaries=new Map((data.nodes||[]).map(n=>[n.uuid,n]));mount();}catch(_){mount();}}
 // Keyed updates avoid feeding the subtree observer indefinitely when the
 // theme or the modal updates its DOM. Controls retain keyboard focus.
 observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});update();timer=setInterval(update,30000);
})();
