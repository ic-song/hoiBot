const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");

// 인접한 목적 주석까지의 실제 함수를 추출해 합성 데이터로 실행한다.
function fn(name) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("\n//", start);
    assert(start >= 0 && end > start, name);
    return source.slice(start, end);
}
const c = {
    formatDateTime: () => "2026-10-21 17:30:00", numberWithCommas: n => String(n),
    checkRank: (_d, _p, _g, user) => user,
    clearPetMusouOpeningTimer() {}, clearPetMusouTurnTimer() {},
    getPetMusouGuildInfo: () => ({ guild: {} }), formatGuildDisplay: () => "합성길드",
    autoRegisterHoiPassPremiumPetMusouUsers: () => ({ registeredCount: 0, skippedCount: 0, failedCount: 0 }),
    processPetMusouLightning: () => ({ triggered: false, message: "벼락 없음" }),
    buildPetMusouAttackDetailMessage: () => "", buildPetMusouStatusMessage: () => "다음 차례",
    resolvePetMusouBattle: () => ({ attackerWin: false }), buildPetMusouBattleMessage: () => "합성 전투",
    normalizeTicketTierName: name => name, getRankByTicketCount: () => "합성티어",
    ticketTierData: { "합성티어": { ticket: 0, highticket: 0, experienceBonus: 0 } },
    getExploreTierBonusPercent: () => 0, getTierExploreBonusPercentByName: () => 0
};
vm.createContext(c);
vm.runInContext("var GLOBAL_CONFIG = { petMusou: " + source.match(/petMusou: (\{[\s\S]*?\n    \}),\n    petSkillCollection/)[1] + " };", c);
vm.runInContext("GLOBAL_CONFIG.pointShop = " + source.match(/pointShop: (\{[\s\S]*?\n    \}),\n    guaranteedPackage/)[1], c);
for (const name of ["ensurePetMusouData", "getPetMusouCurrentAttacker", "shouldFinishPetMusou", "getPetMusouFlagName",
    "processPetMusouAttack", "finishPetMusou", "ensurePetMusouTicketEventData", "appendPetMusouTicketEventLog",
    "isPetMusouTicketEventActive", "grantPetMusouTicketEventCoupon", "processPetMusouTicketEventAdminCommand",
    "isPointShopSafeAmount", "isPointShopSafeCount", "buildTicketEventCouponPurchasePlan", "consumeTicketEventCouponPlan", "buildTierProgressPlan"])
    vm.runInContext(fn(name), c);
const native = value => vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify(value)) + ")", c);
const coupon = rate => "티켓이벤트할인쿠폰🎟️(" + rate + "%)";

// 실제 참가 스냅샷 구조에 맞춘 두 명의 합성 대회를 만든다.
function round(skills = []) {
    return native({ member: { a: { point: 100, bag: {} }, b: { point: 100, bag: {} } },
        petMusouTicketEvent: { enabled: true, logs: [] },
        petMusou: { active: true, startReady: true, roundId: "synthetic-round", turnDeadlineAt: Date.now() + 60000,
            players: { a: { alive: true, attacksLeft: 4, maxAttacks: 4, bonusAttackSkillNames: skills }, b: { alive: true, attacksLeft: 4 } },
            turnQueue: ["a", "b"], realFlagNo: 1, realFlagFound: false, realFlagDiscoveryBonusPaid: false, fakeFlags: {}, processedRounds: {} }
    });
}
for (const [skills, reward] of [[[], 150000000], [["무쌍귀신"], 250000000]]) {
    for (const mode of ["newFake", "discovery", "emptyFlag", "battle"]) {
        const d = round(skills);
        if (mode === "emptyFlag" || mode === "battle") d.petMusou.realFlagFound = true;
        if (mode === "battle") d.petMusou.currentHolder = "b";
        const result = c.processPetMusouAttack(d, {}, {}, {}, "a", mode === "newFake" ? 2 : 1);
        const discovery = mode === "discovery" ? 200000000 : 0;
        assert(result.ok && !result.ended, mode);
        assert.equal(d.member.a.point, 100 + reward + discovery, mode);
        assert.equal(d.petMusou.lastActionAttackRewardPoint, reward);
        assert(result.message.includes("🅟" + reward / 100000000 + "억"));
        assert.equal(Object.values(d.member.a.bag).reduce((a, b) => a + b, 0), 1);
        assert.equal(d.petMusou.players.a.attacksLeft, 3);
    }
}
const rejected = round(); rejected.petMusou.players.a.attacksLeft = 0;
assert.equal(c.processPetMusouAttack(rejected, {}, {}, {}, "a", 1).ok, false);
assert.equal(rejected.member.a.point, 100); assert.equal(Object.keys(rejected.member.a.bag).length, 0);
const knownFake = round(); knownFake.petMusou.fakeFlags["2"] = true;
const fakeResult = c.processPetMusouAttack(knownFake, {}, {}, {}, "a", 2);
assert(fakeResult.ok && fakeResult.message.includes("미지급"));
assert.equal(knownFake.member.a.point, 100); assert.equal(knownFake.petMusou.players.a.alive, false);
assert.equal(Object.values(knownFake.member.a.bag).reduce((a, b) => a + b, 0), 1);
console.log("PASS: 공격 기본·스킬·발견·점령·전투 보상 및 미지급 조건");

