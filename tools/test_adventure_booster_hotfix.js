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
    processAdventureLevelUps: () => [],
    replyAutoDailyAdventureLevelUps: () => {},
    formatAdventureExperience: value => String(value),
    numberWithCommas: value => String(value)
};
vm.createContext(context);
const tierDataStart = source.indexOf("const ticketTierData =");
const tierDataEnd = source.indexOf("\n};", tierDataStart) + 3;
vm.runInContext(source.slice(tierDataStart, tierDataEnd).replace("const ticketTierData =", "ticketTierData ="), context);
const expectedTierExperienceBonuses = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 64, 68, 72, 76, 80, 85, 90, 95, 100, 106, 112, 118, 124, 130, 138, 146, 154, 162, 172, 182, 192, 202, 214, 226, 238];
const tierNames = Object.keys(context.ticketTierData);
if (tierNames.length !== expectedTierExperienceBonuses.length) throw new Error("티어 단계 수 검증 실패: " + tierNames.length);
tierNames.forEach((tierName, index) => {
    if (context.ticketTierData[tierName].experienceBonus !== expectedTierExperienceBonuses[index]) {
        throw new Error("티어 고정 EXP 검증 실패: " + tierName + " / " + context.ticketTierData[tierName].experienceBonus);
    }
});
vm.runInContext(extractFunction("normalizeTicketTierName"), context);
vm.runInContext(extractFunction("getTierExperienceBonus"), context);
vm.runInContext(extractFunction("applyAdventureExperienceBooster"), context);
vm.runInContext(extractFunction("addMemberExperienceWithTierBonus"), context);
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

function verifyTierExperience(tier, base, booster, expectedBonus, expectedTotal, expectedUsed, expectedRemain, excludeTierBonus) {
    const data = { member: { user: { rank: { tier }, exp: 0, boostercnt: booster } } };
    const result = context.addMemberExperienceWithTierBonus(data, "user", base, excludeTierBonus);
    if (result.bonus !== expectedBonus || result.total !== expectedTotal || result.boosterResult.usedBooster !== expectedUsed || data.member.user.boostercnt !== expectedRemain || data.member.user.exp !== expectedTotal) {
        throw new Error(JSON.stringify({ tier, base, booster, result, member: data.member.user }));
    }
    return result;
}

const fullTierResult = verifyTierExperience("노랑하트", 50, 999, 30, 240, 160, 839);
const partialTierResult = verifyTierExperience("노랑하트", 50, 100, 30, 180, 100, 0);
const noBoosterTierResult = verifyTierExperience("노랑하트", 50, 0, 30, 80, 0, 0);
verifyTierExperience("새싹", 1, 10, 1, 6, 4, 6);
verifyTierExperience("보라하트", 50, 0, 33, 83, 0, 0);
verifyTierExperience("노랑하트", 1, 10, 0, 3, 2, 8, true);

if (source.indexOf("addMemberExperienceWithTierBonus(data, sender, 1, true)") < 0) {
    throw new Error("일반 채팅 티어 보너스 제외 연결 검증 실패");
}

