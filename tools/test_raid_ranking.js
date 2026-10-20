const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm"),child=require("child_process");
const {createFixture}=require("./test_server_raid_delivery.js");
const baselineRef="96633c05dd0c6eb66e24f6fb786bcae7a4c3fc62";
const baseline=child.execFileSync("git",["show",baselineRef+":main.js"],{encoding:"utf8",maxBuffer:20*1024*1024}).replace(/\r\n/g,"\n");
const clone=v=>JSON.parse(JSON.stringify(v));let groups=0;
function test(name,fn){fn();console.log("PASS "+(++groups)+": "+name);}
// 실제 레이드 도메인을 사용하는 독립 VM 두 개에서 운영 기준과 현재 결과를 비교한다.
function fixtures(){const h=createFixture(),old=createFixture();for(const n of ["buildServerRaidResults","buildServerRaidAttackMessage"])vm.runInContext(h.block(baseline,"function "+n+"("),old.c);return {h,old};}
function roundOf(h,count){const round={accounts:{}},servers=h.c.GLOBAL_CONFIG.serverRaid.servers;for(let i=0;i<count;i++)round.accounts["id"+i]={id:"id"+i,server:servers[i%servers.length],damage:i%5===0?"90071992547409912345":String(i%7),attacks:i%19===0?[]:[{id:"event"+i,R:10,D:10,P:0,remaining:4,critical:false}],attackReward:0};return round;}
test("운영 main 전체 차이는 버전·개인 정렬 생략·공격 안내 호출만 포함",()=>{
 const h=createFixture();const expected=baseline.replace('const HoiBotVersion = "2.664"','const HoiBotVersion = "2.665"').replace('function buildServerRaidResults(round, freeze) {','function buildServerRaidResults(round, freeze, skipMemberRanks) {').replace('    rankServerRaidRows(rows);\n    for (var r = 0; r < rows.length; r++) {','    rankServerRaidRows(rows);\n    if (skipMemberRanks === true && freeze !== true) return rows; // 공격 안내에는 서버 순위만 필요하므로 개인 정렬은 생략\n    for (var r = 0; r < rows.length; r++) {').replace('var rows = buildServerRaidResults(round), server = null;','var rows = buildServerRaidResults(round, false, true), server = null;');
 assert.equal(h.main,expected);const entries=JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","hoiBotChangeLog.json"),"utf8")).entries;assert.equal(entries[0].version,"2.665");assert.equal(entries[0].date,"2026-10-21");assert.equal(Number(entries[0].version)-Number(entries[1].version)<0.001001,true);
});
test("1,500명·큰 정수 피해에서도 서버 합계/공동 순위와 신구 공격 UI 완전 일치",()=>{
 const {h,old}=fixtures(),round=roundOf(h,1500),original=JSON.stringify(round);const expected=old.c.buildServerRaidResults(clone(round)),actual=h.c.buildServerRaidResults(round,false,true);
 assert.deepStrictEqual(clone(actual).map(({id,damage,rank})=>({id,damage,rank})),clone(expected).map(({id,damage,rank})=>({id,damage,rank})));
 const d={serverRaid:{current:round,wins:{}}},p=round.accounts.id1;
 for(const a of [p.attacks[0],{...p.attacks[0],rewardBasis:"damage",rewardPercent:1},{...p.attacks[0],ticketHeldAfter:4,ticketUsed:true,additionalRemaining:4}])assert.equal(h.c.buildServerRaidAttackMessage(d,p,a,"synthetic"),old.c.buildServerRaidAttackMessage(clone(d),clone(p),clone(a),"synthetic"));assert.equal(JSON.stringify(round),original);
});
test("공격 안내 서버 정렬 1회·개인 조회의 기존 개인 정렬 유지",()=>{
 const {h,old}=fixtures(),round=roundOf(h,1500),p=round.accounts.id1;let calls=0;const rank=h.c.rankServerRaidRows;h.c.rankServerRaidRows=rows=>{calls++;return rank(rows);};h.c.buildServerRaidAttackMessage({serverRaid:{current:round,wins:{}}},p,p.attacks[0],"synthetic");assert.equal(calls,1);calls=0;assert.deepStrictEqual(clone(h.c.buildServerRaidResults(round)),clone(old.c.buildServerRaidResults(clone(round))));assert(calls>1);
});
test("생략 옵션을 줘도 종료 정산의 개인 순위/기여도/상금/핸디캡은 기준과 동일",()=>{
 const {h,old}=fixtures(),round=roundOf(h,1500),oldRound=clone(round);assert.deepStrictEqual(clone(h.c.buildServerRaidResults(round,true,true)),clone(old.c.buildServerRaidResults(oldRound,true)));assert.deepStrictEqual(round,oldRound);
});
test("공동 1위·0 피해 정상 공격·미공격 계정·빈 회차와 손상 피해 오류 유지",()=>{
 const {h,old}=fixtures(),servers=h.c.GLOBAL_CONFIG.serverRaid.servers,round={accounts:{a:{id:"a",server:servers[0],damage:"0",attacks:[{}]},b:{id:"b",server:servers[1],damage:"0",attacks:[{}]},idle:{id:"idle",server:servers[2],damage:"999",attacks:[]}}};assert.deepStrictEqual(clone(h.c.buildServerRaidResults(round,false,true)).map(r=>r.rank),[1,1]);assert.equal(h.c.buildServerRaidResults({accounts:{}},false,true).length,0);round.accounts.a.damage="broken";assert.throws(()=>h.c.buildServerRaidResults(round,false,true));assert.throws(()=>old.c.buildServerRaidResults(clone(round)));
});
console.log("PASS raid ranking: "+groups+" groups (synthetic only)");
module.exports={baseline,baselineRef};
