const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(require("path").join(__dirname, "..", "main.js"), "utf8");

if (source.indexOf("boosterConsumptionPerBaseExp: 2") < 0) {
    throw new Error("가호 최대 추가 경험치 비율 설정이 2가 아닙니다.");
}

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    if (start < 0) throw new Error("함수를 찾을 수 없습니다: " + name);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error("함수 범위를 찾을 수 없습니다: " + name);
}

const context = {
    GLOBAL_CONFIG: { level: { boosterExtraMultiplier: 2, boosterConsumptionPerBaseExp: 2 } },
    roundToTwo: value => Math.round(value * 100) / 100,
    getAutoDailyBatchContext: () => null,
    formatAdventureExperience: value => String(value),
    numberWithCommas: value => String(value)
};
vm.createContext(context);
vm.runInContext(extractFunction("applyAdventureExperienceBooster"), context);
vm.runInContext(extractFunction("buildBattleExperienceRewardMessage"), context);

const depletionContext = {
    GLOBAL_CONFIG: { level: { boosterName: "호월신의 가호✨ (경험치 3배)" } },
    checkRank: () => "💛호이 남_⚔︎"
};
vm.createContext(depletionContext);
vm.runInContext(extractFunction("buildAdventureBoosterDepletionMessage"), depletionContext);
const depletionMessage = depletionContext.buildAdventureBoosterDepletionMessage(
    { member: { "호이 남": { boostercnt: 0 } } }, {}, {}, "호이 남", { usedBooster: 10 }
);
if (depletionMessage !== "[💛호이 남_⚔︎] 님의\n호월신의 가호✨ (경험치 3배) 이(가)\n모두 소진되었습니다.\n안내링크:") {
    throw new Error("가호 별도 소진 문구 검증 실패: " + depletionMessage);
}

function verify(base, booster, expectedExtra, expectedUsed, expectedRemain) {
    const member = { boostercnt: booster };
    const result = context.applyAdventureExperienceBooster(member, base);
    if (result.extraExperience !== expectedExtra || result.usedBooster !== expectedUsed || member.boostercnt !== expectedRemain) {
        throw new Error(JSON.stringify({ base, booster, result, remain: member.boostercnt }));
    }
    console.log("PASS base=" + base + " booster=" + booster + " extra=" + result.extraExperience + " used=" + result.usedBooster + " remain=" + member.boostercnt);
}

verify(100, 0, 0, 0, 0);
verify(100, 10, 10, 10, 0);
verify(100, 200, 200, 200, 0);
verify(100, 500, 200, 200, 300);
verify(22.5, 10, 10, 10, 0);
verify(22.5, 45, 45, 45, 0);

const message = context.buildBattleExperienceRewardMessage(110, 100, 10, 0, 10);
if (message.indexOf("호월신의 가호 적용! (+10exp)") < 0 || message.indexOf("가호 사용: 10개") < 0) {
    throw new Error("가호 적용·소비 문구 검증 실패: " + message);
}

const tierChecks = [
    'tierProgressPlan.user = checkRank(data, petData, guildData, sender)',
    'tierPlan.user = checkRank(data, petData, guildData, sender)',
    'var promotedRankName = checkRank(data, petData, guildData, sender)',
    '"❌ [" + plan.user + "] 님 승급 재료가 부족해요"',
    '"🏅 [" + plan.user + "]님의 티어"'
];
for (const expected of tierChecks) {
    if (source.indexOf(expected) < 0) throw new Error("checkRank 연결 검증 실패: " + expected);
}

const rankContext = {
    ticketTierData: { 노랑하트: { emoji: "💛" }, 킹: { emoji: "👑" } },
    guildPath: "",
    loadJsonFile: () => ({}),
    getMyGuildInfo: () => ({ error: true })
};
vm.createContext(rankContext);
vm.runInContext(extractFunction("getCheckRankTierEmoji"), rankContext);
vm.runInContext(extractFunction("checkRank"), rankContext);
const rankData = { member: { "사람 남": { rank: { tier: "노랑하트", emoji: "💛" } } } };
if (rankContext.checkRank(rankData, {}, {}, "사람 남") !== "💛사람 남") throw new Error("승급 전 checkRank 검증 실패");
rankData.member["사람 남"].rank.tier = "킹";
rankData.member["사람 남"].rank.emoji = "👑";
if (rankContext.checkRank(rankData, {}, {}, "사람 남") !== "👑사람 남") throw new Error("승급 후 checkRank 재계산 검증 실패");

