const test=require('node:test'),assert=require('node:assert/strict');
const ui=require('../plugin/web/presentation');
const now=Date.parse('2026-10-21T10:00:00Z');
const row=(code,extra={})=>({code,carrier:'CT',label:code,confidence:'confirmed',expires_at:'2026-10-21T11:00:00Z',...extra});
test('single-line labels distinguish absent data, insufficient evidence and a known backbone',()=>{
 assert.equal(ui.carrier([],'CT',now).text,'—');
 assert.equal(ui.carrier([row('ct_destination_only',{confidence:'inconclusive'})],'CT',now).text,'?');
 assert.equal(ui.carrier([row('ct_cn2_gia')],'CT',now).text,'GIA');
 assert.equal(ui.carrier([row('unexpected-code')],'CT',now).text,'?');
});
test('different targets are shown as multiple, not a claimed mixed backbone',()=>{
 assert.equal(ui.carrier([row('ct_163',{region:'北京'}),row('ct_163',{region:'广州'})],'CT',now).text,'163');
 assert.equal(ui.carrier([row('ct_163'),row('ct_cn2_gia')],'CT',now).text,'多');
 assert.equal(ui.carrier([row('ct_163'),row('ct_destination_only',{confidence:'inconclusive'})],'CT',now).text,'多');
});
test('status reflects running, retained failures, stale and missing family data',()=>{
 const rows=[row('ct_163')];assert.equal(ui.status({running:true,last_attempt:{status:'failed'}},rows,now).kind,'running');
 assert.equal(ui.status({last_attempt:{status:'failed'}},rows,now).kind,'failed');
 assert.equal(ui.status({},[],now).kind,'empty');assert.equal(ui.status({},rows,now).kind,'fresh');
 assert.equal(ui.status({},rows,now+7200000).kind,'stale');
 assert.equal(ui.carrier(rows,'CT',now+7200000).tone,'uncertain');
 assert.equal(ui.carrier([row('ct_163',{partial:true})],'CT',now).tone,'uncertain');
});
