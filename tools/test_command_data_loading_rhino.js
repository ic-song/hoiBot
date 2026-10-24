// 전체 Info 콜백을 실제 Rhino·Java 파일에서 실행해 결과와 읽기 비용을 비교한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const h=require('./test_command_data_loading'),jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-command-loading-')),base=dir.replace(/\\/g,'/')+'/',prod=base+'prod/',dev=base+'dev/';
fs.mkdirSync(prod);fs.mkdirSync(dev);
const disk=h.seed();
for(const [p,t]of Object.entries(disk)){
 const name=p.slice(p.lastIndexOf('/')+1),data=JSON.parse(t);
 if(name==='member.json')data.syntheticPadding='m'.repeat(1400000);
 if(name==='member_pet.json')data.u.syntheticPadding='p'.repeat(900000);
 if(name==='petSkillData.json')data.syntheticPadding='s'.repeat(130000);
 if(name==='member_title.json'||name==='pet_title.json')data.syntheticPadding='t'.repeat(500000);
 fs.writeFileSync((p.startsWith(h.dev)?dev:prod)+name,JSON.stringify(data),'utf8');
}
fs.writeFileSync(prod+'currencyLog.json',JSON.stringify({user:{u:{diamond:7}},syntheticPadding:'c'.repeat(500000)}),'utf8');
const map=text=>text.replaceAll(h.dev,dev).replaceAll(h.prod,prod);
const prelude=`
var android={os:{Environment:{getExternalStorageDirectory:function(){return {getAbsolutePath:function(){return ${JSON.stringify(base)};}};}}}};
var trace={reads:[],readBytes:0,writes:[],messages:[],errors:[],notices:[]};
var FileStream={read:function(p){p=String(p);var bytes=java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(p));trace.reads.push(p);trace.readBytes+=bytes.length;return String(new java.lang.String(bytes,'UTF-8'));},write:function(p,t){trace.writes.push(String(p));java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(String(t)).getBytes('UTF-8'));}};
var Api={replyRoom:function(r,t){if(String(t).indexOf('[ ERROR')===0)trace.errors.push(String(t));else trace.notices.push(String(t));}};
Math.random=function(){return 0.5;};
`;
const after=`
function runOne(msg,user,where,group){trace={reads:[],readBytes:0,writes:[],messages:[],errors:[],notices:[]};
 var start=Number(java.lang.System.nanoTime());try{response(where||'서버관리자',msg,user||'u',group!==false,{reply:function(t){trace.messages.push(String(t));}},null,'test');}catch(e){trace.errors.push(String(e));}
 var ms=(Number(java.lang.System.nanoTime())-start)/1000000;return JSON.stringify({ms:ms,trace:trace});}
`;
const stageRuntime=`
var currencyLogPath=${JSON.stringify(prod+'currencyLog.json')},filePath=${JSON.stringify(prod+'member.json')},protectedJsonSaveLocks={};
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock();
function resolveActiveDataPath(p){return p;}function getAutoDailyBatchContext(){return null;}function isProtectedManagedJsonPath(){return true;}
function restoreManagedJsonFromBackup(){return null;}function formatDateTime(){return 'synthetic';}function debuggerLog(){}function addResponseTiming(){}
${['ensureCurrencyLogData','parseJsonContent','parseManagedJsonContent','getProtectedJsonSaveLock','loadJsonFile'].map(n=>h.block(h.main,'function '+n+'(')).join('\n')}
function mainStageBefore(msg){var commonStepStart=0;${h.currencyStage(h.oldMain)}}
function mainStageAfter(msg){var commonStepStart=0;${h.currencyStage(h.main)}}
function runStage(after,msg){trace={reads:[],readBytes:0,writes:[],messages:[],errors:[],notices:[]};var start=Number(java.lang.System.nanoTime());if(after)mainStageAfter(msg);else mainStageBefore(msg);return {ms:(Number(java.lang.System.nanoTime())-start)/1000000,trace:trace};}
`;
const script=`
var cx=org.mozilla.javascript.Context.getCurrentContext();function check(v,s){if(!v)throw Error(s);}function equal(a,b,s){check(JSON.stringify(a)===JSON.stringify(b),s);}
cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.info)},'Info.js',1,null);print('PASS Rhino complete Main/Info compilation');
var before=cx.initStandardObjects(),after=cx.initStandardObjects();
cx.evaluateString(before,${JSON.stringify(prelude+map(h.oldInfo)+after)},'before-info',1,null);
cx.evaluateString(after,${JSON.stringify(prelude+map(h.info)+after)},'after-info',1,null);
function run(scope,msg,user,room,group){return JSON.parse(String(cx.evaluateString(scope,'runOne('+JSON.stringify(msg)+','+JSON.stringify(user||'u')+','+JSON.stringify(room||'서버관리자')+','+JSON.stringify(group!==false)+')','invoke',1,null)));}
var commands=${JSON.stringify(h.commands)},optional=${JSON.stringify(h.optional)};
for(var i=0;i<commands.length;i++){
 var row=commands[i],a=run(before,row[0],row[2]),b=run(after,row[0],row[2]);equal(b.trace.messages,a.trace.messages,'same output '+row[0]);equal(b.trace.notices,a.trace.notices,'same notice '+row[0]);check(!a.trace.errors.length&&!b.trace.errors.length,'no error '+row[0]);check(!a.trace.writes.length&&!b.trace.writes.length,'no write '+row[0]);
 var files=[];for(var r=0;r<b.trace.reads.length;r++){var n=String(b.trace.reads[r]).split('/').pop();if(optional.indexOf(n)!==-1)files.push(n);}equal(files.sort(),row[1].slice().sort(),'dependencies '+row[0]);
}
print('PASS Rhino actual Java files: all 43 Info inputs identical / required files once');
for(var i=0;i<commands.length;i++){var row=commands[i],input='dev/'+row[0].replace(/^\\//,''),a=run(before,input,row[2],'팻 테스트방'),b=run(after,input,row[2],'팻 테스트방');equal(b.trace.messages,a.trace.messages,'DEV output '+row[0]);check(!a.trace.errors.length&&!b.trace.errors.length,'DEV no error');check(!b.trace.writes.length,'DEV read only');for(var r=0;r<b.trace.reads.length;r++){var p=String(b.trace.reads[r]),n=p.split('/').pop();if(optional.indexOf(n)!==-1)check(p.indexOf(${JSON.stringify(dev)})===0,'DEV path');}}
print('PASS Rhino actual Java files: all 43 DEV inputs / production no writes');
function median(v){v.sort(function(a,b){return a-b;});return v[Math.floor(v.length/2)];}
var reports=[];for(var c=0;c<5;c++){var command=['/포인트','/레벨','/타이틀목록','/펫정보','/종합순위'][c],oldSamples=[],newSamples=[],a,b;
 for(var i=0;i<36;i++){if(i%2===0){a=run(before,command);b=run(after,command);}else{b=run(after,command);a=run(before,command);}equal(a.trace.messages,b.trace.messages,'benchmark output');if(i>=5){oldSamples.push(a.ms);newSamples.push(b.ms);}}
 reports.push({scope:'Info full response',command:command,beforeMedianMs:median(oldSamples),afterMedianMs:median(newSamples),beforeReads:a.trace.reads.length,afterReads:b.trace.reads.length,beforeReadBytes:a.trace.readBytes,afterReadBytes:b.trace.readBytes});
}
${prelude}
${stageRuntime}
for(var c=0;c<2;c++){var command=['/포인트','/다이아순위'][c],oldSamples=[],newSamples=[],a,b;for(var i=0;i<36;i++){if(i%2===0){a=runStage(false,command);b=runStage(true,command);}else{b=runStage(true,command);a=runStage(false,command);}if(i>=5){oldSamples.push(a.ms);newSamples.push(b.ms);}}
reports.push({scope:'Main currency load stage only',command:command,beforeMedianMs:median(oldSamples),afterMedianMs:median(newSamples),beforeReads:a.trace.reads.length,afterReads:b.trace.reads.length,beforeReadBytes:a.trace.readBytes,afterReadBytes:b.trace.readBytes});}
var currencyOriginal=FileStream.read(currencyLogPath);FileStream.write(currencyLogPath,'{bad json');var skipped=runStage(true,'/포인트');check(skipped.trace.reads.length===0,'unused malformed log unread');var failed=false;try{runStage(true,'/다이아순위');}catch(e){failed=true;}check(failed,'required malformed log fails');check(!dataTransactionLock.isLocked(),'failed read unlock');check(FileStream.read(currencyLogPath)==='{bad json','no default overwrite');FileStream.write(currencyLogPath,currencyOriginal);
new java.io.File(currencyLogPath).delete();check(runStage(true,'/포인트').trace.reads.length===0,'unused missing log unread');FileStream.write(currencyLogPath,currencyOriginal);
print('PASS Rhino Main actual loader: unused missing/corrupt files unread / required parse error visible / lock released');
print('BENCHMARK '+JSON.stringify(reports));print('PASS Rhino command-dependent loading / identical outputs / measured actual read bytes');
`;
const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');
const result=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,'Rhino failed '+file);
const rows=JSON.parse(result.stdout.split(/\r?\n/).find(x=>x.startsWith('BENCHMARK ')).slice(10));
assert.deepStrictEqual(rows.filter(r=>r.scope==='Info full response').map(r=>[r.beforeReads,r.afterReads]),[[7,3],[6,2],[6,3],[10,9],[7,5]]);
const report={baseline:h.baselineRef,environment:'local Rhino 1.7.15 interpreter + real Java UTF-8 reads, synthetic padded files; Info full response excludes external transport/Main callback, not Android timing',warmup:5,samples:31,alternatingOrder:true,rows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
