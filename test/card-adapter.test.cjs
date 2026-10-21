const test=require('node:test'),assert=require('node:assert/strict');
const {matchCards}=require('../plugin/web/card-adapter');
function card(classes,attrs={}){return {id:attrs.id,classList:{contains:c=>classes.split(' ').includes(c)},hasAttribute:k=>k in attrs,getAttribute:k=>attrs[k]??null};}
const node={uuid:'id-a',name:'node [JP] "一号"',match_by_name:true};
const root=cards=>({querySelectorAll:()=>cards});
test('default card maps UUID; Glassmorphism maps exact unique name, independent of ordering',()=>{
 const a=card('km-node-card',{id:'id-a'}),b=card('node-card',{'aria-label':'查看节点 '+node.name+' 详情'}),c=card('node-card',{'aria-label':'查看节点 other 详情'});
 const matches=matchCards(root([c,b,a]),[node]);assert.equal(matches.length,2);assert.equal(matches[0].node.uuid,node.uuid);assert.equal(matches[0].glass,true);assert.equal(matches[1].glass,false);
});
test('unselected duplicate, missing name uniqueness, unexpected labels never match by name',()=>{
 const a=card('node-card',{'aria-label':'查看节点 '+node.name+' 详情'});
 for(const data of [[{...node,match_by_name:false}],[{uuid:node.uuid,name:node.name}],[node,{uuid:'id-b',name:node.name,match_by_name:true}]])assert.equal(matchCards(root([a]),data).length,0);
 assert.equal(matchCards(root([card('node-card',{'aria-label':'打开 '+node.name})]),[node]).length,0);
});
test('explicit UUID wins; it never falls back to a different matching name',()=>{
 const a=card('node-card',{'data-node-uuid':'id-a','aria-label':'renamed'}),b=card('node-card',{'data-node-uuid':'missing','aria-label':'查看节点 '+node.name+' 详情'});
 assert.deepEqual(matchCards(root([a,b]),[node]).map(m=>m.node.uuid),['id-a']);
});
