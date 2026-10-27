// 개인 당근·온도 순위를 직전 운영 소스와 Node/Rhino에서 대조한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),os=require('os');
const io=require('./test_command_data_loading'),root=io.root,baseline='599375e9bd40dba6e4a4b69ec3740b599f98417f';
const info=fs.readFileSync(path.join(root,'Info.js'),'utf8').replace(/\r\n/g,'\n');
const oldInfo=cp.execFileSync('git',['show',baseline+':Info.js'],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024}).replace(/\r\n/g,'\n');
const core=['getCarrotRank','getThermoRank'].map(n=>io.block(oldInfo,'function '+n+'(').replace('function '+n+'(','function old'+n+'(')).join('\n')+'\n'+
 ['getCarrotRank','getThermoRank','getPositiveMemberMetricRank'].map(n=>io.block(info,'function '+n+'(')).join('\n');
const counters=`var sorts=0,nativeSort=Array.prototype.sort;Array.prototype.sort=function(fn){sorts++;return nativeSort.call(this,fn);};`;
const scenarios=String.raw`
var groups=0;
function check(v,m){if(!v)throw Error(m);}
function test(n,f){f();groups++;print('PASS metric '+groups+' '+n);}
function pair(d,u,expectSort){
 var fields=['Carrot','Thermo'];for(var k=0;k<fields.length;k++){
  var oldFn=fields[k]==='Carrot'?oldgetCarrotRank:oldgetThermoRank,fn=fields[k]==='Carrot'?getCarrotRank:getThermoRank;
  sorts=0;var old=oldFn(u,d);check(sorts===1,'baseline sort');sorts=0;var current=fn(u,d);check(current===old,'rank '+String(u)+' '+fields[k]+' '+old+' / '+current);
  if(expectSort!==undefined)check(sorts===expectSort,'sorts '+sorts+' expected '+expectSort);
 }
}
function fixture(size,tied){var d={member:{}};for(var i=0;i<size;i++){var value=tied?i%7+1:(i*7919)%size+0.125;d.member['user'+i]={carrotGiven:value,thermoPoints:value};}return d;}
test('100/1000/5000 members, unique/tied, first/middle/last preserve exact ranks with no sort',function(){
 for(var s=0;s<3;s++)for(var t=0;t<2;t++){var n=[100,1000,5000][s],d=fixture(n,!!t);pair(d,'user0',0);pair(d,'user'+Math.floor(n/2),0);pair(d,'user'+(n-1),0);}
});
test('Korean/English/numeric/emoji/space names and engine-equivalent Unicode preserve tie order',function(){
 var names=['가','나','가나','A','a','1','01','😀',' 가','가 ','é','e\u0301','각','\u1100\u1161\u11a8'],d={member:{}};
 for(var i=0;i<names.length;i++)d.member[names[i]]={carrotGiven:3,thermoPoints:3};
 for(var j=0;j<names.length;j++){
  var equivalent=false;for(var k=0;k<names.length;k++)if(k!==j&&names[k].localeCompare(names[j],'ko')===0)equivalent=true;
  pair(d,names[j],equivalent?1:0);
 }
});
test('numeric strings, booleans, Infinity and positive coercible objects use original sort',function(){
 var values=['2','10','1.5',true,Infinity,{valueOf:function(){return 4;}},[3]];
 for(var i=0;i<values.length;i++){var d={member:{u:{carrotGiven:2,thermoPoints:2},v:{carrotGiven:values[i],thermoPoints:values[i]}}};pair(d,'u',1);pair(d,'v',1);}
 var mixed={member:{a:{carrotGiven:'2',thermoPoints:'2'},b:{carrotGiven:2,thermoPoints:2},c:{carrotGiven:3,thermoPoints:3}}};pair(mixed,'a',1);pair(mixed,'b',1);pair(mixed,'c',1);
});
test('zero, negative, NaN, missing fields and non-positive coercions remain excluded',function(){
 var values=[0,-1,NaN,undefined,null,'',' ',false,-Infinity,'bad',[],{}],d={member:{u:{carrotGiven:1,thermoPoints:1}}};
 for(var i=0;i<values.length;i++)d.member['v'+i]={carrotGiven:values[i],thermoPoints:values[i]};
 pair(d,'u',0);for(var j=0;j<values.length;j++)pair(d,'v'+j,1);pair({member:{}},'u',1);
});
test('missing/inherited users and strict username identity preserve no-rank result',function(){
 var members=Object.create({inherited:{carrotGiven:100,thermoPoints:100}});members.u={carrotGiven:1,thermoPoints:2};members['1']=members.u;
 Object.defineProperty(members,'hidden',{value:members.u,enumerable:false});
 var names=['missing','inherited','hidden',null,undefined,1,true,{},'1','u'];for(var i=0;i<names.length;i++)pair({member:members},names[i]);
});
test('malformed member/data and getter errors propagate; no input repair',function(){
 var bad={};Object.defineProperty(bad,'carrotGiven',{get:function(){throw Error('broken metric');}});Object.defineProperty(bad,'thermoPoints',{get:function(){throw Error('broken metric');}});
 var cases=[undefined,null,{}, {member:null},{member:{u:null}},{member:{u:bad}}];
 for(var i=0;i<cases.length;i++)for(var k=0;k<2;k++){
  var a='',b='';try{(k?oldgetThermoRank:oldgetCarrotRank)('u',cases[i]);}catch(e){a=String(e);}try{(k?getThermoRank:getCarrotRank)('u',cases[i]);}catch(e){b=String(e);}check(!!a&&a===b,'error parity '+i+' '+a+' / '+b);
 }
});
test('repeated queries observe score changes without writes or retained cache',function(){
 var d=fixture(30,true),snapshot=JSON.stringify(d);pair(d,'user5',0);check(JSON.stringify(d)===snapshot,'no mutation');
 d.member.user5.carrotGiven=100;d.member.user5.thermoPoints=0;pair(d,'user5');delete d.member.user6;pair(d,'user5');
});
test('seeded mixed-data differential cases preserve existing numeric coercion and ties',function(){
 var seed=17,values=[1,2,3,0.25,0,-2,'2','10',null,true,Infinity,NaN,'bad'];
 for(var round=0;round<120;round++){var d={member:{}};for(var i=0;i<25;i++){seed=(seed*16807)%2147483647;d.member['u'+i]={carrotGiven:values[seed%values.length],thermoPoints:values[(seed+3)%values.length]};}pair(d,'u'+(round%25));}
});
`;
const c=vm.createContext({print:console.log});vm.runInContext(counters+core+scenarios,c);assert.equal(c.groups,8);
const callbackCases=['normal','tied','coercion','excluded','equivalent','corrupt'];
// 전체 7인수 /내정보 응답용 합성 파일을 준비하는 함수
function diskFor(kind){const disk=io.seed();for(const base of [io.prod,io.dev]){const d=JSON.parse(disk[base+'member.json']);let i=0;for(const u of Object.keys(d.member)){d.member[u].carrotGiven=kind==='tied'?2:i+1;d.member[u].thermoPoints=kind==='tied'?2:20-i++;}if(kind==='coercion'){d.member.u.carrotGiven='2';d.member.v.thermoPoints=true;}if(kind==='excluded'){d.member.u.carrotGiven=0;d.member.u.thermoPoints=-1;}if(kind==='equivalent'){d.member.u.carrotGiven=2;d.member['é']={carrotGiven:2,thermoPoints:2};d.member['e\u0301']={carrotGiven:2,thermoPoints:2};}if(kind==='corrupt')d.member.bad=null;disk[base+'member.json']=JSON.stringify(d);}return disk;}
for(const kind of callbackCases)for(const msg of ['/내정보','dev/내정보']){
 const disk=diskFor(kind),a=io.createInfoFixture(oldInfo,disk),b=io.createInfoFixture(info,disk);vm.runInContext(counters,a.c);vm.runInContext(counters,b.c);
 const old=a.run(msg),now=b.run(msg);assert.deepStrictEqual(now,old,kind+' '+msg);assert.deepStrictEqual(b.disk,a.disk);if(kind!=='corrupt'){assert.equal(now.writes.length,0);assert.equal(now.errors.length,0);assert(now.messages.length>0);}if(kind==='normal'||kind==='tied'){assert.equal(a.c.sorts-b.c.sorts,2);}
 console.log('PASS full Info metric '+kind+' '+msg+' exact output/read/write parity');
}
// 과거 최적화 전용 비교 기준 대신 직전 운영 소스로 기존 명령 목록을 회귀 대조한다.
let commandGroups=0;
for(const [msg,,user] of io.commands)for(const dev of [false,true]){
 const a=io.createInfoFixture(oldInfo),b=io.createInfoFixture(info),input=dev?'dev/'+(msg.startsWith('/')?msg.slice(1):msg):msg;
 assert.deepStrictEqual(b.run(input,user),a.run(input,user),input);assert.deepStrictEqual(b.disk,a.disk);commandGroups++;
}
console.log('PASS current-baseline Info command parity: '+commandGroups+' groups');
if(process.argv[2]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'personal-metric-rhino-'));
 // 실제 파일을 사용하는 Rhino 전체 응답 비교용 런타임을 만드는 함수
 function fullRuntime(text,kind,label){const base=path.join(dir,label).replace(/\\/g,'/')+'/',prod=base+'prod/',dev=base+'dev/';fs.mkdirSync(prod,{recursive:true});fs.mkdirSync(dev);for(const [p,t]of Object.entries(diskFor(kind)))fs.writeFileSync((p.startsWith(io.dev)?dev:prod)+p.slice(p.lastIndexOf('/')+1),t,'utf8');return `
var android={os:{Environment:{getExternalStorageDirectory:function(){return {getAbsolutePath:function(){return ${JSON.stringify(base)};}};}}}};
var trace={reads:[],writes:[],messages:[],errors:[],notices:[]},errorObj={synthetic:true};
var FileStream={read:function(p){p=String(p);trace.reads.push(p.slice(${prod.length}));return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(p)),'UTF-8'));},write:function(p,t){trace.writes.push(String(p).slice(${prod.length}));java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(String(t)).getBytes('UTF-8'));}};
var Api={replyRoom:function(r,t){if(String(t).indexOf('[ ERROR')===0)trace.errors.push(String(t).replace(/"fileName":"[^"]+","lineNumber":\\d+/g,'"fileName":"Info.js","lineNumber":0'));else trace.notices.push(String(t));}};Math.random=function(){return 0.5;};
${text.replaceAll(io.dev,dev).replaceAll(io.prod,prod)}
${counters}
function runOne(msg){trace={reads:[],writes:[],messages:[],errors:[],notices:[]};sorts=0;try{response('서버관리자',msg,'u',true,{reply:function(t){trace.messages.push(String(t));}},null,'test');}catch(e){trace.errors.push(String(e));}return JSON.stringify({trace:trace,sorts:sorts});}
`;}
 let script=`var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(fs.readFileSync(path.join(root,'main.js'),'utf8'))},'main.js',1,null);cx.compileString(${JSON.stringify(info)},'Info.js',1,null);print('PASS Rhino full Main/Info compile');\n`+counters+core+scenarios;
 for(const kind of callbackCases){script+=`var a=cx.initStandardObjects(),b=cx.initStandardObjects();cx.evaluateString(a,${JSON.stringify(fullRuntime(oldInfo,kind,'before-'+kind))},'before',1,null);cx.evaluateString(b,${JSON.stringify(fullRuntime(info,kind,'after-'+kind))},'after',1,null);`;
  for(const msg of ['/내정보','dev/내정보'])script+=`var old=JSON.parse(String(cx.evaluateString(a,${JSON.stringify('runOne('+JSON.stringify(msg)+')')},'invoke',1,null))),now=JSON.parse(String(cx.evaluateString(b,${JSON.stringify('runOne('+JSON.stringify(msg)+')')},'invoke',1,null)));check(JSON.stringify(old.trace)===JSON.stringify(now.trace),'Rhino callback '+${JSON.stringify(kind+' '+msg)});${kind!=='corrupt'?"check(now.trace.writes.length===0,'no writes');check(now.trace.errors.length===0&&now.trace.messages.length>0,'successful output');":''}${kind==='normal'||kind==='tied'?"check(old.sorts-now.sorts===2,'2 fewer sorts');":''}print('PASS Rhino full metric '+${JSON.stringify(kind+' '+msg)});`;
 }
 const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');const p=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',process.argv[2],'org.mozilla.javascript.tools.shell.Main','-version','200','-opt','-1','-encoding','UTF-8',file],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});process.stdout.write(p.stdout||'');process.stderr.write(p.stderr||'');assert.equal(p.status,0);
}
