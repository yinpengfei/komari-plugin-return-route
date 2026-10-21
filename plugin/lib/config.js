'use strict';
const presets = require('../presets.json');
function publicIP(value, family, net) {
  if (typeof value !== 'string' || value.length > 64 || value.includes('%') || net.isIP(value) !== family) return false;
  if (family === 4) {
    const p = value.split('.').map(Number);
    return p[0] > 0 && p[0] < 224 && p[0] !== 10 && p[0] !== 127 && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) && !(p[0] === 192 && p[1] === 168) && !(p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  return /^[23][0-9a-f]{3}:/i.test(value);
}
function normalize(raw, net) {
  const c = Object.assign({enabled:true,interval_minutes:60,history_days:30,nodes:[],targets:JSON.stringify(presets.beijing)},raw || {});
  c.enabled = c.enabled === true;
  c.interval_minutes = Number(c.interval_minutes); c.history_days = Number(c.history_days);
  if (!Number.isInteger(c.interval_minutes) || c.interval_minutes < 5 || c.interval_minutes > 10080) throw Error('检测间隔须为 5–10080 分钟的整数');
  if (!Number.isInteger(c.history_days) || c.history_days < 1 || c.history_days > 365) throw Error('历史保留须为 1–365 天的整数');
  if (typeof c.nodes === 'string') c.nodes = JSON.parse(c.nodes);
  if (!Array.isArray(c.nodes) || c.nodes.length > 1000 || c.nodes.some(n => !/^[a-zA-Z0-9_-]{1,100}$/.test(n))) throw Error('无效的节点列表');
  c.nodes = [...new Set(c.nodes)];
  if (!c.targets) c.targets = JSON.stringify(presets.beijing);
  let targets = typeof c.targets === 'string' ? JSON.parse(c.targets) : c.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 18) throw Error('需配置 1–18 个三网目标');
  const ids = new Set();
  targets = targets.map((t,i) => {
    if (!t || !['CT','CU','CM'].includes(t.carrier)) throw Error('目标运营商须为 CT、CU 或 CM');
    const family = Number(t.family), address = String(t.address || '').trim();
    if (!publicIP(address,family,net)) throw Error('目标须为对应版本的公网 IP，不能填写域名、内网地址或命令');
    const id = t.id || t.carrier.toLowerCase()+'-'+family+'-'+i;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw Error('目标 ID 无效或重复'); ids.add(id);
    return {id,carrier:t.carrier,family,address,name:String(t.name || t.carrier).slice(0,120),region:String(t.region || '自定义').slice(0,80)};
  });
  c.targets = JSON.stringify(targets); return c;
}
function targetKey(t) {return [t.id,t.carrier,t.family,t.address].join('|');}
module.exports = {normalize,publicIP,targetKey};
