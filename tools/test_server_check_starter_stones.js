const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractBlock(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, "missing block: " + marker);
    const brace = source.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed block: " + marker);
}

const messages = [];
const server = {
    allsee: "[전체보기]", numberWithCommas: n => Number(n).toLocaleString("en-US"),
    msg: "/서버통계", sender: "운영자", room: "관리자방", room90: "관리자방", room91: "통합스텝", room92: "서버관리자", testRoom: "테스트방",
    Admins: [], Master: [], getCurrentContext: () => ({ permissionRoom: server.room }),
    replier: { reply: value => messages.push(value) },
    data: { master: ["마스터"], admin: { "운영자": "" }, member: {
        "다른": { server: "호이서버1[30]" }, "가나다": { server: "호이서버1[30]", suspended: true },
        "구서버": { server: "호이서버1-2[30]" }, "구서버6": { server: "호이서버6[30]" },
        "신서버6": { server: "호이서버6[2030]" }, "특수서버": { server: "별도 운영서버" },
        "미등록": {}, "빈서버": { server: "" }
    } }
};
vm.createContext(server);
const configStart = info.indexOf("const GLOBAL_CONFIG = {");
const configEnd = info.indexOf("//랭크.txt", configStart);
vm.runInContext(info.slice(configStart, configEnd) + "\nthis.GLOBAL_CONFIG = GLOBAL_CONFIG;", server);
for (const name of ["normalizeInfoServerLabel", "getServerMemberGroups", "buildServerMemberListMessage", "isAdmin", "isMaster"]) {
    vm.runInContext(extractBlock(info, "function " + name + "("), server);
}
vm.runInContext("function runServer() {" + extractBlock(info, 'if (msg === "/서버확인" ||') + extractBlock(info, 'if (msg === "/서버통계")') + "}", server);
const beforeServer = JSON.stringify(server.data);
server.runServer();
assert(messages[0].includes("서버 전체인원: 6명"));
assert(messages[0].includes("호이서버1[30]: 2명"));
assert(messages[0].includes("호이서버1-2[30]: 1명"));
assert(messages[0].includes("서버 미등록 인원: 2명"));
const groups = server.getServerMemberGroups(server.data.member);
assert.strictEqual(groups.usersByServer["호이서버6[30]"].length, 2, "서버6 구·신 표기 통합");
assert.strictEqual(server.buildServerMemberListMessage("호이서버6[2030]", groups), server.buildServerMemberListMessage("호이서버6[30]", groups));
const list = server.buildServerMemberListMessage("호이서버1[30]", groups);
assert.strictEqual(list, "호이서버1[30] 유저리스트\n[전체보기]\n\n1. 가나다\n2. 다른");
assert.strictEqual(groups.usersByServer["호이서버1[30]"].length, (list.match(/^\d+\. /gm) || []).length);
assert(!list.includes("구서버"));
assert.strictEqual(server.buildServerMemberListMessage("호이서버2[2030]", groups), "해당 서버에 등록된 유저가 없습니다.");
assert(server.buildServerMemberListMessage("없는서버", groups).includes("존재하지 않는"));
assert(server.buildServerMemberListMessage("", groups).includes("조회할 서버명"));
assert(server.buildServerMemberListMessage("별도 운영서버", groups).includes("1. 특수서버"));
assert.strictEqual(JSON.stringify(server.data), beforeServer, "조회는 데이터를 변경하지 않음");
console.log("1/5 서버통계 인원 일치·과거 소속·빈 서버·전체보기 PASS");

server.msg = "/서버확인 호이서버1[30]";
server.runServer();
assert.strictEqual(messages.at(-1), list, "현재 명단의 신규 관리자도 조회 가능");
delete server.data.admin["운영자"];
server.runServer();
assert.strictEqual(messages.at(-1), "MASTER, ADMIN 전용 명령어입니다.", "해제된 관리자 조회 차단");
server.sender = "마스터";
server.room = "서버관리자";
server.runServer();
assert.strictEqual(messages.at(-1), list);
server.msg = "/서버확인";
server.runServer();
assert(messages.at(-1).includes("조회할 서버명"));
server.msg = "/서버확인 호이서버1[30] 해봐";
server.runServer();
assert(messages.at(-1).includes("존재하지 않는"));
server.msg = "/서버확인방법";
const replyCount = messages.length;
server.runServer();
assert.strictEqual(messages.length, replyCount);
console.log("2/5 ADMIN·MASTER 권한·해제 반영·명령 충돌 PASS");

