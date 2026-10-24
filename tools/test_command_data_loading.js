// 실제 Info 응답 전체와 Main 재화 분기의 출력·로드·저장 동등성을 합성 파일로 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),baselineRef='48826682e165787c2c1d36b962c2685902c049ef';
const read=n=>fs.readFileSync(path.join(root,n),'utf8').replace(/\r\n/g,'\n');
const main=read('main.js'),info=read('Info.js');
const oldMain=cp.execFileSync('git',['show',baselineRef+':main.js'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
const oldInfo=cp.execFileSync('git',['show',baselineRef+':Info.js'],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024}).replace(/\r\n/g,'\n');
function block(text,marker){const s=text.indexOf(marker);assert(s>=0,marker);let depth=0;for(let i=text.indexOf('{',s);i<text.length;i++){if(text[i]==='{')depth++;if(text[i]==='}'&&--depth===0)return text.slice(s,i+1);}throw Error(marker);}
const prod='/sdcard/호이랜드/',dev='/sdcard/호이랜드_dev/';
function seed(){
 const d={master:['master'],admin:{admin:{}},member:{},shop:{'테스트상품':100},attend_list:['u','v'],checkcnt:1};
 const pets={},titles={member:{}},petTitles={member:{}},homes={};
 for(const u of ['u','v','master','admin',...Array.from({length:10},(_,i)=>'extra'+i)]){
  d.member[u]={today:1,agree:true,lv:2,exp:10,join:'20261001',recent:'20261025',cnt:2,point:1000,diamond:100,earnings:100,like:3,like0:4,carrotGiven:1,thermoPoints:2,rank:{tier:'초심자'},bag:{'티어 승급티켓🎟':1},battle:{win:2,lose:1,score:10,count:1},towerCnt:1,exploreCnt:1,server:'호이서버1[30]'};
  pets[u]={petname:'펫',petimg:'🐶',petexp:100,upgrade:1,miniPetBattle:{win:50,lose:1,count:1}};
  titles.member[u]={title:{list:[{name:'테스트칭호',inDate:'2026-10-01T00:00:00Z',price:100}],num:1}};petTitles.member[u]={title:{list:[{name:'펫칭호',inDate:'2026-10-01T00:00:00Z',price:100}],num:1}};
  homes[u]={floor:10,houseName:'집',totalExp:0,likeCnt:1,furnitureBag:[]};
 }
 const entries={'member.json':d,'member_pet.json':pets,'guildData.json':{guilds:{},castleSiegeFlag:false},'petSkillData.json':{},'member_title.json':titles,'pet_title.json':petTitles,
 'itemInfo.json':{raidSpecialItem:{},castlePremiumItem:{},castleItem:{},allItem:{}},'petSweetHomeData.json':homes,'petExploreData.json':{record:{}},'petHomeActivityData.json':{users:{},alerts:{}},'trialTower.json':{user:{}},'miniPetData.json':{gradeTable:[]},'castleBattle2.json':{rank:{starter:{scoreRequirement:0,name:'초보'}}}};
 const disk={};for(const base of [prod,dev])for(const [name,data]of Object.entries(entries))disk[base+name]=JSON.stringify(data);return disk;
}
function createInfoFixture(text=info,initial=seed()){
 const disk={...initial},trace={reads:[],writes:[],messages:[],errors:[],notices:[]},properties=new Map();
 function File(a,b){this.path=String(a)+(b===undefined?'':'/'+b);}
 File.prototype.exists=function(){return Object.hasOwn(disk,this.path);};File.prototype.getName=function(){return this.path.split('/').pop();};
 File.prototype.getPath=function(){return this.path;};File.prototype.getAbsolutePath=File.prototype.getPath;
 File.prototype.lastModified=function(){return 1;};File.prototype.length=function(){return (disk[this.path]||'').length;};
 File.prototype.listFiles=function(){const prefix=this.path.replace(/\/$/,'')+'/';return Object.keys(disk).filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(p=>new File(p));};File.prototype.isFile=function(){return this.exists();};
 function Local(){this.value=null;}Local.prototype.get=function(){return this.value;};Local.prototype.set=function(v){this.value=v;};Local.prototype.remove=function(){this.value=null;};
 const c={android:{os:{Environment:{getExternalStorageDirectory:()=>new File('/sdcard')}}},java:{io:{File},lang:{ThreadLocal:Local,System:{getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,String(v))}}},
  FileStream:{read(p){p=String(p);trace.reads.push(p);if(!Object.hasOwn(disk,p))throw Error('missing '+p);return disk[p];},write(p,t){trace.writes.push(String(p));disk[String(p)]=String(t);}},
  Api:{replyRoom:(r,t)=>(String(t).startsWith('[ ERROR')?trace.errors:trace.notices).push(String(t))},errorObj:{synthetic:true}};
 vm.createContext(c);vm.runInContext('Math.random=function(){return 0.5;};',c);vm.runInContext(text,c);trace.reads=[];trace.writes=[];
 function run(msg,user='u',room='서버관리자',group=true){trace.reads=[];trace.writes=[];trace.messages=[];trace.errors=[];trace.notices=[];try{c.response(room,msg,user,group,{reply:t=>trace.messages.push(String(t))},null,'test');}catch(e){trace.errors.push(String(e));}return JSON.parse(JSON.stringify(trace));}
 return {c,disk,trace,run};
}
const currencyStage=text=>{
 const start=text.indexOf('        var currencyLogData');assert(start>=0);
 const end=text.indexOf('        if (matzangField.active && matzangField.resting',start);assert(end>start);return text.slice(start,end);
};
const commands=[
 ['/포인트',[]],['ㅍㅍㅍ',[]],['/레벨',[]],['/내정보',['member_pet.json','member_title.json','pet_title.json']],
 ['/정보 u',['member_pet.json','member_title.json'],'master'],['/타이틀목록',['member_title.json']],['/타이틀목록 u',['member_title.json'],'admin'],
 ['/펫타이틀목록',['pet_title.json']],['/펫타이틀목록 u',['pet_title.json'],'admin'],['/출석목록',[]],['/상점',[]],['/미출석 2',[],'admin'],
 ['/미니펫대전순위',['member_pet.json']],['/미니펫대전승률',['member_pet.json']],['/미니펫승률순위',['member_pet.json']],['/펫강순위',['member_pet.json']],
 ['/누좋순위',[]],['/영주수익순위',[]],['/반지순위',[]],['/종합순위',['member_pet.json','petSkillData.json']],['ㅈㅈㅈ',['member_pet.json','petSkillData.json']],['/서버순위',['member_pet.json','petSkillData.json']],
 ['/티어순위',[]],['/티어확인',[]],['/펫상태',['member_pet.json']],['/미니펫통계',['member_pet.json']],
 ['/펫정보',['member_pet.json','petSkillData.json','pet_title.json']],['/ㅎ',['member_pet.json','petSkillData.json','pet_title.json']],['ㅁㅁㅁ',['member_pet.json','petSkillData.json','pet_title.json']],
 ['/펫매력순위',['member_pet.json']],['/캐슬매력순위',['member_pet.json','petSkillData.json']],['/레이드매력순위',['member_pet.json','petSkillData.json']],['/시련의탑순위',['member_pet.json']],
 ['/가구통계',[]],['/서버확인',[],'admin'],['/서버확인 1',[],'admin'],['/서버통계',[]],['/펫주인',['member_pet.json'],'호이 남'],['/포인트확인',[],'호이 남'],
 ['/캐슬전적',['member_pet.json']],['/캐슬대전순위',[]],['/존재하지않는명령',[]],['/구매 1 1',[]]
];
const optional=['member_pet.json','petSkillData.json','member_title.json','pet_title.json'];
let groups=0;function test(name,fn){fn();console.log('PASS '+(++groups)+': '+name);}
function checks(){
 for(const [msg,files,user]of commands)test('Info 전체 응답 동등 / 필요 파일 1회: '+msg,()=>{
  const before=createInfoFixture(oldInfo),after=createInfoFixture();const a=before.run(msg,user),b=after.run(msg,user);
  assert.deepStrictEqual(b.messages,a.messages,msg);assert.deepStrictEqual(b.errors,a.errors,msg+' errors');assert.equal(b.errors.length,0,msg+' runtime error');
  assert.deepStrictEqual(after.disk,before.disk,msg+' no new writes');assert.equal(b.writes.length,0);
  const actual=b.reads.map(p=>p.slice(prod.length)).filter(n=>optional.includes(n));assert.deepStrictEqual(actual.slice().sort(),files.slice().sort(),msg+' dependencies');
  for(const p of new Set(b.reads))assert.equal(b.reads.filter(x=>x===p).length,1,msg+' duplicate read '+p);
 });
 test('checkRank·레벨 표시에는 펫 내용 접근이 없고 출력은 기존 유지',()=>{
  assert.equal((block(info,'function checkRank(').match(/petData/g)||[]).length,1);
  assert(!block(info,'function buildInfoLevelMessage(').includes('petData['));
 });
 test('공통 권한/출석/레이드/영지/무쌍/정지/약관/개인톡 검사는 기존 위치와 동일',()=>{
  const begin=info.indexOf('function response('),cut=info.indexOf('\t\tvar petData, petSkillData');
  const oldCut=oldInfo.indexOf('\t\tvar petData = loadJsonFile');assert.equal(info.slice(begin,cut),oldInfo.slice(oldInfo.indexOf('function response('),oldCut));
 });
 test('43개 입력의 DEV 응답·명령별 의존성과 운영 파일 보존',()=>{
  for(const [msg,files,user]of commands){const before=createInfoFixture(oldInfo),after=createInfoFixture(),input='dev/'+msg.replace(/^\//,'');const a=before.run(input,user,'팻 테스트방'),b=after.run(input,user,'팻 테스트방');
   assert.deepStrictEqual(b.messages,a.messages,msg);assert.deepStrictEqual(b.errors,a.errors,msg);assert.deepStrictEqual(b.notices,a.notices,msg);assert.equal(b.errors.length,0,msg);assert.equal(b.writes.length,0);
   const actual=b.reads.filter(p=>optional.some(n=>p.endsWith('/'+n))),expected=(msg==='ㅈㅈㅈ'||msg==='ㅁㅁㅁ')?[]:files;assert.deepStrictEqual(actual.map(p=>p.slice(dev.length)).sort(),expected.slice().sort(),msg);
   for(const p of actual)assert(p.startsWith(dev));assert.deepStrictEqual(after.disk,before.disk);
  }
 });
 test('미출석·정지·미동의·대전·개인톡 차단은 선택 파일 읽기 전 반환',()=>{
  const changes=[d=>{d.member.u.today=0;},d=>{d.accountSuspensions={users:{u:{}}};},d=>{d.member.u.agree=false;},d=>{d.petMusou={active:true};},d=>{d.matzangField={active:true,resting:false};},d=>{d.serverRaid={current:{state:'ACTIVE'}};}];
  for(const change of changes){const disk=seed(),d=JSON.parse(disk[prod+'member.json']);change(d);disk[prod+'member.json']=JSON.stringify(d);
   const msg=d.serverRaid?'/레벨':'/펫정보',old=createInfoFixture(oldInfo,disk).run(msg),current=createInfoFixture(info,disk).run(msg);assert.deepStrictEqual(current,old);assert.equal(current.reads.filter(p=>optional.some(n=>p.endsWith('/'+n))).length,0);}
  const disk=seed();disk[prod+'guildData.json']=JSON.stringify({territoryWar:{active:true}});
  for(const [name,d]of [['guild',disk],['private',seed()]]){const old=createInfoFixture(oldInfo,d).run('/펫정보','u','서버관리자',name!=='private'),current=createInfoFixture(info,d).run('/펫정보','u','서버관리자',name!=='private');assert.deepStrictEqual(current,old);assert.equal(current.messages.length,0);assert(!current.reads.includes(prod+'member_pet.json'));}
 });
 test('복구 대기 3종은 데이터 노출·선택 로드·쓰기 없이 차단',()=>{
  for(const name of ['doll','robbery','quest']){const disk=seed();if(name==='doll'){disk[prod+'dollIndex.json']='{}';disk[prod+'dollPending.json']='{"pending":[]}';}else disk[prod+(name==='robbery'?'miniPetRobberyPending.json':'adventureQuestHistoryPending.json')]='{"pending":[]}';
   const a=createInfoFixture(oldInfo,disk).run('/펫정보'),b=createInfoFixture(info,disk).run('/펫정보');assert.deepStrictEqual(b,a);assert.equal(b.messages.length,0);assert(!b.reads.includes(prod+'member_pet.json'));assert.equal(b.writes.length,0);}
 });
 test('비사용 파일 누락·손상은 무읽기 / 사용하는 파일은 기존 오류 방식 유지',()=>{
  for(const name of optional){for(const bad of [null,'{bad json']){const disk=seed();if(bad===null)delete disk[prod+name];else disk[prod+name]=bad;
   const h=createInfoFixture(info,disk),a=h.run('/포인트');assert.equal(a.errors.length,0);assert(a.messages.length);assert(!a.reads.includes(prod+name));assert.equal(a.writes.length,0);
   const needed=name==='member_title.json'?'/타이틀목록':'/펫정보',old=createInfoFixture(oldInfo,disk).run(needed),current=createInfoFixture(info,disk).run(needed);
   assert.deepStrictEqual(current.messages,old.messages);assert.deepStrictEqual(current.errors,old.errors);if(bad!==null)assert(current.reads.includes(prod+name));
   assert.equal(h.disk[prod+name],disk[prod+name]);
  }}
 });
 test('연속 요청은 파일 변경을 즉시 읽고 응답 실패에도 컨텍스트 해제',()=>{
  const h=createInfoFixture(),a=h.run('/타이틀목록');const titles=JSON.parse(h.disk[prod+'member_title.json']);titles.member.u.title.list[0].name='바뀐칭호';h.disk[prod+'member_title.json']=JSON.stringify(titles);
  const b=h.run('/타이틀목록');assert.notDeepStrictEqual(b.messages,a.messages);assert(b.messages[0].includes('바뀐칭호'));assert.equal(b.reads.filter(p=>p===prod+'member_title.json').length,1);
  try{h.c.response('서버관리자','/포인트','u',true,{reply(){throw Error('transport');}},null,'test');}catch(e){}assert.equal(h.c.commandContextThreadLocal.get(),null);assert.equal(h.run('/포인트').errors.length,0);
 });
 const required=['/맞짱종료','/다이아순위','/다이아전체초기화','/데이터정리','/다이아상점구매 1 2','/다이아추가 u 3','/다이아차감 u 3','/계정잠수삭제 1','/계삭진행 u','/다이아상자오픈','/다이아상자오픈 3','/길드분배','/길드분배 1 2'];
 test('Main 재화 사용 11분기/13입력은 기존 위치에서 1회 읽기·비사용 입력 0회',()=>{
  const c={Date,loadJsonFile(){c.reads++;return {user:{u:{diamond:7}}};},currencyLogPath:'currency',addResponseTiming(){},reads:0};vm.createContext(c);vm.runInContext(block(main,'function ensureCurrencyLogData('),c);
  for(const msg of required.concat(['/포인트','/펫정보','/일퀘','일반 대화','/호이봇버전','/개발자노트','/다이아상점','/다이아상점구매 1 2 해봐','/다이아상자오픈 1 해봐','/길드분배 1 해봐'])){
   c.msg=msg;c.reads=0;vm.runInContext(currencyStage(main),c);assert.equal(c.reads,required.includes(msg)?1:0,msg);if(required.includes(msg))assert.equal(c.currencyLogData.user.u.diamond,7);
  }
  const consumers=['if (msg === "/맞짱종료") {','if (msg === "/다이아순위") {','if (/^\\/다이아상점구매\\s+\\d+\\s+\\d+$/.test(msg)) {','if (/^\\/다이아추가\\s+.+\\s+\\d+$/.test(msg)', 'if (/^\\/다이아차감\\s+.+\\s+\\d+$/.test(msg)','if (msg === "/다이아전체초기화"','if (msg.startsWith("/계정잠수삭제")','if (msg.startsWith("/계삭진행")','if (msg === "/다이아상자오픈"','if (msg === "/길드분배"','if (msg === "/데이터정리" &&'];
  for(const marker of consumers)assert.equal(block(main,marker),block(oldMain,marker),marker+' consumer unchanged');
 });
 test('Main 지급·차감·상점·초기화 실제 저장 동등 / 각 저장 실패 롤백·재시도·DEV',()=>{
  const markers=['if (msg === "/다이아순위") {','if (/^\\/다이아상점구매\\s+\\d+\\s+\\d+$/.test(msg)) {','if (/^\\/다이아추가\\s+.+\\s+\\d+$/.test(msg)','if (/^\\/다이아차감\\s+.+\\s+\\d+$/.test(msg)','if (msg === "/다이아전체초기화"'];
  const names=['ensureCurrencyLogData','ensureCurrencyLogUser','ensureDiamondMemberData','addDiamond','addUsedDiamond','getDiamondShopGrantItem','getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction','saveJsonFile'];
  function harness(text,devMode=false,fail=null){let disk={},backups={},reads=[],messages=[],writes=[];const base=devMode?'dev/':'prod/',member=JSON.parse(seed()[prod+'member.json']);
   disk[base+'member']=JSON.stringify(member);disk[base+'currency']=JSON.stringify({user:{u:{diamond:7,usedDiamond:2}}});disk[(devMode?'prod/':'dev/')+'member']='{"untouched":true}';
   const c={filePath:base+'member',currencyLogPath:base+'currency',commonStepStart:0,Date,sender:'master',allsee:'<ALLSEE>',GLOBAL_CONFIG:{petHomeActivity:{shopAliases:{}}},
    dataSaveTransactionThreadLocal:{v:null,get(){return this.v;},set(v){this.v=v;},remove(){this.v=null;}},dataTransactionLock:{lock(){},unlock(){}},
    getAutoDailyBatchContext:()=>null,getCurrentContext:()=>({}),resolveActiveDataPath:p=>p,isProtectedManagedJsonPath:()=>true,getManagedJsonBackupPath:p=>p+'.bak',ensureParentFolder(){},debuggerLog(){},addResponseTiming(){},
    loadJsonFile(p){reads.push(p);return vm.runInContext('JSON.parse('+JSON.stringify(disk[p])+')',c);},
    writeVerifiedJsonFile(p,t,skip){JSON.parse(t);if(p===fail){fail=null;throw Error('injected failure');}if(!skip)backups[p]=disk[p];disk[p]=t;writes.push(p);},restoreManagedJsonFromBackup(p){disk[p]=backups[p];return {data:JSON.parse(disk[p])};},
    numberWithCommas:n=>String(n),formatDateTime:()=> 'synthetic',checkRank:(_d,_p,_g,u)=>u,getRankEmoji:n=>String(n),isMaster:()=>true,isAdmin:()=>true,
    getAdventureQuestState:()=>null,addItem(d,u,n,q){d.member[u].bag[n]=(d.member[u].bag[n]||0)+q;},replier:{reply:m=>messages.push(String(m))}};
   vm.createContext(c);vm.runInContext(names.map(n=>block(main,'function '+n+'(')).join('\n'),c);
   vm.runInContext('function execute(msg){var data=loadJsonFile(filePath),petData={},guildData={},matzangField={shop:[{name:"테스트상품",count:2,price:3}]};'+currencyStage(text)+markers.map(m=>block(text,m)).join('\n')+'}',c);
   function run(msg){messages=[];reads=[];writes=[];c.beginDataSaveTransaction();try{c.execute(msg);}finally{c.endDataSaveTransaction();}return {disk:{...disk},messages:[...messages],reads:[...reads],writes:[...writes]};}
   return {c,run,snapshot:()=>({...disk})};
  }
  for(const command of ['/다이아순위','/다이아추가 u 3','/다이아차감 u 3','/다이아상점구매 1 2','/다이아전체초기화']){
   assert.deepStrictEqual(harness(main).run(command),harness(oldMain).run(command),command);
   if(command!=='/다이아순위')for(const p of ['prod/member','prod/currency']){const f=harness(main,false,p),original=f.snapshot();assert.throws(()=>f.run(command),/injected failure/);assert.deepStrictEqual(f.snapshot(),original);assert.equal(f.c.getDataSaveTransaction(),null);f.run(command);}
   const f=harness(main,true),before=f.snapshot(),r=f.run(command);assert.equal(r.disk['prod/member'],before['prod/member']);assert(r.reads.every(p=>p.startsWith('dev/')));assert(r.writes.every(p=>p.startsWith('dev/')));
  }
  const f=harness(main),before=f.snapshot(),r=f.run('/포인트');assert.equal(r.reads.filter(p=>p.endsWith('currency')).length,0);assert.deepStrictEqual(f.snapshot(),before);
 });
 console.log('PASS command file loading '+groups+' groups');
}
if(require.main===module)checks();
module.exports={root,baselineRef,main,info,oldMain,oldInfo,block,prod,dev,seed,createInfoFixture,currencyStage,commands,optional,checks};
