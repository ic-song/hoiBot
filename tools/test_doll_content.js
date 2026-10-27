const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
const info=fs.readFileSync(path.join(__dirname,"..","Info.js"),"utf8");
const harness=fs.readFileSync(path.join(__dirname,"test_member_display_search_auth.js"),"utf8");
const {c,fixture,seed,block}=new Function("require","__dirname",harness.slice(0,harness.indexOf('\npass("'))+"\nreturn {c,fixture,seed,block};")(require,__dirname);
c.dollCatalogGradeCache=null;
c.Math=vm.runInContext("Math",c);
c.COMMON_DATA_FILE_MAP["dollCatalog.json"]=true;
vm.runInContext(block(main,"const ticketTierData ="),c);
for(const name of ["getDollGradeRows","getDollRequest","getDollShard","validateDollCatalog","requireDollStore","getDollSuccessPercent","getDollSize","getDollRecordCharm","buildDollRepresentative","compareDollRows","getDollBoxRequest","applyDollAcquisition","applyDollDraw","dollTitle","buildDollDrawMessage","formatDollAmount","dollCommandFooter","getDollCollectionRows","getDollCollectionCommand","buildDollCollectionMessage","buildDollRankingMessage","buildDollGuideMessage","getDollEmoji","pruneDollDeletedAccounts","resetAllDollRecords","roundToTwo","getTierExperienceBonus","normalizeTicketTierName","getTicketTierStage","getLevelRequiredExperience","getAdventureLevelTitle","processAdventureLevelUps","applyAdventureExperienceBooster","addMemberExperienceWithTierBonus","removeItem","formatAdventureExperience"])vm.runInContext(block(main,"function "+name+"("),c);
c.getAutoDailyBatchContext=()=>null;c.replyAutoDailyAdventureLevelUps=()=>{};
c.checkRank=(_d,_p,_g,u)=>u;c.isHoiPassPremiumActive=()=>false;
const root="/sdcard/호이랜드/",devRoot="/sdcard/호이랜드_dev/";
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","dollCatalog.json"),"utf8"));
const inRealm=value=>vm.runInContext("("+JSON.stringify(value)+")",c);
const cat=inRealm(catalog);
let groups=0;function test(name,fn){fixture.reset();seed();fn();console.log("PASS "+(++groups)+": "+name);}
function input(ticket=1,points=1000000000,boosters=9999){
 const d=inRealm({member:{u:{point:points,bag:{[c.GLOBAL_CONFIG.doll.ticketName]:ticket},lv:1,exp:0,boostercnt:boosters,rank:{tier:"킹"}}}});
 return {d,p:inRealm({u:{petexp:1}}),s:inRealm({schemaVersion:1,users:{}}),idx:inRealm({schemaVersion:1,users:{}})};
}
function draw(x,values=[0,0,0,0,0]){let i=0;return c.applyDollDraw(x.d,x.p,cat,x.s,x.idx,"u","stable-id","2026.10.13",()=>values[i++]);}
test("정확한 명령·인수·도감 등급 페이지·51단계 확률",()=>{
 for(const name of ["/인형뽑기","/인형도감","/인형순위","/인형가이드","/인형도감 일반1","/인형도감 창조"])assert(c.getDollRequest(name));
 for(const name of ["/인형뽑기 2","/인형뽑기 해봐","/인형순위 1","/인형가이드설명"])assert.strictEqual(c.getDollRequest(name),null);
 assert.strictEqual(c.getDollRequest("/인형도감 창조1").kind,"invalid");
 assert.strictEqual(c.getDollSuccessPercent("새싹"),5);assert.strictEqual(c.getDollSuccessPercent("킹"),15);assert.strictEqual(c.getDollSuccessPercent("호월신"),55);
 assert.strictEqual(c.validateDollCatalog(cat),cat);
});
test("신규·중복 경험치와 가호·매력·크기 갱신·판매",()=>{
 const x=input();let r=draw(x);assert(r.fresh&&r.success);assert.strictEqual(x.d.member.u.point,1000000000);assert.strictEqual(x.p.u.dollCharm,2500);assert.strictEqual(r.experience.total,69);assert.strictEqual(r.experience.boosterResult.usedBooster,46);
 x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=1;
 r=draw(x,[0,0,0,0.995,0.999]);assert(!r.fresh);assert.strictEqual(r.size.label,"초대형");assert.strictEqual(r.sale,2000000);assert.strictEqual(x.p.u.dollCharm,2525);assert.strictEqual(x.s.users.u.catches.D0001.count,2);
 assert.strictEqual(x.p.u.dollCharm/2,1262.5);
 const message=c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r);assert(message.includes("개인 최고 기록 갱신"));
 x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=1;r=draw(x);assert(r.oldMax===1000&&r.length===150);assert.strictEqual(x.s.users.u.catches.D0001.max,1000);assert(!c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r).includes("개인 최고 기록 갱신"));
});
test("마지막 이용권·이용권 전용·실패·시작 전 부족 무차감",()=>{
 const x=input(1,0);let r=draw(x,[0.999]);assert(!r.success&&r.ticket);assert.strictEqual(x.d.member.u.point,0);assert.strictEqual(x.d.member.u.boostercnt,9999);assert(!x.s.users.u);assert(c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r).includes("다음 뽑기부터"));
 const before=JSON.stringify(x);r=draw(x);assert(!r.ok);assert.strictEqual(JSON.stringify(x),before);
 const y=input(0,1000000000);r=draw(y,[0.999]);assert(!r.ok);assert.strictEqual(y.d.member.u.point,1000000000);
});
test("9등급 경계와 크기 85/14/1·같은 기록 유지",()=>{
 let start=0;
 for(let g=0;g<9;g++){const x=input();const r=draw(x,[0,start/1000,0,0,0]);assert.strictEqual(r.doll.grade,g);start+=c.GLOBAL_CONFIG.doll.weights[g];}
 for(const [roll,label]of[[0.84999,"보통"],[0.85,"대형"],[0.98999,"대형"],[0.99,"초대형"]]){const x=input();const r=draw(x,[0,0,0,roll,0]);assert.strictEqual(r.size.label,label);}
 const d=cat.dolls[0];for(const [size,label]of[[829,"보통"],[830,"대형"],[957,"대형"],[958,"초대형"]])assert.strictEqual(c.getDollSize(d,size).label,label);
});
test("도감 1·2는 정렬 후 분할·종수·실제 결과 안내·상한 없는 누적",()=>{
 const x=input();draw(x);const rec=x.s.users.u;
 rec.catches.D0300={count:10000,max:catalog.dolls[299].maxTenths,first:"2026.10.13"};
 const rows=c.getDollCollectionRows(cat,rec,0);assert.strictEqual(rows.length,300);assert.strictEqual(rows[0].id,"D0300");
 const a=c.buildDollCollectionMessage(x.d,x.p,{},cat,rec,"u",{grade:0,page:1}),b=c.buildDollCollectionMessage(x.d,x.p,{},cat,rec,"u",{grade:0,page:2});
 assert.strictEqual((a.match(/No\.\d+/g)||[]).length,150);assert.strictEqual((b.match(/No\.\d+/g)||[]).length,150);
 assert(a.includes("일반 전체 수집 2/300종")&&b.includes("일반 전체 수집 2/300종"));
 assert(c.getDollCollectionCommand(cat,rec,"D0300").endsWith("일반1"));
 assert.strictEqual((a.match(/<ALLSEE>/g)||[]).length,1);
});
test("대표 인형·고정ID 동률·공개10등·내100등·미참여",()=>{
 const x=input();draw(x);for(let i=0;i<105;i++){const n="p"+i;x.d.member[n]={};x.idx.users[n]={id:"account-"+String(i).padStart(3,"0"),name:n,dollId:"D1000",grade:8,max:5200,count:1};}
 let out=c.buildDollRankingMessage(x.d,x.p,{},cat,x.idx,"u");assert(out.includes("100등 밖"));assert(!out.includes("11등｜"));assert(out.includes("10등｜"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);
 out=c.buildDollRankingMessage(x.d,x.p,{},cat,x.idx,"none");assert(out.includes("미참여"));assert(c.compareDollRows(x.idx.users.p0,x.idx.users.p1)<0);
 const r=inRealm({id:"id",catches:{D0999:{count:2,max:4800,first:"date"},D1000:{count:1,max:5200,first:"date"}}});assert.strictEqual(c.buildDollRepresentative(cat,r,"u").dollId,"D1000");
});
test("가호 부족·레벨업 잔여 포인트·데이터 오류 사전 차단",()=>{
 const x=input(1,0,1);x.d.member.u.exp=c.GLOBAL_CONFIG.level.expBase-1;const r=draw(x);assert.strictEqual(r.experience.boosterResult.usedBooster,1);assert(r.experience.levelUps.length>0);assert.strictEqual(r.remainingPoint,0+c.GLOBAL_CONFIG.level.bonusPoint);
 for(const invalid of[-1,"300000000",NaN]){const y=input();y.d.member.u.point=invalid;assert.throws(()=>draw(y));}
 const corrupt=input();corrupt.p.u.dollCharm="1";assert.throws(()=>draw(corrupt));
});
test("계정 삭제 전용 기록 제거·살아 있는 계정 유지·재가입 새ID",()=>{
 const x=input();draw(x);const state={index:x.idx,stores:[x.s],dirty:false};c.pruneDollDeletedAccounts(x.d,state);assert(!state.dirty);
 delete x.d.member.u;c.pruneDollDeletedAccounts(x.d,state);assert(state.dirty);assert(!x.s.users.u&&!x.idx.users.u);
 const y=input();let r=draw(y);assert.strictEqual(r.record.catches.D0001.count,1);
});
test("가이드 확률·비용·경험치·순위·매력와 이모지",()=>{
 const out=c.buildDollGuideMessage();assert(out.includes("이용권 1개 사용")&&!out.includes("포인트 사용")&&out.includes("순위")&&out.includes("퍼센트"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);assert.strictEqual(c.getDollEmoji("별빛 기사 호월이⚔️"),"⚔️");assert.strictEqual(c.getDollEmoji("갈색 곰🧸"),"🧸");
});
const branchStart=main.indexOf('        if (msg === "/인형전체초기화")'),branchEnd=main.indexOf('        if (msg === "/펫무쌍준비")',branchStart);
vm.runInContext("var dollCatalogCache=null;function runDollBranch(){"+main.slice(branchStart,branchEnd)+"}",c);
vm.runInContext("function recoverDollBranch(){"+block(main,'if (new java.io.File(resolveActiveDataPath(DATA_ROOT_PATH + "dollIndex.json")).exists())')+"}",c);
vm.runInContext(block(main,"function parseJsonContent("),c);
vm.runInContext(block(main,"function parseManagedJsonContent("),c);
const originalManagedBackup=c.getManagedJsonBackupPath;
c.getManagedJsonBackupPath=p=>/\/(dollIndex|dollPending|dollRecords_\d+)\.json$/.test(p)?null:originalManagedBackup(p);
c.getAttendanceKstDateKey=()=>"20261013";c.isGuildTerritoryWarCommandLockActive=()=>!!c.territoryLocked;c.buildAdventureLevelUpMessage=()=>"레벨업";c.noticeMsg=()=>{};
function install(dev=false){
 const base=dev?devRoot:root,x=input(1); const d=fixture.read(dev);d.member.u=JSON.parse(JSON.stringify(x.d.member.u));fixture.write(d,dev);
 const p=fixture.get(base+"member_pet.json");p.u={petexp:1};fixture.put(base+"member_pet.json",p);
 fixture.put(base+"dollCatalog.json",catalog);fixture.put(base+"dollIndex.json",{schemaVersion:1,users:{}});fixture.put(base+"dollPending.json",{pending:null});
 for(let i=0;i<16;i++)fixture.put(base+"dollRecords_"+i+".json",{schemaVersion:1,users:{}});
}
function run(command="/인형뽑기",dev=false,user="u"){
 fixture.clear();const ctx=c.createCommandContext(dev,"test"),prev=c.enterCommandContext(ctx),original=c.replier;
 c.beginDataSaveTransaction();c.ctx=ctx;c.msg=command;c.sender=user;c.petMusou={active:false};c.territoryLocked=false;c.dollCatalogCache=null;
 c.replier=c.createContextReplier(original,ctx);
 try{c.recoverDollBranch();c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.guildData={};c.runDollBranch();}
 catch(e){c.rollbackDataSaveTransaction();throw e;}
 finally{c.endDataSaveTransaction();c.exitCommandContext(prev);c.replier=original;}
 return fixture.replies().join("\n");
}
test("실제 명령 분기·네 파일 저장 후 출력·전송 실패도 소모 보존",()=>{
 install();const random=c.Math.random;c.Math.random=()=>0;
 try{const out=run();assert(out.includes("신규 등록"));assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],undefined);
 assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,2500);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
 assert(fixture.traces().findIndex(t=>t.type==="save")<fixture.traces().findIndex(t=>t.type==="reply"));
 install();fixture.replyFail(true);run();fixture.replyFail(false);assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,2500);assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],undefined);
 }finally{c.Math.random=random;fixture.replyFail(false);}
});
test("인형 실제 저장 각 단계 실패·복구 기록·재시도 단일 지급",()=>{
 const random=c.Math.random;c.Math.random=()=>0;
 try{for(const name of["dollRecords_"+c.getDollShard("u")+".json","dollIndex.json","member_pet.json","member.json"]){
 install();const before=fixture.read();fixture.failPath(root+name);assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);
 fixture.failPath("none");run("/인형도감");assert.deepStrictEqual(fixture.read(),before);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
 run();assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,2500);
 }}finally{c.Math.random=random;}
});
test("강제 중단 후 다음 요청 복구·파일 누락/손상 차단·DEV 분리",()=>{
 install();const names=["member.json","member_pet.json","dollIndex.json","dollRecords_"+c.getDollShard("u")+".json"];
 const before=fixture.read(),pending=names.map(name=>({name,text:fixture.raw(root+name)}));
 fixture.put(root+"dollPending.json",{pending});const changed=fixture.read();changed.member.u.point=1;fixture.write(changed);
 run("/인형도감");assert.deepStrictEqual(fixture.read(),before);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
 fixture.remove(root+"dollRecords_"+c.getDollShard("u")+".json");assert.throws(()=>run("/인형도감"));
 install();fixture.corrupt(root+"dollIndex.json");assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);
 install();install(true);const saved=fixture.read(),pet=fixture.get(root+"member_pet.json");const random=c.Math.random;c.Math.random=()=>0;
 try{run("/인형뽑기",true);assert.strictEqual(fixture.get(devRoot+"member_pet.json").u.dollCharm,2500);assert.deepStrictEqual(fixture.read(),saved);assert.deepStrictEqual(fixture.get(root+"member_pet.json"),pet);}finally{c.Math.random=random;}
});
test("프리미엄 이용권은 날짜별1개·만료 제외·기존 지급목록 유지",()=>{
 vm.runInContext(block(main,"function grantHoiPassPremiumDailyRewards("),c);
 c.getActiveSupportPassUsers=()=>["u"];c.getTodaySupportPassDateValue=()=>"20261013";
 const x=input(0);x.d.member.u.pass={premium:{enabled:true}};
 c.grantHoiPassPremiumDailyRewards(x.d);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],1);
 c.grantHoiPassPremiumDailyRewards(x.d);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],1);
 c.getTodaySupportPassDateValue=()=>"20261014";c.grantHoiPassPremiumDailyRewards(x.d);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],2);
 c.getActiveSupportPassUsers=()=>[];c.getTodaySupportPassDateValue=()=>"20261015";c.grantHoiPassPremiumDailyRewards(x.d);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],2);
});
test("도감과 순위는 읽기전용·대전중 인형명령 전부 차단",()=>{
 install();const snapshot=fixture.read();for(const msg of["/인형도감","/인형도감 일반1","/인형순위","/인형가이드"])run(msg);
 assert.deepStrictEqual(fixture.read(),snapshot);
 assert(!fixture.traces().some(t=>t.type==="save"));
 const ctx=c.createCommandContext(false,"test"),prev=c.enterCommandContext(ctx);
 try{c.ctx=ctx;c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.guildData={};c.sender="u";
 for(const active of["musou","territory","raid"]){c.petMusou={active:active==="musou"};c.territoryLocked=active==="territory";const original=c.isServerRaidLocked;c.isServerRaidLocked=()=>active==="raid";
 try{for(const msg of["/인형뽑기","/인형도감","/인형순위","/인형가이드"]){c.msg=msg;fixture.clear();c.runDollBranch();assert(fixture.replies().join("").includes("진행 중"));assert(!fixture.traces().some(t=>t.type==="save"));}}finally{c.isServerRaidLocked=original;}}
 }finally{c.exitCommandContext(prev);c.petMusou={active:false};c.territoryLocked=false;}
});
test("삭제 기록은 실제 회원 저장 트랜잭션에서 함께 반영·실패 원복",()=>{
 install();const x=input();draw(x);const shard=c.getDollShard("u");fixture.put(root+"dollRecords_"+shard+".json",JSON.parse(JSON.stringify(x.s)));fixture.put(root+"dollIndex.json",JSON.parse(JSON.stringify(x.idx)));
 const ctx=c.createCommandContext(false,"test"),prev=c.enterCommandContext(ctx);c.beginDataSaveTransaction();
 try{const d=c.loadJsonFile(c.filePath);delete d.member.u;const state={index:c.loadJsonFile(root+"dollIndex.json"),stores:[],snapshots:[],dirty:false};
 state.indexSnapshot=JSON.stringify(state.index);for(let i=0;i<16;i++){const st=c.loadJsonFile(root+"dollRecords_"+i+".json");state.stores.push(st);state.snapshots.push(JSON.stringify(st));}
 ctx.dollDeletion=state;c.pruneDollDeletedAccounts(d,state);fixture.failPath(c.filePath);assert.throws(()=>c.saveJsonFile(d,c.filePath));c.rollbackDataSaveTransaction();
 assert(fixture.get(root+"dollIndex.json").users.u);assert(fixture.get(root+"dollRecords_"+shard+".json").users.u);
 }finally{c.endDataSaveTransaction();c.exitCommandContext(prev);fixture.failPath("none");}
});
test("수집 1000종·도감 전체 매력1억·최대크기 동률 고정번호",()=>{
 const x=input();const rec={id:"all",catches:{}};for(const doll of catalog.dolls)rec.catches[doll.id]={count:1,max:doll.minTenths,first:"2026.10.13"};
 const out=c.buildDollCollectionMessage(x.d,x.p,{},cat,rec,"u",{grade:-1,page:0});assert(out.includes("1,000/1,000종 · 100.0%"));assert(out.includes("종매 +100,000,000"));assert(out.includes("캐슬 +50,000,000"));
 rec.catches.D0001.max=500;rec.catches.D0002.max=500;const rows=c.getDollCollectionRows(cat,rec,0);assert(rows.findIndex(r=>r.id==="D0001")<rows.findIndex(r=>r.id==="D0002"));
});
test("Info 복구 대기 시 부분 표시 차단·손상 복구 기록 오류 유지",()=>{
 install();const start=info.indexOf("// 인형 저장 복구 전"),end=info.indexOf("let data = loadJsonFile(filePath);",start);assert(start>0&&end>start);
 vm.runInContext("function probeDollInfo(){"+info.slice(start,end)+"return 'ready';}",c);
 assert.strictEqual(c.probeDollInfo(),"ready");fixture.put(root+"dollPending.json",{pending:[]});assert.strictEqual(c.probeDollInfo(),undefined);
 fixture.put(root+"dollPending.json",{});assert.throws(()=>c.probeDollInfo());
});
test("특수 이름 저장·복구 마지막 표시 저장 실패·일반 명령 접미 무저장",()=>{
 const x=input(),user="__proto__";Object.defineProperty(x.d.member,user,{value:x.d.member.u,enumerable:true});Object.defineProperty(x.p,user,{value:{petexp:1},enumerable:true});
 const r=c.applyDollDraw(x.d,x.p,cat,x.s,x.idx,user,"special-id","2026.10.13",()=>0);assert(r.fresh);assert(Object.prototype.hasOwnProperty.call(x.s.users,user));assert(JSON.stringify(x.s).includes("__proto__"));
 install();const before=fixture.read(),random=c.Math.random;c.Math.random=()=>0;
 try{fixture.failNth(root+"dollPending.json",2);assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);fixture.failPath("none");run("/인형도감");assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
 for(const command of["/인형뽑기 2","/인형뽑기 1 해봐"]){run(command);assert(!fixture.traces().some(t=>t.type==="save"));assert.deepStrictEqual(fixture.read(),before);}
 }finally{c.Math.random=random;}
});

