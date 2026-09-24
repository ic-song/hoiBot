const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

const configStart = main.indexOf("    adventureStarter: {");
const configEnd = main.indexOf("    adventureQuest: {", configStart);
const infoStart = info.indexOf("\tstarterRecovery: {");
const infoEnd = info.indexOf("\tguildContributionCube: {", infoStart);
assert(configStart >= 0 && configEnd > configStart && infoStart >= 0 && infoEnd > infoStart);
const configContext = {};
vm.createContext(configContext);
vm.runInContext("this.mainStarter = ({" + main.slice(configStart, configEnd) + "}).adventureStarter;", configContext);
vm.runInContext("this.infoStarter = ({" + info.slice(infoStart, infoEnd) + "}).starterRecovery;", configContext);
const starter = JSON.parse(JSON.stringify(configContext.mainStarter));
assert.deepStrictEqual(starter, JSON.parse(JSON.stringify(configContext.infoStarter)), "MAIN·Info 회수 기준 일치");
assert.strictEqual(starter.items.length, 17);

const replies = [];
let saves = 0;
const fullBag = {};
for (const item of starter.items) fullBag[item[0]] = item[1];
function member(bag = fullBag) {
    return {
        point: starter.points,
        boostercnt: starter.boosters,
        bag: Object.assign({ "펫 친밀도🐾 [Lv.300](0/1000)+330000💕": 1 }, bag),
        adventureQuest: { currentStage: 2, receipts: { starterMemberRewards: true } }
    };
}
const members = {
    "회수가능": member(Object.assign({}, fullBag, { "땅문서📜": 21 })),
    "잔액부족": member(Object.assign({}, fullBag, { "땅문서📜": 19 })),
    "보유량없음": { point: 0, boostercnt: 0, bag: { "펫 친밀도🐾 [Lv.300](0/1000)+330000💕": 1 }, adventureQuest: { receipts: { starterMemberRewards: true } } },
    "비정상수량": { point: -1, boostercnt: 0, bag: {}, adventureQuest: { receipts: { starterMemberRewards: true } } },
    "기록없음": { point: 0, bag: {}, adventureQuest: { receipts: {} } }
};
members["회수가능"].point += 123;
members["잔액부족"].point = 10000000000;
members["잔액부족"].boostercnt = 500;
const context = {
    GLOBAL_CONFIG: { adventureStarter: starter },
    allsee: "[더보기]",
    testRoom: "팻 테스트방",
    room: "팻 테스트방",
    sender: "관리자",
    msg: "/스타터중복회수",
    filePath: "synthetic-member.json",
    replier: { reply: value => replies.push(value) },
    isMaster: value => value === "관리자",
    loadJsonFile: () => ({ member: members }),
    saveJsonFile: () => { saves++; },
    formatDateTime: () => "2026-09-25 03:00",
    Date,
    Number,
    Object,
    Math,
    isFinite,
    Error
};
vm.createContext(context);
for (const name of ["getAdventureStarterRecoverableCount", "getAdventureStarterRecoveryStatus", "getAdventureStarterRecoveryPlan", "applyAdventureStarterRecovery", "buildAdventureStarterRecoveryPreviewMessages"]) {
    vm.runInContext(extractFunction(name), context);
}
const commandStart = main.indexOf('        if (msg === "/스타터중복회수" || msg === "/스타터중복회수 실행")');
const commandEnd = main.indexOf("        if (msg === \"/데이터복구\"", commandStart);
assert(commandStart >= 0 && commandEnd > commandStart);
const command = main.slice(commandStart, commandEnd);
assert(command.includes("room !== testRoom || !isMaster(sender)"));
assert(command.includes("saveJsonFile(starterRecoveryData, filePath)"));
assert(command.includes('msg === "/스타터중복회수 실행"'));
assert(!command.includes("starterRecoveryExecute"));
assert(main.includes('command === "/스타터중복회수 실행"'));
vm.runInContext("function runRecoveryCommand() {" + command + "}", context);

