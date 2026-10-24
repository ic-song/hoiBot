// Rhino/Java의 실제 UTF-8 파일·fsync·ThreadLocal에서 동일 소스와 합성 명령을 비교한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const h=require('./test_command_save_reuse'),jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-save-reuse-'));
const fileApi=`
var FileStream={read:function(p){io.reads++;if(p===readFailurePath){readFailurePath=null;throw Error('injected read failure');}return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));}};
`;
const extra=`
fixture();transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp++;saveJsonFile(p,memberPetPath);readFailurePath=memberPetPath;saveJsonFile(p,memberPetPath);readFailurePath=null;});check(JSON.parse(FileStream.read(memberPetPath)).synthetic.petexp===18&&targetWrites(memberPetPath)===2,'comparison read failure uses original full write');
print('PASS comparison read failure falls back to original verified write / load errors remain unchanged');
fixture();transaction(function(){saveJsonFile({synthetic:{restart:true}},memberPetPath);saveJsonFile({synthetic:{restart:true}},memberPetPath);});
var cx=org.mozilla.javascript.Context.getCurrentContext(),fresh=new org.mozilla.javascript.ImporterTopLevel(cx);
cx.evaluateString(fresh,boot,'fresh-restart',1,null);
cx.evaluateString(fresh,"transaction(function(){var p=loadJsonFile(memberPetPath);check(p.synthetic.restart===true,'persisted after restart');saveJsonFile(p,memberPetPath);check(targetWrites(memberPetPath)===1,'restart cannot reuse old command');});check(!dataTransactionLock.isLocked(),'restart lock released');",'fresh-check',1,null);
check(commandContextThreadLocal.get()===null&&getDataSaveTransaction()===null,'original scope context released');
print('PASS fresh Rhino scope sees durable first save and never inherits reuse state');
fixture();var errors=new java.util.concurrent.ConcurrentLinkedQueue(),ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
function worker(dev){return new java.lang.Thread(new java.lang.Runnable({run:function(){try{ready.countDown();start.await();dataTransactionLock.lock();try{transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.thread=dev?'DEV':'PROD';saveJsonFile(p,memberPetPath);saveJsonFile(p,memberPetPath);},dev);}finally{dataTransactionLock.unlock();}check(getDataSaveTransaction()===null&&commandContextThreadLocal.get()===null,'worker ThreadLocal released');}catch(e){errors.add(String(e));}}}));}
var a=worker(false),b=worker(true);a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'threads ready');start.countDown();a.join(10000);b.join(10000);check(!a.isAlive()&&!b.isAlive()&&errors.isEmpty(),'threads complete '+errors);
check(JSON.parse(FileStream.read(memberPetPath)).synthetic.thread==='PROD','prod thread');check(JSON.parse(FileStream.read(DEV_DATA_ROOT_PATH+'member_pet.json')).synthetic.thread==='DEV','dev thread');check(targetWrites(memberPetPath)===(optimized?1:2)&&targetWrites(DEV_DATA_ROOT_PATH+'member_pet.json')===(optimized?1:2),'per-thread reuse');check(!dataTransactionLock.isLocked(),'all data locks released');
for(var p in protectedJsonSaveLocks)check(!protectedJsonSaveLocks[p].isLocked(),'path lock released '+p);
print('PASS two Java threads / separate DEV-PROD files / locks and ThreadLocals released');
`;
const profile=`
function nanoMs(){return Number(java.lang.System.nanoTime())/1000000;}
function profilePackage(size){
  fixture();var pets=JSON.parse(FileStream.read(memberPetPath));for(var j=0;j<size;j++)pets['synthetic-'+j]={petexp:17,miniPetBag:[{name:'가상 미니펫🐹',battleExp:1}],note:new Array(40).join('가상')};
  writeRaw(memberPetPath,JSON.stringify(pets));replies=[];resetIo();var begin=nanoMs();packageCommand('/이랏싸이마쎄');var elapsed=nanoMs()-begin;
  var lastIo=JSON.parse(JSON.stringify(io)),member=JSON.parse(FileStream.read(filePath)),pet=JSON.parse(FileStream.read(memberPetPath));var result={member:member,petCount:pet.synthetic.miniPetBag.length,reply:replies,otherPet:pet['synthetic-'+(size-1)],originalBackup:JSON.parse(FileStream.read(getManagedJsonBackupPath(memberPetPath))).synthetic};
  return {members:size+1,petFileBytes:new java.lang.String(FileStream.read(memberPetPath)).getBytes('UTF-8').length,ms:elapsed,io:lastIo,petTargetWrites:lastIo.targets[memberPetPath],result:result};
}
`;
function java(file,script){
 fs.writeFileSync(file,script,'utf8');
 const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 if(r.status!==0)throw Error((r.stdout||'')+(r.stderr||'')+'\n'+file);return r.stdout.trim().split(/\r?\n/);
}
function run(source,optimized){
 const folder=path.join(dir,optimized?'after':'before').replace(/\\/g,'/')+'/';fs.mkdirSync(folder,{recursive:true});
 const boot=h.runtime(source,folder)+fileApi;
 const script=`var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(fs.readFileSync(path.join(h.root,'Info.js'),'utf8'))},'Info.js',1,null);var optimized=${optimized},boot=${JSON.stringify(boot)};\n${boot}\n${h.scenarios}\n${extra}`;
 const lines=java(path.join(dir,optimized?'after.js':'before.js'),script);console.log((optimized?'after':'before')+': '+lines.filter(x=>x.startsWith('PASS ')).length+' Rhino groups + complete Main/Info compilation');
}
run(h.before,false);run(h.main,true);
// 같은 JVM의 독립 스코프 두 개를 번갈아 측정해 기동·디스크·백그라운드 부하의 순서 편향을 줄인다.
const boots=[h.before,h.main].map((s,i)=>h.runtime(s,path.join(dir,'paired-'+i).replace(/\\/g,'/')+'/')+fileApi+profile);
const paired=`var cx=org.mozilla.javascript.Context.getCurrentContext(),boots=${JSON.stringify(boots)},scopes=[],reports=[[],[]];
for(var k=0;k<2;k++){scopes[k]=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(scopes[k],boots[k],'profile-boot-'+k,1,null);}
function sample(k,size){return JSON.parse(String(cx.evaluateString(scopes[k],'JSON.stringify(profilePackage('+size+'))','profile-sample',1,null)));}
function median(a){a.sort(function(x,y){return x-y;});return a[Math.floor(a.length/2)];}
for(var si=0;si<3;si++){var size=[100,1000,5000][si],samples=[[],[]],last=[];for(var i=0;i<35;i++){var order=i%2?[1,0]:[0,1];for(var oi=0;oi<2;oi++){var k=order[oi],r=sample(k,size);if(i>=5)samples[k].push(r.ms);last[k]=r;}if(JSON.stringify(last[0].result)!==JSON.stringify(last[1].result))throw Error('paired result mismatch');}for(var k=0;k<2;k++){var row=last[k];delete row.ms;row.medianMs=median(samples[k].slice(0));row.samples=samples[k];reports[k].push(row);}}
print('PAIRED '+JSON.stringify(reports));`;
const lines=java(path.join(dir,'paired.js'),paired),[before,after]=JSON.parse(lines.find(x=>x.startsWith('PAIRED ')).slice(7));
for(let i=0;i<before.length;i++){assert.deepStrictEqual(after[i].result,before[i].result);assert.equal(before[i].petTargetWrites,2);assert.equal(after[i].petTargetWrites,1);}
function compact(rows){return rows.map(({result,io,...row})=>({...row,io:{...io,targets:undefined}}));}
const report={baseline:h.baselineRef,environment:'Rhino 1.7.15 interpreter + actual Java UTF-8 files/fsync; synthetic inputs; local PC timing, not Android',method:'Two independent scopes in one JVM, alternating before/after order for each pair; setup and assertions outside timed command',samples:30,warmup:5,actualPackageRewardsUiAndBackupsEqual:true,before:compact(before),after:compact(after)};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({...report,before:report.before.map(({samples,...v})=>v),after:report.after.map(({samples,...v})=>v)},null,2));
