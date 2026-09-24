const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(name, source = main) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, "missing function: " + name);
    const brace = source.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed function: " + name);
}

const inventory = {};
const config = {
    adventureQuest: {
        tutorialMaxStage: 16,
        starterSkillBookCount: 1,
        homeBadgeCubeCount: 100,
        castlePercentPerStage: 0.005,
        raidPercentPerStage: 0.005,
        experiencePerStage: 1000,
        tierTicketItemName: "티어 승급티켓🎟",
        stages: Array.from({ length: 16 }, (_, index) => ({ number: index + 1, title: "제목" + (index + 1), record: "기록" + (index + 1), objective: "목표", commands: index === 12 ? "/다이아상점 → /다이아상점구매 [번호] [개수] → /퀘스트완료" : index === 13 ? "/홈뱃지장착 [번호] → /홈뱃지큐브 [슬롯] [옵션] → /퀘스트완료" : "/퀘스트완료" }))
    },
    petSkill: { bookItemName: "스킬북📙" },
    items: { diamondBoxName: "다이아상자💎" }
};
const context = {
    GLOBAL_CONFIG: config,
    formatDateTime: () => "2026-09-23 12:00:00",
    addItem: (_data, _user, item, count) => { inventory[item] = (inventory[item] || 0) + count; },
    roundToTwo: value => Math.round(value * 100) / 100,
    processAdventureLevelUps: () => [],
    getNextHomeInfoByFloor: (_info, floor) => floor < 100 ? { floor: floor + 1 } : null,
    getPetHomeEquippedBadgeIds: activity => activity.equippedBadgeIds || [],
    checkRank: () => "테스터"
};
vm.createContext(context);
for (const name of [
    "getAdventureQuestState", "getAdventureQuestStageConfig", "recordAdventureQuestAction",
    "recordAdventureQuestExploreSelection", "recordAdventureQuestExploreResult",
    "isAdventureQuestHomeAtMaximum", "prepareAdventureQuestStage",
    "getAdventureQuestCompletionCheck", "completeAdventureQuestStage",
    "getAdventureQuestGoalLines", "getAdventureQuestPreparationLines", "getAdventureQuestNextStageMessage", "buildAdventureQuestIncompleteMessage",
    "applyPercentWithExactFloor", "removePercentWithExactCeil"
]) vm.runInContext(extractFunction(name), context);

const data = { member: { tester: { exp: 0, rank: { tier: "새싹" } } } };
const user = "tester";
const home = { tester: { floor: 20 } };
let state = context.getAdventureQuestState(data, user, true);
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), true);
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), false);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true);
assert.strictEqual(context.completeAdventureQuestStage(data, user).stage, 1);
assert.strictEqual(inventory["다이아상자💎"], 5);
assert.strictEqual(data.member[user].exp, 1000);
assert.strictEqual(state.currentStage, 2);
data.member[user].bag = {};
state.progress = { shopViewed: true, tierPurchased: true, tierViewed: true, tierApplied: true };
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false, "기존 선행 기록만으로는 완료 불가");
state.progress = {};
let tierQuestSaves = 0;
context.data = data;
context.sender = user;
context.msg = "/티어적용";
context.petSkillData = {};
context.petData = {};
context.guildData = {};
context.filePath = "synthetic-member.json";
context.replier = { reply: () => {} };
context.hasItem = (fixture, name, item, count) => ((fixture.member[name].bag || {})[item] || 0) >= count;
context.buildTierProgressPlan = () => ({ canPromote: false });
context.buildTierProgressMessage = () => "승급 불가";
context.saveJsonFile = () => { tierQuestSaves++; };
const tierCommandStart = main.indexOf('if (msg === "/티어적용") {');
const tierCommandEnd = main.indexOf('if (msg.startsWith("/펫생성 "))', tierCommandStart);
assert(tierCommandStart >= 0 && tierCommandEnd > tierCommandStart);
vm.runInContext("function runTierCommand() { " + main.slice(tierCommandStart, tierCommandEnd) + " }", context);
context.runTierCommand();
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false, "티켓 없이 명령 입력 시 미완료");
assert.strictEqual(tierQuestSaves, 0, "티켓 없이 퀘스트 상태 저장 없음");
data.member[user].bag["티어 승급티켓🎟"] = 1;
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false, "티켓 보유만으로는 미완료");
context.runTierCommand();
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true, "티켓 보유 후 명령 입력 시 승급 실패여도 완료");
assert.strictEqual(tierQuestSaves, 1, "승급 불가 시에도 퀘스트 진행 저장");
delete data.member[user].bag["티어 승급티켓🎟"];
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true, "입력 후 티켓 소진해도 완료 유지");
assert.strictEqual(context.getAdventureQuestGoalLines(state, { complete: true }, false)[0].indexOf("[✅]"), 0);

