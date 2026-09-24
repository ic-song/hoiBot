const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("Info.js", "utf8");
const start = source.indexOf("function getInfoAdventureLevelTitle(");
const end = source.indexOf("// Info 명령에서 후원패스 날짜 문자열", start);
assert(start >= 0 && end > start, "level message helpers not found");

const context = {
    GLOBAL_CONFIG: { level: { titles: ["테스트 칭호"], baseCharmPercent: 0.15, normalPromotionPercent: 0.5, majorPromotionPercent: 5 } },
    allsee: "[ALLSEE]",
    checkRank: (data, pets, guild, user) => user,
    numberWithCommas: value => String(value),
    formatInfoAdventureExperience: value => String(Math.floor(value)),
    getInfoLevelRequiredExperience: level => level * 1000
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const sample = { member: { tester: { lv: 40, exp: 1595, boostercnt: 0, adventureQuest: {
    completedStages: [1, 2, 3, 4, 5, 6],
    totals: { castlePercent: 0.03, raidPercent: 0.035 }
} } } };
const before = JSON.stringify(sample);
const message = context.buildInfoLevelMessage(sample, {}, {}, "tester");
assert(message.includes("캐슬매력⚔️: +7.88% · 레이드매력👾: +7.885%"));
assert(message.includes("레벨 성장: ⚔️+5.85% · 👾+5.85%"));
assert(message.includes("승급: ⚔️+2% · 👾+2%"));
assert(message.includes("대승급: ⚔️+0% · 👾+0%"));
assert(message.includes("모험가 퀘스트: ⚔️+0.03% · 👾+0.035%"));
assert(message.includes("전체보기에서 확인하세요 👇[ALLSEE]\n━━━━━━━━━━━━"));
assert.strictEqual(JSON.stringify(sample), before, "level lookup changed member data");

const boundary = context.getInfoAdventureRewardSummary(100, 0.005, 0);
assert.strictEqual(boundary.levelPercent, 14.85);
assert.strictEqual(boundary.promotionPercent, 4.5);
assert.strictEqual(boundary.majorPercent, 5);
assert.strictEqual(boundary.castleTotalPercent, 24.355);
assert.strictEqual(boundary.raidTotalPercent, 24.35);
console.log("PASS level reward summary totals and read-only UI");
