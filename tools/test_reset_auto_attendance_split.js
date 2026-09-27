const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, "함수 없음: " + name);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("함수 닫힘 없음: " + name);
}

const attempts = [];
const logs = [];
const context = {
    allsee: "[더보기]",
    formatDateTime: () => "2026-09-27 20:00",
    isHoiPassPremiumActive: (_data, user) => user !== "expired",
    processAttendanceForUser: (data, _pet, _skill, _guild, user) => {
        attempts.push(user);
        if (user === "failed") throw new Error("실패");
        if (user === "already") return { ok: false, already: true };
        data.member[user].recent = "20260927";
        return { ok: true, noticeMessage: user + " 출첵 완료" };
    },
    appendPetMusouAutomationLog: (_data, row) => logs.push(row)
};
vm.createContext(context);
vm.runInContext(extractFunction("runHoiPassPremiumAutoAttendance"), context);

const data = { member: {
    success: { premiumAutomation: { autoAttendance: true } },
    already: { premiumAutomation: { autoAttendance: true } },
    expired: { premiumAutomation: { autoAttendance: true } },
    failed: { premiumAutomation: { autoAttendance: true } },
    off: { premiumAutomation: { autoAttendance: false } }
} };
const result = context.runHoiPassPremiumAutoAttendance(data, {}, {}, {}, "오픈채팅봇");
assert.deepStrictEqual(attempts, ["success", "already", "failed"]);
assert.strictEqual(data.member.success.recent, "20260927");
assert(!data.member.expired.recent && !data.member.off.recent);
assert(result.message.includes("출석 완료: 1명"));
assert(result.message.includes("당일 출석 완료로 제외: 1명"));
assert(result.message.includes("프리미엄 비활성으로 제외: 1명"));
assert(result.message.includes("처리 실패: 1명"));
assert.strictEqual(result.noticeMessage, "[👑호이패스 프리미엄 자동출첵 기능👑]\n[자동출첵 유저 리스트][더보기]\n\nsuccess 출첵 완료\n\n==========");
assert(logs.some(row => row.user === "failed" && row.result === "ERROR"));
assert(!result.message.includes("구독 패스"), "자동출첵 도우미는 패스를 지급하지 않음");

const resetStart = source.indexOf('if (msg === "/리셋"');
const resetEnd = source.indexOf('if (msg === "/주기리셋"', resetStart);
const resetBranch = source.slice(resetStart, resetEnd);
assert(resetBranch.indexOf("resetAttendance(petData, data, replier)") < resetBranch.indexOf("runHoiPassPremiumAutoAttendance("));
assert(resetBranch.indexOf("runHoiPassPremiumAutoAttendance(") < resetBranch.indexOf("saveJsonFile(data, filePath)"));
assert(resetBranch.indexOf("saveJsonFile(data, filePath)") < resetBranch.indexOf("noticeMsg(resetAutoAttendanceResult.noticeMessage)"));

const payoutStart = source.indexOf('if (msg === "/자동출첵")');
const payoutEnd = source.indexOf('if (/^\\/자동출첵', payoutStart);
const payoutBranch = source.slice(payoutStart, payoutEnd);
assert(payoutStart >= 0 && payoutEnd > payoutStart);
assert(payoutBranch.includes("grantAllSupportPassDailyRewards(data, sender)"));
assert(!payoutBranch.includes("runHoiPassPremiumAutoAttendance"));
assert(!payoutBranch.includes("noticeMsg("));
assert(!payoutBranch.includes("processAttendanceForUser"));
console.log("리셋 후 프리미엄 출첵·공지, 패스 지급 분리 PASS");