const winner = round(); winner.petMusou.currentHolder = "a";
const finished = c.finishPetMusou(winner, {}, {}, {}, "합성 종료");
assert.equal(winner.member.a.point, 1500000100);
assert.equal(winner.member.a.musouWinCount, 1); assert(finished.message.includes("우승 상금🤑: 🅟15억"));
winner.petMusou.active = true;
c.finishPetMusou(winner, {}, {}, {}, "동일 회차 재처리");
assert.equal(winner.member.a.point, 1500000100); assert.equal(winner.member.a.musouWinCount, 1);
const noWinner = round(); c.finishPetMusou(noWinner, {}, {}, {}, "우승자 없음"); assert.equal(noWinner.member.a.point, 100);
console.log("PASS: 우승 15억·안내·회차 중복 지급 방지·우승자 없음");

const counts = { 10: 0, 20: 0, 30: 0 };
for (let roll = 1; roll <= 92; roll++) {
    vm.runInContext("Math.random = function () { return " + (roll - 0.5) / 92 + "; };", c);
    const d = round(); const reward = c.grantPetMusouTicketEventCoupon(d, "a");
    assert([10, 20, 30].includes(reward.rate)); counts[reward.rate]++;
    assert.equal(d.member.a.bag[reward.name], 1); assert.equal(Object.keys(d.member.a.bag).length, 1);
}
assert.deepEqual(counts, { 10: 70, 20: 15, 30: 7 });
const disabled = round(); disabled.petMusouTicketEvent.enabled = false;
assert.equal(c.grantPetMusouTicketEventCoupon(disabled, "a"), null);
assert.equal(c.grantPetMusouTicketEventCoupon(round(), "missing"), null);
console.log("PASS: 모든 추첨 경계에서 10·20·30% 1장만 지급, 기존 가중치 70:15:7 유지");

const legacy = round(); legacy.member.a.rank = { tier: "합성티어" };
for (const rate of [10, 20, 30, 40, 50]) legacy.member.a.bag[coupon(rate)] = 1;
const holdings = c.buildTierProgressPlan(legacy, {}, "a").couponHoldings;
assert.equal(holdings.length, 5); assert(holdings.every(x => x.count === 1));
const purchase = c.buildTicketEventCouponPurchasePlan(legacy, "a", "티어 승급티켓🎟", 2, 1000);
assert.equal(purchase.itemPrice, 1100); assert.deepEqual(Array.from(purchase.usages, x => x.rate), [50, 40]);
assert.equal(c.consumeTicketEventCouponPlan(legacy, "a", purchase), 2);
assert.equal(legacy.member.a.bag[coupon(50)], undefined); assert.equal(legacy.member.a.bag[coupon(40)], undefined);
for (const rate of [40, 50]) legacy.member.a.bag[coupon(rate)] = 2;
legacy.member.a.bag["합성기타아이템"] = 9;
const revoked = c.processPetMusouTicketEventAdminCommand("/티켓전체회수", legacy, "합성운영자");
assert(revoked.message.includes("40% 쿠폰: 2개") && revoked.message.includes("50% 쿠폰: 2개"));
for (const rate of [10, 20, 30, 40, 50]) assert.equal(legacy.member.a.bag[coupon(rate)], undefined);
assert.equal(legacy.member.a.bag["합성기타아이템"], 9);
console.log("PASS: 기존 40·50% 보유 쿠폰 조회·구매·차감·전체 회수 유지 (합성 데이터만 사용)");
