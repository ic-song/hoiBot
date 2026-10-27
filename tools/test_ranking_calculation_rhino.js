// 실제 Rhino 정렬·전체 Info 응답을 기준 버전과 대조하고 계산/정렬 비용을 측정한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const h=require('./test_ranking_calculation'),io=require('./test_command_data_loading'),jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-ranking-calc-'));
function runtime(size,tied,label,text){const base=path.join(dir,label).replace(/\\/g,'/')+'/',prod=base+'prod/',dev=base+'dev/';fs.mkdirSync(prod,{recursive:true});fs.mkdirSync(dev);
 for(const [p,t]of Object.entries(h.fullFixture(size,tied)))fs.writeFileSync((p.startsWith(io.dev)?dev:prod)+p.slice(p.lastIndexOf('/')+1),t,'utf8');
 const mapped=text.replaceAll(io.dev,dev).replaceAll(io.prod,prod);
 return `
var android={os:{Environment:{getExternalStorageDirectory:function(){return {getAbsolutePath:function(){return ${JSON.stringify(base)};}};}}}};
var trace={reads:[],writes:[],messages:[],errors:[],notices:[]};
var FileStream={read:function(p){p=String(p);trace.reads.push(p.slice(${prod.length}));return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(p)),'UTF-8'));},write:function(p,t){trace.writes.push(String(p));java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(String(t)).getBytes('UTF-8'));}};
var Api={replyRoom:function(r,t){if(String(t).indexOf('[ ERROR')===0)trace.errors.push(String(t));else trace.notices.push(String(t));}};Math.random=function(){return 0.5;};
${mapped}
${h.metrics}
function runOne(msg,where){trace={reads:[],writes:[],messages:[],errors:[],notices:[]};for(var k in rankingMetrics)rankingMetrics[k]=0;
var start=Number(java.lang.System.nanoTime());try{response(where||'서버관리자',msg,'u',true,{reply:function(t){trace.messages.push(String(t));}},null,'test');}catch(e){trace.errors.push(String(e));}
return JSON.stringify({ms:(Number(java.lang.System.nanoTime())-start)/1000000,trace:trace,metrics:rankingMetrics});}
`;}
let script=`
var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.info)},'Info.js',1,null);print('PASS Rhino complete Main/Info compilation');
${h.core}
${h.scenarios}
function nanoMs(){return Number(java.lang.System.nanoTime())/1000000;}
${h.benchmark}
function invoke(scope,msg,room){return JSON.parse(String(cx.evaluateString(scope,'runOne('+JSON.stringify(msg)+','+JSON.stringify(room||'서버관리자')+')','invoke',1,null)));}
var fullReports=[];
`;
for(const tied of [false,true]){
 const oldRuntime=runtime(1000,tied,'before-'+tied,h.oldInfo),newRuntime=runtime(1000,tied,'after-'+tied,h.info);
 script+=`
var oldScope=cx.initStandardObjects(),newScope=cx.initStandardObjects();cx.evaluateString(oldScope,${JSON.stringify(oldRuntime)},'old-full-info',1,null);cx.evaluateString(newScope,${JSON.stringify(newRuntime)},'new-full-info',1,null);
var commands=['/펫정보','/ㅎ','ㅁㅁㅁ','/종합순위','ㅈㅈㅈ','/서버순위','dev/펫정보','dev/ㅎ','dev/종합순위','dev/서버순위'];
for(var i=0;i<commands.length;i++){var msg=commands[i],where=msg.indexOf('dev/')===0?'팻 테스트방':'서버관리자',a=invoke(oldScope,msg,where),b=invoke(newScope,msg,where);
equal(b.trace.messages,a.trace.messages,'full output '+msg);equal(b.trace.notices,a.trace.notices,'notice '+msg);check(!a.trace.errors.length&&!b.trace.errors.length,'no errors '+msg);check(!a.trace.writes.length&&!b.trace.writes.length,'no writes '+msg);equal(b.trace.reads,a.trace.reads,'same IO '+msg);
if(msg==='/펫정보'||msg==='/ㅎ'||msg==='ㅁㅁㅁ'||msg==='dev/펫정보'||msg==='dev/ㅎ'){check(a.metrics.ownCastle===3&&a.metrics.ownRaid===3,'old own stats 3');check(b.metrics.ownCastle===1&&b.metrics.ownRaid===1&&b.metrics.ownUpgrade===1,'new own stats 1');check(b.metrics.rankSorts===1,'personal sort preserved');}}
print('PASS Rhino full Info 1000 members: 10 inputs / output+IO+no-save parity / tied=${tied}');
var oldTimes=[],newTimes=[],a,b;for(var i=0;i<14;i++){if(i%2===0){a=invoke(oldScope,'/펫정보');b=invoke(newScope,'/펫정보');}else{b=invoke(newScope,'/펫정보');a=invoke(oldScope,'/펫정보');}equal(b.trace.messages,a.trace.messages,'full benchmark output');if(i>=3){oldTimes.push(a.ms);newTimes.push(b.ms);}}
fullReports.push({scope:'Info full response with real charm functions + Java files',members:1000,tied:${tied},beforeMedianMs:median(oldTimes),afterMedianMs:median(newTimes),beforeMetrics:a.metrics,afterMetrics:b.metrics,beforeReads:a.trace.reads.length,afterReads:b.trace.reads.length});
`;
}
script+=`print('FULL_BENCHMARK '+JSON.stringify(fullReports));print('PASS Rhino ranking parity, unstable-tie preservation, 19/20/21 entry limits and per-response reuse');`;
const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');
const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0,'Rhino failed '+file);
const rows=JSON.parse(r.stdout.split(/\r?\n/).find(x=>x.startsWith('BENCHMARK ')).slice(10)),fullRows=JSON.parse(r.stdout.split(/\r?\n/).find(x=>x.startsWith('FULL_BENCHMARK ')).slice(15));
for(const row of rows){assert.equal(row.beforeSorts,1);assert.equal(row.afterSorts,row.scope.startsWith('Info')?1:0);}
const report={baseline:h.baselineRef,environment:'local Rhino 1.7.15 interpreter; synthetic helper scores and separate full Info with real charm functions/Java files; not Android timing',helperWarmup:5,helperSamples:31,fullWarmup:3,fullSamples:11,alternatingOrder:true,rows,fullRows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
