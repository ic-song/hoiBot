const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
const start = source.indexOf("function getStarterRecoveryStatus(");
const end = source.indexOf("// JSON 파일 로드 함수", start);
assert(start >= 0 && end > start, "스타터 지급 기록 조회 함수가 있어야 합니다.");

const context = { allsee: "[더보기]" };
vm.createContext(context);
const configStart = source.indexOf("const GLOBAL_CONFIG = {");
const configEnd = source.indexOf("//랭크.txt", configStart);
assert(configStart >= 0 && configEnd > configStart);
vm.runInContext(source.slice(configStart, configEnd) + "\nthis.GLOBAL_CONFIG = GLOBAL_CONFIG;", context);
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
assert.strictEqual(messages.length, 5);
assert(messages[0].includes("기존 지급: 2명"));
assert(messages[0].includes("퀘스트 지급: 2명"));
assert(messages[0].includes("두 플래그 모두: 1명"));
assert(messages[0].includes("회수 가능: 0명"));
assert(messages[0].includes("잔액 부족 보류: 2명"));
assert(messages[1].includes("기존만"));
assert(!messages[1].includes("퀘스트만"));
assert(messages[2].includes("퀘스트만"));
assert(!messages[2].includes("기존만"));
assert(messages[3].includes("두번받음"));
assert(!messages.join("\n").includes("문자플래그"));
assert(messages[1].includes("퀘스트 지급 없음"));
assert(messages[2].includes("회수 보류"));

const manyMembers = {};
for (let i = 0; i < 31; i++) manyMembers["유저" + i] = member(true, true);
const pages = context.buildStarterDuplicateAuditMessages(manyMembers);
assert.strictEqual(pages.length, 8);
assert(pages[0].includes("두 플래그 모두: 31명"));
assert(pages[2].includes("31. "));
assert(pages[6].includes("31. "));
const emptyPages = context.buildStarterDuplicateAuditMessages({});
assert.strictEqual(emptyPages.length, 5);
assert(emptyPages[0].includes("두 플래그 모두: 0명"));

const recovery = context.GLOBAL_CONFIG.starterRecovery;
assert.strictEqual(recovery.items.length, 17);
const fullBag = {};
for (const item of recovery.items) fullBag[item[0]] = item[1];
const recoverable = {
    point: recovery.points,
    boostercnt: recovery.boosters,
    bag: fullBag,
    adventureQuest: { receipts: { starterMemberRewards: true } }
};
assert.strictEqual(context.getStarterRecoveryStatus(recoverable).label, "회수 가능");
const eligibleMessages = context.buildStarterDuplicateAuditMessages({ recoverable, "보류": member(false, true) });
assert(eligibleMessages[0].includes("회수 가능: 1명"));
assert(eligibleMessages[0].includes("잔액 부족 보류: 1명"));
assert(eligibleMessages[4].includes("recoverable — 회수 가능"));
recoverable.adventureQuest.receipts.starterMemberRewardsRecovered = true;
assert.strictEqual(context.getStarterRecoveryStatus(recoverable).label, "회수 완료");
const insufficient = member(false, true);
insufficient.point = recovery.points;
insufficient.boostercnt = recovery.boosters;
insufficient.bag = Object.assign({}, fullBag, { "땅문서📜": 19 });
assert.strictEqual(context.getStarterRecoveryStatus(insufficient).label, "회수 보류(부족 1항목)");
assert.strictEqual(insufficient.point, recovery.points);
assert.strictEqual(insufficient.bag["땅문서📜"], 19);

const commandStart = source.indexOf('if (msg === "/스타터중복확인")');
const commandEnd = source.indexOf("var isGlobalInfoCommand", commandStart);
assert(commandStart >= 0 && commandEnd > commandStart);
const command = source.slice(commandStart, commandEnd);
const roomGuard = source.indexOf('if (msg === "/스타터중복확인" && room !== testRoom) return;');
const dataLoad = source.indexOf("let data = loadJsonFile(filePath);", roomGuard);
assert(roomGuard >= 0 && dataLoad > roomGuard && commandStart > dataLoad, "테스트방 외 조회는 데이터 읽기 전에 무응답 종료");
assert(command.includes("if (!isMaster(sender)) return;"));
assert(!command.includes("saveJsonFile"));
assert(command.includes("buildStarterDuplicateAuditMessages"));

console.log("Info.js 스타터 중복 지급 후보 조회 테스트 통과");