state.currentStage = 6;
state.progress = { exploreSelected: true };
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false);
state.progress = {};
assert.strictEqual(context.recordAdventureQuestExploreSelection(data, user, "11"), false, "지도 조회 전 탐험지 지정 불가");
assert.strictEqual(context.recordAdventureQuestAction(data, user, 6, "mapViewed", 0), true);
assert.strictEqual(context.recordAdventureQuestExploreSelection(data, user, "11"), true);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false, "탐험지 지정만으로 완료 불가");
assert.strictEqual(context.recordAdventureQuestExploreResult(data, user, "1"), false, "다른 탐험지 정산은 인정하지 않음");
assert.strictEqual(context.recordAdventureQuestExploreResult(data, user, "11"), true, "이벤트 탐험지 11번 정상 정산 인정");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true);
assert.strictEqual(context.getAdventureQuestGoalLines(state, { complete: true }, false).filter(line => line.indexOf("[✅]") === 0).length, 3);
assert.strictEqual(context.recordAdventureQuestExploreSelection(data, user, "11"), true, "같은 탐험지 재확인 인정");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true, "같은 탐험지 재확인 시 이미 받은 결과 유지");
assert.strictEqual(context.recordAdventureQuestExploreSelection(data, user, "1"), true, "다른 탐험지 재지정 시 새 결과 필요");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false);
assert.strictEqual(context.recordAdventureQuestExploreResult(data, user, "1"), true);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true);

state.currentStage = 7;
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), true);
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), false);
assert.strictEqual(inventory["펫먹이🍼"], 100000);
state.currentStage = 8;
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), true);
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), false);
assert.strictEqual(inventory["스킬북📙"], 1);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, { tester: { petSkills: { equipped: [] } } }, home, {}, {}, user).complete, false);
state.progress.skillBookOpened = true;
state.progress.skillEquipped = true;
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, { tester: { petSkills: { equipped: ["스킬"] } } }, home, {}, {}, user).complete, true);

state.currentStage = 9;
home.tester.floor = 100;
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), true);
assert.strictEqual(state.progress.maxFloorAtEntry, true);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, true);
assert.strictEqual(context.completeAdventureQuestStage(data, user).stage, 9);
state.currentStage = 9;
assert.strictEqual(context.completeAdventureQuestStage(data, user), null);
state.currentStage = 10;
assert.strictEqual(state.currentStage, 10);
assert.strictEqual(state.completedStages.filter(number => number === 9).length, 1);

