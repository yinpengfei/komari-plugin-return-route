'use strict';
const path = require('path');
function createStorage(fs,dir) {
  for (const name of ['', 'latest','history']) fs.mkdirSync(path.join(dir,name),{recursive:true,mode:448});
  function read(file,fallback) {
    const p=path.join(dir,file); if (!fs.existsSync(p)) return fallback;
    // A corrupt committed file must stop the scheduler rather than erase state.
    return JSON.parse(fs.readFileSync(p,'utf8'));
  }
  function write(file,value) {
    const p=path.join(dir,file), tmp=p+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(value),{encoding:'utf8',mode:384});
    fs.renameSync(tmp,p);
  }
  function node(uuid) {if(!/^[a-zA-Z0-9_-]{1,100}$/.test(uuid))throw Error('invalid node');return uuid;}
  return {
    jobs:()=>read('jobs.json',{schema:1,jobs:[],due:{},installed:{}}),
    saveJobs:s=>write('jobs.json',s),
    latest:uuid=>read('latest/'+node(uuid)+'.json',{schema:1,results:[],last_attempt:null}),
    saveLatest:(uuid,result)=>write('latest/'+node(uuid)+'.json',result),
    append(uuid,event) {
      const day=event.at.slice(0,10), folder=path.join(dir,'history',day);
      fs.mkdirSync(folder,{recursive:true,mode:448});
      fs.appendFileSync(path.join(folder,node(uuid)+'.jsonl'),JSON.stringify(event)+'\n',{encoding:'utf8',mode:384});
    },
    history(uuid,day) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('invalid history day');
      const p=path.join(dir,'history',day,node(uuid)+'.jsonl');
      if(!fs.existsSync(p))return [];
      return fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).slice(-100).map(line=>JSON.parse(line));
    },
    prune(now,days) {
      const cutoff=new Date(now-days*86400000).toISOString().slice(0,10);
      for(const day of fs.readdirSync(path.join(dir,'history'))) {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>=cutoff)continue;
        const folder=path.join(dir,'history',day);
        // Only our date directories and validated node JSONL files are removed.
        if(!fs.lstatSync(folder).isDirectory())continue;
        for(const file of fs.readdirSync(folder))if(/^[a-zA-Z0-9_-]{1,100}\.jsonl$/.test(file))fs.unlinkSync(path.join(folder,file));
        if(fs.readdirSync(folder).length===0)fs.rmdirSync(folder);
      }
    }
  };
}
module.exports={createStorage};
