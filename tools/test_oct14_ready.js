const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
const old=fs.readFileSync(path.join(__dirname,"test_doll_content.js"),"utf8");
const {c,fixture,block,input,draw,install,run,cat,root,devRoot}=new Function("require","__dirname",old+"\nreturn {c,fixture,block,input,draw,install,run,cat,root,devRoot};")(require,__dirname);
for(const name of ["addItem","getSupportPassConfigs","getSupportPassConfigByCommandName","ensureSupportPassStore","parseSupportPassCommandMeta","getSupportPassDateValue","isValidSupportPassDateText","isSupportPassActive","getActiveSupportPassUsers","grantSupportPassDailyRewards","grantDollPassDailyRewards","grantAllSupportPassDailyRewards","buildSupportPassPayoutResultMessage","appendTerritoryPassPayoutLogs","buildSupportPassSaveCheckMessage","processUserIDCommand","isDollTestRoomCommand","buildUserSupportPassLines","formatSupportPassStatus","isGuildTerritoryAllowedDuringWarCommand","isGuildTerritoryRiftControlCommandMessage","isServerRaidAdditionalCommand","isPetMusouAllowedDuringTournamentCommand","isAutoDailyQuestRunComplete","getDailyQuestStatus","runAutoDailyQuestCommands","buildBattleExperienceRewardMessage"])
 vm.runInContext(block(main,"function "+name+"("),c);
