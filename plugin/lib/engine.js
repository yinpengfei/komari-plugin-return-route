'use strict';
const {targetKey}=require('./config');
const commands=require('./commands');
const labels={ct_cn2_mixed:'CN2 混合',ct_cn2_gia:'CN2（GIA 推测）',ct_cn2_gt:'CN2（GT 推测）',ct_ctgnet:'CTGNET',ct_163:'163',ct_destination_only:'仅见电信目的网',ct_unknown:'未知',cu_9929:'9929',cu_9929_mixed:'9929 混合',cu_cug:'CUG',cu_4837:'4837',cu_destination_only:'仅见联通目的网',cu_unknown:'未知',cm_cmin2:'CMIN2',cm_cmin2_mixed:'CMIN2 混合',cm_cmi:'CMI',cm_cmnet:'CMNET',cm_unknown:'未知',ct_dynamic_mixed:'动态混合',cu_dynamic_mixed:'动态混合',cm_dynamic_mixed:'动态混合'};
function createEngine(env){
 const {rpc,storage,config,artifacts,net}=env, now=env.now||Date.now;
 const state=storage.jobs(); if(state.schema!==1||!Array.isArray(state.jobs)||!state.due||!state.installed)throw Error('任务状态损坏，请恢复备份');
 let busy=false, stopped=false; let cleanupDay='';
 function save(){state.jobs=state.jobs.filter(j=>['queued','dispatching','running'].includes(j.status)).concat(state.jobs.filter(j=>!['queued','dispatching','running'].includes(j.status)).slice(-80));storage.saveJobs(state);}
 function active(uuid){return state.jobs.find(j=>j.uuid===uuid&&['queued','dispatching','running'].includes(j.status));}
 function targets(){return JSON.parse(config().targets);}
 function jitter(uuid){let n=0;for(const c of uuid)n=(n*31+c.charCodeAt(0))>>>0;return n%60000;}
 const cfgAtLoad=config(),signature=JSON.stringify({interval:cfgAtLoad.interval_minutes,targets:cfgAtLoad.targets,nodes:cfgAtLoad.nodes});
 if(state.signature!==signature){
  for(const uuid of cfgAtLoad.nodes){const latest=storage.latest(uuid);const sameTargets=state.target_signature===cfgAtLoad.targets;state.due[uuid]=sameTargets&&latest.last_attempt?Date.parse(latest.last_attempt.at)+cfgAtLoad.interval_minutes*60000+jitter(uuid):now()+jitter(uuid);}
  state.signature=signature;state.target_signature=cfgAtLoad.targets;save();
 }
 function queue(uuid,kind,manual){
  const cfg=config();if(!cfg.nodes.includes(uuid))throw Error('请先在配置中选择该节点');
  const existing=active(uuid);if(existing)return existing;
  const recent=state.jobs.find(j=>j.uuid===uuid&&now()-(j.finished_at||j.created_at)<30000);
  if(manual&&recent)throw Error('请等待 30 秒再试');
  const job={id:env.id(),uuid,kind,status:'queued',manual:!!manual,created_at:now(),targets:targets(),task_id:null};
  state.jobs.push(job);save();return job;
 }
 function validReport(raw,job){
  if(typeof raw!=='string'||raw.length>1048576)throw Error('采集结果过大或无效');
  const report=JSON.parse(raw);
  if(report.schema!==1||report.version!=='0.1.0'||report.request_id!==job.id||!Array.isArray(report.results)||report.results.length!==job.targets.length)throw Error('采集器版本、任务或结果数量不匹配');
  const seen=new Set();
  for(const row of report.results){
   const target=job.targets.find(t=>t.id===row.target?.id);
   if(!target||seen.has(target.id)||targetKey(target)!==targetKey(row.target))throw Error('采集目标不匹配');seen.add(target.id);
   if(!['available','partial','unavailable','timeout','permission_denied','network_unavailable'].includes(row.status)||!Array.isArray(row.attempts)||row.attempts.length>3)throw Error('无效的检测状态');
   if(!row.classification||!Object.prototype.hasOwnProperty.call(labels,row.classification.code)||!['confirmed','mixed','inconclusive'].includes(row.classification.confidence))throw Error('无效的线路分类');
   for(const a of row.attempts){if(!Array.isArray(a.hops)||a.hops.length>30)throw Error('跳点过多');for(const h of a.hops){if(!Number.isInteger(h.ttl)||h.ttl<1||h.ttl>30||net.isIP(h.ip)!==target.family||typeof h.rtt_ms!=='number'||h.rtt_ms<0||h.rtt_ms>180000||h.asn&&!/^AS\d{1,10}$/.test(h.asn))throw Error('无效的跳点');}}
   if(['available','partial'].includes(row.status)&&!row.attempts.some(a=>a.hops.length))throw Error('成功结果缺少跳点');
   row.target=target;
   row.classification={code:row.classification.code,label:labels[row.classification.code],confidence:row.classification.confidence,evidence:String(row.classification.evidence||'').slice(0,500)};
  }
  return report;
 }
 function finish(job,status,error,report){
  job.status=status;job.error=String(error||'').slice(0,500);job.finished_at=now();
  const at=new Date(now()).toISOString();
  if(job.kind==='install'&&status==='success')state.installed[job.uuid]={version:'0.1.0',at};
  if(job.kind==='probe'){
   const latest=storage.latest(job.uuid), current=new Set(targets().map(targetKey));
   latest.results=latest.results.filter(r=>current.has(targetKey(r.target)));
   latest.last_attempt={id:job.id,at,status,error:job.error,targets:report?report.results.map(r=>({id:r.target.id,status:r.status})):[]};
   if(report){
    for(const row of report.results){if(!['available','partial'].includes(row.status)||!current.has(targetKey(row.target)))continue;
     latest.results=latest.results.filter(r=>targetKey(r.target)!==targetKey(row.target));latest.results.push(Object.assign({},row,{observed_at:at,dataset:report.dataset}));
    }
    if(report.results.some(r=>['available','partial'].includes(r.status)))latest.last_success_at=at;
   }
   storage.saveLatest(job.uuid,latest);
   storage.append(job.uuid,{schema:1,at,job_id:job.id,status,error:job.error,report:report||null});
   if(status==='success')state.installed[job.uuid]={version:'0.1.0',at};
   state.due[job.uuid]=now()+(JSON.stringify(job.targets)===config().targets?config().interval_minutes*60000:0)+jitter(job.uuid);
  }
  save();
 }
 async function pump(){
  if(busy||stopped)return;busy=true;
  try{
   const cfg=config();
   // Persist the task lease before dispatch. A reload in the RPC gap waits for
   // its lease to expire rather than immediately duplicating a remote command.
   for(const job of state.jobs.slice()){
    if(!['dispatching','running'].includes(job.status))continue;
    if(now()-job.started_at>240000){finish(job,'failed','检测超时；节点任务由采集器自身的 180 秒上限结束');continue;}
    if(!job.task_id)continue;
    try{
     const task=await rpc('admin:getSpecificTaskResult',{task_id:job.task_id,uuid:job.uuid});
     if(!task||task.exit_code===null||task.exit_code===undefined)continue;
     const raw=String(task.result||'');
     if(Number(task.exit_code)!==0){finish(job,'failed',raw.includes('Remote control is disabled')?'节点已关闭远程任务，无法执行回程检测':raw.slice(0,300)||'节点命令失败');continue;}
     if(job.kind==='install'){if(!raw.includes('collector_installed:0.1.0')){finish(job,'failed','采集器安装回执无效');continue;}finish(job,'success');}
     else {let report;try{report=validReport(raw,job);}catch(e){finish(job,'failed','采集结果无效：'+e.message);continue;}const ok=report.results.some(r=>['available','partial'].includes(r.status));finish(job,ok?'success':'failed',ok?'':'所有目标均无可用跳点，请检查网络、目标和原始套接字权限',report);}
    }catch(e){if(now()-job.started_at>230000)finish(job,'failed',e.message);else job.poll_error=String(e.message).slice(0,200);}
   }
   if(cfg.enabled){for(const uuid of cfg.nodes){if(!state.installed[uuid]||active(uuid))continue;if(state.due[uuid]===undefined)state.due[uuid]=now()+jitter(uuid);if(state.due[uuid]<=now())queue(uuid,'probe',false);}}
   const count=()=>state.jobs.filter(j=>['dispatching','running'].includes(j.status)).length;
   while(count()<2&&!stopped){
    const job=state.jobs.find(j=>j.status==='queued');if(!job)break;
    if(!cfg.nodes.includes(job.uuid)||!job.manual&&!cfg.enabled){finish(job,'canceled','节点已移除或自动检测已暂停');continue;}
    job.status='dispatching';job.started_at=now();save();
    try{
     const command=job.kind==='install'?commands.install(artifacts):commands.probe({schema:1,request_id:job.id,targets:job.targets});
     const reply=await rpc('admin:exec',{command,clients:[job.uuid]});
     if(!reply?.task_id)throw Error('无法创建节点任务');job.task_id=reply.task_id;job.status='running';save();
    }catch(e){finish(job,'failed',e.message);}
   }
   const day=new Date(now()).toISOString().slice(0,10);if(cleanupDay!==day){storage.prune(now(),cfg.history_days);cleanupDay=day;}save();
  }finally{busy=false;}
 }
 function view(uuid){const v=storage.latest(uuid),allowed=new Set(targets().map(targetKey));v.results=v.results.filter(r=>allowed.has(targetKey(r.target)));v.stale=!v.last_success_at||now()-Date.parse(v.last_success_at)>config().interval_minutes*120000;return v;}
 function summary(uuid){const v=view(uuid);return {uuid,stale:v.stale,last_attempt:v.last_attempt?{at:v.last_attempt.at,status:v.last_attempt.status}:null,running:!!active(uuid),results:v.results.map(r=>({carrier:r.target.carrier,family:r.target.family,target_name:r.target.name,region:r.target.region,label:r.classification.label,confidence:r.classification.confidence,observed_at:r.observed_at,expires_at:new Date(Date.parse(r.observed_at)+config().interval_minutes*120000).toISOString(),partial:r.status==='partial'}))};}
 return {state,queue,pump,view,summary,validReport,stop(){stopped=true;save();}};
}
module.exports={createEngine,labels};
