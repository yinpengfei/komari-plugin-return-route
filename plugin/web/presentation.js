'use strict';
(()=>{
 const shortLabels={ct_cn2_mixed:'CN2混',ct_cn2_gia:'GIA',ct_cn2_gt:'GT',ct_ctgnet:'CTGNET',ct_163:'163',cu_9929:'9929',cu_9929_mixed:'9929混',cu_cug:'CUG',cu_4837:'4837',cm_cmin2:'CMIN2',cm_cmin2_mixed:'CMIN2混',cm_cmi:'CMI',cm_cmnet:'CMNET',ct_dynamic_mixed:'混合',cu_dynamic_mixed:'混合',cm_dynamic_mixed:'混合'};
 function expired(row,now=Date.now()){return !!row.expires_at&&now>Date.parse(row.expires_at);}
 function carrier(rows,code,now=Date.now()){
  const matches=rows.filter(r=>r.carrier===code);
  if(!matches.length)return {text:'—',tone:'empty',description:'待检测／未配置'};
  const values=[...new Set(matches.map(r=>r.confidence==='inconclusive'?'?':shortLabels[r.code]||'?'))];
  return {text:values.length===1?values[0]:'多',tone:matches.some(r=>expired(r,now)||r.confidence==='inconclusive'||r.partial)?'uncertain':'known',description:matches.map(r=>[r.region,r.label].filter(Boolean).join(' · ')).join('；')};
 }
 function status(item,rows,now=Date.now()){
  if(item.running)return {kind:'running',text:'更新中'};
  if(item.last_attempt?.status==='failed')return {kind:'failed',text:'更新失败，保留上次结果'};
  if(!rows.length)return {kind:'empty',text:'当前协议待检测／未配置'};
  if(item.stale||rows.some(r=>expired(r,now)))return {kind:'stale',text:'结果已过期'};
  return {kind:'fresh',text:'结果已更新'};
 }
 const api={carrier,status,expired};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else window.KomariReturnRoutePresentation=api;
})();