let day=20261014;c.getTodaySupportPassDateValue=()=>day;let groups=0;
function test(name,fn){fixture.reset();day=20261014;fn();console.log("PASS OCT14 "+(++groups)+": "+name);}
function seedReset(dev=false){install(dev);const x=input();draw(x);const base=dev?devRoot:root;
 const d=fixture.read(dev);d.member.u.pass={doll:{enabled:true,permanent:true,dailyRewardLastDate:"20261014"}};d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=9;fixture.write(d,dev);
 const p=fixture.get(base+"member_pet.json");p.u.dollCharm=2525;p.u.other="preserve";fixture.put(base+"member_pet.json",p);
 fixture.put(base+"dollIndex.json",JSON.parse(JSON.stringify(x.idx)));fixture.put(base+"dollRecords_"+c.getDollShard("u")+".json",JSON.parse(JSON.stringify(x.s)));
}
test("MASTER 초기화·도감/순위/매력 삭제·구독/재화/경험치 보존",()=>{
 seedReset();const member=fixture.read(),catalog=fixture.raw(root+"dollCatalog.json");
 const out=run("/인형전체초기화",false,"master");assert(out.includes("초기화 완료"));assert.deepStrictEqual(fixture.read(),member);
 assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,undefined);assert.strictEqual(fixture.get(root+"member_pet.json").u.other,"preserve");
 assert.deepStrictEqual(fixture.get(root+"dollIndex.json").users,{});for(let i=0;i<16;i++)assert.deepStrictEqual(fixture.get(root+"dollRecords_"+i+".json").users,{});
 assert.strictEqual(fixture.raw(root+"dollCatalog.json"),catalog);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
 assert(run("/인형전체초기화",false,"master").includes("0명"));
});
test("일반 사용자·Admin 초기화 거부·접미 미실행",()=>{
 for(const user of ["u","admin"]){seedReset();const p=fixture.get(root+"member_pet.json");assert(run("/인형전체초기화",false,user).includes("MASTER"));assert.deepStrictEqual(fixture.get(root+"member_pet.json"),p);assert(!fixture.traces().some(t=>t.type==="save"));}
 seedReset();run("/인형전체초기화 확인");assert(!fixture.traces().some(t=>t.type==="save"));
});
test("초기화 모든 파일 저장 실패 원복·재시작 복구·DEV 분리",()=>{
 for(const name of ["dollIndex.json",...Array.from({length:16},(_,i)=>"dollRecords_"+i+".json"),"member_pet.json"]){seedReset();const member=fixture.read(),p=fixture.get(root+"member_pet.json"),index=fixture.get(root+"dollIndex.json");fixture.failPath(root+name);assert.throws(()=>run("/인형전체초기화",false,"master"));assert.deepStrictEqual(fixture.read(),member);assert.deepStrictEqual(fixture.get(root+"member_pet.json"),p);assert.deepStrictEqual(fixture.get(root+"dollIndex.json"),index);fixture.failPath("none");run("/인형도감");assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);}
 seedReset();seedReset(true);const p=fixture.get(root+"member_pet.json"),index=fixture.get(root+"dollIndex.json");run("/인형전체초기화",true,"master");assert.deepStrictEqual(fixture.get(root+"member_pet.json"),p);assert.deepStrictEqual(fixture.get(root+"dollIndex.json"),index);assert.strictEqual(fixture.get(devRoot+"member_pet.json").u.dollCharm,undefined);
});
test("인형패스 기간·영구권·조회·만료·연장/삭제재추가 중복 방지",()=>{
 const d={member:{"공백 이름":{bag:{}}}};const user="공백 이름",ticket=c.GLOBAL_CONFIG.doll.ticketName;
 assert(!c.processUserIDCommand("/인형패스추가, 공백 이름 26.10.14",d,"호이 남").startsWith("❌"));assert(c.isSupportPassActive(d,user,"doll"));
 assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,1);assert.strictEqual(d.member[user].bag[ticket],3);assert.strictEqual(c.grantDollPassDailyRewards(d).skippedUserCount,1);
 c.processUserIDCommand("/인형패스추가, 공백 이름 영구권",d,"호이 남");assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,0);
 c.processUserIDCommand("/인형패스삭제, 공백 이름",d,"호이 남");c.processUserIDCommand("/인형패스추가, 공백 이름 영구권",d,"호이 남");assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,0);assert.strictEqual(d.member[user].bag[ticket],3);
 assert(c.buildUserSupportPassLines(d,user).join("\n").includes("인형뽑기패스"));day=20261015;assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,1);assert.strictEqual(d.member[user].bag[ticket],6);
 c.processUserIDCommand("/인형패스추가, 공백 이름 26.10.14",d,"호이 남");assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,0);
 const before=JSON.stringify(d);for(const msg of ["/인형패스추가, 공백 이름 26.02.30","/인형패스추가, 공백 이름","/인형패스추가, 없는 사람 영구권"]){assert(c.processUserIDCommand(msg,d,"호이 남").startsWith("❌"));assert.strictEqual(JSON.stringify(d),before);}
});
test("인형패스 손상·정수 초과 차단·패스 명령도 테스트방 대상",()=>{
 const t=c.GLOBAL_CONFIG.doll.ticketName;for(const count of [-1,0.1,"1",9007199254740989]){const d={member:{u:{pass:{doll:{enabled:true,permanent:true}},bag:{[t]:count}}}};const before=JSON.stringify(d);assert.throws(()=>c.grantDollPassDailyRewards(d));assert.strictEqual(JSON.stringify(d),before);}
 assert(c.isDollTestRoomCommand("/인형패스추가, u 영구권"));assert(c.isDollTestRoomCommand("/인형패스삭제, u"));
});
test("글자수전체정리의 세 대전 허용·정확한 명령 경계",()=>{
 for(const n of ["isGuildTerritoryAllowedDuringWarCommand","isServerRaidAdditionalCommand","isPetMusouAllowedDuringTournamentCommand"]){assert(c[n]("/글자수전체정리"));assert(!c[n]("/글자수전체정리 실행"));}
});
test("일퀘 5회·콘텐츠 10회·자동 15회 경계·기존 초과 기록 보존",()=>{
 for(const n of ["trialTowerMax","castleBattleMax","miniPetBattleMax"])assert.strictEqual(c.GLOBAL_CONFIG.daily[n],10);assert.strictEqual(c.GLOBAL_CONFIG.daily.autoDailyBonusRuns,5);
 for(const count of [9,10,14,15,20]){const d={member:{u:{towerCnt:count,battle:{count}}}},p={u:{miniPetBattle:{count}}};const before=JSON.stringify([d,p]);assert.strictEqual(c.isAutoDailyQuestRunComplete(d,p,"u"),count>=15);assert.strictEqual(JSON.stringify([d,p]),before);}
 const oldLoad=c.loadJsonFile;c.loadJsonFile=()=>({record:{}});c.petExplorePath="synthetic";c.initPetExploreData=d=>d;c.cleanupInvalidPetExploreUsers=()=>{};c.savePetExploreMigrationIfNeeded=()=>{};c.getPetExploreRank=()=>null;c.hasActiveHoiOrNewbiePass=()=>false;c.isHoiPassPremiumActive=()=>false;
 try{for(const count of [4,5,9,10,20]){const d={member:{u:{towerCnt:count,battle:{count},exploreCnt:10}}},p={u:{miniPetBattle:{count}}};const s=c.getDailyQuestStatus(d,p,{},"u");assert.strictEqual(s.isComplete,count>=5);assert.strictEqual(s.towerMax,10);assert.strictEqual(d.member.u.towerCnt,count);}}finally{c.loadJsonFile=oldLoad;}
});
test("실제 자동 반복은 남은 15회까지만 실행·진행 실패 중단",()=>{
 let count=9,calls=0;c.getAutoDailyQuestSnapshot=()=>({status:{towerUsed:count,towerMax:10}});c.runAutoDailyInternalCommand=()=>{calls++;count++;return[];};c.getLastAutoDailyBlockedMessage=()=>"";c.buildAutoDailyBlockedFallbackMessage=()=>"중단";
 c.runAutoDailyQuestCommands("test","u",true,null,"com.kakao.talk","/시탑","towerUsed","towerMax");assert.strictEqual(calls,6);assert.strictEqual(count,15);
 c.runAutoDailyQuestCommands("test","u",true,null,"com.kakao.talk","/시탑","towerUsed","towerMax");assert.strictEqual(calls,6);
 count=10;c.runAutoDailyInternalCommand=()=>{calls++;return[];};c.runAutoDailyQuestCommands("test","u",true,null,"com.kakao.talk","/시탑","towerUsed","towerMax");assert.strictEqual(calls,7);
});
test("실제 승패 경험치 분기는 승리 100·패배 25·티어와 가호 순서 유지",()=>{
 for(const [flag,key,result] of [["isWinFlag","castle","castleTierExpResult"],["isWin","mini","miniTierExpResult"]]){
  const marker="let expGain = "+flag+" ? GLOBAL_CONFIG.daily."+(key==="castle"?"castleBattleExperience":"miniPetBattleExperience");const at=main.indexOf(marker),end=main.indexOf("// ",at);assert(at>0&&end>at);
  vm.runInContext("function probe"+key+"(data,sender,"+flag+"){"+main.slice(at,end)+"return "+result+";}",c);
  for(const win of [true,false]){const x=input();const r=c["probe"+key](x.d,"u",win);assert.strictEqual(r.base,win?100:25);assert.strictEqual(r.total,(r.base+15)*3);assert.strictEqual(r.boosterResult.usedBooster,(r.base+15)*2);}
 }
});

