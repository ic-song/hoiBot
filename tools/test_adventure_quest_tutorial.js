const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(name) {
    const start = main.indexOf("function " + name + "(");
    assert(start >= 0, "missing function: " + name);
    const brace = main.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < main.length; i++) {
        if (main[i] === "{") depth++;
        if (main[i] === "}" && --depth === 0) return main.slice(start, i + 1);
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
        stages: Array.from({ length: 16 }, (_, index) => ({ number: index + 1, title: "제목" + (index + 1), record: "기록" + (index + 1) }))
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
    getPetHomeEquippedBadgeIds: (_activity, _user) => [1]
};
vm.createContext(context);
for (const name of [
    "getAdventureQuestState", "getAdventureQuestStageConfig", "recordAdventureQuestAction",
    "isAdventureQuestHomeAtMaximum", "prepareAdventureQuestStage",
    "getAdventureQuestCompletionCheck", "completeAdventureQuestStage",
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
assert.strictEqual(context.recordAdventureQuestAction(data, user, 2, "tierPurchased", 0), false);
assert.strictEqual(context.recordAdventureQuestAction(data, user, 2, "shopViewed", 0), true);
assert.strictEqual(context.recordAdventureQuestAction(data, user, 2, "tierPurchased", 0), true);
assert.strictEqual(context.recordAdventureQuestAction(data, user, 2, "tierViewed", 0), true);
assert.strictEqual(context.recordAdventureQuestAction(data, user, 2, "tierApplied", 0), true);
state.progress.appliedTier = "노랑하트";
assert.strictEqual(context.getAdventureQuestCompletionCheck(data, {}, {}, home, {}, {}, user).complete, false);
data.member[user].rank.tier = "노랑하트";
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
assert(main.includes('msg === "/일퀘완료"'));
assert(!info.includes('"/퀘스트완료" 또는 "/ㅇ"'));
console.log("PASS adventure quest tutorial synthetic checks");
