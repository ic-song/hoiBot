// 직전 운영 소스와 공통 처리의 출력·보상·공지·게시 중단 복구를 대조한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),os=require('os');
const h=require('./test_mini_games'),baseline='1157868c496015b33c5ac37814543de0e6bcc96d';
const old=cp.execFileSync('git',['show',baseline+':main.js'],{cwd:h.root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n'),current=h.main;
// 같은 합성 파일 하네스에 선택한 버전의 런타임 소스를 주입하는 함수
function fixture(source){const module={exports:{}},localRequire=n=>n==='fs'?Object.assign({},fs,{readFileSync(p,...a){return path.resolve(String(p))===path.join(h.root,'main.js')?source:fs.readFileSync(p,...a);}}):require(n);new Function('require','__dirname','module','exports',fs.readFileSync(path.join(__dirname,'test_mini_games.js'),'utf8'))(localRequire,__dirname,module,module.exports);return module.exports.fixture();}
let groups=0;
function test(n,f){f();console.log('PASS MINI COMMON '+(++groups)+' '+n);}
function both(dev,scenario){const a=fixture(old),b=fixture(current);for(const f of [a,b]){f.seed(dev);f.c.Math.random=()=>0.42;const d=f.read(dev);d.member.b.pass='premium';f.write(d,dev);}
 const run=(msg,user='a')=>{const x=a.run(msg,user,dev),y=b.run(msg,user,dev);assert.deepStrictEqual(y,x,msg);assert.deepStrictEqual(b.disk(),a.disk(),msg+' exact files');return y;};
 const same=()=>{assert.deepStrictEqual(b.disk(),a.disk());assert.deepStrictEqual(b.traces(),a.traces());};scenario({a,b,run,same,dev});}
// 무관한 주사위 사용자가 많은 실제 검증 가능한 진행 자료를 만드는 함수
function addUsers(f,dev,count=1000){const s=f.state(dev);for(let i=0;i<count;i++)s.dice.users['$ghost'+i]={accountId:'ghost'+i,day:s.dailyReset.day,used:0,finishedAt:0,game:null};f.putState(s,dev);}
test('PROD/DEV: unrelated users, balance view/vote/stats and two dice screens preserve exact writes and output',()=>{for(const dev of [false,true])both(dev,({a,b,run})=>{assert(!run('/금고').error);for(const f of [a,b])addUsers(f,dev);for(const [msg,user]of [['/밸런스','a'],['/밸런스 1 이유','a'],['/밸런스결과','master'],['/호월주사위','a'],['/호월주사위','a'],['/호월주사위','a']])assert(!run(msg,user).error);});});
test('pending results for several users are untouched by another command and auto outputs/payments complete once',()=>{both(false,({a,b,run,same})=>{run('/금고');for(const u of ['a','b']){run('/호월주사위',u);for(const f of [a,b])f.replyFail(true);assert(run('/호월주사위',u).error);for(const f of [a,b])f.replyFail(false);}run('/밸런스');assert.deepStrictEqual(b.auto(1000),a.auto(1000));same();const paid=b.read().member.a.point;assert.deepStrictEqual(b.auto(1000),a.auto(1000));same();assert.equal(b.read().member.a.point,paid);});});
test('vault reward and failed/uncertain announcement are preserved without repeated credit or broadcast',()=>{for(const dev of [false,true])both(dev,({a,b,run})=>{run('/금고');const answer=b.state(dev).vault.current.answer;for(const f of [a,b])f.noticeFail(true);run('/금고 '+answer);const paid=b.read(dev).member.a.point;for(const f of [a,b]){f.noticeFail(false);f.clock(f.now()+1);}run('/밸런스');assert.equal(b.read(dev).member.a.point,paid);assert(Object.values(b.state(dev).vault.awards).some(x=>x.notice==='UNCERTAIN'));});});
test('member/state/journal-clear publication stops recover identical confirmed reward once on next entry',()=>{for(const dev of [false,true])for(const stage of ['member','state','clear'])both(dev,({a,b,run})=>{run('/금고');const answer=b.state(dev).vault.current.answer;for(const f of [a,b])f.crashAfter((p,t)=>stage==='member'?p.endsWith('/member.json'):stage==='state'?p.endsWith('/miniGameState.json'):p.endsWith('/miniGamePending.json')&&t.pending===null);assert(run('/금고 '+answer).error);for(const f of [a,b])f.dropTimers();run('/밸런스');const paid=b.read(dev).member.a.point;run('/밸런스');assert.equal(b.read(dev).member.a.point,paid);});});
test('damaged progress remains an error before optimized selection; no reset or normalization',()=>{both(false,({a,b,run})=>{run('/금고');for(const f of [a,b]){const s=f.state();s.dice.users.$bad=null;f.putState(s);}assert(run('/밸런스').error);});});
// 화면 전송 구간을 동일 경계로 추출해 순회 횟수와 상태 전이를 두 엔진에서 대조하는 함수
function output(source,name){const start=source.indexOf('    // 전송 재시도는 확정된 화면만'),end=source.indexOf('    // 전체 공지는 지급과 독립적으로',start);assert(start>0&&end>start);return 'function '+name+'(mode,request,accountId,diceReplay,state){'+source.slice(start,end).replace('        var outputUser =','        visits++;\n        var outputUser =')+'}';}
const runtime=h.block(old,'function getMiniGameWorkDelay(').replace('function getMiniGameWorkDelay(','function oldDelay(')+'\n'+h.block(current,'function getMiniGameWorkDelay(')+'\n'+output(old,'oldOutput')+'\n'+output(current,'newOutput')+'\nvar GLOBAL_CONFIG='+JSON.stringify(h.fixture().c.GLOBAL_CONFIG)+';\n';
const scenarios=String.raw`
var visits=0,events=[],accounts={},data={},args={ctx:{},replier:{reply:function(t){events.push(['reply',t]);}}};Date.now=function(){return 123;};
function check(v,m){if(!v)throw Error(m);}
function same(a,b,m){check(JSON.stringify(a)===JSON.stringify(b),m);}
function isHoiPassPremiumActive(){return true;}function getMiniGameDiceLimit(){return 4;}
function buildMiniGameDiceMessage(g,screen,premium,remaining){return JSON.stringify([g.accountId,screen,premium,remaining]);}
function createContextReplier(r){return r;}var Api={replyRoom:function(r,t){events.push(['auto',r,t]);return true;}};
function commit(){events.push('commit');}
function runOutput(fn,mode,kind,owner,replay,s){events=[];visits=0;var d=JSON.parse(JSON.stringify(s));fn(mode,{kind:kind},owner,replay,d);return {events:events,state:d,visits:visits};}
function outputState(){var s={dice:{users:{}}};accounts={};for(var i=0;i<1000;i++)s.dice.users['$ghost'+i]={accountId:'ghost'+i,used:0,game:null};for(var j=0;j<3;j++){var id='a'+j;accounts[id]={user:id};s.dice.users['$'+id]={accountId:id,used:1,game:{accountId:id,room:'r',phase:j===0?'WAIT_USER2':'RESULT',paid:j!==2,outputIndex:1}};}return s;}
var s=outputState(),cases=[['command','dice','a0',false],['command','dice','a1',false],['command','dice','a2',false],['command','dice','a0',true],['command','balance','a0',false],['command','dice','missing',false],['auto','dice','a0',false]];
for(var i=0;i<cases.length;i++){var x=cases[i],a=runOutput(oldOutput,x[0],x[1],x[2],x[3],s),b=runOutput(newOutput,x[0],x[1],x[2],x[3],s);same(a.events,b.events,'same sends/commits');same(a.state,b.state,'same transitions');if(x[0]==='auto')check(a.visits===b.visits,'auto keeps full scan');else check(a.visits===1003&&b.visits===(x[1]==='dice'&&!x[3]&&x[2]!=='missing'?1:0),'1003 to 1/0');}
print('PASS common output: 7 selection/transition cases, command visits 1003 to 1/0, auto unchanged');
function delayState(resultAt,pendingAt){var s={dice:{users:{}},ledger:{}};for(var i=0;i<1000;i++){s.dice.users['$'+i]={game:i===resultAt?{phase:'RESULT'}:null};s.ledger['r'+i]={status:i===pendingAt?'PENDING':'PAID',kind:'dice'};}return s;}
for(var i=0;i<5;i++){var s=delayState([0,999,-1,-1,-1][i],[-1,-1,0,999,-1][i]);same(getMiniGameWorkDelay(s,0,{},{}),oldDelay(s,0,{},{}),'delay '+i);}
var d=delayState(-1,0);d.ledger.r0.kind='balance';same(getMiniGameWorkDelay(d),oldDelay(d),'balance pending ignored');
var reads=0,d=delayState(0,0);for(var k in d.dice.users)(function(u,g){Object.defineProperty(u,'game',{get:function(){reads++;return g;}});})(d.dice.users[k],d.dice.users[k].game);
reads=0;var a=oldDelay(d),before=reads;reads=0;var b=getMiniGameWorkDelay(d);same(a,b,'same early delay');check(before===1000&&reads===1,'delay reads 1000 to 1');
print('PASS common delay: first/last/absent result and pending reward, balance ignored, game reads 1000 to 1');
`;
vm.runInNewContext(runtime+scenarios,{print:console.log});
if(process.argv[2]){const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'mini-common-')),'test.js');fs.writeFileSync(file,runtime+scenarios,'utf8');const r=cp.spawnSync('java',['-Dfile.encoding=UTF-8','-cp',process.argv[2],'org.mozilla.javascript.tools.shell.Main','-version','200','-opt','-1','-encoding','UTF-8',file],{encoding:'utf8',timeout:60000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0);}
console.log('PASS mini-game common differential '+groups+' full-flow groups');
