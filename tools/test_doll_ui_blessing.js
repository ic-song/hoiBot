const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm"),cp=require("child_process");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
const base=fs.readFileSync(path.join(__dirname,"test_doll_content.js"),"utf8");
const {c,fixture,block,input,draw,cat,install,run}=new Function("require","__dirname",base+"\nreturn {c,fixture,block,input,draw,cat,install,run};")(require,__dirname);
let groups=0;function test(name,fn){fixture.reset();fn();console.log("PASS DOLL UI "+(++groups)+": "+name);}
function output(x,r){const before=JSON.stringify(x),s=c.buildDollDrawMessage(x.d,x.p,{},cat,"u",r);assert.strictEqual(JSON.stringify(x),before);return s;}
function checkCommon(s,r){const rows=s.split("\n"),at=rows.findIndex(x=>x.startsWith("🎟️ 티어:"));assert.strictEqual(at,rows[0].startsWith("[👑")?2:1);assert.strictEqual(rows[at+1],"━━━━━━━━━━━━");assert.strictEqual(rows[at+2],"");assert.strictEqual((s.match(/🎟️ 티어:/g)||[]).length,1);assert.strictEqual((s.match(/<ALLSEE>/g)||[]).length,1);assert(!s.includes("잔여 🅟"));assert(!/🅟.* 사용/.test(s));assert(s.includes("🧸 이용권 1개 사용 · 잔여 "+r.remainingTicket+"개"));}
test("신규·프리미엄 머리말·가호 미적용 15+30=45·UI 무변경 계산",()=>{
 const x=input(99,123456,0);x.d.member.u.rank.tier="노랑하트";const r=draw(x,[0,0.56,0,0,0]);assert.strictEqual(r.experience.base,15);assert.strictEqual(r.experience.total,45);const original=c.isHoiPassPremiumActive;c.isHoiPassPremiumActive=()=>true;try{const s=output(x,r);checkCommon(s,r);assert(s.startsWith("[👑호이패스 프리미엄👑]\n🧸 [u] 님 인형뽑기\n🎟️ 티어: 노랑하트 · 성공률 20%"));assert.strictEqual((s.match(/📊 총 획득 경험치: \+45exp/g)||[]).length,2);assert(s.includes("├ 📘 기본: +15exp\n└ 🎟️ 티어 보너스: +30exp"));assert(!s.includes("가호 추가 보너스"));assert(s.includes("+5,000💞"));}finally{c.isHoiPassPremiumActive=original;}
});
test("가호 충분/부족/0은 실제 추가량·소모량·동일 총 EXP",()=>{
 for(const booster of [9999,1,89,90,0]){const x=input(2,0,booster);x.d.member.u.rank.tier="노랑하트";const r=draw(x,[0,0.56,0,0,0]),s=output(x,r);checkCommon(s,r);const extra=Math.min(booster,90);assert.strictEqual(r.experience.total,45+extra);assert.strictEqual((s.match(new RegExp("📊 총 획득 경험치: \\+"+(45+extra)+"exp","g"))||[]).length,2);if(extra){assert(s.includes("└ ✨ 가호 추가 보너스: +"+extra+"exp\n\n✨ 호월신의 가호: "+extra+"개 사용"));}else assert(!s.includes("호월신의 가호:"));}
});
test("실패 결과·잔여 포인트 줄 제거·마지막 이용권·추가 지급 없음",()=>{
 const x=input(1,123456);const before=x.d.member.u.boostercnt,r=draw(x,[0.999]),s=output(x,r);checkCommon(s,r);assert(s.includes("━━━━━━━━━━━━\n\n❌ 인형뽑기 실패\n다음 뽑기에 다시 도전해 보세요!\n\n━━━━━━━━━━━━"));assert(s.includes("📖 상세·명령어<ALLSEE>\n\n🧸 /인형뽑기"));assert(!s.includes("총 획득 경험치"));assert.strictEqual(x.d.member.u.point,123456);assert.strictEqual(x.d.member.u.boostercnt,before);
});
test("중복 판매·최대 크기 갱신·실제 경험치 유지",()=>{
 const x=input(2,0,0);draw(x);const r=draw(x,[0,0,0,0.995,0.999]),s=output(x,r);checkCommon(s,r);assert(s.includes("🔁 중복 획득"));assert(s.includes("💰 자동 판매"));assert(s.includes("개인 최고 기록 갱신"));assert.strictEqual(x.d.member.u.point,r.sale);assert(s.includes("📖 획득 등급 보기\n"+c.getDollCollectionCommand(cat,r.record,r.doll.id)));
});
test("이용권 부족 UI는 노션의 빈 줄·상세 제목·전체보기 유지·포인트 미표시·무소모",()=>{
 const x=input(0,9999999),before=JSON.stringify(x),r=draw(x),s=output(x,r);
 assert.strictEqual(s,"🧸 [u] 님 인형뽑기\n━━━━━━━━━━━━\n\n🧸 뽑기에 사용할 이용권이 부족해요.\n└ 인형뽑기이용권 1개가 필요해요.\n\n🧸 이용권 0개\n└ 부족한 이용권: 1개\n\n━━━━━━━━━━━━\n📖 상세·명령어<ALLSEE>\n\n🧸 /인형뽑기\n📖 /인형도감\n🏆 /인형순위\n📘 /인형가이드\n└ 크기·확률·수집효과 안내");assert.strictEqual(JSON.stringify(x),before);
 const premium=c.isHoiPassPremiumActive;c.isHoiPassPremiumActive=()=>true;try{assert.strictEqual(output(x,r),"[👑호이패스 프리미엄👑]\n"+s);}finally{c.isHoiPassPremiumActive=premium;}
});
vm.runInContext(block(main,'if (msg === "/호여" || /^\\/호여\\s+\\d+$/.test(msg))').replace(/^if /,'function blessingCommand(){if ')+"}",c);
test("실제 /호여 10 지급·가호 안내100/인형별 EXP·저장 1회",()=>{
 const x=input();x.d.member.u.bag[c.GLOBAL_CONFIG.level.boosterItemName]=20;const before=x.d.member.u.boostercnt;let saved=0,replies=[];const loadSave=c.saveJsonFile,has=c.hasItem;c.data=x.d;c.petData=x.p;c.guildData={};c.sender="u";c.msg="/호여 10";c.replier={reply:m=>replies.push(m)};c.hasItem=(d,u,n,q)=>(d.member[u].bag[n]||0)>=q;c.saveJsonFile=()=>saved++;
 try{c.blessingCommand();assert.strictEqual(saved,1);assert.strictEqual(x.d.member.u.boostercnt,before+10);assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.level.boosterItemName],10);const s=replies.join("\n");assert(s.startsWith("[u] 님에게\n호월신의 가호✨ 10개가 깃들었습니다!"));assert(s.includes("🏆 캐슬대전: 100 EXP\n🐹 미니펫대전: 100 EXP"));assert(s.includes("🧸 인형뽑기: 인형별 기본 EXP 적용"));assert(s.includes("인형뽑기 경험치에도 동일하게 적용됩니다."));assert.strictEqual((s.match(/<ALLSEE>/g)||[]).length,1);assert(!s.includes("50 EXP"));}finally{c.saveJsonFile=loadSave;c.hasItem=has;}
});
test("가호 명령 부족·0·접미는 저장/소모 없이 기존 안내",()=>{
 const x=input();x.d.member.u.bag[c.GLOBAL_CONFIG.level.boosterItemName]=1;c.data=x.d;c.petData=x.p;c.guildData={};c.sender="u";let saved=0;const save=c.saveJsonFile,has=c.hasItem;c.hasItem=(d,u,n,q)=>(d.member[u].bag[n]||0)>=q;c.saveJsonFile=()=>saved++;c.replier={reply:()=>{}};try{for(const msg of ["/호여","/호여 0","/호여 2","/호여 1 해봐"]){c.msg=msg;const before=JSON.stringify(x);c.blessingCommand();assert.strictEqual(JSON.stringify(x),before);assert.strictEqual(saved,0);}}finally{c.saveJsonFile=save;c.hasItem=has;}
});
test("대전 승리100/패배25와 실제 티어/가호 390 표시 유지",()=>{
 vm.runInContext(block(main,"function buildBattleExperienceRewardMessage("),c);for(const domain of ["castleBattleExperience","miniPetBattleExperience"]){assert.strictEqual(c.GLOBAL_CONFIG.daily[domain].win,100);assert.strictEqual(c.GLOBAL_CONFIG.daily[domain].lose,25);const x=input();x.d.member.u.rank.tier="노랑하트";const r=c.addMemberExperienceWithTierBonus(x.d,"u",c.GLOBAL_CONFIG.daily[domain].win);assert.strictEqual(r.total,390);assert(c.buildBattleExperienceRewardMessage(r).includes("├ 📘 기본: +100exp\n├ 🎟️ 티어 보너스: +30exp\n└ ✨ 가호 추가 보너스: +260exp"));}
});
console.log("Doll UI/blessing "+groups+" groups passed");
