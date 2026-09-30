const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 현재 소스에서 검증할 계산 함수를 가져온다.
function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name);
    const opening = source.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed: " + name);
}

// 미니펫 외 매력은 0으로 고정해 실제 대표·보조 계산 경로를 분리 검증한다.
function makeContext(source, isInfo) {
    const c = {
        calculateCastleItem: () => 0,
        calculateItemInfoAll: () => ({ castleExp: 0, raidExp: 0 }),
        getHomeTotalExp: () => 0,
        hasPetSkill: () => false,
        getIntimacyExpFromBag: () => 0,
        getEquippedNonTierPetSkillExp: () => 0,
        getEquippedTierPetSkillExp: () => 0,
        getHomeBadgeCubeActiveOptionPercent: () => 0,
        getGuildContributionCubeMemberPercent: () => 0,
        getAdventureLevelCharmPercent: () => 0,
        getInfoAdventureLevelSummary: () => ({ charmPercent: 0 }),
        calculatePetUpgradeCharm: () => 0,
        numberWithCommas: n => Number(n).toLocaleString("en-US"),
        checkRank: (_data, _pets, _guild, user) => user,
        getHoiPassPremiumHeader: () => "",
        getMiniPetBattleRank: () => "순위없음",
        GLOBAL_CONFIG: { daily: { miniPetBattleMax: 15, miniPetBattleFree: 1 } },
        allsee: "<ALLSEE>"
    };
    vm.createContext(c);
    const names = ["getMiniPetModeCharm", "calculateCastleExp", "calculateRaidExp", "calculateTotalExp",
        isInfo ? "applyInfoPercentWithExactFloor" : "applyPercentWithExactFloor"];
    if (isInfo) names.push("formatPetInfo", "formatKoreanShort", "getMiniPetUpgradeDisplay");
    else names.push("buildMiniPetInfoRenewedMessage", "getMiniPetDisplayTitle");
    for (const name of names) vm.runInContext(extractFunction(source, name), c);
    return c;
}

const contexts = [makeContext(main, false), makeContext(info, true)];
const data = { member: { test: { bag: {}, lv: 1, battle: { score: 0 } } } };
const pets = { test: { petname: "테스트펫", petimg: "🐶", petexp: 0,
    miniPet: { name: "대표", emoji: "🐹", grade: "일반", battleExp: 375250 },
    miniPetSupport: { name: "보조", emoji: "📝", grade: "일반", battleExp: 1622350 },
    miniPetBag: [{ battleExp: 999999999 }] } };

// 대표·보조, 보조만, 홀수, 미장착, 가방 제외의 다섯 경계값을 대조한다.
const fixtures = [
    { primary: 375250, support: 1622350, expected: 1186425 },
    { primary: null, support: 1622350, expected: 811175 },
    { primary: 100, support: 5, expected: 102 },
    { primary: 100, support: null, expected: 100 },
    { primary: null, support: null, expected: 0 }
];
for (const fixture of fixtures) {
    const p = { test: { miniPetBag: [{ battleExp: 999999999 }] } };
    if (fixture.primary !== null) p.test.miniPet = { battleExp: fixture.primary };
    if (fixture.support !== null) p.test.miniPetSupport = { battleExp: fixture.support };
    for (const c of contexts) {
        assert.strictEqual(c.getMiniPetModeCharm("test", p), fixture.expected);
        assert.strictEqual(c.calculateCastleExp("test", data, p, {}, {}, false, {}), fixture.expected);
        assert.strictEqual(c.calculateRaidExp("test", data, p, {}, {}, false, {}), fixture.expected);
        assert.strictEqual(c.calculateTotalExp("test", data, p, {}, {}, {}), fixture.expected * 2);
    }
}

// 퍼센트 보너스는 대표+보조50%의 합산 이후에 적용되는지 검증한다.
data.member.test.adventureQuest = { totals: { castlePercent: 10, raidPercent: 20 } };
for (const c of contexts) {
    assert.strictEqual(c.calculateCastleExp("test", data, pets, {}, {}, false, {}), 1305067);
    assert.strictEqual(c.calculateRaidExp("test", data, pets, {}, {}, false, {}), 1423710);
    assert.strictEqual(c.calculateTotalExp("test", data, pets, {}, {}, {}), 2728777);
}
delete data.member.test.adventureQuest;

// 실제 /펫정보 응답 분기와 계산 함수들을 함께 실행한다.
const c = contexts[1];
const replies = [];
Object.assign(c, {
    msg: "/펫정보", sender: "test", data, petData: pets, petSkillData: {}, guildData: {},
    petTitleData: { member: { test: {} } },
    homeDataFile: "home", petExplorePath: "explore", trialTowerPath: "tower", castleBattlePath: "castle",
    loadJsonFile: () => ({}), initSweetHomeUser: home => home,
    calculateEffectivePetUpgradeLevel: () => 0, getCritChance: () => 0, getCritMultiplier: () => 1,
    getIntimacyLvFromBag: () => "", getIntimacyUserRank: () => 0, getUserIntimacyInfo: () => ({ exp: 0 }),
    getMemberRank: () => 1, getTitle: () => "", initPetSkillUser: () => ({ equipped: [] }),
    getPetSkillSlotCount: () => 0, getCastleBattleRankEmoji: () => "",
    hasInfoPrivateChatPass: () => false, isInfoSupportPassActive: () => false,
    getC: () => "", formatDoneLine: () => "", getPetExploreRank: () => null,
    getWeeklyQuestRemainText: () => "", replier: { reply: message => replies.push(message) }
});
const start = info.indexOf('if (msg === "/펫정보" ||');
const end = info.indexOf('if (msg === "/펫매력순위")', start);
assert(start >= 0 && end > start);
vm.runInContext("function runPetInfo() { " + info.slice(start, end) + " }", c);
const before = JSON.stringify(pets.test.miniPetSupport);
c.runPetInfo();
const output = replies[1];
assert(output.includes("종합매력👑: " + c.formatKoreanShort(2372850)));
assert(output.includes("캐슬매력⚔️: " + c.formatKoreanShort(1186425)));
assert(output.includes("레이드매력👾: " + c.formatKoreanShort(1186425)));
assert.strictEqual(JSON.stringify(pets.test.miniPetSupport), before);
const miniOutput = contexts[0].buildMiniPetInfoRenewedMessage("test", data, pets, {}, {}, false);
assert(miniOutput.includes("└ 매력 811,175💞"));
assert(miniOutput.includes("종합매력 반영: +2,372,850"));
console.log("Mini-pet support: 5 boundary fixtures, percent bonuses and actual /펫정보 output passed");
console.log(output.split("\n").filter(line => /종합매력|캐슬매력|레이드매력|미니🐹/.test(line)).join("\n"));
