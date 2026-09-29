const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, "missing function: " + name);
    const opening = source.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed function: " + name);
}

function extractBadgeConfig(source) {
    const start = source.indexOf("authorityBadge: {");
    const end = source.indexOf("display: {", start);
    assert(start >= 0 && end > start);
    return vm.runInNewContext("({" + source.slice(start, end) + "})").authorityBadge;
}

function makeContext(source, infoFile) {
    const context = {
        GLOBAL_CONFIG: {
            authorityBadge: extractBadgeConfig(source),
            attendance: { resultLink: "https://example.com", chatExpDailyLimit: 1000 }
        },
        isHoiPassPremiumActive: (data, user) => !!(data.member[user] && data.member[user].premiumActive),
        isInfoSupportPassActive: (data, user, type) => type === "premium" && !!(data.member[user] && data.member[user].premiumActive),
        checkRank: (_data, _pet, _guild, user) => user,
        numberWithCommas: value => Number(value).toLocaleString("en-US"),
        buildAdventureLevelUpMessage: () => "레벨업"
    };
    vm.createContext(context);
    const names = infoFile
        ? ["getInfoAuthorityTitleBadge", "getInfoHoiPassPremiumHeader"]
        : ["getAuthorityTitleBadge", "getHoiPassPremiumHeader", "buildAttendanceCompleteMessage", "buildDailyChatExperienceLimitMessage"];
    for (const name of names) vm.runInContext(extractFunction(source, name), context);
    return context;
}

const mainContext = makeContext(main, false);
const infoContext = makeContext(info, true);
const data = {
    master: ["마스터"],
    admin: { "관리자": true, "겸직": true },
    member: {
        "마스터": { premiumActive: false },
        "관리자": { premiumActive: false },
        "겸직": { premiumActive: true },
        "일반": { premiumActive: false }
    }
};
data.master.push("겸직");

// 기존 명단 회원과 겸직 회원은 프리미엄 여부와 무관하게 한 종류만 표시한다.
for (const context of [mainContext, infoContext]) {
    const badge = context.getAuthorityTitleBadge || context.getInfoAuthorityTitleBadge;
    const header = context.getHoiPassPremiumHeader || context.getInfoHoiPassPremiumHeader;
    assert.strictEqual(badge(data, "마스터"), "[🎮호월GM]");
    assert.strictEqual(badge(data, "관리자"), "[🎖호월관리자]");
    assert.strictEqual(badge(data, "겸직"), "[🎮호월GM]");
    assert.strictEqual(badge(data, "일반"), "");
    assert.strictEqual(header(data, "마스터"), "[🎮호월GM]\n");
    assert.strictEqual(header(data, "관리자"), "[🎖호월관리자]\n");
    assert.strictEqual(header(data, "겸직"), "[🎮호월GM]\n[👑호이패스 프리미엄👑]\n");
    assert.strictEqual(header(data, "일반"), "");
}

// 권한 명단 변경이 별도 뱃지 저장 없이 즉시 출력에 반영된다.
data.master.push("관리자");
assert.strictEqual(mainContext.getAuthorityTitleBadge(data, "관리자"), "[🎮호월GM]");
data.master = data.master.filter(user => user !== "관리자");
assert.strictEqual(mainContext.getAuthorityTitleBadge(data, "관리자"), "[🎖호월관리자]");
delete data.admin["관리자"];
assert.strictEqual(mainContext.getAuthorityTitleBadge(data, "관리자"), "");
assert.strictEqual(infoContext.getInfoAuthorityTitleBadge(data, "관리자"), "");

// 출석 결과도 권한 뱃지, 프리미엄, 기존 정보 순서로 출력한다.
const attendanceResult = {
    experienceResult: { total: 100, base: 100, bonus: 0, boosterResult: { usedBooster: 0, requiredBooster: 0, extraExperience: 0 } },
    totalPointReward: 0,
    dicePoint: 0,
    rankBonusPoint: 0,
    openRunRewardGranted: false,
    levelUps: []
};
let attendance = mainContext.buildAttendanceCompleteMessage(data, {}, {}, "겸직", attendanceResult);
assert(attendance.startsWith("[🎮호월GM]\n[👑호이패스 프리미엄👑]\n[겸직]님, 출석체크 완료!"));
attendance = mainContext.buildAttendanceCompleteMessage(data, {}, {}, "마스터", attendanceResult);
assert(attendance.startsWith("[🎮호월GM]\n[마스터]님, 출석체크 완료!"));
attendance = mainContext.buildAttendanceCompleteMessage(data, {}, {}, "일반", attendanceResult);
assert(attendance.startsWith("[일반]님, 출석체크 완료!"));
data.admin["관리자"] = true;
data.member["관리자"].premiumActive = true;
assert(mainContext.buildDailyChatExperienceLimitMessage(data, {}, {}, "관리자").startsWith("[🎖호월관리자]\n[👑호이패스 프리미엄👑]\n[관리자]님,"));
assert(mainContext.buildDailyChatExperienceLimitMessage(data, {}, {}, "관리자").includes("1,000 / 1,000 EXP"));

console.log("authority badge: role precedence, dynamic lists, main/Info headers, attendance passed");
