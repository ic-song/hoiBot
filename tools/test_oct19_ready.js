const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const harness = fs.readFileSync(path.join(__dirname, "test_member_display_search_auth.js"), "utf8");
const { c, fixture, block } = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\npass("')) + "\nreturn {c,fixture,block};")(require, __dirname);
c.checkRank = (_d, _p, _g, user) => user;
c.hasPetSkill = (skills, user, name) => !!(skills[user] && skills[user].indexOf(name) >= 0);
c.isHoiPassPremiumActive = (data, user) => !!(data.member[user] && data.member[user].premium);
vm.runInContext(block(main, "var guildLevelTable ="), c);
for (const name of ["ensureGuildTerritoryBoosterCount", "ensureGuildWarehouseObj", "checkGuildLevelUp", "getFurnitureMaxSlots", "getFreeMarketCarrotFee", "hasFreeMarketMemberTicket", "getFreeMarketMemberTicketCount", "normalizeFreeMarketMemberTicketName", "getFreeMarketTradeFeeRate", "buildFreeMarketTradeFeeNotice", "refundFreeMarketCancelCarrotFee", "formatTransferFeeRate", "roundToTwo", "getFreeMarketActiveListings", "ensureFreeMarketData", "getFreeMarketTypeLabel", "formatFreeMarketPoint", "formatFreeMarketUnitPriceText", "formatFreeMarketDisplayTime", "isFreeMarketMemberFeeLog", "buildFreeMarketHistoryMessage", "buildFreeMarketListMessage", "normalizePendantTransitionItemName", "normalizePendantTransitionBagItem", "normalizeUniversalCollectionKeyBagItems", "addItem", "tradePendantByCarrot", "buildAdventureQuestMessage", "buildAdventureQuestIncompleteMessage"])
    vm.runInContext(block(main, "function " + name + "("), c);
let groups = 0;
function test(name, fn) { fixture.reset(); fn(); console.log("PASS OCT19 " + (++groups) + ": " + name); }
test("도달 13/14/19/20레벨의 창고 보상·연속 레벨업·중복 미지급", () => {
    for (const [target, key, amount] of [[13, "miniPet", 30000], [14, "petSkillBook", 700], [19, "miniPet", 70000], [20, "petSkillBook", 1500]]) {
        const guild = { level: target - 1, exp: c.guildLevelTable[target - 1].need, members: {} };
        const result = c.checkGuildLevelUp({ member: {} }, {}, guild);
        assert.strictEqual(result.newLevel, target); assert.strictEqual(guild.warehouse[key], amount);
        const before = JSON.stringify(guild); c.checkGuildLevelUp({ member: {} }, {}, guild); assert.strictEqual(JSON.stringify(guild), before);
    }
    const guild = { level: 12, exp: c.guildLevelTable[13].need, members: {} };
    c.checkGuildLevelUp({ member: {} }, {}, guild);
    assert.strictEqual(guild.level, 14); assert.strictEqual(guild.warehouse.miniPet, 30000); assert.strictEqual(guild.warehouse.petSkillBook, 700);
});
test("가구 평수 경계·기존 유저 재조회·건물주/베란다/프리미엄 보존", () => {
    const d = { member: { u: {} } }, p = { u: {} };
    for (const floor of [0, 4, 5, 99, 100, 104, 105, 109, 110, 115, 120, 200]) {
        const expected = floor <= 100 ? Math.floor(floor / 5) + 1 : 21 + Math.floor((floor - 100) / 5);
        for (let i = 0; i < 3; i++) assert.strictEqual(c.getFurnitureMaxSlots(d, p, "u", floor, {}), expected);
    }
    d.member.u.premium = true;
    const skills = { u: ["건물주", "베란다 확장", c.GLOBAL_CONFIG.petSkill.largeVerandaSkillName] };
    assert.strictEqual(c.getFurnitureMaxSlots(d, p, "u", 200, skills), 41 + 10 + c.GLOBAL_CONFIG.petSkill.verandaFurnitureSlotBonus + c.GLOBAL_CONFIG.petSkill.largeVerandaFurnitureSlotBonus + c.GLOBAL_CONFIG.supportPass.premium.furnitureSlotBonusCount);
});
test("개당 시장 당근·판매자 회원권 수수료·기존 등록 취소는 원래 납부액 반환", () => {
    for (const [type, cost] of [["bag", 1], ["miniPet", 100], ["furniture", 100], ["skill", 300], ["pendant", 300]]) {
        assert.strictEqual(c.getFreeMarketCarrotFee(type, 1), cost); assert.strictEqual(c.getFreeMarketCarrotFee(type, 3), cost * 3);
    }
    const d = { member: { u: { bag: {} } } }, name = c.GLOBAL_CONFIG.freeMarket.memberTicketItemName;
    assert.strictEqual(c.getFreeMarketTradeFeeRate(d, "u"), 0.17);
    d.member.u.bag[name] = 1; assert.strictEqual(c.getFreeMarketTradeFeeRate(d, "u"), 0.1);
    assert(c.buildFreeMarketTradeFeeNotice(d, "u").includes("10.0%"));
    assert.strictEqual(c.refundFreeMarketCancelCarrotFee(d, "u", { carrotFee: 5 }), 5);
    assert.strictEqual(d.member.u.bag[c.GLOBAL_CONFIG.items.carrotName], 5);
});
test("시장 목록/현황 17%·10% 안내와 과거 5% 거래 기록 보존", () => {
    c.getFreeMarketItemText = listing => listing.itemName;
    const data = { member: { u: {} } }, market = { listings: [], completedLogs: [{ itemName: "synthetic", quantity: 1, price: 100, seller: "u", buyer: "u", memberFeeApplied: true, feeRate: 0.05, completedAt: "2026.10.18 00:00:00" }] };
    const history = c.buildFreeMarketHistoryMessage(data, {}, {}, market);
    assert(history.includes("17.0%")); assert(history.includes("10.0%")); assert(history.includes("자회원🏪(수수료 5.0%)"));
    const list = c.buildFreeMarketListMessage(data, {}, {}, market); assert(list.includes("17.0%")); assert(list.includes("10.0%"));
});
test("펜던트는 가방번호로 1개 이전·당근300개·부족 시 무변경", () => {
    c.isMemberTierKing = () => true; c.getPendantBagLimit = () => 100;
    c.getPendantBag = (pets, user) => pets[user].bag; c.sortPendantBagByGrade = () => {}; c.formatPendantDisplay = pendant => pendant.name;
    const name = c.GLOBAL_CONFIG.items.carrotName;
    const d = { member: { u: { bag: { [name]: 299 } }, v: { bag: {} } } }, p = { u: { bag: [{ name: "synthetic" }] }, v: { bag: [] } };
    const before = JSON.stringify([d, p]); assert(!c.tradePendantByCarrot(d, p, {}, "u", "/펜던트당근 v 1").ok); assert.strictEqual(JSON.stringify([d, p]), before);
    d.member.u.bag[name] = 300;
    assert(c.tradePendantByCarrot(d, p, {}, "u", "/펜던트당근 v 1").ok);
    assert.strictEqual(d.member.u.bag[name] || 0, 0); assert.strictEqual(p.u.bag.length, 0); assert.strictEqual(p.v.bag.length, 1);
});
test("퀘스트14 기본/미완료 안내 모두 사용횟수 표시·명령 실행 형식 유지", () => {
    const state = { currentStage: 14, progress: {} };
    c.getAdventureQuestState = () => state;
    c.getAdventureQuestStageConfig = stage => c.GLOBAL_CONFIG.adventureQuest.stages[stage - 1];
    c.getAdventureQuestCompletionCheck = () => ({ badgeApplied: true, badgeEquipped: true });
    c.getAdventureQuestPetLabel = () => "synthetic"; c.getAdventureQuestPreparationLines = () => []; c.getAdventureQuestGoalLines = () => [];
    const text = c.buildAdventureQuestMessage({ member: { u: {} } }, {}, {}, {}, {}, {}, {}, "u");
    assert(text.includes("/홈뱃지큐브 [슬롯] [옵션] [사용횟수]"));
    for (const [progress, check] of [[{}, { badgeApplied: true }], [{}, { badgeEquipped: false }]]) {
        state.progress = progress;
        assert(c.buildAdventureQuestIncompleteMessage({}, {}, {}, "u", check).includes("/홈뱃지큐브 [슬롯] [옵션] [사용횟수]"));
    }
});
console.log("10월19일 기존 기능 변경 6개 그룹 통과");