state.currentStage = 14;
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), true);
assert.strictEqual(context.prepareAdventureQuestStage(data, user, {}, home), false);
assert.strictEqual(inventory["홈뱃지 큐브💟"], 100);
const badgeActivity = { equippedBadgeIds: ["badge-a", null] };
const realmArray = vm.runInContext("Array", context);
data.member[user].homeBadgeCube = { equippedBadgeIds: realmArray.of("badge-a", null) };
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user).complete, false, "기존 장착만으로는 완료 불가");
const preEquippedCheck = context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user);
const preEquippedMessage = context.buildAdventureQuestIncompleteMessage(data, {}, {}, user, preEquippedCheck);
assert(preEquippedMessage.includes("👉 /홈뱃지큐브"));
assert(!preEquippedMessage.includes("👉 /홈뱃지장착"));
state.progress.homeBadgeCubeUsed = true;
state.progress.cubedBadgeIds = realmArray.of("badge-a");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user).complete, true, "사전 장착 후 큐브 사용 인정");
badgeActivity.equippedBadgeIds = [null, null];
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user).complete, false, "해제된 뱃지는 완료 불가");
let badgeCheck = context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user);
let badgeMessage = context.buildAdventureQuestIncompleteMessage(data, {}, {}, user, badgeCheck);
assert(badgeMessage.includes("큐브를 사용한 홈뱃지 장착·적용"));
assert(!badgeMessage.includes("[✅] 홈뱃지 큐브"));
assert(!badgeMessage.includes("👉 /홈뱃지큐브"));
badgeActivity.equippedBadgeIds = ["badge-a", null];
data.member[user].homeBadgeCube.equippedBadgeIds = realmArray.of(null, null);
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user).complete, false, "큐브 적용 동기화 누락은 완료 불가");
data.member[user].homeBadgeCube.equippedBadgeIds = realmArray.of("badge-a", null);
state.progress.cubedBadgeIds.push("badge-b");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, badgeActivity, user).complete, true, "다른 뱃지를 추가로 큐브 사용해도 기존 장착 뱃지 인정");
state.currentStage = 13;
state.progress = { diamondShopViewed: true, diamondShopPurchase: 1 };
const shopCheck = context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user);
const shopMessage = context.buildAdventureQuestIncompleteMessage(data, {}, {}, user, shopCheck);
assert(shopMessage.includes("인정 상품 구매 · 1/2개"));
assert(!shopMessage.includes("[✅] 다이아상점 조회"));
assert(!shopMessage.includes("👉 /다이아상점\n"));
assert.strictEqual(context.applyPercentWithExactFloor(100000, 0.005), 100005);
assert.strictEqual(context.removePercentWithExactCeil(100005, 0.005), 100000);
const totalsData = { member: { all: { exp: 0 } } };
const totalsState = context.getAdventureQuestState(totalsData, "all", true);
for (let stage = 1; stage <= 16; stage++) {
    assert.strictEqual(context.completeAdventureQuestStage(totalsData, "all").stage, stage);
}
assert.strictEqual(totalsState.currentStage, 17);
assert.strictEqual(totalsState.totals.castlePercent, 0.08);
assert.strictEqual(totalsState.totals.raidPercent, 0.08);
assert.strictEqual(totalsState.totals.diamondBoxes, 680);
assert.strictEqual(totalsState.totals.experience, 16000);
assert.strictEqual(totalsState.titles.length, 16);
assert.strictEqual(context.completeAdventureQuestStage(totalsData, "all"), null);
assert.strictEqual(context.getAdventureQuestNextStageMessage(totalsData, "all").includes("Lv.17부터 진행 가능"), true);
assert(context.buildAdventureQuestIncompleteMessage(totalsData, {}, {}, "all", { complete: false }).includes("본편 공개 대기"));
const rewardsAfterTutorial = inventory["다이아상자💎"];
assert.strictEqual(context.completeAdventureQuestStage(totalsData, "all"), null);
assert.strictEqual(inventory["다이아상자💎"], rewardsAfterTutorial);
assert(main.includes('if (adventureQuestState.currentStage > GLOBAL_CONFIG.adventureQuest.tutorialMaxStage) {'));
const questCommandStart = main.indexOf('if (msg === "/모험가퀘스트" || msg === "/퀘스트완료"');
const questMutationStart = main.indexOf('var adventureQuestMemberSnapshot =', questCommandStart);
assert(questCommandStart >= 0 && questMutationStart > questCommandStart);
const responseStart = main.indexOf('function response(room, msg, sender, isGroupChat, replier, imageDB, packageName)');
const questCommandGuard = main.slice(responseStart, questCommandStart);
assert(/if \(msg === "\/퀘스트완료" && room !== testRoom\) return;/.test(questCommandGuard));
assert(main.indexOf('if (msg === "/퀘스트완료" && room !== testRoom) return;') < main.indexOf('if (ctx.isDev && msg === "/데이터백업")'));
assert(main.includes('const testRoom = "팻 테스트방";'));
assert(!main.includes('recordAdventureQuestAction(data, sender, 2, "shopViewed", 0)'), "상점 조회는 2단계 필수 조건 아님");
assert(main.indexOf('var tierQuestCommandRecorded = hasItem(data, sender, GLOBAL_CONFIG.adventureQuest.tierTicketItemName, 1) && recordAdventureQuestAction(data, sender, 2, "tierTicketApplied", 0);') < main.indexOf('if (!tierPlan || !tierPlan.canPromote) {'), "티켓 보유를 승급 판정 전에 확인");
assert(main.includes('if (tierQuestCommandRecorded) saveJsonFile(data, filePath);'), "승급 불가 시에도 퀘스트 진행 저장");
const exploreCommandStart = main.indexOf('if (msg === "/탐" || /^\\/탐\\s+\\d+$/.test(msg)) {');
const exploreCommandEnd = main.indexOf('// 길드 =================', exploreCommandStart);
const exploreCommand = main.slice(exploreCommandStart, exploreCommandEnd);
assert(exploreCommandStart >= 0 && exploreCommandEnd > exploreCommandStart);
assert(main.includes('if (recordAdventureQuestAction(data, sender, 6, "mapViewed", 0)) saveJsonFile(data, filePath);'), "지도 조회 기록 저장");
assert(!exploreCommand.includes('questExploreInputRecorded'), "이벤트 차단 전 입력만으로 기록하지 않음");
assert(exploreCommand.indexOf('recordAdventureQuestExploreSelection(data, sender, dungeonNo)') > exploreCommand.indexOf('if (isChuseokExploreEventActive(petExploreData)) {'), "유효한 등록 이후 탐험지 기록");
assert(exploreCommand.includes('if (parts.length === 2) recordAdventureQuestExploreSelection(data, sender, dungeonNo);'), "번호를 지정한 명령만 기록");
assert(main.includes('recordAdventureQuestExploreResult(data, user, config.slot);'), "이벤트 정상 정산 결과 기록");
assert(main.includes('recordAdventureQuestExploreResult(data, user, dk);'), "일반 정상 정산 결과 기록");
assert.strictEqual(context.getAdventureQuestPreparationLines({ currentStage: 14, receipts: {} })[1], "홈뱃지 큐브💟 ×100개");
assert.strictEqual(context.getAdventureQuestPreparationLines({ currentStage: 14, receipts: {} })[0], "📦 최초 1회 지급");
assert(!/^\s*saveJsonFile\(/m.test(info), "Info.js must not call the main-only save helper");
assert(main.includes('msg === "/일퀘완료"'));
assert(!info.includes('"/퀘스트완료" 또는 "/ㅇ"'));
const starterContext = {
    getAdventureOnboardingMemberState: (fixture, name) => fixture.member[name].adventureOnboarding,
    getUserIntimacyInfo: (fixture, name) => {
        const key = Object.keys(fixture.member[name].bag).find(item => item.startsWith("펫 친밀도🐾"));
        return { exists: !!key, itemKey: key || null, level: key ? Number((key.match(/Lv\.(\d+)/) || [])[1]) : 0 };
    },
    buildIntimacyItemName: (level, progress, exp) => `펫 친밀도🐾 [Lv.${level}](${progress}/1000)+${exp}💕`,
    getAdventureQuestState: (fixture, name) => fixture.member[name].adventureQuest,
    addPoint: (fixture, name, count) => { fixture.member[name].point = (fixture.member[name].point || 0) + count; },
    addItem: (fixture, name, item, count) => { fixture.member[name].bag[item] = (fixture.member[name].bag[item] || 0) + count; },
    GLOBAL_CONFIG: { petSkill: { bookItemName: "스킬북📙" } }
};
vm.createContext(starterContext);
vm.runInContext(["applyAdventureStarterIntimacyReward", "applyAdventureStarterMemberRewards"].map(name => extractFunction(name)).join("\n"), starterContext);
const starterFixture = { member: {
    newbie: { bag: {}, adventureOnboarding: { stage: "APPLYING", receipts: {} }, adventureQuest: { receipts: {} } },
    existing: { bag: { "펫 친밀도🐾 [Lv.100](0/1000)+110000💕": 1 }, adventureQuest: { receipts: {} } },
    advanced: { bag: { "펫 친밀도🐾 [Lv.350](0/1000)+385000💕": 1 }, adventureOnboarding: { stage: "APPLYING", receipts: {} } }
} };
assert.strictEqual(starterContext.applyAdventureStarterIntimacyReward(starterFixture, "newbie"), true);
assert.strictEqual(starterFixture.member.newbie.bag["펫 친밀도🐾 [Lv.300](0/1000)+330000💕"], 1);
assert.strictEqual(starterContext.applyAdventureStarterIntimacyReward(starterFixture, "newbie"), false);
assert.strictEqual(starterContext.applyAdventureStarterMemberRewards(starterFixture, "newbie"), true);
assert.strictEqual(starterContext.applyAdventureStarterMemberRewards(starterFixture, "newbie"), false);
assert.strictEqual(starterFixture.member.newbie.bag["펫 친밀도🐾 [Lv.300](0/1000)+330000💕"], 1);
assert.strictEqual(starterContext.applyAdventureStarterMemberRewards(starterFixture, "existing"), true);
assert.strictEqual(starterFixture.member.existing.bag["펫 친밀도🐾 [Lv.100](0/1000)+110000💕"], 1);
assert.strictEqual(starterFixture.member.existing.bag["펫 친밀도🐾 [Lv.300](0/1000)+330000💕"], undefined);
assert.strictEqual(starterContext.applyAdventureStarterIntimacyReward(starterFixture, "advanced"), false);
assert.strictEqual(starterFixture.member.advanced.bag["펫 친밀도🐾 [Lv.350](0/1000)+385000💕"], 1);
for (const source of [main, info]) {
    const charmContext = {
        calculateCastleItem: () => 140000,
        calculateItemInfoAll: () => ({ castleExp: 0, raidExp: 150000 }),
        getHomeTotalExp: () => 0,
        hasPetSkill: () => false,
        getIntimacyExpFromBag: bag => bag.intimacy || 0,
        getEquippedNonTierPetSkillExp: () => 0,
        getEquippedTierPetSkillExp: () => 0,
        getHomeBadgeCubeActiveOptionPercent: () => 0,
        getGuildContributionCubeMemberPercent: () => 0,
        getAdventureLevelCharmPercent: () => 0,
        getInfoAdventureLevelSummary: () => ({ charmPercent: 0 })
    };
    vm.createContext(charmContext);
    const percentName = source === main ? "applyPercentWithExactFloor" : "applyInfoPercentWithExactFloor";
    vm.runInContext([percentName, "calculateCastleExp", "calculateRaidExp"].map(name => extractFunction(name, source)).join("\n"), charmContext);
    const charmData = { member: { tester: { lv: 1, bag: { intimacy: 0 }, adventureQuest: { totals: { castlePercent: 0, raidPercent: 0 } } } } };
    const pet = { tester: { petexp: 0 } };
    assert.strictEqual(charmContext.calculateCastleExp("tester", charmData, pet, {}, {}, false, {}), 140000);
    assert.strictEqual(charmContext.calculateRaidExp("tester", charmData, pet, {}, {}, false, {}), 150000);
    charmData.member.tester.bag.intimacy = 330000;
    charmData.member.tester.adventureQuest.totals.castlePercent = 0.005;
    charmData.member.tester.adventureQuest.totals.raidPercent = 0.005;
    assert.strictEqual(charmContext.calculateCastleExp("tester", charmData, pet, {}, {}, false, {}), 470023);
    assert.strictEqual(charmContext.calculateRaidExp("tester", charmData, pet, {}, {}, false, {}), 150007);
}
console.log("PASS adventure quest tutorial synthetic checks");