test("포인트만으로 진행 불가·부족 무소모·잔액 분리·알림 등급",()=>{
 for(const roll of [0,0.999]){const x=input(0,1000000000);const r=draw(x,[roll,0,0,0,0]);assert(!r.ok);assert.strictEqual(x.d.member.u.point,1000000000);const out=c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r);assert(out.includes("이용권이 부족해요"));}
 const x=input(0,999999999),before=JSON.stringify(x);assert(!draw(x).ok);assert.strictEqual(JSON.stringify(x),before);
 assert.strictEqual(c.GLOBAL_CONFIG.doll.broadcastMinGrade,6);let notices=[];c.noticeMsg=m=>notices.push(m);const random=c.Math.random;
 try{for(const [roll,expected] of [[0.75,0],[0.9,0],[0.95,0],[0.975,1],[0.99,1],[0.998,1]]){install();notices=[];let n=0;c.Math.random=()=>[0,roll,0,0,0][n++];run();assert.strictEqual(notices.length,expected);if(expected){assert(notices[0].includes("cm"));for(const cmd of ["/인형뽑기","/인형도감","/인형순위","/인형가이드"])assert(!notices[0].includes(cmd));}}}finally{c.Math.random=random;}
});
test("글자수통계 인형 19개·누락/손상·읽기 전용",()=>{
 const start=main.indexOf('out += "\\n[인형 데이터]'),end=main.indexOf('out += "\\n[칭호·성장 데이터]',start);assert(start>0&&end>start);
 vm.runInContext('function dollStatsProbe(){var out="";'+main.slice(start,end)+'return out;}',c);install();const before=fixture.read();const out=c.dollStatsProbe();assert(out.includes("1,000종"));assert(out.includes("dollRecords_15.json"));assert.deepStrictEqual(fixture.read(),before);
 fixture.remove(root+"dollRecords_15.json");assert(c.dollStatsProbe().includes("❌ 파일 없음"));fixture.corrupt(root+"dollIndex.json");assert.throws(()=>c.dollStatsProbe());
});
test("초기화 마지막 복구 표시 실패·복구 후 매력과 구독 보존",()=>{
 seedReset();const member=fixture.read(),pet=fixture.get(root+"member_pet.json");fixture.failNth(root+"dollPending.json",2);assert.throws(()=>run("/인형전체초기화",false,"master"));assert.deepStrictEqual(fixture.get(root+"member_pet.json"),pet);fixture.failPath("none");run("/인형도감");assert.deepStrictEqual(fixture.read(),member);assert.deepStrictEqual(fixture.get(root+"member_pet.json"),pet);
});