test("성공 확률 직전·정확한 경계와 최저/최고 크기",()=>{
 for(const [tier,percent] of [["새싹",5],["킹",15],["호월신",55]]){
  const x=input();x.d.member.u.rank.tier=tier;assert(draw(x,[(percent-0.0001)/100,0,0,0,0]).success);
  const y=input();y.d.member.u.rank.tier=tier;assert(!draw(y,[percent/100]).success);
 }
 const small=input(),large=input();assert.strictEqual(draw(small,[0,0,0,0,0]).length,cat.dolls[0].minTenths);
 assert.strictEqual(draw(large,[0,0,0,0.999,0.999999]).length,cat.dolls[0].maxTenths);
});
test("손상 티켓·매력 정수 상한·손상 도감은 저장 전 차단",()=>{
 const random=c.Math.random;c.Math.random=()=>0;
 try{
  for(const invalid of [-1,0.5,"1",null,9007199254740992]){
   install();const d=fixture.read();d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=invalid;fixture.write(d);
   const before=fixture.read();assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==="save"));
  }
  install();const p=fixture.get(root+"member_pet.json");p.u.dollCharm=9007199254740991;fixture.put(root+"member_pet.json",p);
  const before=fixture.read();assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==="save"));
  install();const bad=JSON.parse(JSON.stringify(catalog));bad.dolls[0].id="D9999";fixture.put(root+"dollCatalog.json",bad);
  const snapshot=fixture.read();assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),snapshot);assert(!fixture.traces().some(t=>t.type==="save"));
 }finally{c.Math.random=random;}
});
test("복구 목록 전체 검사 후 쓰기·잘못된 경로/JSON 차단",()=>{
 for(const bad of [{name:"../member.json",text:"{}"},{name:"dollRecords_16.json",text:"{}"},{name:"member.json",text:"{"}]){
  install();const before=fixture.read();fixture.put(root+"dollPending.json",{pending:[{name:"member.json",text:JSON.stringify({member:{}})},bad]});
  assert.throws(()=>run("/인형도감"));assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==="save"));
 }
});
test("운영 백업과 동일한 초기 파일 19개 누락·무저장·설치 후 실행",()=>{
 vm.runInContext(block(main,"function loadJsonFile(").replace("function loadJsonFile(","function loadDollCatalogActual("),c);
 const original=c.loadJsonFile;c.loadJsonFile=p=>p===root+"dollCatalog.json"?c.loadDollCatalogActual(p):original(p);
 try{
 install();for(const name of ["dollCatalog.json","dollIndex.json","dollPending.json",...Array.from({length:16},(_,i)=>"dollRecords_"+i+".json")])fixture.remove(root+name);
 const before=fixture.read();for(const msg of ["/인형뽑기","/인형도감"]){assert.throws(()=>run(msg),/인형 고정 목록 파일 누락.*19개/);assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==="save"));}
 install();assert(run("/인형도감").includes("인형도감"));const random=c.Math.random;c.Math.random=()=>0;
 try{assert(run().includes("신규 등록"));}finally{c.Math.random=random;}
 }finally{c.loadJsonFile=original;}
});
console.log("인형 규칙·UI·실제 저장 "+groups+"개 그룹 통과");
