'use strict';
// Only match documented DOM attributes. Never read framework internals or use
// list order: themes may sort/filter nodes independently of the summary API.
(()=>{
 function matchCards(root,nodes){
  const byID=new Map(nodes.map(n=>[n.uuid,n])),byName=new Map();
  for(const n of nodes){if(n.match_by_name===true&&typeof n.name==='string'&&n.name)byName.set(n.name,byName.has(n.name)?null:n);}
  const matches=[];
  for(const card of root.querySelectorAll('.km-node-card[id],.node-card[aria-label],.node-card[data-node-uuid]')){
   let node=null,glass=card.classList.contains('node-card');
   if(card.classList.contains('km-node-card'))node=byID.get(card.id);
   else if(card.hasAttribute('data-node-uuid'))node=byID.get(card.getAttribute('data-node-uuid'));
   else {
    const label=card.getAttribute('aria-label')||'',prefix='查看节点 ',suffix=' 详情';
    if(label.startsWith(prefix)&&label.endsWith(suffix))node=byName.get(label.slice(prefix.length,-suffix.length));
   }
   if(node)matches.push({card,node,glass});
  }
  return matches;
 }
 if(typeof module==='object'&&module.exports)module.exports={matchCards};
 else window.KomariReturnRouteCards={matchCards};
})();