test("실제 패스 관리 분기 권한·저장·실패 원복",()=>{
 vm.runInContext('function passCommandProbe(){'+block(main,'if (sender == "호이 남" && (/^\\/인형패스')+'}',c);
 function command(user,msg){const ctx=c.createCommandContext(false,"test"),prev=c.enterCommandContext(ctx);c.beginDataSaveTransaction();c.sender=user;c.msg=msg;c.data=c.loadJsonFile(c.filePath);try{c.passCommandProbe();}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(prev);}}
 install();const before=fixture.read();command("admin","/인형패스추가, u 영구권");assert.deepStrictEqual(fixture.read(),before);
 command("호이 남","/인형패스추가, u 영구권");assert(fixture.read().member.u.pass.doll.permanent);
 const saved=fixture.read();fixture.failPath(c.filePath);assert.throws(()=>command("호이 남","/인형패스삭제, u"));assert.deepStrictEqual(fixture.read(),saved);fixture.failPath("none");command("호이 남","/인형패스삭제, u");assert(!fixture.read().member.u.pass.doll.enabled);
});
test("실제 자동출첵 지급·프리미엄1+인형3·반복/리셋 중복 없음",()=>{
 vm.runInContext('function payoutCommandProbe(){'+block(main,'if (msg === "/자동출첵")')+'}',c);c.appendPetMusouAutomationLog=()=>{};
 function pay(user){const ctx=c.createCommandContext(false,"test"),prev=c.enterCommandContext(ctx);c.beginDataSaveTransaction();c.sender=user;c.msg="/자동출첵";c.data=c.loadJsonFile(c.filePath);try{c.payoutCommandProbe();}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(prev);}}
 install();const d=fixture.read();d.member.u.pass={doll:{enabled:true,permanent:true},premium:{enabled:true,permanent:true}};d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=0;fixture.write(d);
 pay("u");assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],0);pay("master");assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],4);pay("master");assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],4);
 const reset=fixture.read();reset.member.u.today=0;fixture.write(reset);pay("master");assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],4);
 day=20261015;const before=fixture.read();fixture.failPath(c.filePath);assert.throws(()=>pay("master"));assert.deepStrictEqual(fixture.read(),before);fixture.failPath("none");pay("master");assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],8);
});

