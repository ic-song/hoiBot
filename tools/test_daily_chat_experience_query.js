const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    if (start < 0) throw new Error("함수를 찾을 수 없습니다: " + name);
    const brace = source.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("함수 범위를 찾을 수 없습니다: " + name);
}

const context = {
    GLOBAL_CONFIG: { attendance: { chatExpDailyLimit: 1000 } },
    today: "20260927",
    numberWithCommas: value => Number(value).toLocaleString("en-US"),
    isAdminIdentity: sender => sender === "admin",
    isMasterIdentity: sender => sender === "master"
};
context.getAttendanceKstDateKey = () => context.today;
vm.createContext(context);
["getChatExperienceQueryTarget", "hasAttendedToday", "buildDailyChatExperienceStatusMessage", "handleDailyChatExperienceQuery"].forEach(name => {
    vm.runInContext(extractFunction(name), context);
});

assert.strictEqual(context.getChatExperienceQueryTarget("/채팅경험치확인 핑크 여"), "핑크 여");
assert.strictEqual(context.getChatExperienceQueryTarget("/채팅경험치확인"), "");
assert.strictEqual(context.getChatExperienceQueryTarget("/채팅경험치확인삭제 핑크 여"), null);
console.log("1/5 대상 닉네임·명령 경계 PASS");

const data = { member: { "핑크 여": { recent: context.today, chatExperienceDaily: { date: context.today, experience: 497, notified: false } } } };
let output = context.buildDailyChatExperienceStatusMessage(data, "핑크 여");
assert(output.includes("대상: 핑크 여"));
assert(output.includes("기준: 2026.09.27 (KST)"));
assert(output.includes("획득: 497 / 1,000 EXP"));
assert(output.includes("남음: 503 EXP"));
assert(output.includes("상태: 획득 가능"));
console.log("2/5 오늘 누적·남은 한도 PASS");

data.member["핑크 여"].chatExperienceDaily.experience = 500;
output = context.buildDailyChatExperienceStatusMessage(data, "핑크 여");
assert(output.includes("획득: 500 / 1,000 EXP"));
assert(output.includes("남음: 500 EXP"));
assert(output.includes("상태: 획득 가능"));
data.member["핑크 여"].chatExperienceDaily.experience = 1000;
output = context.buildDailyChatExperienceStatusMessage(data, "핑크 여");
assert(output.includes("획득: 1,000 / 1,000 EXP"));
assert(output.includes("남음: 0 EXP"));
assert(output.includes("상태: 한도 도달"));
data.member["핑크 여"].chatExperienceDaily.experience = 1010;
assert(context.buildDailyChatExperienceStatusMessage(data, "핑크 여").includes("획득: 1,000 / 1,000 EXP"));
console.log("3/5 한도 도달·초과 저장값 표시 PASS");

context.today = "20260928";
output = context.buildDailyChatExperienceStatusMessage(data, "핑크 여");
assert(output.includes("획득: 0 / 1,000 EXP"));
assert(output.includes("남음: 1,000 EXP"));
assert(output.includes("상태: 출석 전"));
data.member["핑크 여"].recent = context.today;
delete data.member["핑크 여"].chatExperienceDaily;
assert(context.buildDailyChatExperienceStatusMessage(data, "핑크 여").includes("상태: 획득 가능"));
console.log("4/5 날짜 변경·기록 없음 PASS");

const before = JSON.stringify(data);
context.buildDailyChatExperienceStatusMessage(data, "핑크 여");
assert.strictEqual(JSON.stringify(data), before, "조회는 회원 데이터를 바꾸지 않아야 함");
const replies = [];
const replier = { reply: message => replies.push(message) };
assert.strictEqual(context.handleDailyChatExperienceQuery(data, "/채팅경험치확인 핑크 여", "user", replier), true);
assert(replies.pop().includes("관리자 또는 MASTER만"), "일반 사용자 조회 거부");
assert.strictEqual(context.handleDailyChatExperienceQuery(data, "/채팅경험치확인", "admin", replier), true);
assert(replies.pop().includes("사용법:"), "대상 누락 안내");
assert.strictEqual(context.handleDailyChatExperienceQuery(data, "/채팅경험치확인 없는유저", "master", replier), true);
assert(replies.pop().includes("대상 계정을 찾을 수 없습니다"), "대상 없음 안내");
assert.strictEqual(context.handleDailyChatExperienceQuery(data, "/채팅경험치확인 핑크 여", "master", replier), true);
assert(replies.pop().includes("대상: 핑크 여"), "MASTER의 닉네임 조회");
assert.strictEqual(context.handleDailyChatExperienceQuery(data, "/채팅경험치확인삭제 핑크 여", "admin", replier), false);
assert.strictEqual(replies.length, 0, "다른 명령어는 응답하지 않음");
assert.strictEqual(JSON.stringify(data), before, "명령 처리도 회원 데이터를 바꾸지 않아야 함");
const handler = source.indexOf("if (handleDailyChatExperienceQuery(data, msg, sender, replier)) return;");
const attendanceGate = source.indexOf("if (!hasAttendedToday(data, sender) && isAttendanceGameCommand(msg)");
assert(handler > 0 && handler < attendanceGate, "관리자 조회는 출석 전 차단보다 먼저 처리");
assert(source.includes("!isChatExperienceQueryOperator"), "관리자 조회는 1:1 패스 차단에서 제외");
console.log("5/5 읽기 전용·권한·명령 연결 PASS");
