'use strict';
(()=>{
 if(window.__komariReturnRoute)return;window.__komariReturnRoute=true;
 let summaries=new Map(),enabled=true,timer,observer,queued=false;
 const carriers={CT:'电信',CU:'联通',CM:'移动'};
 function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
 function draw(card){
  const item=summaries.get(card.id);let panel=card.querySelector(':scope > .rr-home-panel');
  if(!item){panel?.remove();return;}
  if(!panel){panel=el('section');panel.className='rr-home-panel';panel.addEventListener('click',e=>e.stopPropagation());panel.dataset.family='4';card.append(panel);}
  const expired=item.stale||item.results.filter(r=>r.family===Number(panel.dataset.family)).some(r=>r.expires_at&&Date.now()>Date.parse(r.expires_at));const key=JSON.stringify(item)+'|'+panel.dataset.family+'|'+expired;if(panel.dataset.key===key)return;panel.dataset.key=key;const family=Number(panel.dataset.family);panel.replaceChildren();
  const header=el('header');header.append(el('strong','三网回程'));const select=el('select');select.setAttribute('aria-label','回程 IP 版本');for(const n of [4,6]){const o=el('option','IPv'+n);o.value=String(n);select.append(o);}select.value=String(family);select.onchange=()=>{panel.dataset.family=select.value;draw(card);};header.append(select);panel.append(header);
  const rows=item.results.filter(r=>r.family===family);
  for(const carrier of ['CT','CU','CM']){const matches=rows.filter(r=>r.carrier===carrier);if(!matches.length)matches.push({label:'待检测／未配置',region:'',confidence:'inconclusive'});for(const r of matches){const row=el('div');row.className='rr-route-row';row.append(el('span',carriers[carrier]+(r.region?' · '+r.region:'')));const badge=el('span',r.label);badge.className='rr-route-label'+(expired||r.confidence==='inconclusive'?' rr-stale':'');badge.title=r.observed_at?'目标：'+r.target_name+'；采集：'+new Date(r.observed_at).toLocaleString()+(r.partial?'；路径不完整':''):'';row.append(badge);panel.append(row);}}
  const foot=el('div');foot.className='rr-foot';const date=rows.map(r=>r.observed_at).filter(Boolean).sort()[0];foot.append(el('span',item.running?'更新中':expired?'结果过期':item.last_attempt?.status==='failed'?'更新失败，保留上次结果':'仅代表所选目标'),el('span',date?new Date(date).toLocaleString():'—'));panel.append(foot);
 }
 function mount(){if(!enabled)return;document.querySelectorAll('.km-node-card[id]').forEach(draw);}
 function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;mount();},150);}
 function stop(){enabled=false;clearInterval(timer);observer?.disconnect();document.querySelectorAll('.rr-home-panel').forEach(e=>e.remove());window.__komariReturnRoute=false;}
 async function update(){if(document.hidden)return;try{const res=await fetch('/api/plugins/return-route/summary',{credentials:'same-origin',cache:'no-store'});if(res.status===404){stop();return;}if(!res.ok){summaries=new Map();mount();return;}const data=await res.json();summaries=new Map((data.nodes||[]).map(n=>[n.uuid,n]));mount();}catch(_){mount();/* Retain timestamps; expiry is evaluated locally during outages. */}}
 observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});update();timer=setInterval(update,30000);
})();