test("초기화 파일 누락/손상은 쓰기 전 차단·복구 기록도 보존",()=>{
 for(const mode of ["missing","corrupt"]){for(const name of ["dollIndex.json","dollRecords_15.json","member_pet.json"]){fixture.reset();seedReset();const member=fixture.read(),pending=fixture.raw(root+"dollPending.json");if(mode==="missing")fixture.remove(root+name);else fixture.corrupt(root+name);assert.throws(()=>run("/인형전체초기화",false,"master"));assert.deepStrictEqual(fixture.read(),member);assert.strictEqual(fixture.raw(root+"dollPending.json"),pending);assert(!fixture.traces().some(t=>t.type==="save"));}}
});
test("초기화 강제 중단 뒤 18개 원문 복구·성공 전송 실패 보존",()=>{
 seedReset();const names=["member_pet.json","dollIndex.json",...Array.from({length:16},(_,i)=>"dollRecords_"+i+".json")];const snapshots=names.map(name=>({name,text:fixture.raw(root+name)}));const member=fixture.read();fixture.put(root+"dollPending.json",{pending:snapshots});fixture.put(root+"dollIndex.json",{schemaVersion:1,users:{}});const pet=fixture.get(root+"member_pet.json");delete pet.u.dollCharm;fixture.put(root+"member_pet.json",pet);
 run("/인형도감");for(const snap of snapshots)assert.deepStrictEqual(fixture.get(root+snap.name),JSON.parse(snap.text));assert.deepStrictEqual(fixture.read(),member);
 seedReset();const kept=fixture.read();fixture.replyFail(true);try{run("/인형전체초기화",false,"master");}finally{fixture.replyFail(false);}assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,undefined);assert.deepStrictEqual(fixture.read(),kept);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
});
test("MASTER도 대전 중 초기화 금지·첫 복구 표시 저장 실패 원복",()=>{
 for(const active of ["musou","raid","territory"]){seedReset();const ctx=c.createCommandContext(false,"test"),prev=c.enterCommandContext(ctx);const original=c.isServerRaidLocked;c.beginDataSaveTransaction();try{c.msg="/인형전체초기화";c.sender="master";c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.guildData={};c.petMusou={active:active==="musou"};c.territoryLocked=active==="territory";c.isServerRaidLocked=()=>active==="raid";fixture.clear();const before=fixture.get(root+"member_pet.json");c.runDollBranch();assert(fixture.replies().join("").includes("진행 중"));assert.deepStrictEqual(fixture.get(root+"member_pet.json"),before);assert(!fixture.traces().some(t=>t.type==="save"));}finally{c.isServerRaidLocked=original;c.petMusou={active:false};c.territoryLocked=false;c.endDataSaveTransaction();c.exitCommandContext(prev);}}
 seedReset();const p=fixture.get(root+"member_pet.json");fixture.failNth(root+"dollPending.json",1);assert.throws(()=>run("/인형전체초기화",false,"master"));assert.deepStrictEqual(fixture.get(root+"member_pet.json"),p);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);fixture.failPath("none");
});
test("패스 만료일 당일/다음날·손상 날짜·다중 계정 사전 검증",()=>{
 const ticket=c.GLOBAL_CONFIG.doll.ticketName;const d={member:{u:{bag:{},pass:{doll:{enabled:true,endDate:"26.10.14"}}}}};assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,1);day=20261015;assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,0);assert.strictEqual(d.member.u.bag[ticket],3);
 const bad={member:{a:{pass:{doll:{enabled:true,permanent:true}},bag:{}},b:{pass:{doll:{enabled:true,permanent:true}},bag:{[ticket]:9007199254740990}}}};const before=JSON.stringify(bad);assert.throws(()=>c.grantDollPassDailyRewards(bad));assert.strictEqual(JSON.stringify(bad),before);
 d.member.u.pass.doll.endDate="26.02.30";const corrupt=JSON.stringify(d);assert.throws(()=>c.grantDollPassDailyRewards(d),/종료일/);assert.strictEqual(JSON.stringify(d),corrupt);
});
test("KST 자정 지급 날짜 경계·인형패스 가방 누락과 안전 정수 최대",()=>{
 for(const [instant,key] of [["2026-10-14T14:59:59.999Z",20261014],["2026-10-14T15:00:00.000Z",20261015]]){class AtTime extends Date{constructor(...args){super(...(args.length?args:[Date.parse(instant)]));}}const ctx=vm.createContext({Date:AtTime});vm.runInContext(block(main,"function getTodaySupportPassDateValue("),ctx);assert.strictEqual(ctx.getTodaySupportPassDateValue(),key);}
 const ticket=c.GLOBAL_CONFIG.doll.ticketName,d={member:{u:{pass:{doll:{enabled:true,permanent:true}}}}};c.grantDollPassDailyRewards(d);assert.strictEqual(d.member.u.bag[ticket],3);const edge={member:{u:{pass:{doll:{enabled:true,permanent:true}},bag:{[ticket]:9007199254740988}}}};c.grantDollPassDailyRewards(edge);assert.strictEqual(edge.member.u.bag[ticket],9007199254740991);assert.strictEqual(c.grantDollPassDailyRewards(edge).grantedUserCount,0);
});
test("초기화 완료 후 응답과 디버그 로그 전송 모두 실패해도 초기화 보존",()=>{
 seedReset();const member=fixture.read(),original=c.debuggerLog;fixture.replyFail(true);c.debuggerLog=()=>{throw Error("log transport failure");};
 try{assert.doesNotThrow(()=>run("/인형전체초기화",false,"master"));}finally{fixture.replyFail(false);c.debuggerLog=original;}
 assert.deepStrictEqual(fixture.read(),member);assert.strictEqual(fixture.get(root+"member_pet.json").u.dollCharm,undefined);assert.strictEqual(fixture.get(root+"dollPending.json").pending,null);
});
console.log("OCT14 확정 정책 "+groups+"개 그룹 통과");