const fullMessage = context.buildBattleExperienceRewardMessage(fullTierResult);
if (fullMessage.indexOf("📊 총 획득 경험치: +240exp") < 0 || fullMessage.indexOf("🎟️ 티어 보너스: +30exp") < 0 || fullMessage.indexOf("가호 추가 보너스: +160exp") < 0 || fullMessage.indexOf("기본 경험치와 티어 보너스에 3배 적용되었습니다.") < 0) {
    throw new Error("가호 전체 적용 문구 검증 실패: " + fullMessage);
}
const partialMessage = context.buildBattleExperienceRewardMessage(partialTierResult);
if (partialMessage.indexOf("📊 총 획득 경험치: +180exp") < 0 || partialMessage.indexOf("보유 수량이 부족해 일부 경험치에만 3배 적용되었습니다.") < 0) {
    throw new Error("가호 부분 적용 문구 검증 실패: " + partialMessage);
}
const noBoosterMessage = context.buildBattleExperienceRewardMessage(noBoosterTierResult);
if (noBoosterMessage.indexOf("📊 총 획득 경험치: +80exp") < 0 || noBoosterMessage.indexOf("호월신의 가호가 적용되지 않았습니다.") < 0) {
    throw new Error("가호 미적용 문구 검증 실패: " + noBoosterMessage);
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
    "buildBattleExperienceRewardMessage(castleTierExpResult)",
    "buildBattleExperienceRewardMessage(miniTierExpResult)",
    "buildQuestExperienceRewardMessage(dailyExperienceResult)",
    "buildQuestExperienceRewardMessage(premiumExperienceResult)",
    "buildQuestExperienceRewardMessage(weeklyExperienceResult)",
    "buildBattleExperienceRewardMessage(experienceResult)",
    "buildBattleExperienceRewardMessage(attendanceExpResult)"
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

function verifyBattleSummaryBlock(startText, endText, experienceVariable, detailTitle) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    if (start < 0 || end < 0) throw new Error("대전 UI 검증 범위를 찾을 수 없습니다: " + detailTitle);
    const block = source.slice(start, end);
    const experienceIndex = block.indexOf(experienceVariable);
    const resultIndex = block.indexOf('" [" + checkRank');
    const detailIndex = block.indexOf(detailTitle + '" + allsee');
    if (experienceIndex < 0 || resultIndex < experienceIndex || detailIndex < resultIndex) {
        throw new Error("대전 요약 UI 순서 검증 실패: " + detailTitle);
    }
    const allseeCalls = block.match(/allsee/g) || [];
    if (allseeCalls.length !== 1) throw new Error("대전 상세 allsee 위치 검증 실패: " + detailTitle + " / " + allseeCalls.length);
}

verifyBattleSummaryBlock('result += "🏆 데일리 캐슬매력 대전', 'replier.reply(result);', 'castleExperienceMessage', '📊 데일리 캐슬대전 상세결과');
verifyBattleSummaryBlock('let resultMsg = "🐹 미니펫 대전', 'replier.reply(resultMsg);', 'miniExperienceMessage', '📊 미니펫대전 상세결과');
if (source.indexOf('miniPetBattleExperience: { win: 50, lose: 25 }') < 0) {
    throw new Error("미니펫대전 승패 경험치 설정 검증 실패");
}

const attendanceChecks = [
    "attendanceExpResult = addMemberExperienceWithTierBonus(data, user, GLOBAL_CONFIG.attendance.bonusExp)",
    "attendanceBoosterResult = attendanceExpResult.boosterResult",
    "buildBattleExperienceRewardMessage(attendanceExpResult)",
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

const boosterEditCommandChecks = [
    'msg === "/부스터수정" || /^\\/부스터수정\\s+.+\\s+[+-]?\\d+$/.test(msg)',
    "var boosterEditAfter = boosterEditBefore + boosterEditAmount",
    "if (boosterEditAfter < 0",
    "saveJsonFile(data, filePath)",
    "Number(verifiedBoosterEditMember.boostercnt) !== boosterEditAfter"
];
for (const expected of boosterEditCommandChecks) {
    if (source.indexOf(expected) < 0) throw new Error("/부스터수정 연결 검증 실패: " + expected);
}

const boosterHelperSource = extractFunction("applyAdventureExperienceBooster");
if (boosterHelperSource.indexOf("loadJsonFile") >= 0 || boosterHelperSource.indexOf("saveJsonFile") >= 0) {
    throw new Error("가호 계산 helper 내부에 파일 IO가 포함되어 있습니다.");
}
const tierExperienceHelperSource = extractFunction("addMemberExperienceWithTierBonus");
if (tierExperienceHelperSource.indexOf("loadJsonFile") >= 0 || tierExperienceHelperSource.indexOf("saveJsonFile") >= 0) {
    throw new Error("티어 경험치 helper 내부에 파일 IO가 포함되어 있습니다.");
}

console.log("PASS fixed tier EXP, booster ordering/boundaries, reward UI, tier checkRank wiring");
