// 기존 운영 소스와 단일 회원 만료 조회·마블 정산 원문 재사용 결과를 대조한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const { block } = require('./test_pet_skill_lookup');
const root = path.join(__dirname, '..'), baseline = 'e1d2edf4d8cf8d43232d4619e823eb81e8639473';
const current = fs.readFileSync(path.join(root, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const before = cp.execFileSync('git', ['show', baseline + ':main.js'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
// 실제 정산 전 게시 구간을 이전·이후 동일한 경계로 추출하는 함수
function settlement(source, name) {
    const start = source.indexOf('                if (marbleResult.changed) {', source.indexOf('if (marbleResult.settlement && marbleRequest.mutation)'));
    const end = source.indexOf('                var marbleSettlement =', start);
    assert(start > 0 && end > start);
    return 'function ' + name + '(){' + source.slice(start, end) + '}';
}
const runtime = block(current, 'function getSupportPassDateValue(') + '\nfunction getTodaySupportPassDateValue(){return 20261027;}\n' +
    block(before, 'function getExpiredHoiPassPremiumUsers(').replace('getExpiredHoiPassPremiumUsers(', 'oldExpiry(') + '\n' +
    block(current, 'function getExpiredHoiPassPremiumUsers(') + '\n' + settlement(before, 'oldSettlement') + '\n' + settlement(current, 'newSettlement');
const tests = String.raw`
var groups=0;
function check(v,m){if(!v)throw Error(m);}
function same(a,b,m){check(JSON.stringify(a)===JSON.stringify(b),m);}
function test(n,f){f();groups++;print('PASS targeted '+groups+' '+n);}
function member(pass){return {pass:{premium:pass}};}
test('expiry: expired/today/future/permanent/disabled/missing/invalid date and strict booleans',function(){
 var values=[null,{}, {enabled:true,endDate:'26.10.26'}, {enabled:true,endDate:'26.10.27'}, {enabled:true,endDate:'26.10.28'},
 {enabled:true,permanent:true,endDate:'26.10.26'},{enabled:false,endDate:'26.10.26'}, {enabled:1,endDate:'26.10.26'},
 {enabled:true,permanent:1,endDate:'26.10.26'}, {enabled:true,endDate:'26.02.30'}, {enabled:true,endDate:'bad'}, {enabled:true}];
 for(var i=0;i<values.length;i++){
  var d={member:{u:member(values[i]),other:member({enabled:true,endDate:'26.10.26'})}}, snapshot=JSON.stringify(d);
  same(getExpiredHoiPassPremiumUsers(d,'u'),oldExpiry(d,'u'),'target '+i);
  same(getExpiredHoiPassPremiumUsers(d,''),oldExpiry(d,''),'all '+i);
  check(JSON.stringify(d)===snapshot,'no mutation');
 }
 same(getExpiredHoiPassPremiumUsers({member:{u:member(values[2])}},'u'),['u'],'expiry expected');
});
test('expiry: no data, missing user, inherited/nonenumerable names, numeric and falsy targets',function(){
 var members=Object.create({inherited:member({enabled:true,endDate:'26.10.26'})});
 members.u=member({enabled:true,endDate:'26.10.26'});members['1']=members.u;
 Object.defineProperty(members,'hidden',{value:members.u,enumerable:false});
 var targets=['u','missing','inherited','hidden','toString','__proto__',1,true,{},null,undefined,'',false,0];
 for(var i=0;i<targets.length;i++)same(getExpiredHoiPassPremiumUsers({member:members},targets[i]),oldExpiry({member:members},targets[i]),'target '+i);
 for(var j=0;j<3;j++){var d=[null,{}, {member:null}][j];same(getExpiredHoiPassPremiumUsers(d,'u'),oldExpiry(d,'u'),'missing data');}
});
test('expiry: malformed target remains an error, unrelated damaged user is not inspected',function(){
 var bad={};Object.defineProperty(bad,'pass',{get:function(){throw Error('broken pass');}});
 var d={member:{u:bad,good:member({enabled:true,endDate:'26.10.26'})}};
 for(var i=0;i<2;i++){var f=i?getExpiredHoiPassPremiumUsers:oldExpiry,threw=false;try{f(d,'u');}catch(e){threw=String(e).indexOf('broken pass')!==-1;}check(threw,'target error');same(f(d,'good'),['good'],'unrelated not inspected');}
});
test('expiry: 5000 members preserve first/middle/last and all-user results',function(){
 var d={member:{}};for(var i=0;i<5000;i++)d.member['u'+i]=member({enabled:true,endDate:i%2?'26.10.26':'26.10.27'});
 for(var j=0;j<4;j++){var t=['u0','u2501','u4999',''][j];same(getExpiredHoiPassPremiumUsers(d,t),oldExpiry(d,t),'large '+t);}
});
var marbleResult,marbleStore,marblePath,marbleOriginalText,events,serializeCount,failure;
function requireGuildMarbleStore(s){events.push('validate');if(failure==='validate')throw Error(failure);return s;}
function writeMemberSplitSlot(p,t){events.push(['write',p,t]);if(failure==='write')throw Error(failure);}
function endDataSaveTransaction(){events.push('end');if(failure==='end')throw Error(failure);}
function beginDataSaveTransaction(){events.push('begin');if(failure==='begin')throw Error(failure);}
function trial(fn,changed,fail,dev){
 marbleResult={changed:changed};marbleStore={schemaVersion:1,guilds:{$g:{current:{results:[{amount:123}],players:[{paid:false}]}}}};
 marblePath=(dev?'/synthetic/dev/':'/synthetic/prod/')+'guildMarble.json';marbleOriginalText='original';events=[];serializeCount=0;failure=fail;
 var stringify=JSON.stringify,error='';JSON.stringify=function(v){if(v===marbleStore){serializeCount++;if(failure==='serialize')throw Error(failure);}return stringify(v);};
 try{fn();}catch(e){error=String(e);}finally{JSON.stringify=stringify;}
 return {result:{events:events,original:marbleOriginalText,changed:marbleResult.changed,store:marbleStore,error:error},count:serializeCount};
}
test('marble: same confirmed text/order/flags in PROD and DEV; two serializations become one',function(){
 for(var i=0;i<2;i++){var a=trial(oldSettlement,true,'',!!i),b=trial(newSettlement,true,'',!!i);same(a.result,b.result,'settlement parity');check(a.count===2&&b.count===1,'2 to 1');check(b.result.original===b.result.events[1][2],'written original reused');}
});
test('marble: unchanged state does not validate, serialize or write',function(){var a=trial(oldSettlement,false,'',false),b=trial(newSettlement,false,'',false);same(a,b,'unchanged parity');check(b.count===0&&b.result.events.length===0,'no work');});
test('marble: validation/serialization/write/transaction failures preserve ordering and error',function(){
 var faults=['validate','serialize','write','end','begin'];for(var i=0;i<faults.length;i++){var a=trial(oldSettlement,true,faults[i],false),b=trial(newSettlement,true,faults[i],false);same(a.result,b.result,'failure '+faults[i]);check(!!b.result.error,'error retained');}
});
`;
const c = vm.createContext({print:console.log});
vm.runInContext(runtime + tests, c); assert.equal(c.groups, 7);
// 키 열거 자체의 제거를 계측한다. Rhino 결과 대조는 위 ES5 시나리오로 별도 실행한다.
let enumerations=0;
const members=new Proxy({u:{pass:{premium:{enabled:true,endDate:'26.10.26'}}}}, {ownKeys(target){enumerations++;return Reflect.ownKeys(target);}});
c.oldExpiry({member:members},'u');assert.equal(enumerations,1);enumerations=0;
c.getExpiredHoiPassPremiumUsers({member:members},'u');assert.equal(enumerations,0);
console.log('PASS target member key enumeration: 1 -> 0');
if(process.argv[2]){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'targeted-performance-')),'test.js');
 fs.writeFileSync(file,runtime+tests,'utf8');
 const p=cp.spawnSync('java',['-Dfile.encoding=UTF-8','-cp',process.argv[2],'org.mozilla.javascript.tools.shell.Main','-version','200','-opt','-1','-encoding','UTF-8',file],{encoding:'utf8',timeout:60000});
 process.stdout.write(p.stdout||'');process.stderr.write(p.stderr||'');assert.equal(p.status,0);
}
