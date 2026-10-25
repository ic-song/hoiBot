// 동일 JVM의 독립 전후 스코프에서 Rhino 계산·파일 IO·난수 결과와 시간을 비교한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const h=require('./test_calculation_catalog_performance'),io=require('./test_command_data_loading'),ranking=require('./test_ranking_calculation');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-calculation-catalog-'));
const previous=fs.readFileSync(path.join(__dirname,'test_castle_raid_common_rhino.js'),'utf8');
const fullRuntime=new Function('fs','path','dir','io','ranking',h.block(previous,'function fullRuntime(')+';return fullRuntime;')(fs,path,dir,io,ranking);
let script=`var cx=org.mozilla.javascript.Context.getCurrentContext();
cx.compileString(${JSON.stringify(h.after.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.after.info)},'Info.js',1,null);print('PASS full Main/Info Rhino compile');
function fresh(code){var s=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(s,code,'boot',1,null);return s;}
function invoke(s,code){return JSON.parse(String(cx.evaluateString(s,'JSON.stringify('+code+')','case',1,null)));}
function same(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label);}
function median(a){a.sort(function(x,y){return x-y;});return a[Math.floor(a.length/2)];}
var reports=[];
function timing(a,b,code,label){var oldTimes=[],newTimes=[],ra,rb;for(var i=0;i<12;i++){var start;if(i%2){start=Number(java.lang.System.nanoTime());rb=invoke(b,code);var bt=(Number(java.lang.System.nanoTime())-start)/1e6;start=Number(java.lang.System.nanoTime());ra=invoke(a,code);var at=(Number(java.lang.System.nanoTime())-start)/1e6;}else{start=Number(java.lang.System.nanoTime());ra=invoke(a,code);var at=(Number(java.lang.System.nanoTime())-start)/1e6;start=Number(java.lang.System.nanoTime());rb=invoke(b,code);var bt=(Number(java.lang.System.nanoTime())-start)/1e6;}same(ra,rb,label+' result');if(i>=3){oldTimes.push(at);newTimes.push(bt);}}reports.push({scope:label,beforeMedianMs:median(oldTimes),afterMedianMs:median(newTimes),beforeSamples:oldTimes,afterSamples:newTimes});}
`;
for(const kind of ['main','info']){
 const boots=[h.before[kind],h.after[kind]].map(s=>'var optimized=true;'+h.runtime(s,kind)+h.scenarios+h.commonScenarios());
 script+=`var a=fresh(${JSON.stringify(boots[0])}),b=fresh(${JSON.stringify(boots[1])});same(invoke(a,'results'),invoke(b,'results'),'${kind} skills');same(invoke(a,'outcomes'),invoke(b,'outcomes'),'${kind} errors/state');print('PASS ${kind} actual skill + common 27 parity scenarios');\n`;
 const times=[h.before[kind],h.after[kind]].map(s=>h.runtime(s,kind,false)+`\nvar profileFixture=fixture(100,true);function profile(){var f=profileFixture,total=0;for(var i=0;i<100;i++)total+=calculateTotalExp('u'+i,f.d,f.p,f.h,f.s,f.g);return total;}`);
 script+=`var a=fresh(${JSON.stringify(times[0])}),b=fresh(${JSON.stringify(times[1])});timing(a,b,'profile()','${kind} actual aggregate / 100 synthetic users');\n`;
}
const dollBoots=[h.before.main,h.after.main].map(s=>h.dollRuntime(s));
script+=`var a=fresh(${JSON.stringify(dollBoots[0])}),b=fresh(${JSON.stringify(dollBoots[1])});
for(var g=0;g<10;g++)for(var n=0;n<2;n++)for(var seed=0;seed<3;seed++){var code='dollOutcome('+g+','+(n?100:1)+','+[0,17,2147483647][seed]+',false)';same(invoke(a,code),invoke(b,code),'box');}
for(var seed=0;seed<150;seed++){var code='dollOutcome(0,1,'+(seed*7919)+',true)';same(invoke(a,code),invoke(b,code),'draw');}print('PASS Rhino 210 seeded draws/boxes, identical RNG calls + state + awards');
cx.evaluateString(a,"function lookupProfile(){var total=0;for(var i=0;i<300;i++)total+=catalog.dolls.filter(function(d){return d.grade===i%9;}).length;return total;}",'old-profile',1,null);
cx.evaluateString(b,"function lookupProfile(){var total=0;for(var i=0;i<300;i++)total+=getDollGradeRows(catalog,i%9).length;return total;}",'new-profile',1,null);
timing(a,b,'lookupProfile()','static catalog grade lookup / 300 calls over 1000 dolls');
`;
script+=`cx.evaluateString(b,${JSON.stringify(`
var errors=new java.util.concurrent.ConcurrentLinkedQueue(),ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
function gradeWorker(reverse){return new java.lang.Thread(new java.lang.Runnable({run:function(){org.mozilla.javascript.Context.enter();try{ready.countDown();start.await();for(var n=0;n<100;n++){var g=n%9,rows=getDollGradeRows(catalog,g),expected=GLOBAL_CONFIG.doll.counts[g];if(rows.length!==expected)throw Error('grade size');if(reverse)rows.reverse();rows.pop();if(getDollGradeRows(catalog,g).length!==expected)throw Error('shared array');}}catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}}}));}
dollCatalogGradeCache=null;var t1=gradeWorker(true),t2=gradeWorker(false);t1.start();t2.start();if(!ready.await(5,java.util.concurrent.TimeUnit.SECONDS))throw Error('ready');start.countDown();t1.join(15000);t2.join(15000);if(t1.isAlive()||t2.isAlive()||!errors.isEmpty())throw Error('concurrent cache '+errors);
`)},'grade-threads',1,null);print('PASS two Java threads / cold cache / caller sorting and deletion cannot change cached order');\n`;
for(const tied of [false,true]){
 const boots=[h.before.info,h.after.info].map((s,i)=>fullRuntime(s,'full-'+tied+'-'+i,1000,tied));
 script+=`var a=fresh(${JSON.stringify(boots[0])}),b=fresh(${JSON.stringify(boots[1])});var commands=['/펫정보','/ㅎ','ㅁㅁㅁ','/종합순위','ㅈㅈㅈ','/서버순위','dev/펫정보','dev/종합순위'];for(var i=0;i<commands.length;i++){var code='JSON.parse(runOne('+JSON.stringify(commands[i])+'))',ra=invoke(a,code),rb=invoke(b,code);same(ra.trace,rb.trace,'full Info '+commands[i]);if(rb.trace.errors.length||rb.trace.writes.length)throw Error('Info error/write');}print('PASS real Java files / 1000 users / tied=${tied} / 8 callbacks, UI+IO+DEV');
for(var j=0;j<2;j++){var cmd=j?'/종합순위':'/펫정보';timing(a,b,'JSON.parse(runOne('+JSON.stringify(cmd)+')).trace','full Info / 1000 users / '+cmd+' / tied=${tied}');}
`;
}
// 새 전역 스코프는 개인 계산/등급 캐시를 계정 상태와 섞지 않는다.
script+=`var restarted=fresh(${JSON.stringify(dollBoots[1])});same(invoke(restarted,'dollOutcome(0,100,17,false)'),invoke(b=fresh(${JSON.stringify(dollBoots[0])}),'dollOutcome(0,100,17,false)'),'fresh scope');print('PASS fresh Rhino scope keeps RNG and reward state');print('REPORT '+JSON.stringify(reports));`;
const file=path.join(dir,'verify.js');fs.writeFileSync(file,script,'utf8');
const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:300000,maxBuffer:8e6});
if(r.status!==0)throw Error((r.stdout||'')+(r.stderr||'')+'\n'+file);
const lines=r.stdout.trim().split(/\r?\n/);lines.filter(s=>s.startsWith('PASS ')).forEach(s=>console.log(s));
const rows=JSON.parse(lines.find(s=>s.startsWith('REPORT ')).slice(7));
const report={baseline:h.baselineRef,environment:'development PC Rhino 1.7.15 interpreter, synthetic accounts and real temporary Java files; not Android runtime timing',method:'same JVM, independent scopes, alternating before/after, 3 warmups + 9 samples, uninstrumented timing',rows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({...report,rows:rows.map(({beforeSamples,afterSamples,...row})=>row)},null,2));console.log('Evidence '+dir);
