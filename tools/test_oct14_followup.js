const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8"),info=fs.readFileSync(path.join(__dirname,"..","Info.js"),"utf8");
const old=fs.readFileSync(path.join(__dirname,"test_oct14_ready.js"),"utf8");
const {c,fixture,block,input,draw,cat}=new Function("require","__dirname",old+"\nreturn {c,fixture,block,input,draw,cat};")(require,__dirname);
let groups=0;function test(name,fn){fn();console.log("PASS FOLLOWUP "+(++groups)+": "+name);}
for(const n of ["claimQuestReward","getDailyQuestStatus","buildDailyQuestInfoMessage","getWeeklyQuestRemainText","buildQuestExperienceRewardMessage","getPetSkillSlotCount","buildTierPromotionSuccessMessage","formatTicketTierLabel","getTierExploreBonusPercentByName"])vm.runInContext(block(main,"function "+n+"("),c);
c.buildAdventureBoosterDepletionMessage=()=>"";c.getC=x=>x?"✅":"❌";c.hasPetSkill=()=>false;
c.initPetExploreData=d=>d;c.cleanupInvalidPetExploreUsers=()=>{};c.savePetExploreMigrationIfNeeded=()=>{};c.getPetExploreRank=()=>null;c.hasActiveHoiOrNewbiePass=()=>false;c.isHoiPassPremiumActive=()=>false;
function prepare(count=5){const x=input();Object.assign(x.d.member.u,{towerCnt:count,battle:{count},exploreCnt:10,weeklyQuestCnt:0,dailyQuestCnt:0});x.p.u.miniPetBattle={count};return x;}
const originalLoad=c.loadJsonFile;c.loadJsonFile=()=>({record:{}});
test("4/5회 경계·탐험 미완료·일반5/자동10와 기존 카운트 유지",()=>{
 for(const count of [0,4,5,10,15,20]){const x=prepare(count),before=JSON.stringify(x);const s=c.getDailyQuestStatus(x.d,x.p,{},"u");assert.strictEqual(s.isComplete,count>=5);assert.strictEqual(s.towerMax,5);assert.strictEqual(s.towerGoal,5);assert.strictEqual(JSON.stringify(x),before);const out=c.buildDailyQuestInfoMessage(x.d,x.p,{},"u");assert(out.includes("시련탑😈["+count+"/5]"));assert(out.includes(c.GLOBAL_CONFIG.doll.ticketName+" 1개"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);}
 const x=prepare();x.d.member.u.exploreCnt=9;assert(!c.getDailyQuestStatus(x.d,x.p,{},"u").isComplete);
});
test("일퀘 이용권 실제 1개 지급·중복청구 무지급·미완료 무소모·주퀘 병행",()=>{
 for(const weekly of [0,6]){const x=prepare();x.d.member.u.weeklyQuestCnt=weekly;const first=c.claimQuestReward(x.d,x.p,{}, {},"u");assert(first.dailyClaimed);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],2);assert(first.message.includes(c.GLOBAL_CONFIG.doll.ticketName+" 1개"));assert(first.message.indexOf("펫 강화석⭐ 30개")<first.message.indexOf(c.GLOBAL_CONFIG.doll.ticketName));const before=JSON.stringify(x);assert(!c.claimQuestReward(x.d,x.p,{}, {},"u").claimed);assert.strictEqual(JSON.stringify(x),before);assert.strictEqual(x.d.member.u.weeklyQuestCnt,weekly===6?0:1);}
 const x=prepare(4),before=JSON.stringify(x);assert(!c.claimQuestReward(x.d,x.p,{}, {},"u").claimed);assert.strictEqual(JSON.stringify(x),before);
 for(const count of [-1,"1",1.5,Number.MAX_SAFE_INTEGER]){const x=prepare();x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=count;const before=JSON.stringify(x);assert.throws(()=>c.claimQuestReward(x.d,x.p,{}, {},"u"));assert.strictEqual(JSON.stringify(x),before);}
});
test("Info 안내/판정도 5회·보상 1개·기존 전체보기 유지",()=>{
 const ic={};for(let i=1;i<=100;i++)ic["room"+i]="room"+i;vm.createContext(ic);vm.runInContext(block(info,"const GLOBAL_CONFIG = {").replace("const ","var "),ic);
 Object.assign(ic,{loadJsonFile:()=>({record:{}}),petExplorePath:"synthetic",initPetExploreData:d=>d,getPetExploreRank:()=>null,hasInfoBasePass:()=>false,isInfoSupportPassActive:()=>false,checkRank:()=>"u",getC:c.getC,allsee:"<ALLSEE>"});
 for(const n of ["getDailyQuestStatus","buildDailyQuestInfoMessage"])vm.runInContext(block(info,"function "+n+"("),ic);
 for(const count of [4,5,15]){const x=prepare(count);assert.strictEqual(ic.getDailyQuestStatus(x.d,x.p,{},"u").isComplete,count>=5);const out=ic.buildDailyQuestInfoMessage(x.d,x.p,{},"u");assert(out.includes("시련탑😈["+count+"/5]"));assert(out.includes(c.GLOBAL_CONFIG.doll.ticketName+" 1개"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);}
});
c.loadJsonFile=originalLoad;
test("Main/Info 학개론 실제 슬롯 40/43·친밀도 경계·해제·프리미엄 +7",()=>{
 for(const source of [main,info]){vm.runInContext(source.match(/const PET_SKILL_MAX_EQUIP_SLOT = \d+;/)[0].replace("const ","var "),c);vm.runInContext(block(source,"function getPetSkillSlotCount("),c);let level=0,intro=false,premium=false;c.getUserIntimacyInfo=()=>({level});c.hasPetSkill=()=>intro;c.isHoiPassPremiumActive=()=>premium;
 c.isInfoSupportPassActive=()=>premium;
 for(const n of [0,99,100,3999,4000,5000])for(const enabled of [false,true])for(const paid of [false,true]){level=n;intro=enabled;premium=paid;assert.strictEqual(c.getPetSkillSlotCount({}, {},"u"),Math.min(Math.floor(n/100),40)+(enabled?3:0)+(paid?7:0));}
 }
 assert(main.includes("최대수치 40개가 되면 43개로 확장됩니다."));
});
test("승급 9단계13%·10단계14%·최고티어55%·변화 안내 제거",()=>{
 const tiers=vm.runInContext("Object.keys(ticketTierData)",c);for(const [at,pct] of [[8,13],[9,14],[50,55]]){const out=c.buildTierPromotionSuccessMessage({},"실제 닉네임",{newTierName:tiers[at],bonus:900});assert(out.includes("[실제 닉네임] 님\n━━━━━━━━━━━━━━━"));assert(out.includes("💞 매력 보상: +900"));assert(out.includes("🧸 인형 성공확률 보너스: "+pct+"% 적용"));assert(!out.includes("% →"));assert(out.includes("📋 승급 준비 확인: /티어"));assert.strictEqual(out.includes("🎯 다음 목표"),at<50);}
});
test("이용권 없음·고액 포인트라도 RNG/기록/재화 무변경·기존 중복 판매 유지",()=>{
 for(const point of [0,1000000000,Number.MAX_SAFE_INTEGER]){const x=input(0,point),before=JSON.stringify(x);const r=c.applyDollDraw(x.d,x.p,cat,x.s,x.idx,"u","id","20261014",()=>{throw Error("must not draw");});assert(!r.ok&&r.lack);assert.strictEqual(JSON.stringify(x),before);const out=c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r);assert(!out.includes("포인트가 부족"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);}
 const x=input(2,0);draw(x);const r=draw(x);assert(r.sale>0);assert.strictEqual(x.d.member.u.point,r.sale);assert(!c.buildDollGuideMessage().includes("자동 사용"));
});
const harness=fs.readFileSync(path.join(__dirname,"test_server_raid.js"),"utf8");
const raid=new Function("require","__dirname",harness.slice(0,harness.indexOf('\ngroup("'))+`\nreturn {c,run,tick,read,write,reset:()=>{reset();c.GLOBAL_CONFIG.serverRaid=clone(ticketConfig);},now:()=>now,traces:()=>traces,pending:()=>timers.size};`)(require,__dirname);
test("레이드 준비 예정/활성 확정시각 일치·30분 자동종료·종료 공지",()=>{
 raid.reset();raid.run("/서버대전시작","master");let d=raid.read(),r=d.serverRaid.current;const text=raid.c.buildServerRaidCurrentStatus(d,"a",raid.now());assert(text.includes(raid.c.formatServerRaidKstTime(r.prepareUntil+r.durationMs)));raid.tick(1);raid.tick(60000);d=raid.read();r=d.serverRaid.current;assert.strictEqual(r.autoEndAt,r.startedAt+1800000);assert(raid.c.buildServerRaidCurrentStatus(d,"a",raid.now()).includes(raid.c.formatServerRaidKstTime(r.autoEndAt)));raid.tick(r.autoEndAt-raid.now());assert.strictEqual(raid.read().serverRaid.current,null);assert(raid.traces().some(t=>t.type==="notice"&&t.text.includes("종료")));
});
test("공지+로그 동시 예외에도 준비/자동종료/정산 이어짐·복구 후 공지 재전송",()=>{
 raid.reset();raid.run("/서버대전시작","master");const notice=raid.c.noticeMsg,log=raid.c.debuggerLog;raid.c.noticeMsg=()=>{throw Error("transport");};raid.c.debuggerLog=()=>{throw Error("log transport");};
 try{raid.tick(1);assert(raid.pending()>0);raid.tick(60000);const r=raid.read().serverRaid.current;assert.strictEqual(r.state,"ACTIVE");raid.tick(r.autoEndAt-raid.now());assert.strictEqual(raid.read().serverRaid.current,null);assert(raid.pending()>0);}finally{raid.c.noticeMsg=notice;raid.c.debuggerLog=log;}
 raid.tick(2000);assert(raid.traces().some(t=>t.type==="notice"&&t.text.includes("종료")));assert.strictEqual(raid.pending(),0);
});
test("레이드 데이터 읽기/로그 예외에도 재예약·DEV 자동종료 운영 데이터 보존",()=>{
 raid.reset();raid.run("/서버대전시작","master");const load=raid.c.loadJsonFile,log=raid.c.debuggerLog;raid.c.loadJsonFile=()=>{throw Error("read failure");};raid.c.debuggerLog=()=>{throw Error("log failure");};
 try{raid.tick(1);assert(raid.pending()>0);}finally{raid.c.loadJsonFile=load;raid.c.debuggerLog=log;}
 raid.tick(60000);assert.strictEqual(raid.read().serverRaid.current.state,"ACTIVE");
 raid.reset();raid.run("dev/서버대전시작","master");const prod=JSON.stringify(raid.read());raid.tick(1);raid.tick(60000);const r=raid.read(true).serverRaid.current;raid.tick(r.autoEndAt-raid.now());assert.strictEqual(raid.read(true).serverRaid.current,null);assert.strictEqual(JSON.stringify(raid.read()),prod);
});
console.log("OCT14 followup "+groups+" groups passed");