const stone = "펜던트 강화석📿";
const blessing = "호월신의 축복✨(/호여!!)";
let failHomeSave = false;
const saves = [];
const starterReplies = [];
const starter = {
    data: { member: {} }, sender: "신규", msg: "/호여!!", petData: { "신규": { petname: "친구" } }, petSkillData: {},
    home: {}, filePath: "dev-member.json", memberPetPath: "dev-pet.json", petSkillDataPath: "dev-skills.json", homeDataFile: "dev-home.json",
    getAdventureOnboardingMemberState: (data, user) => data.member[user] && data.member[user].adventureOnboarding,
    addPoint: (data, user, value) => { data.member[user].point = (data.member[user].point || 0) + value; },
    addItem: (data, user, name, value) => { data.member[user].bag[name] = (data.member[user].bag[name] || 0) + value; },
    removeItem: (data, user, name) => { if (--data.member[user].bag[name] === 0) delete data.member[user].bag[name]; },
    hasItem: (data, user, name) => (data.member[user].bag[name] || 0) >= 1,
    getAdventureBlessingItemName: () => blessing,
    loadJsonFile: () => starter.home,
    saveJsonFile: (data, file) => { if (failHomeSave && file === starter.homeDataFile) throw new Error("home save failed"); saves.push(file); },
    formatDateTime: () => "2026-09-30 20:00",
    applyAdventureStarterPetSettings: data => { if (data["신규"].starterBlessingApplied) return false; data["신규"].starterBlessingApplied = true; return true; },
    applyAdventureStarterSkill: data => { if (data.applied) return false; data.applied = true; return true; },
    applyAdventureStarterHome: data => { data.applied = true; return true; },
    applyAdventureStarterIntimacyReward: () => false,
    buildAdventureOnboardingResumeMessage: () => "이미 지급 완료",
    replier: { reply: message => starterReplies.push(message) }
};
vm.createContext(starter);
const starterStart = main.indexOf("    adventureStarter: {");
const starterEnd = main.indexOf("    adventureQuest: {", starterStart);
vm.runInContext("this.GLOBAL_CONFIG = ({" + main.slice(starterStart, starterEnd) + "});", starter);
for (const name of ["applyAdventureStarterMemberRewards", "buildAdventureStarterCompleteMessage"]) {
    vm.runInContext(extractBlock(main, "function " + name + "("), starter);
}
function newMember(stage = "WAIT_BLESSING") {
    return { point: 5, bag: { [stone]: 4, [blessing]: 1 }, adventureOnboarding: { stage, receipts: {} } };
}
starter.data.member["신규"] = newMember();
assert.strictEqual(starter.applyAdventureStarterMemberRewards(starter.data, "신규"), true);
assert.strictEqual(starter.data.member["신규"].bag[stone], 7);
assert.strictEqual(starter.data.member["신규"].point, 30000000005);
assert.strictEqual(starter.data.member["신규"].bag["펫 강화석⭐"], 3000);
assert(starter.buildAdventureStarterCompleteMessage("신규", "친구", false, true).includes(stone + " 3개"));
assert(!starter.buildAdventureStarterCompleteMessage("신규", "친구", false, false).includes(stone));
console.log("3/5 스타터 기존 구성 유지·강화석 +3·실제 지급 안내 PASS");

starter.data = JSON.parse(JSON.stringify(starter.data));
assert.strictEqual(starter.applyAdventureStarterMemberRewards(starter.data, "신규"), false);
assert.strictEqual(starter.data.member["신규"].bag[stone], 7, "재시작 후 중복 지급 없음");
starter.data.member["신규"] = newMember("APPLYING");
starter.data.member["신규"].adventureQuest = { receipts: { starterMemberRewards: true } };
assert.strictEqual(starter.applyAdventureStarterMemberRewards(starter.data, "신규"), false);
assert.strictEqual(starter.data.member["신규"].bag[stone], 4, "과거 퀘스트 지급자에게 소급 지급하지 않음");
console.log("4/5 재입력·재시작·과거 지급자 미지급 PASS");

starter.data.member["신규"] = newMember();
starter.adventureOnboarding = starter.data.member["신규"].adventureOnboarding;
vm.runInContext("function runBlessing() {" + extractBlock(main, 'if (msg === "/호여!!")') + "}", starter);
failHomeSave = true;
assert.throws(() => starter.runBlessing(), /home save failed/);
assert.strictEqual(starter.data.member["신규"].bag[stone], 4);
assert.strictEqual(starter.data.member["신규"].adventureOnboarding.receipts.memberRewards, undefined);
assert.strictEqual(starterReplies.length, 0);
failHomeSave = false;
starter.runBlessing();
assert.strictEqual(starter.data.member["신규"].bag[stone], 7);
assert.strictEqual(starter.data.member["신규"].adventureOnboarding.stage, "COMPLETE");
assert.strictEqual(saves.at(-1), "dev-member.json");
assert(starterReplies.at(-1).includes(stone + " 3개"));
starter.runBlessing();
assert.strictEqual(starter.data.member["신규"].bag[stone], 7);
assert.strictEqual(starterReplies.at(-1), "이미 지급 완료");
console.log("5/5 /호여!! 중단 후 재개·동일 저장 경로·완료 재입력 PASS");
