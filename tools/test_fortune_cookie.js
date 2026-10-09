const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
// 기존 합성 파일시스템과 실제 저장 함수·레이드 진입부를 재사용한다.
const harness = fs.readFileSync(path.join(__dirname, "test_server_raid.js"), "utf8");
const fixture = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\ngroup("')) + `
return {c,block,reset,read,write,run,start,
  put: (p,v) => {disk[p]=JSON.stringify(v);}, get: p => JSON.parse(disk[p]),
  raw: p => disk[p], corrupt: p => {disk[p]="{";},
  traces: () => traces, replies: () => replies,
  clear: () => {traces=[];replies=[];},
  fail: p => {failWrite=(_d,target)=>target===p;},
  noticeFail: fn => {failNotice=fn;}, replyFail: v => {replyFailure=v;}
};`)(require, __dirname);
const c = fixture.c, block = fixture.block;
c.memberTitlePath = "/sdcard/호이랜드/member_title.json";
c.boardPath = "/sdcard/호이랜드/board.json";
c.castleSiegeFlag = false;
c.normalizePendantTransitionBagItem = (_bag, item) => item;
const oldBackup = c.getManagedJsonBackupPath;
c.getManagedJsonBackupPath = p => p.endsWith("/member_title.json") ? null : oldBackup(p);
c.java.io.File.prototype.getName = function () { return this.path.split("/").pop(); };
for (const name of ["isPointShopSafeCount", "rollFortuneCookieTitle", "applyFortuneCookieOpen",
 "buildFortuneCookieOpenMessage", "buildFortuneCookieSpecialNotice", "getMemberTitleSalePoint", "removeMemberTitleAt",
 "applyMemberTitleSale", "ensureTitleUserData", "addItemToBag", "removeItem", "getNoticeTargetRooms", "isAdmin", "isAdminIdentity", "formatDateTime",
 "normalizeSearchAuthenticationKeyword", "countSearchAuthenticationCharacters", "isSearchAuthenticationTarget",
 "isSearchAuthenticationCount", "applySearchAuthentication", "buildSearchAuthenticationManagementMessage",
 "buildSearchAuthenticationRankingMessage", "isProtectedManagedJsonPath"]) vm.runInContext(block(main, "function " + name + "("), c);
const markers = ['if (msg === "/호츈오픈" ||', 'if (msg === "/타이틀정보" ||',
 'if (msg === "/타이틀판매" ||', 'if (msg === "/타이틀지정판매" ||', 'if (msg === "/검색인증" ||',
 'if (msg === "/검색인증관리" ||', 'if (msg === "/검색인증순위" ||'];
vm.runInContext("function runCommands(){" + markers.map(m => block(main, m)).join("\n") + "}", c);
const clone = x => JSON.parse(JSON.stringify(x));
let groups = 0;
function seed(count = 100, dev = false) {
 const d = fixture.read(dev);
 d.member.admin.bag[c.GLOBAL_CONFIG.fortuneCookie.itemName] = count;
 d.member.admin.diamond = 20;
 d.member["신규 남"] = {agree:true,join:"20261009",point:0,diamond:0,bag:{}};
 fixture.write(d, dev);
 fixture.put((dev ? "/sdcard/호이랜드_dev/" : "/sdcard/호이랜드/") + "member_title.json", {member:{admin:{title:{list:[{name:"기존",price:0,inDate:"2026-10-01"}],num:1}}}});
}
function random(values) {
 let i=0; c.draw=()=>{ assert(i<values.length,"추첨 횟수 초과"); return values[i++]; };
 vm.runInContext("Math.random=draw",c);
}
function command(msg, sender="admin", dev=false, room="room90") {
 fixture.clear();
 const ctx=c.createCommandContext(dev,room), prev=c.enterCommandContext(ctx);
 c.beginDataSaveTransaction();c.ctx=ctx;
 c.data=c.loadJsonFile(c.filePath);c.petData={};c.guildData={};c.msg=msg;c.sender=sender;
 const original=c.replier;c.replier=c.createContextReplier(original,ctx);
 try {c.runCommands();}
 catch(e){c.rollbackDataSaveTransaction();throw e;}
 finally{c.replier=original;c.endDataSaveTransaction();c.exitCommandContext(prev);}
 return fixture.replies().join("\n");
}
function title(dev=false){return fixture.get((dev?"/sdcard/호이랜드_dev/":"/sdcard/호이랜드/")+"member_title.json").member.admin.title;}
function pass(label, fn){fixture.reset();seed();fn();console.log("PASS "+(++groups)+": "+label);}

pass("명단 310개·중복 없음·콘셉트 7개·멘트 각30개·총 조합55830개",()=>{
 const cfg=c.GLOBAL_CONFIG.fortuneCookie;
 assert.strictEqual(cfg.names.length,310);assert.strictEqual(new Set(cfg.names).size,310);
 assert.strictEqual(cfg.concepts.length,7);
 for(const concept of cfg.concepts){assert.strictEqual(concept.quotes.length,30);assert.strictEqual(new Set(concept.quotes).size,30);}
 assert.strictEqual(cfg.names.length*6*30+30,55830);
 assert(cfg.names.includes("오픈채팅봇")&&cfg.names.includes("알림 봇")&&cfg.names.includes("호월 봇"));
});
pass("확률 경계 0·1%·51%·100%와 지정 닉네임·콘셉트·멘트 끝 항목",()=>{
 const roll=v=>c.rollFortuneCookieTitle((()=>{let a=[v,.999999,.999999,.999999];return ()=>a.shift();})());
 assert(roll(0).special);assert(roll(.009999).special);
 assert(!roll(.01).special);assert(!roll(.509999).special);assert.strictEqual(roll(.51),null);assert.strictEqual(roll(.999999),null);
 const r=roll(.2);assert(r.name.includes("왕눈 남의 비밀친구"));assert(r.quote===c.GLOBAL_CONFIG.fortuneCookie.concepts[5].quotes[29]);
 assert.throws(()=>c.rollFortuneCookieTitle(()=>1),/추첨값 오류/);
});
pass("일반 신규 당첨·기본3종·타이틀 원문·기존 장착 유지·저장 후 응답",()=>{
 random([.1,0,0,0]);const text=command("/호츈오픈 1"),d=fixture.read();
 assert.strictEqual(d.member.admin.bag["호츈쿠키🥠"],99);
 assert.strictEqual(d.member.admin.bag["펫 강화석⭐"],100);
 assert.strictEqual(d.member.admin.bag["티어 승급티켓🎟"],1);
 assert.strictEqual(d.member.admin.bag["다이아상자💎(/다이아상자오픈)"],1);
 assert.strictEqual(title().num,1);assert.strictEqual(title().list.length,2);
 assert.strictEqual(title().list[1].name,"쟈기 여의 축복🍀 ⎯ "+c.GLOBAL_CONFIG.fortuneCookie.concepts[0].quotes[0]);
 assert(text.includes("⭕ 타이틀 당첨!")&&text.includes("🥠 남음: 99개"));
 assert(text.indexOf("<ALLSEE>")>text.indexOf("당첨!"));
 const ts=fixture.traces(),lastSave=ts.map(t=>t.type).lastIndexOf("save");
 assert(lastSave>=0&&lastSave<ts.findIndex(t=>t.type==="reply"));
});
pass("같은 개봉 중 일반 반복 당첨·멘트만 다르면 신규·중복5천만",()=>{
 random([.1,0,0,0,.1,0,0,0,.1,0,0,.04]);
 const text=command("/호츈오픈 3");
 assert.strictEqual(title().list.length,3);assert.strictEqual(fixture.read().member.admin.point,1050000000);
 assert(text.includes("신규 2회 · 중복 1회"));assert(text.includes("🅟50,000,000"));
});
pass("호월신 신규·중복 모두 다이아100·중복포인트·당첨마다 독립 전체알림",()=>{
 random([0,0,0,0]);const text=command("/호츈오픈 2"),d=fixture.read();
 assert.strictEqual(d.member.admin.diamond,220);assert.strictEqual(d.member.admin.point,1050000000);
 assert.strictEqual(title().list.length,2);assert(text.includes("호월신 당첨: 2회"));
 const notices=fixture.traces().filter(t=>t.type==="notice");
 assert.strictEqual(notices.length,26);assert(!notices.some(t=>t.text.includes("<ALLSEE>")||t.text.includes("🥠 소모")));
 assert(notices.every(t=>t.text.includes(c.GLOBAL_CONFIG.fortuneCookie.concepts[6].quotes[0])));
});
pass("100개 전부 미당첨·쿠키0개 제거·기본합산·불필요항목 숨김",()=>{
 random(Array(100).fill(.99));const text=command("/호츈오픈 100"),d=fixture.read();
 assert(!Object.hasOwn(d.member.admin.bag,"호츈쿠키🥠"));assert(text.includes("🥠 남음: 0개"));
 assert.strictEqual(d.member.admin.bag["펫 강화석⭐"],10000);assert.strictEqual(d.member.admin.bag["티어 승급티켓🎟"],100);
 assert.strictEqual(title().list.length,1);assert(!text.includes("⭕ 신규"));
 assert(!text.includes("✨ 특별 보상")&&!text.includes("💰 중복 보상"));
});
pass("보유부족·0·101·소수·지수·무한대·거대숫자·접미 입력은 무변경",()=>{
 seed(1);const before=fixture.raw(c.filePath),beforeTitle=fixture.raw(c.memberTitlePath);
 for(const msg of ["/호츈오픈","/호츈오픈 0","/호츈오픈 101","/호츈오픈 2","/호츈오픈 -1","/호츈오픈 1.5","/호츈오픈 1e2","/호츈오픈 Infinity","/호츈오픈 "+"9".repeat(350),"/호츈오픈 1 해봐","/호츈오픈안내"]){
  const text=command(msg);assert.strictEqual(fixture.raw(c.filePath),before);assert.strictEqual(fixture.raw(c.memberTitlePath),beforeTitle);
  if(msg.endsWith("해봐")||msg.endsWith("안내"))assert.strictEqual(text,"");
 }
});
pass("포인트·다이아·보상아이템 안전정수 초과·음수·문자열은 전부 무변경",()=>{
 const cfg=c.GLOBAL_CONFIG.fortuneCookie,max=9007199254740991;
 for(const [field,value,draw] of [["diamond",max,0],["point",max,.1],["diamond",-1,.99],["diamond","20",.99],["펫 강화석⭐",max,.99],["티어 승급티켓🎟","1",.99],["호츈쿠키🥠","100",.99]]){
  seed();const d=fixture.read();if(["point","diamond"].includes(field))d.member.admin[field]=value;else d.member.admin.bag[field]=value;
  fixture.write(d);if(field==="point"){const t=fixture.get(c.memberTitlePath);t.member.admin.title.list.push({name:"쟈기 여의 축복🍀 ⎯ "+cfg.concepts[0].quotes[0],kind:"fortuneCookie",price:0});fixture.put(c.memberTitlePath,t);}
  random(draw===0?[0,0]:draw===.1?[.1,0,0,0]:[.99]);
  const before=fixture.raw(c.filePath),bt=fixture.raw(c.memberTitlePath);command("/호츈오픈 1");
  assert.strictEqual(fixture.raw(c.filePath),before);assert.strictEqual(fixture.raw(c.memberTitlePath),bt);
 }
});
pass("기존 타이틀 없는 유저 신규 지급·파일 파싱 실패는 숨기지 않음",()=>{
 fixture.put(c.memberTitlePath,{member:{}});random([.1,0,0,0]);command("/호츈오픈 1");assert.strictEqual(title().list.length,1);assert.strictEqual(title().num,null);
 fixture.corrupt(c.memberTitlePath);const before=fixture.raw(c.filePath);
 assert.throws(()=>command("/호츈오픈 1"));assert.strictEqual(fixture.raw(c.filePath),before);
});
pass("타이틀 파일은 기존 보호대상 밖·스냅샷 저장 실패 시 전액 복구·재시도1회",()=>{
 assert.strictEqual(c.isProtectedManagedJsonPath(c.memberTitlePath),false);
 for(const failPath of [c.memberTitlePath,c.filePath]){
  fixture.reset();seed();const before=fixture.raw(c.filePath),bt=fixture.raw(c.memberTitlePath);
  fixture.fail(failPath);random([.1,0,0,0]);assert.throws(()=>command("/호츈오픈 1"),/replace failed/);
  assert.strictEqual(fixture.raw(c.filePath),before);assert.strictEqual(fixture.raw(c.memberTitlePath),bt);
  random([.1,0,0,0]);command("/호츈오픈 1");assert.strictEqual(title().list.length,2);assert.strictEqual(fixture.read().member.admin.bag["호츈쿠키🥠"],99);
 }
});
pass("결과·공지 전송 실패 후 확정 보상 보존·추가 재지급 없음",()=>{
 fixture.noticeFail(()=>true);fixture.replyFail(true);random([0,0]);command("/호츈오픈 1");
 assert.strictEqual(fixture.read().member.admin.diamond,120);assert.strictEqual(title().list.length,2);
 assert.strictEqual(fixture.read().member.admin.bag["호츈쿠키🥠"],99);assert(c.getDataSaveTransaction()===null);
 fixture.replyFail(false);fixture.noticeFail(()=>{throw Error("transport");});random([0,0]);command("/호츈오픈 1");
 assert.strictEqual(fixture.read().member.admin.diamond,220);assert.strictEqual(fixture.read().member.admin.point,1050000000);
 fixture.noticeFail(room=>{if(room==="room1")throw Error("one room failure");return false;});random([0,.04]);command("/호츈오픈 1");
 assert.strictEqual(fixture.traces().filter(t=>t.type==="notice").length,12,"첫 방 전송 실패 후 나머지 방 전송 유지");
});
pass("DEV 개봉·전체알림은 DEV 데이터와 테스트방만 변경",()=>{
 seed(5,true);const prod=fixture.raw(c.filePath),pt=fixture.raw(c.memberTitlePath);
 random([0,0]);const text=command("/호츈오픈 1","admin",true,"test");
 assert(text.includes("[DEV 테스트환경]"));assert.strictEqual(fixture.read(true).member.admin.diamond,120);
 assert.strictEqual(fixture.raw(c.filePath),prod);assert.strictEqual(fixture.raw(c.memberTitlePath),pt);
 assert(fixture.traces().filter(t=>t.type==="notice").every(t=>t.room==="room8"&&t.text.includes("[DEV 테스트환경]")));
});
pass("재시작과 닉변 후 전체 문구 기준 중복·기존 타이틀 번호 유지",()=>{
 random([.1,0,0,0]);command("/호츈오픈 1");const d=fixture.read(),t=fixture.get(c.memberTitlePath);
 d.member.renamed=d.member.admin;delete d.member.admin;t.member.renamed=t.member.admin;delete t.member.admin;
 fixture.write(d);fixture.put(c.memberTitlePath,t);random([.1,0,0,0]);command("/호츈오픈 1","renamed");
 assert.strictEqual(fixture.get(c.memberTitlePath).member.renamed.title.list.length,2);assert.strictEqual(fixture.read().member.renamed.point,1050000000);
});
pass("판매정보·단일판매·구간판매 1500만·기존30%/100만 유지·장착번호 보정",()=>{
 const t=fixture.get(c.memberTitlePath);t.member.admin.title.list.push({name:"쿠키",kind:"fortuneCookie",price:0,inDate:"2026-10-09"},{name:"기존유료",price:10000000,inDate:"2026-10-09"});
 t.member.admin.title.num=3;fixture.put(c.memberTitlePath,t);
 assert(command("/타이틀정보 2").includes("판매가: 🅟15,000,000"));
 assert(command("/타이틀판매 1").includes("🅟1,000,000"));assert.strictEqual(title().num,2);
 assert(command("/타이틀지정판매 1~1").includes("🅟15,000,000"));assert.strictEqual(title().num,1);
 assert(command("/타이틀판매 1").includes("🅟3,000,000"));assert.strictEqual(title().num,null);
 assert.strictEqual(fixture.read().member.admin.point,1019000000);
});
pass("판매 0·역범위·거대숫자·접미·정수넘침은 무변경·혼합 구간 장착보존",()=>{
 const t=fixture.get(c.memberTitlePath);t.member.admin.title.list.push({name:"쿠키",kind:"fortuneCookie",price:0},{name:"다른 장착",price:0});t.member.admin.title.num=3;fixture.put(c.memberTitlePath,t);
 const before=fixture.raw(c.filePath),bt=fixture.raw(c.memberTitlePath);
 for(const msg of ["/타이틀판매 0","/타이틀판매 "+"9".repeat(100),"/타이틀판매 1 해봐","/타이틀지정판매 3~1"]){command(msg);assert.strictEqual(fixture.raw(c.filePath),before);assert.strictEqual(fixture.raw(c.memberTitlePath),bt);}
 command("/타이틀지정판매 1~2");assert.strictEqual(title().num,1);assert.strictEqual(title().list[0].name,"다른 장착");
 const d=fixture.read();d.member.admin.point=9007199254740991;fixture.write(d);const b2=fixture.raw(c.memberTitlePath);command("/타이틀판매 1");assert.strictEqual(fixture.raw(c.memberTitlePath),b2);
});
pass("단일·구간 판매 저장 실패 시 포인트·타이틀·장착 전부 복구",()=>{
 for(const msg of ["/타이틀판매 1","/타이틀지정판매 1~1"]){
  fixture.reset();seed();const before=fixture.raw(c.filePath),bt=fixture.raw(c.memberTitlePath);
  fixture.fail(c.filePath);assert.throws(()=>command(msg),/replace failed/);
  assert.strictEqual(fixture.raw(c.filePath),before);assert.strictEqual(fixture.raw(c.memberTitlePath),bt);
 }
});
pass("실제 Info 타이틀목록 9·10·11개 접기 경계·멘트·장착 표시",()=>{
 const ctx={data:{member:{admin:{}}},petData:{},guildData:{},sender:"admin",msg:"/타이틀목록",allsee:"<ALLSEE>",checkRank:()=> "admin",replier:{reply:t=>ctx.out=t}};
 vm.createContext(ctx);vm.runInContext("function render(){"+block(info,'if (msg === "/타이틀목록")')+"}",ctx);
 for(const count of [9,10,11]){ctx.titleData={member:{admin:{title:{list:Array.from({length:count},(_,i)=>({name:"문구 ⎯ 멘트"+i})),num:2}}}};ctx.render();assert.strictEqual(ctx.out.includes("<ALLSEE>"),count>=10);assert(ctx.out.includes("☞ 2. 문구 ⎯ 멘트1"));}
});
pass("대전 PREP·ACTIVE·SETTLING의 실제 진입에서 신규6종 통과·미허용은 차단",()=>{
 fixture.start();const cmds=["/기록","/기록 내용","/기록실","/검색인증 신규 남 수다","/검색인증관리","/검색인증순위","/검색인증관리순위"];
 for(const state of ["PREP","ACTIVE","SETTLING"]){const d=fixture.read();d.serverRaid.current.state=state;fixture.write(d);
  for(const msg of cmds)assert.strictEqual(fixture.run(msg,"admin",undefined,"room90"),"",msg+" "+state);
 }
 assert(!c.isServerRaidAdditionalCommand("/기록삭제 1"));assert(!c.isServerRaidAdditionalCommand("/기록실 추가"));assert(!c.isServerRaidAdditionalCommand("/검색인증순위 추가"));
 assert(!c.isServerRaidAdditionalCommand("/호츈오픈 1"));assert(fixture.run("/호츈오픈 1","admin").includes("대전"));
 for(const msg of ["/포인트","ㅍㅍㅍ","/가방","/펫정보","/이체 a 1"])assert(c.isServerRaidAdditionalCommand(msg));
});
pass("검색인증 허용은 기존 관리자 방 권한 유지·일반유저·타방 관리자 무변경",()=>{
 const before=fixture.raw(c.filePath);
 command("/검색인증 신규 남 수다","a");assert.strictEqual(fixture.raw(c.filePath),before);
 command("/검색인증 신규 남 수다","admin",false,"room1");assert.strictEqual(fixture.raw(c.filePath),before);
 command("/검색인증 신규 남 수다");assert.strictEqual(fixture.read().member["신규 남"].voicecheck,1);assert.strictEqual(fixture.read().member.admin.diamond,21);
});
pass("개봉100회 최악의 전부특별중복·보상 합산·알림건수",()=>{
 random(Array(200).fill(0));command("/호츈오픈 100");
 const d=fixture.read();assert.strictEqual(d.member.admin.diamond,10020);assert.strictEqual(d.member.admin.point,5950000000);
 assert.strictEqual(title().list.length,2);assert.strictEqual(fixture.traces().filter(t=>t.type==="notice").length,1300);
});
pass("1만개 확률 구간에서 일반50%·특별1%·미당첨49% 배타 판정",()=>{
 const counts={general:0,special:0,missed:0};
 for(let i=0;i<10000;i++){let first=true;const result=c.rollFortuneCookieTitle(()=>{if(first){first=false;return (i+.5)/10000;}return .5;});
  if(!result)counts.missed++;else if(result.special)counts.special++;else counts.general++;
 }
 assert.deepStrictEqual(counts,{general:5000,special:100,missed:4900});
});
pass("실제 개봉·판매 쓰기 잠금 분류와 DEV 형식·접미 미실행",()=>{
 for(const command of ["/호츈오픈 1","dev/호츈오픈 100","/타이틀판매 1","/타이틀지정판매 1~2"])
  assert.strictEqual(c.getResponseDataFlowLock(command),"write");
 assert.strictEqual(c.getResponseDataFlowLock("/호츈오픈 1 해봐"),"read");
 assert.strictEqual(c.getResponseDataFlowLock("/타이틀판매 1 해봐"),"read");
});
console.log("호츈쿠키·대전 허용 명령 "+groups+"개 검증 그룹 통과 (합성 데이터·실제 명령/저장/복구 함수)");
