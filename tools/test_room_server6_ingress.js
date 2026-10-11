const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 실제 함수·분기를 합성 가입 데이터로 실행한다.
function block(source, marker) {
    const start = source.indexOf(marker); assert(start >= 0, marker);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error("unclosed " + marker);
}
const c = { allsee: "<ALLSEE>", getCurrentDate: () => "2026-10-06", getAttendanceKstDateKey: () => "2026-10-06", formatDateTime: () => "synthetic-time",
    getCurrentContext: () => ({ isDev: false }), isDebuggerFlag: false, data: { member: {}, shop: {} }, petData: {},
    adventureOnboardingData: { users: {} }, room: "", isGroupChat: true, sender: "합성 여", msg: "", filePath: "prod-member", memberPetPath: "prod-pet", memberTitlePath: "prod-title", attendanceLightPath: "prod-light", adventureOnboardingPath: "prod-onboarding",
    syncStoneBoxShopItems: () => false, validateSignupNickname: () => ({ ok: true }), buildAdventureStartMessage: () => "start",
    createAdventureOnboardingMemberState: () => ({ stage: "WAIT_PET_NAME" }), buildAdventurePetNamePromptMessage: () => "name", replier: { reply() {} },
    numberWithCommas: String };
vm.createContext(c);
vm.runInContext(main.slice(main.indexOf("const room1 = "), main.indexOf("// 이미 생성된 회원의 미지정 소속")) + ";this.room15=room15;this.testRoom=testRoom;this.roomToServer=roomToServer;", c);
vm.runInContext(block(main, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", c);
for (const name of ["assignUnspecifiedMemberServer", "normalizeHoiServerLabel", "initializeMember", "recordLightAttendanceOnly", "migrateLightSearchAuthenticationToMember", "migrateLightAttendanceToMember", "getNoticeTargetRooms"])
    vm.runInContext(block(main, "function " + name + "("), c);
const bootstrapStart = main.indexOf("var pointShopBootstrapChanged = ");
const bootstrapEnd = main.indexOf("commonStepStart = Date.now();", bootstrapStart);
assert(bootstrapEnd > bootstrapStart);
vm.runInContext("function incomingChat(){" + main.slice(bootstrapStart, bootstrapEnd) + "}", c);
vm.runInContext("function startSignup(){" + block(main, 'if (msg === "/모험시작")') + "}", c);
vm.runInContext("function depart(){" + block(main, 'if (preMemberOnboarding && preMemberOnboarding.stage === "WAIT_START" && msg === "출발한다")') + "}", c);
let disk, saves, failSave, groups = 0;
function reset() {
    disk = { "prod-title": JSON.stringify({ member: {} }), "prod-light": JSON.stringify({ users: {} }) }; saves = []; failSave = false;
    c.data = { member: {}, shop: { [c.GLOBAL_CONFIG.serverTransfer.itemName]: c.GLOBAL_CONFIG.serverTransfer.itemPrice } }; c.petData = {};
    c.adventureOnboardingData = { users: {} }; c.sender = "합성 여"; c.room = c.room15; c.isGroupChat = true;
    c.filePath = "prod-member"; c.memberPetPath = "prod-pet"; c.memberTitlePath = "prod-title"; c.attendanceLightPath = "prod-light"; c.adventureOnboardingPath = "prod-onboarding";
    c.loadJsonFile = p => vm.runInContext("JSON.parse(" + JSON.stringify(disk[p]) + ")", c);
    c.saveJsonFile = (data, p) => { if (failSave) throw Error("synthetic save failure"); disk[p] = JSON.stringify(data); saves.push(p); };
}
function group(name, run) { reset(); run(); groups++; console.log("PASS " + groups + ": " + name); }
group("정확한 신규 방 제목·기존 ROOM 보존·기존 서버6 연결·별도 서버 미생성", () => {
    assert.strictEqual(c.room15, "🚨 30대 반말방｜도파민 폭주구역 💣🔥");
    assert.strictEqual(c.roomToServer[c.room15], "호이서버6[30]");
    assert.strictEqual(Object.values(c.roomToServer).filter(s => s === "호이서버6[30]").length, 2);
    assert.strictEqual(c.GLOBAL_CONFIG.serverRaid.servers.length, 10);
    assert(!c.roomToServer[c.room15 + " "]); assert(!c.GLOBAL_CONFIG.serverRaid.rooms.production.includes(c.room15));
});
group("짧은 일반 채팅도 미지정만 지정·반복 무저장·다른 서버와 레이드 기록 유지", () => {
    c.data.member[c.sender] = { point: 12, bag: { synthetic: 3 }, serverRaidAccount: { id: "fixed", latest: { damage: "100" } } };
    c.msg = "ㅇ"; c.incomingChat();
    assert.strictEqual(JSON.parse(disk[c.filePath]).member[c.sender].server, "호이서버6[30]"); assert.strictEqual(saves.length, 1);
    c.incomingChat(); assert.strictEqual(saves.length, 1);
    c.data.member[c.sender].server = "호이서버2[2030]";
    const before = JSON.stringify(c.data); c.incomingChat(); assert.strictEqual(JSON.stringify(c.data), before); assert.strictEqual(saves.length, 1);
    assert.strictEqual(c.data.member[c.sender].serverRaidAccount.id, "fixed"); assert.strictEqual(c.data.member[c.sender].point, 12);
});
group("일대일·다른 ROOM·미가입 일반 대화는 신규 소속/계정 자동 생성 없음", () => {
    c.incomingChat(); assert.strictEqual(Object.keys(c.data.member).length, 0); assert.strictEqual(saves.length, 0);
    c.data.member[c.sender] = {}; c.isGroupChat = false; c.incomingChat(); assert(!c.data.member[c.sender].server);
    c.isGroupChat = true; c.room = "다른 방"; c.incomingChat(); assert(!c.data.member[c.sender].server); assert.strictEqual(saves.length, 0);
});
group("모험 시작 유입을 다른 방 가입 완료까지 보존·실제 초기화 및 경량 출첵 이관", () => {
    c.msg = "/모험시작"; c.startSignup();
    assert(!c.data.member[c.sender]); assert.strictEqual(c.adventureOnboardingData.users[c.sender].server, "호이서버6[30]");
    disk[c.attendanceLightPath] = JSON.stringify({ users: { [c.sender]: { cnt: 1, recent: "2026-10-06", today: 1, server: "호이서버1[30]" } } });
    c.room = c.testRoom; c.msg = "출발한다"; c.preMemberOnboarding = c.adventureOnboardingData.users[c.sender]; c.depart();
    const member = JSON.parse(disk[c.filePath]).member[c.sender];
    assert.strictEqual(member.server, "호이서버6[30]"); assert.strictEqual(member.agree, true); assert.strictEqual(member.cnt, 1);
    assert.strictEqual(Object.keys(c.data.member).length, 1); assert(!c.adventureOnboardingData.users[c.sender]);
    c.preMemberOnboarding = c.adventureOnboardingData.users[c.sender]; const before = JSON.stringify(disk); c.depart(); assert.strictEqual(JSON.stringify(disk), before);
});
group("신규 방 경량 출첵·기존 유입 유지·가입 완료 방 기준 지정·DEV 저장 분리", () => {
    const light = vm.runInContext("({users:{}})", c); c.recordLightAttendanceOnly(light, c.sender, c.room15);
    assert.strictEqual(light.users[c.sender].server, "호이서버6[30]");
    light.users[c.sender].server = "호이서버3[3040]"; c.recordLightAttendanceOnly(light, c.sender, c.room15); assert.strictEqual(light.users[c.sender].server, "호이서버3[3040]");
    c.room = c.testRoom; c.msg = "/모험시작"; c.startSignup(); assert(!c.adventureOnboardingData.users[c.sender].server);
    c.room = c.room15; c.msg = "출발한다"; c.preMemberOnboarding = c.adventureOnboardingData.users[c.sender]; c.depart(); assert.strictEqual(c.data.member[c.sender].server, "호이서버6[30]");
    const prod = JSON.stringify(disk); c.sender = "DEV 합성 남"; c.data.member[c.sender] = {}; c.filePath = "dev-member"; c.incomingChat();
    assert.strictEqual(JSON.parse(disk["dev-member"]).member[c.sender].server, "호이서버6[30]"); delete disk["dev-member"]; assert.strictEqual(JSON.stringify(disk), prod);
});
group("공통 공지에 신규 방 1회·DEV 기존 발송 대상 유지·동일 서버 집계", () => {
    const rooms = c.getNoticeTargetRooms({ isDev: false }); assert.strictEqual(rooms.filter(r => r === c.room15).length, 1);
    assert(!c.getNoticeTargetRooms({ isDev: true }).includes(c.room15));
    const rank = { data: { member: { fresh: { server: c.roomToServer[c.room15] }, previous: { server: "호이서버6[2030]" } } }, userScores: [{ key: "fresh", totalExp: 100 }, { key: "previous", totalExp: 50 }] };
    vm.createContext(rank); vm.runInContext(block(info, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", rank);
    for (const name of ["normalizeInfoServerLabel", "normalizeRankServerName", "buildServerRankingRows"]) vm.runInContext(block(info, "function " + name + "("), rank);
    const rows = rank.buildServerRankingRows(rank.userScores, rank.data); assert.strictEqual(rows.length, 10);
    const server6 = rows.find(r => r.name === "호이서버6[30]"); assert.strictEqual(server6.totalExp, 150); assert.strictEqual(server6.users.length, 2);
});
group("지정 저장 실패는 완료 저장 없음·다음 입력에서 미지정 상태 재시도", () => {
    c.data.member[c.sender] = {}; disk[c.filePath] = JSON.stringify(c.data); const before = disk[c.filePath]; failSave = true;
    assert.throws(() => c.incomingChat(), /synthetic save failure/); assert.strictEqual(disk[c.filePath], before); assert.strictEqual(saves.length, 0);
    failSave = false; c.data = JSON.parse(disk[c.filePath]); c.incomingChat(); assert.strictEqual(JSON.parse(disk[c.filePath]).member[c.sender].server, "호이서버6[30]");
});
console.log("신규 ROOM 유입 " + groups + "개 검증 그룹 통과 (합성 데이터·실제 가입 분기/함수)");
