const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
const start = source.indexOf("function buildStarterDuplicateAuditMessages(");
const end = source.indexOf("// JSON 파일 로드 함수", start);
assert(start >= 0 && end > start, "스타터 지급 기록 조회 함수가 있어야 합니다.");

const context = { allsee: "[더보기]" };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

function member(oldReward, questReward) {
    return {
        adventureOnboarding: { receipts: { memberRewards: oldReward } },
        adventureQuest: { receipts: { starterMemberRewards: questReward } }
    };
}

const messages = context.buildStarterDuplicateAuditMessages({
    "기존만": member(true, false),
    "퀘스트만": member(false, true),
    "문자플래그": member("true", "true"),
    "두번받음": member(true, true),
    "기록없음": {}
});
assert.strictEqual(messages.length, 4);
assert(messages[0].includes("기존 지급: 2명"));
assert(messages[0].includes("퀘스트 지급: 2명"));
assert(messages[0].includes("두 플래그 모두: 1명"));
assert(messages[1].includes("기존만"));
assert(!messages[1].includes("퀘스트만"));
assert(messages[2].includes("퀘스트만"));
assert(!messages[2].includes("기존만"));
assert(messages[3].includes("두번받음"));
assert(!messages.join("\n").includes("문자플래그"));

const manyMembers = {};
for (let i = 0; i < 31; i++) manyMembers["유저" + i] = member(true, true);
const pages = context.buildStarterDuplicateAuditMessages(manyMembers);
assert.strictEqual(pages.length, 7);
assert(pages[0].includes("두 플래그 모두: 31명"));
assert(pages[2].includes("31. "));
assert(pages[6].includes("31. "));
const emptyPages = context.buildStarterDuplicateAuditMessages({});
assert.strictEqual(emptyPages.length, 4);
assert(emptyPages[0].includes("두 플래그 모두: 0명"));

const commandStart = source.indexOf('if (msg === "/스타터중복확인")');
const commandEnd = source.indexOf("var isGlobalInfoCommand", commandStart);
assert(commandStart >= 0 && commandEnd > commandStart);
const command = source.slice(commandStart, commandEnd);
assert(command.includes("if (!isMaster(sender)) return;"));
assert(!command.includes("saveJsonFile"));

console.log("Info.js 스타터 중복 지급 후보 조회 테스트 통과");