context.runRecoveryCommand();
assert(replies[0].includes("처리 가능: 3명"));
assert(replies[0].includes("전액 회수: 1명"));
assert(replies[0].includes("부분 회수: 1명"));
assert(replies[0].includes("보유량 0: 1명"));
assert(replies[0].includes("데이터 오류 보류: 1명"));
assert(replies.join("\n").includes("회수가능"));
assert.strictEqual(saves, 0);
replies.length = 0;
context.room = "일반방";
context.msg = "/스타터중복회수 실행";
context.runRecoveryCommand();
assert.strictEqual(replies.length, 0);
assert.strictEqual(saves, 0);
context.room = "팻 테스트방";
context.sender = "일반인";
context.runRecoveryCommand();
assert.strictEqual(replies.length, 0);
context.sender = "관리자";
context.msg = "/스타터중복회수 실행 해볼래";
context.runRecoveryCommand();
assert.strictEqual(replies.length, 0, "안내 문구가 붙은 명령은 실행하지 않음");
assert.strictEqual(saves, 0);
context.msg = "/스타터중복회수 실행 5 확인";
context.runRecoveryCommand();
assert.strictEqual(replies.length, 0, "이전 인원 수 입력 형식은 실행하지 않음");
assert.strictEqual(saves, 0);
members["미리보기이후추가"] = member();
context.msg = "/스타터중복회수 실행";
context.runRecoveryCommand();
assert.strictEqual(saves, 1);
assert(replies[0].includes("처리 완료: 4명"));
assert(replies[0].includes("전액 회수: 2명"));
assert.strictEqual(members["회수가능"].point, 123);
assert.strictEqual(members["회수가능"].boostercnt, 0);
assert.strictEqual(members["회수가능"].bag["땅문서📜"], 1);
assert.strictEqual(members["회수가능"].bag["펫 친밀도🐾 [Lv.300](0/1000)+330000💕"], 1);
assert.strictEqual(members["회수가능"].adventureQuest.currentStage, 2);
assert.strictEqual(members["회수가능"].adventureQuest.receipts.starterMemberRewards, true);
assert.strictEqual(members["회수가능"].adventureQuest.receipts.starterMemberRewardsRecovered, true);
assert.strictEqual(members["잔액부족"].point, 0);
assert.strictEqual(members["잔액부족"].boostercnt, 0);
assert.strictEqual(members["잔액부족"].bag["땅문서📜"], undefined);
assert.strictEqual(members["잔액부족"].adventureQuest.receipts.starterMemberRewardsRecovered, true);
assert.strictEqual(members["잔액부족"].adventureQuest.receipts.starterMemberRewardsRecovery.points, 10000000000);
assert.strictEqual(members["잔액부족"].adventureQuest.receipts.starterMemberRewardsRecovery.missingPoints, 20000000000);
assert.strictEqual(members["잔액부족"].adventureQuest.receipts.starterMemberRewardsRecovery.missingBoosters, 500);
assert.strictEqual(members["잔액부족"].adventureQuest.receipts.starterMemberRewardsRecovery.missingItems["땅문서📜"], 1);
assert.strictEqual(members["보유량없음"].adventureQuest.receipts.starterMemberRewardsRecovered, true);
assert.strictEqual(members["보유량없음"].adventureQuest.receipts.starterMemberRewardsRecovery.points, 0);
assert.strictEqual(members["보유량없음"].bag["펫 친밀도🐾 [Lv.300](0/1000)+330000💕"], 1);
assert.strictEqual(members["비정상수량"].point, -1);
assert.strictEqual(members["비정상수량"].adventureQuest.receipts.starterMemberRewardsRecovered, undefined);
assert.strictEqual(members["미리보기이후추가"].adventureQuest.receipts.starterMemberRewardsRecovered, true);
replies.length = 0;
context.msg = "/스타터중복회수 실행";
context.runRecoveryCommand();
assert.strictEqual(saves, 1, "동일 명령 재입력 시 추가 차감 없음");

console.log("MAIN 스타터 회수 명령 모의 테스트 통과");
