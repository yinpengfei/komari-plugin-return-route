'use strict';
const server=require('server'),fs=require('fs'),path=require('path'),net=require('net'),crypto=require('crypto');
const {normalize}=require('./lib/config');
const {createStorage}=require('./lib/storage');
const {createEngine}=require('./lib/engine');
const presets=require('./presets.json');
const artifacts=require('./artifacts.json');
const BASE='/api/plugins/return-route';
let engine,configuration,configurationError='',timer;
const storage=createStorage(fs,__storageDir__);
function config(){if(!configuration)throw Error(configurationError||'配置未加载');return configuration;}
function header(req,name){for(const key of Object.keys(req.headers||{}))if(key.toLowerCase()===name.toLowerCase())return String(Array.isArray(req.headers[key])?req.headers[key][0]:req.headers[key]);return '';}
function admin(req){return Array.isArray(req.context?.principal?.roles)&&req.context.principal.roles.includes('admin');}
function write(res,code,value){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
function guard(req){
 if(!admin(req))throw Object.assign(Error('需要管理员登录'),{status:401});
 if(req.method==='POST'){
  if(header(req,'X-Komari-Return-Route')!=='1'||!header(req,'Content-Type').startsWith('application/json'))throw Object.assign(Error('无效的操作请求'),{status:403});
  // Browser-owned Sec-Fetch-Site cannot be spoofed by cross-origin JS. The
  // custom header additionally requires a CORS preflight, which we never grant.
  if(header(req,'Sec-Fetch-Site')!=='same-origin'&&!req.context?.principal?.is_api_key)throw Object.assign(Error('仅允许同源操作'),{status:403});
  const origin=header(req,'Origin');if(origin&&origin!==header(req,'X-Return-Route-Origin'))throw Object.assign(Error('来源不匹配'),{status:403});
 }
}
function route(method,url,fn,isAdmin=true){server.route(method,BASE+url,async(req,res)=>{try{if(isAdmin)guard(req);await fn(req,res);}catch(e){write(res,e.status||400,{error:String(e.message||e).slice(0,500)});}});}
async function nodes(){const list=await server.call('admin:listClients');if(!Array.isArray(list))throw Error('节点列表无效');return list;}
async function requireNode(uuid){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(uuid||''))throw Error('无效节点');const list=await nodes();if(!list.some(n=>n.uuid===uuid))throw Error('节点不存在');return uuid;}
function load(){
 route('GET','/state',async(req,res)=>{const list=await nodes();write(res,200,{version:'0.1.1',configuration,configuration_error:configurationError,presets,nodes:list.map(n=>({uuid:n.uuid,name:n.name,os:n.os,arch:n.arch,hidden:n.hidden})),jobs:engine?engine.state.jobs:[],installed:engine?engine.state.installed:{},summaries:engine?list.map(n=>engine.summary(n.uuid)):[],next_due:engine?engine.state.due:{}});});
 route('POST','/validate',async(req,res)=>{const c=normalize(JSON.parse(req.body),net);const known=new Set((await nodes()).map(n=>n.uuid));if(c.nodes.some(n=>!known.has(n)))throw Error('配置包含不存在的节点');write(res,200,{configuration:c});});
 route('POST','/refresh',async(req,res)=>{if(!engine)throw Error(configurationError||'尚未就绪');const data=JSON.parse(req.body);if(!Array.isArray(data.nodes)||data.nodes.length>1000||!['probe','install'].includes(data.kind))throw Error('无效任务');const jobs=[];for(const uuid of [...new Set(data.nodes)]){await requireNode(uuid);jobs.push(engine.queue(uuid,data.kind,true));}write(res,202,{jobs:jobs.map(j=>({id:j.id,uuid:j.uuid,status:j.status}))});engine.pump().catch(e=>console.error(e.message));});
 route('GET','/detail',async(req,res)=>{const uuid=await requireNode(req.query.uuid);if(!engine)throw Error('尚未就绪');write(res,200,engine.view(uuid));});
 route('GET','/history',async(req,res)=>{const uuid=await requireNode(req.query.uuid);write(res,200,{events:storage.history(uuid,req.query.day)});});
 route('GET','/summary',async(req,res)=>{
  if(!engine){write(res,200,{nodes:[]});return;}
  const settings=await server.call('admin:getSettings');if(settings.private_site&&!admin(req))throw Object.assign(Error('私有站点需要登录'),{status:401});
  const allowed=(await nodes()).filter(n=>admin(req)||!n.hidden),counts=new Map();for(const n of allowed)counts.set(n.name,(counts.get(n.name)||0)+1);write(res,200,{nodes:allowed.filter(n=>config().nodes.includes(n.uuid)).map(n=>Object.assign(engine.summary(n.uuid),{name:n.name,match_by_name:counts.get(n.name)===1}))});
 },false);
 server.static('/plugins/return-route/assets','web');
 server.injectHTML('<link rel="stylesheet" href="/plugins/return-route/assets/style.css">','<script src="/plugins/return-route/assets/card-adapter.js" defer></script><script src="/plugins/return-route/assets/home.js" defer></script>');
 server.getConfig().then(raw=>{
  try{configuration=normalize(raw,net);engine=createEngine({rpc:(m,p)=>server.call(m,p),storage,config,artifacts,net,id:()=>crypto.randomUUID()});engine.pump().catch(e=>console.error(e.message));
   timer=setInterval(()=>engine.pump().catch(e=>console.error(e.message)),2000);
  }catch(e){configurationError=String(e.message);console.error(configurationError);}
 });
 // The persisted due times, not browser activity, determine hourly work.
 server.cron('@every 1m',()=>{if(engine)engine.pump().catch(e=>console.error(e.message));});
}
function unload(){if(timer)clearInterval(timer);if(engine)engine.stop();}
