// Rhino/Java 전체 Info 응답 및 실제 공통 계산의 전후 결과와 비용을 비교한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const h=require('./test_castle_raid_common'),io=require('./test_command_data_loading'),ranking=require('./test_ranking_calculation');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-castle-raid-'));
const profile=`
function runProfile(size,summary){var f=fixture(size,summary),total=0;resetCounts();var start=Number(java.lang.System.nanoTime());for(var i=0;i<size;i++)total+=calculateTotalExp('u'+i,f.d,f.p,f.h,f.s,f.g);return JSON.stringify({ms:(Number(java.lang.System.nanoTime())-start)/1000000,total:total,counts:counts,state:JSON.stringify(f)});}
`;
function fullRuntime(source,label,size,tied){
 const base=path.join(dir,label).replace(/\\/g,'/')+'/',prod=base+'prod/',dev=base+'dev/';fs.mkdirSync(prod,{recursive:true});fs.mkdirSync(dev);
 for(const [p,t]of Object.entries(ranking.fullFixture(size,tied)))fs.writeFileSync((p.startsWith(io.dev)?dev:prod)+p.slice(p.lastIndexOf('/')+1),t,'utf8');
 const mapped=source.replaceAll(io.dev,dev).replaceAll(io.prod,prod);
 return `
var android={os:{Environment:{getExternalStorageDirectory:function(){return {getAbsolutePath:function(){return ${JSON.stringify(base)};}};}}}};
var trace={reads:[],writes:[],messages:[],errors:[],notices:[]};
var FileStream={read:function(p){p=String(p);trace.reads.push(p.slice(${prod.length}));return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(p)),'UTF-8'));},write:function(p,t){trace.writes.push(String(p));java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(String(t)).getBytes('UTF-8'));}};
var Api={replyRoom:function(r,t){if(String(t).indexOf('[ ERROR')===0)trace.errors.push(String(t));else trace.notices.push(String(t));}};Math.random=function(){return .5;};
${mapped}
function runOne(msg){trace={reads:[],writes:[],messages:[],errors:[],notices:[]};var start=Number(java.lang.System.nanoTime());try{response(msg.indexOf('dev/')===0?'팻 테스트방':'서버관리자',msg,'u',true,{reply:function(t){trace.messages.push(String(t));}},null,'synthetic');}catch(e){trace.errors.push(String(e));}return JSON.stringify({ms:(Number(java.lang.System.nanoTime())-start)/1000000,trace:trace});}
`;
}
let script=`var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.current.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.current.info)},'Info.js',1,null);print('PASS complete Main/Info compile');
function same(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label);}function check(v,label){if(!v)throw Error(label);}function median(a){a.sort(function(x,y){return x-y;});return a[Math.floor(a.length/2)];}
function fresh(boot){var s=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(s,boot,'boot',1,null);return s;}
function invoke(s,code){return JSON.parse(String(cx.evaluateString(s,code,'invoke',1,null)));}
var reports=[];
`;
for(const kind of ['main','info']){
 const instrumented=[h.before[kind],h.current[kind]].map((s,i)=>'var optimized='+!!i+';'+h.runtime(s,kind)+h.scenarios+profile);
 const timing=[h.before[kind],h.current[kind]].map(s=>h.runtime(s,kind,false)+profile);
 const baselineFunctions=['calculateCastleExp','calculateRaidExp','calculateTotalExp'].map(n=>h.block(h.before[kind],'function '+n+'(')).join('\n').replace(/\b(calculateCastleExp|calculateRaidExp|calculateTotalExp)\b/g,'$1Before');
 const threads=baselineFunctions+`
var errors=new java.util.concurrent.ConcurrentLinkedQueue(),ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
function worker(offset){return new java.lang.Thread(new java.lang.Runnable({run:function(){org.mozilla.javascript.Context.enter();try{ready.countDown();start.await();var f=fixture();f.p.u0.petexp+=offset;for(var j=0;j<50;j++){f.p.u0.petexp+=j;var original=clone(f),expected=calculateTotalExpBefore('u0',original.d,original.p,original.h,original.s,original.g),actual=calculateTotalExp('u0',f.d,f.p,f.h,f.s,f.g);check(actual===expected,'parallel total');same(f,original,'parallel normalization state');}}catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}}}));}
var wa=worker(1),wb=worker(999);wa.start();wb.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'threads ready');start.countDown();wa.join(15000);wb.join(15000);check(!wa.isAlive()&&!wb.isAlive()&&errors.isEmpty(),'private pair state '+errors);
`;
 script+=`var a=fresh(${JSON.stringify(instrumented[0])}),b=fresh(${JSON.stringify(instrumented[1])});same(invoke(a,'JSON.stringify(outcomes)'),invoke(b,'JSON.stringify(outcomes)'),'Rhino ${kind} values/state/errors');print('PASS Rhino ${kind}: 14 parity groups / both modes / normalization and exceptions');
var ta=fresh(${JSON.stringify(timing[0])}),tb=fresh(${JSON.stringify(timing[1])});
cx.evaluateString(tb,${JSON.stringify(threads)},'parallel-private-state',1,null);print('PASS Rhino ${kind}: two Java threads / changed inputs / no cross-user snapshot / normalization parity');
for(var summary=0;summary<2;summary++){var oldTimes=[],newTimes=[],ra,rb;for(var i=0;i<25;i++){if(i%2){rb=invoke(tb,'runProfile(100,'+summary+')');ra=invoke(ta,'runProfile(100,'+summary+')');}else{ra=invoke(ta,'runProfile(100,'+summary+')');rb=invoke(tb,'runProfile(100,'+summary+')');}same(ra.total,rb.total,'profile total');same(ra.state,rb.state,'profile normalized state');if(i>=5){oldTimes.push(ra.ms);newTimes.push(rb.ms);}}
var ca=invoke(a,'runProfile(100,'+summary+')').counts,cb=invoke(b,'runProfile(100,'+summary+')').counts;check(ca.item===200&&cb.item===100&&ca.home===200&&cb.home===100&&ca.mini===200&&cb.mini===100,'three common inputs 2 to 1');check(ca.village===cb.village&&ca.init===cb.init,'mode validations preserved');reports.push({scope:'${kind} aggregate helper / 100 synthetic users / real equipment, pendant, furniture; fixed unchanged mode bonuses',summary:!!summary,beforeMedianMs:median(oldTimes),afterMedianMs:median(newTimes),beforeCounts:ca,afterCounts:cb,beforeSamples:oldTimes,afterSamples:newTimes});}
`;
}
for(const tied of [false,true]){
 const boots=[h.before.info,h.current.info].map((s,i)=>fullRuntime(s,'full-'+tied+'-'+i,1000,tied));
 script+=`var a=fresh(${JSON.stringify(boots[0])}),b=fresh(${JSON.stringify(boots[1])});var commands=['/펫정보','/ㅎ','ㅁㅁㅁ','/종합순위','ㅈㅈㅈ','/서버순위','dev/펫정보','dev/종합순위'];for(var i=0;i<commands.length;i++){var ra=invoke(a,'runOne('+JSON.stringify(commands[i])+')'),rb=invoke(b,'runOne('+JSON.stringify(commands[i])+')');same(ra.trace,rb.trace,'full Info parity '+commands[i]);check(!rb.trace.errors.length,'full Info no errors');check(!rb.trace.writes.length,'read-only Info no saves');}print('PASS full Rhino Info 1000 users / tied=${tied} / 8 commands, messages+IO+DEV+no-save parity');
for(var cmdIndex=0;cmdIndex<2;cmdIndex++){var command=cmdIndex?'/종합순위':'/펫정보',oldTimes=[],newTimes=[];for(var i=0;i<14;i++){var code='runOne('+JSON.stringify(command)+')',ra,rb;if(i%2){rb=invoke(b,code);ra=invoke(a,code);}else{ra=invoke(a,code);rb=invoke(b,code);}same(ra.trace,rb.trace,'full timing parity');if(i>=3){oldTimes.push(ra.ms);newTimes.push(rb.ms);}}reports.push({scope:'full Info response / 1000 users / actual Java files and all real charm functions',command:command,tied:${tied},beforeMedianMs:median(oldTimes),afterMedianMs:median(newTimes),reads:rb.trace.reads.length,writes:rb.trace.writes.length,beforeSamples:oldTimes,afterSamples:newTimes});}
`;
}
script+=`print('BENCHMARK '+JSON.stringify(reports));`;
const file=path.join(dir,'verify.js');fs.writeFileSync(file,script,'utf8');
const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
if(r.status!==0)throw Error((r.stdout||'')+(r.stderr||'')+'\n'+file);
const lines=r.stdout.trim().split(/\r?\n/);lines.filter(s=>s.startsWith('PASS ')).forEach(s=>console.log(s));
const rows=JSON.parse(lines.find(s=>s.startsWith('BENCHMARK ')).slice(10)),report={baseline:h.baselineRef,environment:'local PC Rhino 1.7.15 interpreter; synthetic inputs; not Android runtime timing',method:'alternating before/after scopes in one JVM; uninstrumented timing, counters measured separately; helper 5 warmup+20 samples; full response 3 warmup+11 samples',identicalValuesStateErrorsMessagesAndIo:true,rows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({...report,rows:rows.map(({beforeSamples,afterSamples,...r})=>r)},null,2));
