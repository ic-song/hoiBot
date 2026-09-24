const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
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

const stage = { currentStage: 6, progress: {}, completedStages: [], records: [], titles: [], receipts: {}, totals: {} };
const data = { member: { tester: { point: 100000000, adventureQuest: stage } } };
const explore = { bet: { "11": [] }, userBet: {}, chuseokEvent: { processedHours: {}, balances: {} } };
const saves = [];
const replies = [];
const context = {
    data, sender: "tester", msg: "", petData: {}, guildData: {}, petSkillData: {},
    filePath: "synthetic-member.json", petExplorePath: "synthetic-explore.json", homeDataFile: "synthetic-home.json",
    GLOBAL_CONFIG: { petExplore: { chuseokEvent: { slot: "11", participationFee: 50000000, rewardMin: 1, rewardMax: 1 }, experienceRewards: { event: 10 }, slots: { regularMax: 9 } } },
    replier: { reply: message => replies.push(message) },
    loadJsonFile: file => file === "synthetic-explore.json" ? explore : {},
    saveJsonFile: (_value, file) => saves.push(file),
    initPetExploreData: value => value,
    cleanupInvalidPetExploreUsers: () => {},
    savePetExploreMigrationIfNeeded: () => {},
    isChuseokExploreEventActive: () => true,
    isPetExploreEventMineActive: () => false,
    isGuildRaidExploreEventActive: () => false,
    isRegularDungeonExploreSlot: () => false,
    isRegularMineExploreSlot: value => value === "1",
    isCurrentGuildMemberForChuseok: () => true,
    buildPetExploreStatusMessage: () => "지도 화면",
    buildExploreBetMessage: () => "탐험지 등록",
    checkRank: () => "테스터",
    getCurrentDate: () => "20260924",
    calcExploreSuccessPercent: () => ({ totalP: 0 }),
    pickAndConsumeExploreUpItem: () => null,
    updatePetExploreRecord: value => value,
    getChuseokCarrotBalance: () => 0,
    migrateChuseokCarrotBalance: () => {},
    getExploreTreasureUsageInfo: () => ({ applied: false }),
    getPetExploreBaseExperience: () => 3,
    getExploreDungeonName: () => "1번 광산",
    getExploreSuccessRewardItem: () => "광산상자",
    getTreasureHunterBonusReward: () => null,
    addItem: () => {},
    grantPetExploreExperience: () => ({ message: "EXP 지급", boosterDepletionMessage: "", levelUpMessage: "" }),
    autoExploreBetting: (_data, value) => value,
    resetChuseokExploreRound: value => { value.bet["11"] = []; value.userBet = {}; return value; },
    resetPetExploreBet: value => { value.bet["1"] = []; value.userBet = {}; return value; },
    clearPetExploreTransientSaveFlags: () => {},
    buildPetExploreLevelUpSummary: () => "",
    numberWithCommas: value => String(value),
    allsee: "[상세]"
};
vm.createContext(context);
for (const name of [
    "getAdventureQuestState", "recordAdventureQuestAction", "recordAdventureQuestExploreSelection",
    "recordAdventureQuestExploreResult", "getAdventureQuestCompletionCheck", "doChuseokExploreInterval", "doPetExploreInterval"
]) vm.runInContext(extractFunction(name), context);

const mapStart = source.indexOf('if (msg === "/지도") {');
const mapEnd = source.indexOf('if (msg === "/탐험유저확인"', mapStart);
assert(mapStart >= 0 && mapEnd > mapStart);
vm.runInContext("function runMapCommand() { " + source.slice(mapStart, mapEnd) + " }", context);
const exploreStart = source.indexOf('if (msg === "/탐" || /^\\/탐\\s+\\d+$/.test(msg)) {');
const exploreEnd = source.indexOf("// 길드 =================", exploreStart);
assert(exploreStart >= 0 && exploreEnd > exploreStart);
vm.runInContext("function runExploreCommand() { " + source.slice(exploreStart, exploreEnd) + " }", context);

context.msg = "/탐 1";
context.runExploreCommand();
assert.strictEqual(stage.progress.exploreSelected, undefined, "이벤트 중 거절된 1번 입력은 미인정");
assert.strictEqual(saves.length, 0, "거절된 입력으로 퀘스트 저장 없음");

context.msg = "/지도";
context.runMapCommand();
assert.strictEqual(stage.progress.mapViewed, true);
assert.deepStrictEqual(saves, ["synthetic-member.json"]);
context.msg = "/탐 1";
context.runExploreCommand();
assert.strictEqual(stage.progress.exploreSelected, undefined, "지도 조회 후라도 이벤트에서 거절된 번호는 미인정");

context.msg = "/탐 11";
context.runExploreCommand();
assert.strictEqual(stage.progress.exploreSelected, true);
assert.strictEqual(stage.progress.exploreSelectedDungeon, "11");
assert.strictEqual(explore.userBet.tester, "11");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, false, "등록만으로는 미완료");

data.member.tester.point = 0;
context.doChuseokExploreInterval(data, {}, {}, {}, explore, {});
assert.strictEqual(stage.progress.exploreResult, false, "포인트 부족으로 정산 제외된 사용자는 미인정");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, false);

data.member.tester.point = 100000000;
context.runExploreCommand();
const failedReport = context.doChuseokExploreInterval(data, {}, {}, {}, explore, {});
assert(failedReport.includes("실패(❌)"));
assert.strictEqual(stage.progress.exploreResult, true, "정상 참가 후 탐험 실패도 인정");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, true);

stage.progress = {};
explore.chuseokEvent.processedHours = {}; // 독립적인 다음 정산 회차
context.msg = "/지도";
context.runMapCommand();
context.msg = "/탐 11";
context.runExploreCommand();
context.calcExploreSuccessPercent = () => ({ totalP: 100 });
const successReport = context.doChuseokExploreInterval(data, {}, {}, {}, explore, {});
assert(successReport.includes("성공(✅)"));
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, true, "성공 정산도 인정");
assert(replies.includes("지도 화면") && replies.includes("탐험지 등록"));
assert(saves.filter(file => file === "synthetic-member.json").length >= 4, "행동·정산이 회원 데이터에 저장됨");

context.isChuseokExploreEventActive = () => false;
context.calcExploreSuccessPercent = () => ({ totalP: 0 });
stage.progress = {};
explore.bet["1"] = [];
context.msg = "/지도";
context.runMapCommand();
context.msg = "/탐 1";
context.runExploreCommand();
assert.strictEqual(explore.userBet.tester, "1", "일반 탐험지 등록");
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, false);
const normalReport = context.doPetExploreInterval(data, {}, {}, {}, explore, {});
assert(normalReport.includes("실패(❌)"));
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, {}, explore, {}, "tester").complete, true, "일반 탐험 실패 정산도 인정");

console.log("PASS tutorial stage 6 command, event and regular settlement simulation");