const consumptionMessageCallChecks = [
    "buildBattleExperienceRewardMessage(castleTierExpResult.total, expGain, expFromBooster, castleTierExpResult.bonus, castleBoosterResult.usedBooster)",
    "buildBattleExperienceRewardMessage(miniTierExpResult.total, expGain, expFromBooster, miniTierExpResult.bonus, miniBoosterResult.usedBooster)",
    "buildQuestExperienceRewardMessage(dailyExperienceResult, dailyBaseExperience, dailyBoosterResult.extraExperience, dailyBoosterResult.usedBooster)",
    "buildQuestExperienceRewardMessage(premiumExperienceResult, premiumBaseExperience, premiumBoosterResult.extraExperience, premiumBoosterResult.usedBooster)",
    "buildQuestExperienceRewardMessage(weeklyExperienceResult, weeklyBaseExperience, weeklyBoosterResult.extraExperience, weeklyBoosterResult.usedBooster)",
    "buildBattleExperienceRewardMessage(experienceResult.total, baseExperience, boosterResult.extraExperience, experienceResult.bonus, boosterResult.usedBooster)",
    'attendanceRewardMessage += "\\n└ 가호 사용: " + numberWithCommas(attendanceBoosterResult.usedBooster) + "개"'
];
for (const expected of consumptionMessageCallChecks) {
    if (source.indexOf(expected) < 0) throw new Error("가호 소비 문구 연결 검증 실패: " + expected);
}

const separateDepletionChecks = [
    "if (castleBoosterDepletionMessage && autoDailyQuestInternalDepth <= 0) replier.reply(castleBoosterDepletionMessage)",
    "if (miniBoosterDepletionMessage && autoDailyQuestInternalDepth <= 0) replier.reply(miniBoosterDepletionMessage)",
    "if (rewardResult.boosterDepletionMessage) replier.reply(rewardResult.boosterDepletionMessage)",
    "if (autoDailyResult.boosterDepletionMessage) replier.reply(autoDailyResult.boosterDepletionMessage)"
];
for (const expected of separateDepletionChecks) {
    if (source.indexOf(expected) < 0) throw new Error("가호 별도 소진 출력 연결 검증 실패: " + expected);
}

const attendanceChecks = [
    "attendanceBoosterResult = applyAdventureExperienceBooster(member, GLOBAL_CONFIG.attendance.bonusExp)",
    "attendanceExpResult = addMemberExperienceWithTierBonus(data, user, attendanceBoosterResult.totalExperience)",
    'attendanceRewardMessage += "\\n└ 가호 사용: " + numberWithCommas(attendanceBoosterResult.usedBooster) + "개"',
    "boosterUsed: attendanceBoosterResult.usedBooster"
];
for (const expected of attendanceChecks) {
    if (source.indexOf(expected) < 0) throw new Error("출석 가호 적용 연결 검증 실패: " + expected);
}

const onboardingChecks = [
    "currentIntimacy.level < 300",
    "buildIntimacyItemName(300, 0, 330000)"
];
for (const expected of onboardingChecks) {
    if (source.indexOf(expected) < 0) throw new Error("신규 모험가 친밀도 300 검증 실패: " + expected);
}

const boosterHelperSource = extractFunction("applyAdventureExperienceBooster");
if (boosterHelperSource.indexOf("loadJsonFile") >= 0 || boosterHelperSource.indexOf("saveJsonFile") >= 0) {
    throw new Error("가호 계산 helper 내부에 파일 IO가 포함되어 있습니다.");
}

console.log("PASS adventure booster boundaries, consumption message, tier checkRank wiring");
