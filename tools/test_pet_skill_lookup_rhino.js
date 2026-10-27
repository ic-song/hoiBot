// 실제 Rhino 정렬·정의 참조·Java 동시 조회와 교대 측정으로 전후 결과를 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),h=require('./test_pet_skill_lookup');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-skill-lookup-'));
const profile=`
function nanoMs(){return Number(java.lang.System.nanoTime())/1000000;}
function profile(mode,size,cold){var s=fixture(size,false),queries=[],value;
 for(var j=0;j<PET_SKILL_LIST.length;j++)queries.push(PET_SKILL_LIST[j].name);
 if(!cold){for(var j=0;j<queries.length;j++)getPetSkillData(queries[j]);getPetSkillBagList(s,'test');}
 else getPetSkillData.definitionLookup=null;
 resetMetrics();var start=nanoMs();
 if(mode==='lookup'){for(var j=0;j<500;j++)value=getPetSkillData(queries[j%queries.length]);value=value.name;}
 else if(mode==='bag')value=getPetSkillBagList(s,'test');
 else value=formatSkillBagMessage({}, {},s,{},'test');
 var ms=nanoMs()-start;return {ms:ms,metrics:metrics,value:value,state:s};
}
`;
const extra=`
function print(s){java.lang.System.out.println(String(s));}
resetDefinitions();var linear=${h.block(h.before,'function getPetSkillData(').replace('function getPetSkillData(','function linearLookup(')};
var expected=[];for(var i=0;i<PET_SKILL_LIST.length;i++)expected.push(linear(PET_SKILL_LIST[i].name));
getPetSkillData.definitionLookup=null;var errors=new java.util.concurrent.ConcurrentLinkedQueue(),ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
function worker(offset){return new java.lang.Thread(new java.lang.Runnable({run:function(){try{ready.countDown();start.await();for(var j=0;j<500;j++){var index=(j+offset)%PET_SKILL_LIST.length;check(getPetSkillData(PET_SKILL_LIST[index].name)===expected[index],'concurrent reference '+index);}}catch(e){errors.add(String(e));}}}));}
var a=worker(0),b=worker(31);a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'workers ready');start.countDown();a.join(10000);b.join(10000);check(!a.isAlive()&&!b.isAlive()&&errors.isEmpty(),'parallel lookup '+errors);
print('PASS two Java threads / 1000 cold-to-warm lookups / original definition references');
var fresh=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(fresh,boot,'fresh-boot',1,null);cx.evaluateString(fresh,"check(getPetSkillData.definitionLookup===undefined,'new script cache starts empty');check(getPetSkillData('장미칼')===PET_SKILL_LIST.filter(function(s){return s.name==='장미칼';})[0],'fresh definition reference');",'fresh-check',1,null);
print('PASS new Rhino scope / no prior definition cache / no personal data retained');
`;
const boots=[h.before,h.main].map(s=>h.runtime(s)+profile);
const timingBoots=[h.before,h.main].map(s=>h.runtime(s,false)+profile);
const script=`
var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(fs.readFileSync(path.join(h.root,'Info.js'),'utf8'))},'Info.js',1,null);
var boots=${JSON.stringify(boots)},scopes=[],outcomes=[];
for(var k=0;k<2;k++){scopes[k]=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(scopes[k],boots[k]+${JSON.stringify(h.scenarios)},'source-'+k,1,null);outcomes[k]=String(cx.evaluateString(scopes[k],'JSON.stringify(outcomes)','outcomes',1,null));}
if(outcomes[0]!==outcomes[1])throw Error('Rhino exception, alias, tie ordering, bag number or UI parity mismatch');print('PASS Rhino 15 before/after definition/exception/bag/UI groups and complete Main/Info compilation');
var boot=boots[1];cx.evaluateString(scopes[1],'var cx=org.mozilla.javascript.Context.getCurrentContext(),boot='+JSON.stringify(boot)+';'+${JSON.stringify(extra)},'threads-restart',1,null);
var timingBoots=${JSON.stringify(timingBoots)},timingScopes=[];for(var k=0;k<2;k++){timingScopes[k]=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(timingScopes[k],timingBoots[k],'timing-boot-'+k,1,null);}
function sample(scope,mode,size,cold){return JSON.parse(String(cx.evaluateString(scope,'JSON.stringify(profile('+JSON.stringify(mode)+','+size+','+cold+'))','profile',1,null)));}
function median(a){a.sort(function(x,y){return x-y;});return a[Math.floor(a.length/2)];}
var workloads=[{mode:'lookup',size:0,cold:false},{mode:'bag',size:10,cold:false},{mode:'bag',size:50,cold:false},{mode:'bag',size:100,cold:false},{mode:'bag',size:100,cold:true},{mode:'ui',size:100,cold:false},{mode:'ui',size:100,cold:true}],reports=[];
for(var w=0;w<workloads.length;w++){var task=workloads[w],times=[[],[]],last=[];
 for(var i=0;i<35;i++){var order=i%2?[1,0]:[0,1];for(var o=0;o<2;o++){var k=order[o],r=sample(timingScopes[k],task.mode,task.size,task.cold);if(i>=5)times[k].push(r.ms);last[k]=r;}
  if(JSON.stringify(last[0].value)!==JSON.stringify(last[1].value)||JSON.stringify(last[0].state)!==JSON.stringify(last[1].state))throw Error('benchmark parity '+w);
 }
 var beforeMetrics=sample(scopes[0],task.mode,task.size,task.cold).metrics,afterMetrics=sample(scopes[1],task.mode,task.size,task.cold).metrics;
 reports.push({mode:task.mode,bagNames:task.size,cold:task.cold,before:{medianMs:median(times[0].slice(0)),metrics:beforeMetrics,samples:times[0]},after:{medianMs:median(times[1].slice(0)),metrics:afterMetrics,samples:times[1]}});
}
print('BENCHMARK '+JSON.stringify(reports));
`;
const file=path.join(dir,'verify.js');fs.writeFileSync(file,script,'utf8');
const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
if(r.status!==0)throw Error((r.stdout||'')+(r.stderr||'')+'\n'+file);
const lines=r.stdout.trim().split(/\r?\n/);lines.filter(s=>s.startsWith('PASS ')).forEach(s=>console.log(s));
const rows=JSON.parse(lines.find(s=>s.startsWith('BENCHMARK ')).slice(10));
const report={baseline:h.baselineRef,environment:'local PC, Rhino 1.7.15 interpreter, actual definitions and native sort; not Android runtime timing',method:'two independent scopes, alternating before/after in one JVM; 5 warmup + 30 samples; setup outside timer; lookup row is 500 calls; timing uses original uninstrumented helpers, counts measured separately',identicalResultsAndUi:true,definitions:106,rows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({...report,rows:rows.map(({before,after,...v})=>({...v,before:{...before,samples:undefined},after:{...after,samples:undefined}}))},null,2));
