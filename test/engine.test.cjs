const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createStorage}=require('../plugin/lib/storage'),{createEngine}=require('../plugin/lib/engine'),{normalize}=require('../plugin/lib/config'),commands=require('../plugin/lib/commands');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'return-route-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=Date.parse('2026-10-21T00:00:00Z'),seq=0;
 const storage=createStorage(fs,dir),cfg=normalize({enabled:false,nodes:['node-a','node-b','node-c']},net),tasks=new Map(),calls=[];
 const env={storage,config:()=>cfg,artifacts:{},net,now:()=>clock,id:()=>`job-${++seq}`,rpc:async(m,p)=>{
  calls.push([m,p]);if(m==='admin:exec'){const task_id=`task-${calls.length}`;tasks.set(task_id,{exit_code:null,result:'',uuid:p.clients[0],command:p.command});return {task_id};}
  assert.equal(m,'admin:getSpecificTaskResult');const task=tasks.get(p.task_id);assert.equal(p.uuid,task.uuid);return task;
 }};
 const e=createEngine(env);
 return {e,env,storage,cfg,tasks,calls,dir,advance:n=>clock+=n,now:()=>clock};
}
function report(job,options={}){return JSON.stringify({schema:1,version:'0.1.0',dataset:'fixture',request_id:job.id,results:job.targets.map(target=>({target,status:options.failure?'timeout':'available',attempts:options.failure?[]:[{reached:true,hops:[{ttl:1,ip:target.family===4?'59.43.1.1':'2402:4f00:f000::1',asn:'AS4809',rtt_ms:30}]}],classification:{code:target.carrier==='CT'?'ct_cn2_mixed':target.carrier==='CU'?'cu_9929':'cm_cmin2',confidence:'mixed',evidence:'fixture'}}))});}
test('manual refresh deduplicates, uses fixed commands, collects through host task API',async t=>{
 const s=setup(t),job=s.e.queue('node-a','probe',true);assert.equal(s.e.queue('node-a','probe',true).id,job.id);await s.e.pump();
 assert.equal(s.calls.filter(c=>c[0]==='admin:exec').length,1);assert.ok(s.tasks.get(job.task_id).command.includes('--config-b64'));
 Object.assign(s.tasks.get(job.task_id),{exit_code:0,result:report(job)});await s.e.pump();
 assert.equal(job.status,'success');assert.equal(s.storage.latest('node-a').results.length,6);
 const publicJSON=JSON.stringify(s.e.summary('node-a'));assert.ok(!publicJSON.includes('59.43.1.1'));assert.ok(!publicJSON.includes('219.141.140.10'));assert.ok(!publicJSON.includes('fixture'));
 assert.equal(s.storage.history('node-a','2026-10-21').length,1);
});
test('failure preserves successful results and remains explicitly failed',async t=>{
 const s=setup(t),job=s.e.queue('node-a','probe',true);await s.e.pump();Object.assign(s.tasks.get(job.task_id),{exit_code:0,result:report(job)});await s.e.pump();
 const good=s.storage.latest('node-a').last_success_at;s.advance(60000);const bad=s.e.queue('node-a','probe',true);await s.e.pump();Object.assign(s.tasks.get(bad.task_id),{exit_code:0,result:report(bad,{failure:true})});await s.e.pump();
 assert.equal(s.storage.latest('node-a').last_attempt.status,'failed');assert.equal(s.storage.latest('node-a').last_success_at,good);assert.equal(s.storage.latest('node-a').results.length,6);
 s.advance(121*60000);assert.equal(s.e.summary('node-a').stale,true);
});
test('hourly scheduler works without browser, caps concurrency, and pause blocks automatic work',async t=>{
 const s=setup(t);s.cfg.enabled=true;s.e.state.installed={'node-a':{version:'0.1.0'},'node-b':{version:'0.1.0'},'node-c':{version:'0.1.0'}};s.e.state.due={'node-a':0,'node-b':0,'node-c':0};await s.e.pump();
 assert.equal(s.e.state.jobs.filter(j=>j.status==='running').length,2);assert.equal(s.e.state.jobs.filter(j=>j.status==='queued').length,1);
 for(const j of s.e.state.jobs.filter(j=>j.status==='running'))Object.assign(s.tasks.get(j.task_id),{exit_code:0,result:report(j)});
 s.cfg.enabled=false;await s.e.pump();assert.equal(s.e.state.jobs.filter(j=>j.status==='canceled').length,1);
 const due=s.e.state.due['node-a'];assert.ok(due>=s.now()+60*60000&&due<s.now()+61*60000);
});
test('restart recovers task ID; uncertain dispatch and timeout never immediately dispatch again',async t=>{
 const s=setup(t),job=s.e.queue('node-a','probe',true);await s.e.pump();const n=s.calls.length;
 const e2=createEngine(s.env);await e2.pump();assert.equal(s.calls.filter(c=>c[0]==='admin:exec').length,1);assert.ok(s.calls.length>n);
 s.advance(241000);await e2.pump();assert.equal(e2.state.jobs[0].status,'failed');assert.equal(s.calls.filter(c=>c[0]==='admin:exec').length,1);
 const job2=e2.queue('node-b','probe',true);job2.status='dispatching';job2.started_at=s.now();s.storage.saveJobs(e2.state);const e3=createEngine(s.env);await e3.pump();assert.equal(s.calls.filter(c=>c[0]==='admin:exec').length,1);
});
test('changed targets do not reuse a previous address result and unexpected reports are rejected',async t=>{
 const s=setup(t),job=s.e.queue('node-a','probe',true);await s.e.pump();Object.assign(s.tasks.get(job.task_id),{exit_code:0,result:report(job)});await s.e.pump();
 let targets=JSON.parse(s.cfg.targets);targets[0].address='1.1.1.1';s.cfg.targets=JSON.stringify(targets);assert.equal(s.e.view('node-a').results.length,5);
 let raw=JSON.parse(report(job));raw.request_id='other';assert.throws(()=>s.e.validReport(JSON.stringify(raw),job));raw=JSON.parse(report(job));raw.results[0].target.address='8.8.8.8';assert.throws(()=>s.e.validReport(JSON.stringify(raw),job));
});
test('configuration rejects shell payloads, private IPs and unsupported address families',()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','100.64.0.1','1.1.1.1; touch /tmp/pwn','$(id)','example.com','fe80::1','::1','fd00::1'])assert.throws(()=>normalize({targets:[{id:'a',carrier:'CT',family:address.includes(':')?6:4,address}]},net));
 for(const interval_minutes of [0,1,1.5,-1,Infinity])assert.throws(()=>normalize({interval_minutes},net));
 assert.throws(()=>normalize({nodes:['../escape']},net));assert.equal(normalize({},net).interval_minutes,60);
});
test('atomic persistence survives recreation; history retention removes only old owned files',t=>{
 const s=setup(t);s.storage.saveLatest('node-a',{schema:1,results:[],last_success_at:'saved'});s.storage.append('node-a',{at:'2026-08-01T00:00:00Z'});s.storage.append('node-a',{at:'2026-10-21T00:00:00Z'});
 const other=path.join(s.dir,'history','leave-me');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'custom.txt'),'keep');s.storage.prune(s.now(),30);
 assert.equal(createStorage(fs,s.dir).latest('node-a').last_success_at,'saved');assert.equal(fs.existsSync(path.join(s.dir,'history','2026-08-01')),false);assert.ok(fs.existsSync(other));assert.throws(()=>s.storage.history('node-a','../../escape'));
 fs.writeFileSync(path.join(s.dir,'jobs.json'),'{');assert.throws(()=>createEngine(s.env));
});
test('installer pins HTTPS and SHA256; user fields cannot alter the command path',()=>{
 const a={version:'0.1.0'};for(const arch of ['amd64','arm64'])a[arch]={url:'https://github.com/yinpengfei/komari-plugin-return-route/releases/download/v0.1.1/return-route-collector-linux-'+arch,sha256:'a'.repeat(64)};
 const cmd=commands.install(a);assert.ok(cmd.includes('sha256sum -c'));assert.ok(cmd.includes('--proto-redir'));assert.ok(cmd.includes('symlink_refused'));a.amd64.url='https://evil.example/file';assert.throws(()=>commands.install(a));
});

test('legacy collector results retain conservative destination-only labels with human explanation',async t=>{
 const s=setup(t),job=s.e.queue('node-a','probe',true);await s.e.pump();const raw=JSON.parse(report(job));
 for(const row of raw.results)if(row.target.carrier==='CU')row.classification={code:'cu_destination_only',confidence:'inconclusive',label:'untrusted raw label',evidence:'only one AS4837 hop'};
 Object.assign(s.tasks.get(job.task_id),{exit_code:0,result:JSON.stringify(raw)});await s.e.pump();
 const cu=s.e.summary('node-a').results.find(r=>r.carrier==='CU');assert.equal(cu.label,'仅见联通目的网');assert.match(cu.explanation,/AS4837/);assert.equal(cu.confidence,'inconclusive');assert.equal(s.e.state.installed['node-a'].version,'0.1.0');
});
