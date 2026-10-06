const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8").replace(/\r\n/g, "\n");

// 실제 소스의 함수·명령 진입 분기를 합성 파일시스템에서 실행한다.
function block(source, marker) {
    const start = source.indexOf(marker); assert(start >= 0, marker);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error("unclosed " + marker);
}
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/", memberPath = root + "member.json";
let disk, traces, replies, now, timers, nextTimer, uuid, failWrite, failNotice, replyFailure, groups = 0;
const clone = value => JSON.parse(JSON.stringify(value));
const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } });
const local = () => ({ value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } });
function FakeFile(p) { this.path = String(p); }
FakeFile.prototype.exists = function () { return Object.hasOwn(disk, this.path); };
FakeFile.prototype.getPath = function () { return this.path; };
FakeFile.prototype.delete = function () { delete disk[this.path]; return true; };
FakeFile.prototype.renameTo = function (to) {
    if (this.path.endsWith(".tmp") && failWrite && failWrite(JSON.parse(disk[this.path]), to.path)) { failWrite = null; return false; }
    if (!this.exists()) return false;
    disk[to.path] = disk[this.path]; delete disk[this.path];
    if (this.path.endsWith(".tmp")) traces.push({ type: "save", path: to.path, data: JSON.parse(disk[to.path]) });
    return true;
};
class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
}
const c = {
    Date: ClockDate, DATA_ROOT_PATH: root, DEV_DATA_ROOT_PATH: devRoot, COMMON_DATA_FILE_MAP: {},
    filePath: memberPath, memberPetPath: root + "member_pet.json", guildPath: root + "guild.json", homeDataFile: root + "home.json", petSkillDataPath: root + "skills.json",
    commandContextThreadLocal: local(), dataSaveTransactionThreadLocal: local(), dataTransactionLock: lock(),
    getProtectedJsonSaveLock: () => lock(), isProtectedManagedJsonPath: () => true,
    getManagedJsonBackupPath: p => p + ".bak", getManagedJsonSecondaryBackupPath: () => null,
    getAutoDailyBatchContext: () => null, ensureParentFolder() {}, debuggerLog(text) { traces.push({ type: "log", text: String(text) }); },
    parseManagedJsonContent: text => JSON.parse(text),
    restoreManagedJsonFromBackup(p) { disk[p] = disk[p + ".bak"]; return { data: JSON.parse(disk[p]) }; },
    FileStream: { read: p => disk[p], write() { throw Error("unexpected unprotected write"); } },
    java: { util: { UUID: { randomUUID: () => "uuid-" + (++uuid) } }, io: {
        File: FakeFile,
        FileOutputStream: function (f) { this.path = f.path; disk[f.path] = ""; this.getFD = () => ({ sync() {} }); this.close = () => {}; },
        OutputStreamWriter: function (s) { this.write = text => { disk[s.path] = text; }; this.flush = () => {}; this.close = () => {}; }
    } },
    numberWithCommas: n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    checkRank: (_d, _p, _g, user) => "💛" + user, allsee: "<ALLSEE>", isDebuggerFlag: false,
    Master: ["master"], Admins: ["admin"], ACCOUNT_SUSPENSION_BLOCKED_PLAIN_MESSAGES: ["ㅊㅊ", "출발한다", "다음에 한다"],
    worldNewsDraftState: {},
    getMissingDevDataFiles: () => [], hasAttendedToday: (_d, user) => user !== "absent",
    isAttendanceFreeCommand: (_msg, user) => user === "master",
    hasActiveHoiPassAccess: (_d, user) => user !== "noPass", isAccountSuspended: (_d, user) => user === "suspended",
    buildAttendanceRequiredMessage: () => "출석체크부터", buildNoHoiPassPrivateChatMessage: () => "프리미엄 필요",
    calculateRaidExp: (_u, d) => d.member[_u].R === undefined ? 100000 : d.member[_u].R,
    calculateEffectivePetUpgradeLevel: () => 300,
    isSealedVaultMutationCommandMessage: () => false, getRaidSealCraftRequest: () => null, getStoneBoxOpenRequest: () => null,
    commandDataFlowLock: { writeLock: () => "write", readLock: () => "read" },
    BASE_CRIT_DAMAGE_MULTIPLIER: 1.7,
    isAdmin: user => user === "admin",
    removeItem: (d, user, item, count) => { d.member[user].bag[item] -= count; },
    addItem: (d, user, item, count) => { d.member[user].bag[item] = (d.member[user].bag[item] || 0) + count; },
    replier: { reply(text) { if (replyFailure) throw Error("response transport failure"); replies.push(text); traces.push({ type: "reply", text }); } },
    Api: { replyRoom(room, text) {
        if (failNotice && failNotice(room, text)) return false;
        traces.push({ type: "notice", room, text }); return true;
    } },
    loadJsonFile(p) { traces.push({ type: "load", path: p }); return vm.runInContext("JSON.parse(" + JSON.stringify(disk[c.resolveActiveDataPath(p)]) + ")", c); },
    serverRaidWorkTimers: {},
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
};
for (let i = 1; i <= 100; i++) c["room" + i] = "room" + i;
c.testRoom = "test";
vm.createContext(c);
vm.runInContext(block(main, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", c);
for (const name of ["isDevCommandMessage", "stripDevCommandPrefix", "createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataFileName", "resolveActiveDataPath",
    "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "writeVerifiedJsonFile", "saveJsonFile",
    "isMaster", "isMasterIdentity", "isAttendanceGameCommand", "isAdventurePetNameInputCandidate", "isAdventureReferralInputCandidate", "getWorldNewsDraftKey", "normalizeHoiServerLabel", "noticeMsg", "isAutoDailyEntryCommandMessage", "isExclusiveDataMutationCommandMessage", "getResponseDataFlowLock",
    "getCappedUpgradeForCrit", "getCritChance", "calculateCritChance", "getCritMultiplier", "calculateCriticalDamage"]) vm.runInContext(block(main, "function " + name + "("), c);
vm.runInContext(main.slice(main.indexOf("function serverRaidHeader("), main.indexOf("// 길드 영지전 관련 함수들")), c);
const entryStart = main.indexOf("// 서버 레이드대전 진입:");
const entryEnd = main.indexOf('if (ctx.isDev && msg === "/데이터백업")', entryStart);
vm.runInContext("function runEntry(){" + main.slice(entryStart, entryEnd) + "}", c);
const responseStart = main.indexOf("function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {");
const responseEnd = main.indexOf("///////////////////////////////////////////////////////////////////////////////////////////////", responseStart);
assert(responseStart >= 0 && responseEnd > responseStart);
vm.runInContext(main.slice(responseStart, responseEnd), c);
vm.runInContext(block(main, "function createContextReplier("), c);
vm.runInContext("function runTicketMove(){" + block(main, 'if (msg === "/서버변경" ||') + "}", c);
vm.runInContext("function runAdminMove(){" + block(main, "if (/^\\/서버이동\\s+") + "}", c);
const infoContext = { allsee: "<ALLSEE>", numberWithCommas: c.numberWithCommas, checkRank: c.checkRank };
vm.createContext(infoContext);
vm.runInContext(block(info, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", infoContext);
for (const name of ["normalizeInfoServerLabel", "normalizeRankServerName", "isInfoServerRaidLocked", "formatInfoServerRaidServer", "buildServerRankingRows", "formatOverallRankPosition", "formatOverallUserRow", "formatOverallServerRow", "buildCombinedServerRankingMessage", "buildStandaloneServerRankingMessage"])
    vm.runInContext(block(info, "function " + name + "("), infoContext);

function reset() {
    now = Date.parse("2026-10-05T12:00:00Z"); timers = new Map(); nextTimer = 0; uuid = 0;
    disk = {}; traces = []; replies = []; failWrite = null; failNotice = null; replyFailure = false;
    c.serverRaidWorkTimers = {}; c.dataSaveTransactionThreadLocal.remove(); c.commandContextThreadLocal.remove();
    c.worldNewsDraftState = {};
    const member = {}, pets = {};
    for (const user of ["master", "admin", "a", "b", "c", "absent", "suspended", "noPass", "오픈채팅봇", "unassigned"]) {
        member[user] = { point: 1000000000, server: c.GLOBAL_CONFIG.serverRaid.servers[0], agree: true, bag: { unchanged: 7 } };
        pets[user] = { petname: "합성펫", upgrade: 300 };
    }
    member.unassigned.server = "GM";
    for (const prefix of [root, devRoot]) for (const [file, value] of [["member.json", { member, master: ["master"] }], ["member_pet.json", pets], ["guild.json", {}], ["home.json", {}], ["skills.json", {}]]) disk[prefix + file] = JSON.stringify(value);
    vm.runInContext("Math.random=function(){return 0.99}", c);
}
function read(dev = false) { return JSON.parse(disk[(dev ? devRoot : root) + "member.json"]); }
function write(d, dev = false) { disk[(dev ? devRoot : root) + "member.json"] = JSON.stringify(d); }
function run(msg, user = "a", event, room, group = true, native) {
    room = room === undefined ? (c.isDevCommandMessage(msg) ? "test" : "room8") : room;
    replies = []; c.sender = user; c.serverRaidEvent = event; c.room = room; c.isGroupChat = group;
    c.packageName = native ? "com.kakao.talk" : undefined;
    c.ctx = c.createCommandContext(c.isDevCommandMessage(msg), room); c.msg = c.ctx.isDev ? c.stripDevCommandPrefix(msg) : msg;
    const previous = c.enterCommandContext(c.ctx); c.beginDataSaveTransaction();
    try {
        if (native) c.runEntry(null, null, null, null, null, null, c.packageName, false, native.logId, native.channelId, native.userHash);
        else if (event) c.runEntry(null, null, null, null, null, null, null, event);
        else c.runEntry(null, null, null, null, null, null, "com.kakao.talk");
    }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return replies.join("\n");
}
function tick(ms = 1, limit = 10) {
    now += ms;
    for (let i = 0; i < limit; i++) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]); due[1].fn();
    }
    throw Error("timer loop");
}
function start(dev = false) { run((dev ? "dev/" : "/") + "서버대전시작", "master"); tick(); tick(60000); }
function attack(user = "a", id = "event-1", dev = false, room) { return run((dev ? "dev/" : "/") + "레이드공격", user, id === null ? undefined : { id }, room); }
function end(dev = false) { run((dev ? "dev/" : "/") + "서버대전종료", "master"); tick(); }
function group(name, f) { reset(); f(); groups++; console.log("PASS " + groups + ": " + name); }

group("정확한 6개 명령·접미 미실행·MASTER 및 인증된 운영봇 권한", () => {
    for (const msg of ["/서버대전시작 해봐", "/서버대전종료 1", "/서버대전전체초기화 확인", "/레이드공격 1", "/레이드순위 대상"]) {
        const before = disk[memberPath]; run(msg); assert.strictEqual(disk[memberPath], before); assert(!c.isServerRaidMutationCommand(msg));
    }
    for (const user of ["a", "admin", "오픈채팅봇"]) for (const msg of ["/서버대전시작", "/서버대전종료", "/서버대전전체초기화"]) {
        const before = disk[memberPath]; assert(run(msg, user).includes("권한")); assert.strictEqual(disk[memberPath], before);
    }
    assert(run("/서버대전시작", "master", undefined, "room1").includes("공성전 또는 팻 테스트방")); assert(!read().serverRaid);
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["trusted-bot"];
    run("/서버대전시작", "오픈채팅봇", { id: "bot-start", operatorId: "trusted-bot" }); assert(c.isServerRaidLocked(read()));
    assert(run("/서버대전전체초기화", "오픈채팅봇", { operatorId: "trusted-bot" }).includes("권한"));
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = [];
});
group("60초 준비·저장 후 공지·기존 공지방과 명령방 중복 제외", () => {
    run("/서버대전시작", "master", undefined, "room8"); const initial = read();
    assert.strictEqual(initial.serverRaid.current.prepareUntil, now + 60000);
    assert(!traces.some(t => t.type === "notice")); tick();
    const prep = traces.filter(t => t.type === "notice" && t.text.includes("60초 뒤"));
    assert.strictEqual(prep.length, 13); assert.strictEqual(new Set(prep.map(t => t.room)).size, 13);
    const before = disk[memberPath]; assert(attack().includes("아직 공격 준비")); assert.strictEqual(disk[memberPath], before);
    tick(59998); assert.strictEqual(read().serverRaid.current.state, "PREP"); tick(1);
    assert.strictEqual(read().serverRaid.current.state, "ACTIVE");
    const notices = traces.filter(t => t.type === "notice" && t.text.includes("크아아아앙")); assert.strictEqual(notices.length, 13);
    assert(traces.findIndex(t => t.type === "save") < traces.findIndex(t => t.type === "notice"));
});
group("준비 취소·옛 타이머 무효·완료 회차와 보상 미증가", () => {
    run("/서버대전시작", "master"); const stale = [...timers.values()][0].fn;
    run("/서버대전종료", "master"); tick(); now += 100000; stale();
    const s = read().serverRaid; assert(!s.current); assert.strictEqual(s.completed, 0); assert.strictEqual(s.history.length, 0); assert.deepStrictEqual(s.wins, {});
    assert(!traces.some(t => t.type === "notice" && t.text.includes("크아아아앙")));
});
group("치명타 전 R1% 버림·치명타 데미지와 보상 분리·각 공격 R/D/P 보존", () => {
    start(); const d = read(); d.member.a.R = 100099; write(d);
    const output = attack(); let current = read(); const a = current.serverRaid.current.accounts[current.member.a.serverRaidAccount.id];
    assert.deepStrictEqual([a.attacks[0].R, a.attacks[0].D, a.attacks[0].P], [100099, 100099, 1000]);
    vm.runInContext("Math.random=function(){return 0}", c);
    const critical = attack("a", "crit"); current = read(); const result = current.serverRaid.current.accounts[current.member.a.serverRaidAccount.id].attacks[1];
    assert.strictEqual(result.D, 170168); assert.strictEqual(result.P, 1000); assert(critical.includes("치명타 발동"));
    assert(output.includes("레이드매력의 1% 지급")); assert(!output.includes("치명타 적용"));
    assert(critical.includes("레이드매력의 1% 지급")); assert(!critical.includes("일반 공격")); assert.strictEqual(current.member.a.point, 1000002000);
});
group("공성전 방 공격은 계정 서버 고정·6회 요청 중 5회만 반영", () => {
    start(); for (let i = 0; i < 6; i++) attack("a", "allowed-room-" + i, false, i % 2 ? "test" : "room8");
    const d = read(), a = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    assert.strictEqual(a.attacks.length, 5); assert.strictEqual(a.damage, "500000"); assert.strictEqual(d.member.a.point, 1000005000);
    assert.strictEqual(a.server, c.GLOBAL_CONFIG.serverRaid.servers[0]); assert(replies.join("").includes("모두 사용"));
    assert.strictEqual(c.getResponseDataFlowLock("/레이드공격"), "write");
    assert.strictEqual(c.getResponseDataFlowLock("dev/서버대전전체초기화"), "write");
});
group("동일 64비트 문자열 이벤트 재전송·재시작·다음 회차 재전송 무반영", () => {
    start(); const id = "18446744073709551615"; attack("a", id); const before = disk[memberPath];
    attack("a", id); assert.strictEqual(disk[memberPath], before);
    c.serverRaidWorkTimers = {}; timers.clear(); attack("a", id); assert.strictEqual(disk[memberPath], before);
    assert.throws(() => run("/레이드공격", "a", { id: Number(id) }), /이벤트 ID/);
    end(); start(); const nextRound = disk[memberPath];
    assert(attack("a", id).includes("이전 회차")); assert.strictEqual(disk[memberPath], nextRound);
});
group("기본 7인수 콜백 시작·공격·여러 방 및 재시작 후 계정당 5회·중복 정산 방지", () => {
    start();
    for (let i = 0; i < 6; i++) {
        if (i === 2) { c.serverRaidWorkTimers = {}; timers.clear(); }
        attack("a", null);
    }
    const d = read(), participant = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    assert.strictEqual(participant.attacks.length, 5); assert.strictEqual(participant.damage, "500000");
    assert.strictEqual(d.member.a.point, 1000005000); assert(replies.join("").includes("모두 사용"));
    assert.strictEqual(new Set(participant.attacks.map(a => a.id)).size, 5);
    assert(participant.attacks.every(a => a.id.startsWith("event:legacy-callback:")));
    end(); const paid = disk[memberPath]; end(); tick();
    assert.strictEqual(disk[memberPath], paid); assert.strictEqual(read().member.a.point, 1500005000);
});
group("MASTER 포함 Main·Info 일반 명령 잠금·서버 이동 및 출석 잠금 유지", () => {
    start();
    for (const user of ["a", "master", "admin"]) for (const msg of ["/정보 a", "/내정보", "/서버순위", "ㅈㅈㅈ", "/종합순위", "/서버변경 호이서버2", "/서버이동 a 호이서버2[2030]", "ㅊㅊ", "출발한다"]) {
        const before = disk[memberPath]; assert(run(msg, user).includes("지금은 서버 레이드대전"), user + msg); assert.strictEqual(disk[memberPath], before);
    }
    assert(infoContext.isInfoServerRaidLocked(read()));
    const before = disk[memberPath]; assert.strictEqual(run("일반 대화"), ""); assert.strictEqual(disk[memberPath], before);
    assert(entryStart < main.indexOf('if (msg === "/데이터상태")'));
    assert(info.indexOf("if (isInfoServerRaidLocked(data)) return") < info.indexOf("var isGlobalInfoCommand ="));
});
group("참가 자격·출석·정지·일대일 패스·유효 소속·미등록 검사", () => {
    start();
    for (const [user, expected] of [["absent", "출석체크"], ["suspended", "계정정지"], ["unassigned", "소속 서버"], ["missing", "모험시작"]]) {
        const before = disk[memberPath]; assert(attack(user, user).includes(expected)); assert.strictEqual(disk[memberPath], before);
    }
    const before = disk[memberPath]; assert(run("/레이드공격", "noPass", { id: "private" }, "private", false).includes("공성전 또는 팻 테스트방")); assert.strictEqual(disk[memberPath], before);
    const d = read(); d.member.a.agree = false; write(d); assert(attack().includes("모험 시작"));
});
group("다른 대전 준비·진행·휴식 중 시작 거부", () => {
    for (const [part, value] of [["petMusou", { active: true }], ["matzangField", { active: true, resting: true }], ["guildTerritoryWar", { pendingStart: true }]]) {
        const d = read(); d[part] = value; write(d); const before = disk[memberPath];
        assert(run("/서버대전시작", "master").includes("다른 대전")); assert.strictEqual(disk[memberPath], before); delete d[part]; write(d);
    }
    for (const guild of [{ castleSiegeFlag: true }, { territoryWar: { active: true } }, { territoryWar: { pendingStart: true } }]) {
        disk[root + "guild.json"] = JSON.stringify(guild); assert(run("/서버대전시작", "master").includes("다른 대전")); assert(!read().serverRaid);
    }
});
group("공동 서버1위 2곳·다음3위·참가자만 각1회 보상·동점 개인순위", () => {
    start(); const d = read(); d.member.b.server = c.GLOBAL_CONFIG.serverRaid.servers[1]; d.member.c.server = c.GLOBAL_CONFIG.serverRaid.servers[2]; d.member.c.R = 50000; write(d);
    attack("a", "a"); attack("b", "b"); attack("c", "c"); end();
    const done = read(), r = done.serverRaid.history[0];
    assert.deepStrictEqual(r.results.map(s => s.rank), [1, 1, 3]);
    assert.strictEqual(done.member.a.point, 1500001000); assert.strictEqual(done.member.b.point, 1500001000); assert.strictEqual(done.member.c.point, 1400000500);
    assert.strictEqual(done.member.master.point, 1000000000); assert.strictEqual(Object.keys(done.serverRaid.wins).length, 2);
    assert(traces.some(t => t.type === "notice" && t.text.includes("우승 서버 각각")));
    const notice = c.buildServerRaidResultNotice(done, r), visible = notice.split("<ALLSEE>")[0];
    assert.strictEqual(visible.split("참여자 1인당 상금: 5억 포인트").length - 1, 2);
    assert(notice.includes("상금: 4억 포인트"));
    const before = disk[memberPath]; run("/서버대전종료", "master"); tick(5000); assert.strictEqual(disk[memberPath], before);
    start(); attack("a", "equal-a"); const next = read(); next.member.c.server = next.member.a.server; next.member.c.R = 100000; write(next); attack("c", "equal-c"); end();
    assert.strictEqual(read().member.a.serverRaidAccount.latest.rank, 1); assert.strictEqual(read().member.c.serverRaidAccount.latest.rank, 1);
});
group("10위5천만·미참여 무보상·유효0데미지 참가·전체 미참여 종료", () => {
    const d = read();
    for (let i = 0; i < 10; i++) { d.member["p" + i] = { point: 0, server: c.GLOBAL_CONFIG.serverRaid.servers[i], agree: true, R: 1000 - i * 100 }; }
    write(d); const pets = JSON.parse(disk[root + "member_pet.json"]); for (let i = 0; i < 10; i++) pets["p" + i] = { petname: "합성펫" }; disk[root + "member_pet.json"] = JSON.stringify(pets);
    start(); for (let i = 0; i < 10; i++) attack("p" + i, "p" + i); end();
    assert.strictEqual(read().member.p9.serverRaidAccount.latest.serverRank, 10); assert.strictEqual(read().member.p9.point, 50000001);
    start(); const zero = read(); zero.member.a.R = 0; write(zero); attack("a", "zero"); end();
    assert.strictEqual(read().member.a.serverRaidAccount.latest.damage, "0"); assert.strictEqual(read().member.a.serverRaidAccount.latest.percent, "0.00%"); assert.strictEqual(read().member.a.serverRaidAccount.latest.rankReward, 500000000);
    start(); const points = Object.fromEntries(Object.entries(read().member).map(([u, m]) => [u, m.point])); end();
    assert.deepStrictEqual(Object.fromEntries(Object.entries(read().member).map(([u, m]) => [u, m.point])), points);
    const endNotices = traces.filter(t => t.type === "notice" && t.text.includes("오늘은 조용하군")); assert(endNotices.length > 0);
});
group("최신 개인 기록 유지·KST·누적 회차/공격 구분·더보기와 미참여 조회", () => {
    start(); for (let i = 0; i < 5; i++) attack("a", "a" + i); attack("b", "b"); end();
    const personal = run("/레이드순위"); assert(personal.includes("2026.10.05 21:01")); assert(!personal.includes("/5회")); assert(!personal.includes("서버 전체 데미지")); assert(personal.includes("✅ 지급 완료"));
    const latest = clone(read().member.a.serverRaidAccount.latest); start(); end(); assert.deepStrictEqual(read().member.a.serverRaidAccount.latest, latest);
    const cumulative = run("/서버레이드순위"); assert(cumulative.includes("우승: 1회")); assert(cumulative.includes("참가 1회 · 공격 5회")); assert(cumulative.includes("83.33%")); assert(cumulative.includes("← 나"));
    assert(cumulative.indexOf("📊 기여도") < cumulative.indexOf("<ALLSEE>"));
    const before = disk[memberPath]; assert(run("/서버레이드순위", "c").includes("참가 기록 없음")); assert(run("/서버레이드순위 호이서버2").includes("서버명을 입력하지")); assert.strictEqual(disk[memberPath], before);
});
group("이동·재입장 기록 미복원·남은 명단 기여도 재계산·확정 개인 결과 보존", () => {
    start(); attack("a", "a"); attack("b", "b"); end(); const d = read();
    const official = JSON.stringify(d.serverRaid.history); const bLatest = JSON.stringify(d.member.b.serverRaidAccount.latest); const oldPoint = d.member.a.point;
    const destination = c.GLOBAL_CONFIG.serverRaid.servers[1]; assert(c.applyServerRaidMembershipChange(d.member.a, destination));
    assert(!d.member.a.serverRaidAccount.latest); assert(!d.member.a.serverRaidAccount.total); assert.strictEqual(d.member.a.serverRaidAccount.period, 1); assert.strictEqual(d.member.a.point, oldPoint);
    write(d); assert(run("/레이드순위").includes("참가 기록이 없습니다")); assert(run("/서버레이드순위", "b").includes("100.00%"));
    c.applyServerRaidMembershipChange(d.member.a, c.GLOBAL_CONFIG.serverRaid.servers[0]); write(d);
    assert(!d.member.a.serverRaidAccount.total); assert.strictEqual(d.member.a.serverRaidAccount.period, 2);
    assert.strictEqual(JSON.stringify(d.serverRaid.history), official); assert.strictEqual(JSON.stringify(d.member.b.serverRaidAccount.latest), bLatest); assert.strictEqual(d.serverRaid.wins[c.GLOBAL_CONFIG.serverRaid.servers[0]], 1);
    const same = JSON.stringify(d); assert(!c.applyServerRaidMembershipChange(d.member.a, d.member.a.server)); assert.strictEqual(JSON.stringify(d), same);
});
group("정산 지연 후 같은 서버 재입장도 조회 기록 재생성하지 않고 원래 보상만 지급", () => {
    start(); attack("a", "a"); run("/서버대전종료", "master"); const d = read(); const home = d.member.a.server;
    c.applyServerRaidMembershipChange(d.member.a, c.GLOBAL_CONFIG.serverRaid.servers[1]); c.applyServerRaidMembershipChange(d.member.a, home); write(d); tick();
    assert.strictEqual(read().member.a.point, 1500001000); assert(!read().member.a.serverRaidAccount.latest); assert(!read().member.a.serverRaidAccount.total);
    assert.strictEqual(read().serverRaid.history[0].accounts[d.member.a.serverRaidAccount.id].paid, true);
});
group("계정 닉네임 이동·삭제 후 같은 닉네임 재가입은 다른 내부 계정", () => {
    start(); attack("a", "one"); const d = read(); const oldId = d.member.a.serverRaidAccount.id;
    d.member.renamed = d.member.a; delete d.member.a; write(d);
    const pets = JSON.parse(disk[root + "member_pet.json"]); pets.renamed = pets.a; disk[root + "member_pet.json"] = JSON.stringify(pets);
    attack("renamed", "two");
    assert.strictEqual(read().serverRaid.current.accounts[oldId].attacks.length, 2);
    const next = read(); delete next.member.renamed; next.member.a = { point: 0, agree: true, server: c.GLOBAL_CONFIG.serverRaid.servers[0] }; write(next); attack("a", "three");
    assert.notStrictEqual(read().member.a.serverRaidAccount.id, oldId); end(); assert.strictEqual(read().member.a.point, 500001000);
    assert.strictEqual(read().serverRaid.history[0].accounts[oldId].missingAccount, true);
});
group("MAX_SAFE를 넘는 합계도 정확한 공동/차등 순위·기여도", () => {
    assert.strictEqual(c.addServerRaidInteger("9007199254740991", "2"), "9007199254740993");
    assert.strictEqual(c.serverRaidPercent("840000000", "2460000000"), "34.15%");
    assert.strictEqual(c.serverRaidPercent("1", "32"), "3.13%"); assert.strictEqual(c.serverRaidPercent("0", "0"), "0.00%");
    const rows = c.rankServerRaidRows([{ id: "a", damage: "9007199254740993" }, { id: "b", damage: "9007199254740992" }, { id: "c", damage: "9007199254740993" }]);
    assert.deepStrictEqual(Array.from(rows, r => r.rank), [1, 1, 3]);
    start(); const d = read(); d.member.a.R = Number.MAX_SAFE_INTEGER; d.member.b.R = Number.MAX_SAFE_INTEGER - 1; write(d);
    attack("a", "huge-a"); attack("b", "huge-b"); end(); const latest = read();
    assert.strictEqual(latest.serverRaid.history[0].results[0].damage, "18014398509481981"); assert.strictEqual(latest.member.a.serverRaidAccount.latest.rank, 1); assert.strictEqual(latest.member.b.serverRaidAccount.latest.rank, 2);
});
group("잘못된 수치·포인트 지급 범위 초과는 공격 미차감·미지급", () => {
    start();
    for (const R of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100000"]) {
        const d = read(); d.member.a.R = R; write(d); const before = disk[memberPath]; assert.throws(() => attack("a", "bad"), /정수 범위/); assert.strictEqual(disk[memberPath], before);
    }
    const d = read(); d.member.a.R = 100000; d.member.a.point = Number.MAX_SAFE_INTEGER; write(d); const before = disk[memberPath]; assert.throws(() => attack(), /정수 범위/); assert.strictEqual(disk[memberPath], before);
});
group("공격 저장 교체 실패 전액 미반영·응답 실패 후 이벤트 재전송 미재지급", () => {
    start(); const before = disk[memberPath]; failWrite = d => !!d.member.a.serverRaidAccount;
    assert.throws(() => attack(), /rename|replace|교체/i); assert.strictEqual(disk[memberPath], before);
    replyFailure = true; attack(); const committed = disk[memberPath]; replyFailure = false; attack(); assert.strictEqual(disk[memberPath], committed); assert.strictEqual(read().member.a.point, 1000001000);
});
group("지급 저장 후 우승 확정 저장 실패·재시작 재시도는 중복 지급 없이 완료", () => {
    start(); attack("a", "a"); attack("b", "b"); run("/서버대전종료", "master");
    failWrite = d => d.serverRaid.completed > 0; tick(); let d = read();
    assert.strictEqual(d.member.a.point, 1500001000); assert.strictEqual(d.member.b.point, 1500001000); assert.strictEqual(d.serverRaid.current.state, "SETTLING"); assert.deepStrictEqual(d.serverRaid.wins, {});
    c.serverRaidWorkTimers = {}; timers.clear(); c.scheduleServerRaidWork(c.createCommandContext(false, "room8"), d.serverRaid.generation, 1, d.serverRaid.sequence); tick();
    d = read(); assert.strictEqual(d.member.a.point, 1500001000); assert.strictEqual(d.member.b.point, 1500001000); assert.strictEqual(d.serverRaid.completed, 1); assert.strictEqual(d.serverRaid.wins[c.GLOBAL_CONFIG.serverRaid.servers[0]], 1);
});
group("준비 중 재시작은 원래 마감 유지·활성화 공지 한 번·진행 횟수 유지", () => {
    run("/서버대전시작", "master"); tick(); tick(20000); const deadline = read().serverRaid.current.prepareUntil;
    c.serverRaidWorkTimers = {}; timers.clear(); const d = read(); c.scheduleServerRaidWork(c.createCommandContext(false, "room8"), d.serverRaid.generation, 1, d.serverRaid.sequence); tick();
    assert.strictEqual(read().serverRaid.current.prepareUntil, deadline); tick(40000); assert.strictEqual(read().serverRaid.current.state, "ACTIVE");
    assert.strictEqual(traces.filter(t => t.type === "notice" && t.room === "room8" && t.text.includes("크아아아앙")).length, 1);
    attack(); c.serverRaidWorkTimers = {}; timers.clear(); attack("a", "second"); assert.strictEqual(read().serverRaid.current.accounts[read().member.a.serverRaidAccount.id].attacks.length, 2);
});
group("공지 일부 실패는 완료 방 재발송 없이 미완료만 재시도·보상과 별 미증가", () => {
    start(); attack(); failNotice = (room, text) => room === "room2" && text.includes("이번 대전 우승"); end();
    const d = read(); assert.strictEqual(d.serverRaid.completed, 1); assert.strictEqual(d.member.a.point, 1500001000);
    const sent = traces.filter(t => t.type === "notice" && t.room === "room1" && t.text.includes("이번 대전 우승")).length; assert.strictEqual(sent, 1);
    failNotice = null; tick(2000); assert.strictEqual(traces.filter(t => t.type === "notice" && t.room === "room1" && t.text.includes("이번 대전 우승")).length, 1);
    assert.strictEqual(read().member.a.point, d.member.a.point); assert.deepStrictEqual(read().serverRaid.wins, d.serverRaid.wins);
    const end1 = traces.findIndex(t => t.type === "notice" && t.text.includes("항복이다")); const firstPay = traces.findIndex(t => t.type === "save" && t.data.member.a.point === 1500001000); assert(end1 < firstPay);
});
group("전체 초기화 권한·옛 작업 세대 차단·일반 재화와 가방 보존", () => {
    start(); attack(); run("/서버대전종료", "master"); const stale = [...timers.values()][0].fn; const before = disk[memberPath];
    assert(run("/서버대전전체초기화", "a").includes("권한")); assert.strictEqual(disk[memberPath], before);
    const old = read(); run("/서버대전전체초기화", "master"); stale(); tick(100000);
    const d = read(); assert.notStrictEqual(d.serverRaid.generation, old.serverRaid.generation); assert(!d.serverRaid.current); assert.strictEqual(d.serverRaid.completed, 0); assert.deepStrictEqual(d.serverRaid.history, []); assert.deepStrictEqual(d.serverRaid.wins, {});
    assert.strictEqual(d.member.a.point, old.member.a.point); assert.deepStrictEqual(d.member.a.bag, old.member.a.bag); assert(!d.member.a.serverRaidAccount.total);
    start(); assert.notStrictEqual(read().serverRaid.current.id, old.serverRaid.current.id);
});
group("DEV 회차·별·포인트·공지와 운영 데이터 완전 분리", () => {
    const production = disk[memberPath]; start(true); attack("a", "dev", true); end(true);
    assert.strictEqual(disk[memberPath], production); assert.strictEqual(read(true).member.a.point, 1500001000);
    const notices = traces.filter(t => t.type === "notice"); assert(notices.every(t => t.room === "room8" && t.text.startsWith("[DEV 테스트환경]")));
    assert(traces.filter(t => t.type === "save").every(t => t.path.startsWith(devRoot)));
});
group("정보·종합순위 ⭐ 원본 일치·별칭 정상화·매력 합산/순서 보존", () => {
    start(); attack(); end(); const d = read();
    for (const server of c.GLOBAL_CONFIG.serverRaid.servers) assert.strictEqual(c.formatServerRaidServer(d, server), infoContext.formatInfoServerRaidServer(d, server));
    assert.strictEqual(infoContext.formatInfoServerRaidServer(d, "호이서버6[2030]"), "호이서버6[30]⭐0");
    const scores = [{ key: "a", totalExp: 12 }, { key: "b", totalExp: 8 }]; const rows = infoContext.buildServerRankingRows(scores, d); assert.strictEqual(rows[0].totalExp, 20);
    const before = JSON.stringify(d); const output = infoContext.buildCombinedServerRankingMessage(rows, "a", d, {}, {});
    assert(output.includes("호이서버1[30]⭐1")); assert.strictEqual((output.match(/<ALLSEE>/g) || []).length, 1); assert.strictEqual(JSON.stringify(d), before);
    assert(main.includes("const HoiBotVersion")); assert(info.includes("formatInfoServerRaidServer(data, memberInfo.server)")); assert(info.includes("formatInfoServerRaidServer(data, data.member[targetUser].server)"));
});
group("조회와 공격 출력은 저장 상태 미변경·로딩 실패를 빈 데이터로 복구하지 않음", () => {
    start(); attack(); const d = read(), before = JSON.stringify(d), a = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    c.buildServerRaidAttackMessage(d, a, a.attacks[0], "[합성] 님"); assert.strictEqual(JSON.stringify(d), before);
    end(); const idle = disk[memberPath]; run("/레이드순위"); run("/서버레이드순위"); assert.strictEqual(disk[memberPath], idle);
    disk[memberPath] = "invalid json"; assert.throws(() => run("/레이드순위"), error => error.name === "SyntaxError"); assert.strictEqual(disk[memberPath], "invalid json");
});
group("실제 이동권·관리자 이동 저장 실패에서 소속·개인 기록·이동권 모두 복구", () => {
    start(); attack(); end(); const d = read(); const item = c.GLOBAL_CONFIG.serverTransfer.itemName; d.member.a.bag[item] = 2; write(d);
    c.petData = {}; c.guildData = {}; c.roomToServer = { room1: c.GLOBAL_CONFIG.serverRaid.servers[0] };
    function move(msg, admin = false) {
        replies = []; c.msg = msg; c.sender = admin ? "admin" : "a"; c.data = read(); const previous = c.enterCommandContext(c.createCommandContext(false, "test")); c.beginDataSaveTransaction();
        try { admin ? c.runAdminMove() : c.runTicketMove(); }
        finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
        return replies.join("\n");
    }
    for (const [msg, admin] of [["/서버변경 호이서버2", false], ["/서버이동 a 호이서버2[2030]", true]]) {
        const before = disk[memberPath]; failWrite = value => value.member.a.server === c.GLOBAL_CONFIG.serverRaid.servers[1];
        assert(move(msg, admin).includes("실패") || replies.join("").includes("오류")); assert.strictEqual(disk[memberPath], before); assert.deepStrictEqual(clone(c.data.member.a), read().member.a);
        assert(!replies.join("").includes("완료되었습니다"));
    }
    const official = JSON.stringify(read().serverRaid.history); assert(move("/서버변경 호이서버2").includes("완료"));
    assert.strictEqual(read().member.a.bag[item], 1); assert(!read().member.a.serverRaidAccount.latest); assert.strictEqual(read().member.a.serverRaidAccount.period, 1);
    assert(move("/서버이동 a 호이서버1[30]", true).includes("이동되었습니다")); assert.strictEqual(read().member.a.serverRaidAccount.period, 2); assert.strictEqual(read().member.a.bag[item], 1);
    assert.strictEqual(JSON.stringify(read().serverRaid.history), official);
});
group("취소된 이전 회차 타이머는 새 회차와 새 타이머를 변경하지 않음", () => {
    run("/서버대전시작", "master"); const stale = [...timers.values()][0].fn;
    run("/서버대전종료", "master"); tick(); run("/서버대전시작", "master");
    const before = disk[memberPath], timerId = c.serverRaidWorkTimers[root]; stale();
    assert.strictEqual(disk[memberPath], before); assert.strictEqual(c.serverRaidWorkTimers[root], timerId); tick(); tick(60000); assert.strictEqual(read().serverRaid.current.state, "ACTIVE");
});
group("이미 일부 지급 완료된 저장 상태는 미완료 참가자만 이어서 정산", () => {
    start(); attack("a", "a"); attack("b", "b"); run("/서버대전종료", "master");
    const d = read(); assert(c.settleServerRaidParticipant(d)); write(d); const paid = d.member.a.point;
    tick(); assert.strictEqual(read().member.a.point, paid); assert.strictEqual(read().member.b.point, 1500001000); assert.strictEqual(read().serverRaid.completed, 1);
});
group("참가자 1,000명 정산 저장은 인원수만큼 반복하지 않음", () => {
    start(); const d = read(), round = d.serverRaid.current;
    for (let i = 0; i < 1000; i++) {
        const user = "synthetic-" + i, id = "synthetic-id-" + i, server = c.GLOBAL_CONFIG.serverRaid.servers[i % 10];
        d.member[user] = { point: 0, server, serverRaidAccount: { id, period: 0, server, latest: null, total: null }, bag: {} };
        round.accounts[id] = { id, user, server, period: 0, damage: "100000", attackReward: 1000, attacks: [{ id: "event:" + i, R: 100000, D: 100000, P: 1000 }], paid: false };
    }
    write(d); run("/서버대전종료", "master"); traces = []; tick();
    const saves = traces.filter(t => t.type === "save" && t.path === memberPath);
    assert.strictEqual(saves.length, 28); // 지급 1 + 완료 1 + 신규 일반방을 포함한 공지 13방에 공지 2회
    assert.strictEqual(read().member["synthetic-999"].point, 500000000); assert.strictEqual(read().serverRaid.completed, 1);
    assert.strictEqual(read().member["synthetic-999"].serverRaidAccount.total.participations, 1);
});
group("이전부터 대기 중인 펫이름·추천인·관리자 소식 입력도 잠금, 일반 대화 유지", () => {
    start(); const d = read(); d.member.a.adventureOnboarding = { stage: "WAIT_REFERRAL" }; d.member.b.adventureOnboarding = { stage: "WAIT_PET_NAME" }; write(d);
    c.worldNewsDraftState[c.getWorldNewsDraftKey("master", "test")] = { step: "title" };
    for (const [msg, user] of [["없음", "a"], ["합성 추천인", "a"], ["합성 펫이름", "b"], ["새 소식 제목", "master"], ["호월 봇 이용약관", "c"]]) {
        const before = disk[memberPath]; assert(run(msg, user, undefined, user === "master" ? "test" : "room8").includes("지금은 서버 레이드대전")); assert.strictEqual(disk[memberPath], before);
    }
    const before = disk[memberPath]; assert.strictEqual(run("일반 대화", "c"), ""); assert.strictEqual(disk[memberPath], before);
});
group("기록 조회에서도 기존 출석·계정정지·일대일 패스 제한 유지", () => {
    for (const msg of ["/레이드순위", "/서버레이드순위"]) {
        const before = disk[memberPath];
        assert(run(msg, "absent").includes("출석체크")); assert(run(msg, "suspended").includes("계정정지")); assert(run(msg, "noPass", undefined, "private", false).includes("프리미엄 필요"));
        assert.strictEqual(disk[memberPath], before);
    }
});
group("네이티브 확장 콜백 logId·channelId는 큰 정수 문자열로 수신·공격 재전송 차단", () => {
    const native = { logId: { toString: () => "18446744073709551615" }, channelId: { toString: () => "9007199254740993123" }, userHash: "native-user" };
    run("/서버대전시작", "master", undefined, "room8", true, native); tick(); tick(60000);
    native.logId = { toString: () => "18446744073709551614" };
    run("/레이드공격", "a", undefined, "room8", true, native); const before = disk[memberPath];
    run("/레이드공격", "a", undefined, "room8", true, native); assert.strictEqual(disk[memberPath], before);
    const a = read().serverRaid.current.accounts[read().member.a.serverRaidAccount.id]; assert.strictEqual(a.attacks[0].id, "event:com.kakao.talk|9007199254740993123|18446744073709551614");
    for (const bad of [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, 0, false, null, undefined, "0", "1e20"]) {
        assert.strictEqual(c.getServerRaidNativeId(bad), null); const beforeBad = disk[memberPath];
        run("/레이드공격", "a", undefined, "room8", true, { ...native, logId: bad }); assert.strictEqual(disk[memberPath], beforeBad);
    }
});
group("네이티브 운영봇은 등록된 앱·방·사용자 해시만 인증·동일 닉네임 위조 거부", () => {
    const native = { logId: "18446744073709551615", channelId: "9007199254740993123", userHash: "registered-bot" };
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["com.kakao.talk|9007199254740993123|registered-bot"];
    assert(run("/서버대전시작", "오픈채팅봇", undefined, "room8", true, { ...native, userHash: "imposter" }).includes("권한")); assert(!read().serverRaid);
    assert(run("/서버대전시작", "오픈채팅봇", undefined, "room8", true, { ...native, channelId: "123" }).includes("권한")); assert(!read().serverRaid);
    run("/서버대전시작", "오픈채팅봇", undefined, "room8", true, native); assert(c.isServerRaidLocked(read()));
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = [];
});

group("최초 DEV 데이터백업은 없는 DEV 파일을 먼저 읽지 않고 기존 MASTER 권한 유지", () => {
    const originalMissing = c.getMissingDevDataFiles, originalBackup = c.backupDevDataFromProduction;
    for (const p of Object.keys(disk)) if (p.startsWith(devRoot)) delete disk[p];
    let backups = 0;
    c.getMissingDevDataFiles = () => disk[devRoot + "member.json"] ? [] : ["member.json"];
    c.backupDevDataFromProduction = () => {
        backups++;
        for (const p of Object.keys(disk)) if (p.startsWith(root)) disk[devRoot + p.slice(root.length)] = disk[p];
        return "합성 DEV 백업 완료";
    };
    try {
        const production = disk[memberPath];
        assert(run("dev/레이드순위").includes("DEV 데이터가 준비되지"));
        assert(run("dev/데이터백업", "a").includes("권한")); assert.strictEqual(backups, 0);
        assert(!traces.some(t => t.type === "load" && t.path.includes(devRoot)));
        assert(run("dev/데이터백업", "master").includes("백업 완료")); assert.strictEqual(backups, 1);
        assert.strictEqual(disk[memberPath], production); assert.strictEqual(disk[devRoot + "member.json"], production);
        run("dev/서버대전시작", "master"); assert(c.isServerRaidLocked(read(true)));
        assert(run("dev/데이터백업", "master").includes("지금은 서버 레이드대전")); assert.strictEqual(backups, 1);
    } finally {
        c.getMissingDevDataFiles = originalMissing; c.backupDevDataFromProduction = originalBackup;
    }
});

group("레거시 공격 저장 실패는 미반영·재입력은 새 공격·응답 실패 후에도 한 호출당 한 번 저장", () => {
    start(); const before = disk[memberPath]; failWrite = d => !!d.member.a.serverRaidAccount;
    assert.throws(() => attack("a", null), /rename|replace|교체/i); assert.strictEqual(disk[memberPath], before);
    replyFailure = true; attack("a", null); replyFailure = false;
    assert.strictEqual(read().member.a.point, 1000001000);
    // 원본 ID가 없는 재전송은 새 공격으로 센다는 사용자 승인 정책을 검증한다.
    attack("a", null); const d = read(), participant = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    assert.strictEqual(participant.attacks.length, 2); assert.strictEqual(d.member.a.point, 1000002000);
    end(); const paid = disk[memberPath]; c.serverRaidWorkTimers = {}; timers.clear(); end(); tick();
    assert.strictEqual(disk[memberPath], paid);
});

group("레거시 기본 콜백 DEV 공격·정산은 운영 파일과 공지에 영향 없음", () => {
    const production = disk[memberPath]; start(true); attack("a", null, true); end(true);
    assert.strictEqual(disk[memberPath], production); assert.strictEqual(read(true).member.a.point, 1500001000);
    assert.strictEqual(read(true).serverRaid.completed, 1);
    assert(traces.filter(t => t.type === "notice").every(t => t.room === "room8"));
});

group("확장 인수 없는 8인수 및 빈 확장 슬롯은 기본 콜백 호환·손상된 확장 ID 시작 차단", () => {
    for (const args of [Array(7), [null, null, null, null, null, null, "com.kakao.talk", false], Array(11)]) {
        assert.strictEqual(c.getServerRaidCallbackEvent(args, "com.kakao.talk"), null);
        const first = c.createServerRaidAttackEvent(null), second = c.createServerRaidAttackEvent(null);
        assert.notStrictEqual(first.id, second.id);
    }
    const native = { logId: 123, channelId: "456", userHash: "master" }, before = disk[memberPath];
    assert(run("/서버대전시작", "master", undefined, "room8", true, native).includes("식별값"));
    assert.strictEqual(disk[memberPath], before); assert(!c.isServerRaidLocked(read()));
    assert.throws(() => { start(); c.applyServerRaidAttack(read(), "a", "new-id", null, 100000, 100000); }, /저장 식별값/);
});

group("예약 유실 후 DEV 종료 재입력으로 미완료 정산 재개·중복 지급 없음", () => {
    start(true); attack("a", null, true);
    run("dev/서버대전종료", "master"); c.serverRaidWorkTimers = {}; timers.clear();
    assert.strictEqual(read(true).serverRaid.current.state, "SETTLING");
    run("dev/서버대전종료", "master"); assert.strictEqual(timers.size, 1); tick();
    assert.strictEqual(read(true).serverRaid.completed, 1); assert.strictEqual(read(true).member.a.point, 1500001000);
    end(true); assert.strictEqual(read(true).member.a.point, 1500001000);
});

group("예약 유실 후 준비 중 시작 재입력은 회차·마감 보존하고 원래 시각에 활성화", () => {
    run("dev/서버대전시작", "master"); tick(); tick(20000);
    const round = clone(read(true).serverRaid.current); c.serverRaidWorkTimers = {}; timers.clear();
    assert(run("dev/서버대전시작", "master").includes("지금은 서버 레이드대전"));
    assert.deepStrictEqual(read(true).serverRaid.current, round); assert.strictEqual(timers.size, 1);
    tick(); tick(40000); assert.strictEqual(read(true).serverRaid.current.state, "ACTIVE");
    assert.strictEqual(read(true).serverRaid.current.id, round.id);
});

group("실제 7인수 response 전체 콜백·DEV 헤더·잠금/컨텍스트 해제·저장 실패 처리", () => {
    const originalFlow = c.commandDataFlowLock, originalDataLock = c.dataTransactionLock, originalWrite = c.FileStream.write;
    const originalIdentity = c.isMasterIdentity, originalDepth = c.autoDailyQuestInternalDepth, originalErrorPath = c.errorLogPath;
    function countedLock() {
        return { depth: 0, locks: 0, lock() { this.depth++; this.locks++; }, tryLock() { this.lock(); return true; }, unlock() { assert(this.depth > 0); this.depth--; } };
    }
    const readLock = countedLock(), writeLock = countedLock(), dataLock = countedLock();
    c.commandDataFlowLock = { readLock: () => readLock, writeLock: () => writeLock }; c.dataTransactionLock = dataLock;
    c.isMasterIdentity = user => user === "master"; c.autoDailyQuestInternalDepth = 0; c.errorLogPath = "/synthetic/error.json";
    c.FileStream.write = (p, value) => { assert.strictEqual(p, c.errorLogPath); traces.push({ type: "error", value }); };
    function callback(msg, user = "a", room, group = true) {
        room = room === undefined ? (c.isDevCommandMessage(msg) ? "test" : "room8") : room;
        replies = []; c.response(room, msg, user, group, c.replier, {}, "com.kakao.talk");
        assert.strictEqual(readLock.depth, 0); assert.strictEqual(writeLock.depth, 0); assert.strictEqual(dataLock.depth, 0);
        assert.strictEqual(c.commandContextThreadLocal.get(), null); assert.strictEqual(c.dataSaveTransactionThreadLocal.get(), null);
        return replies.join("\n");
    }
    try {
        callback("/서버대전시작", "master"); tick(); tick(60000);
        for (let i = 0; i < 6; i++) callback("/레이드공격", "a");
        assert.strictEqual(read().member.a.point, 1000005000); assert(replies.join("").includes("모두 사용"));
        callback("/서버대전종료", "master"); tick(); assert.strictEqual(read().member.a.point, 1500005000);
        callback("/서버대전종료", "master"); assert.strictEqual(read().serverRaid.completed, 1);
        assert(!traces.some(t => t.type === "error")); assert(writeLock.locks >= 9);
        const prod = disk[memberPath]; callback("dev/서버대전시작", "master"); tick(); tick(60000);
        const dev = disk[devRoot + "member.json"]; failWrite = d => !!d.member.b.serverRaidAccount;
        assert.strictEqual(callback("dev/레이드공격", "b"), ""); assert.strictEqual(disk[devRoot + "member.json"], dev);
        assert(traces.some(t => t.type === "error"));
        assert(callback("dev/레이드공격", "b").startsWith("[DEV 테스트환경]\n"));
        callback("dev/서버대전종료", "master"); tick(); assert.strictEqual(read(true).member.b.point, 1500001000);
        assert.strictEqual(disk[memberPath], prod);
    } finally {
        c.commandDataFlowLock = originalFlow; c.dataTransactionLock = originalDataLock; c.FileStream.write = originalWrite;
        c.isMasterIdentity = originalIdentity; c.autoDailyQuestInternalDepth = originalDepth; c.errorLogPath = originalErrorPath;
    }
});

group("실제 레이드 계산·인장·홈/길드 큐브·레벨·퀘스트 합산과 Info 일치·종합매력 미사용", () => {
    const names = ["calculateRaidExp", "getPetModeCharmPercent", "getAdventurePromotionCounts", "getAdventureLevelCharmPercent", "applyPercentWithExactFloor",
        "getHomeBadgeCubeStore", "normalizeHomeBadgeCubeEquippedBadgeIds", "getHomeBadgeCubeRecord", "getHomeBadgeCubeOptionConfig",
        "isHomeBadgeCubeTotalBuffActive", "isHomeBadgeCubeOptionAppliedInSlot", "getHomeBadgeCubeSlotOptionPercent", "getHomeBadgeCubeActiveOptionPercent", "calculateEffectivePetUpgradeLevel",
        "calculateItemInfoAll", "calculateItemInfo", "getMyGuildId", "getGuildContributionCubeOptionByKey", "getGuildContributionCubeData", "getGuildContributionCubeMemberPercent"];
    const itemConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "itemInfo.json"), "utf8"));
    const stubs = { raidSpecialItem: itemConfig.raidSpecialItem, calculatePendantItemInfo: () => ({ battleExp: 0, castleExp: 0, raidExp: 0 }), getMiniPetModeCharm: () => 0, getHomeTotalExp: () => 0,
        getEquippedNonTierPetSkillExp: () => 0, getEquippedTierPetSkillExp: () => 0, hasPetSkill: () => false,
        isHoiPassPremiumActive: () => false,
        calculateTotalExp: () => { throw Error("종합매력을 공격에 사용하면 안 됨"); } };
    const originals = new Map([...names, ...Object.keys(stubs)].map(name => [name, c[name]]));
    const comparison = { ...stubs, calculatePendantItemInfoForInfo: stubs.calculatePendantItemInfo, numberWithCommas: c.numberWithCommas, isInfoSupportPassActive: () => false };
    vm.createContext(comparison);
    vm.runInContext(block(info, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", comparison);
    for (const name of ["calculateRaidExp", "getInfoAdventureLevelSummary", "applyInfoPercentWithExactFloor", "getInfoHomeBadgeCubeEquippedBadgeIds", "getInfoHomeBadgeCubeSlotOptionPercent", "getHomeBadgeCubeActiveOptionPercent",
        "calculateItemInfoAll", "calculateItemInfo", "getMyGuildId", "getGuildContributionCubeMemberPercent"])
        vm.runInContext(block(info, "function " + name + "("), comparison);
    try {
        Object.assign(c, stubs);
        for (const name of names) vm.runInContext(block(main, "function " + name + "("), c);
        start();
        for (const [index, lv] of [1, 10, 100, 321828].entries()) {
            const d = read(), user = ["a", "b", "c", "master"][index];
            const sealCount = [0, 1, 5, 1234][index]; d.member[user].bag[c.GLOBAL_CONFIG.raidSealCraft.rewardName] = sealCount;
            d.member[user].guild = { id: "g0" };
            const guild = { guilds: { g0: { members: { [user]: {} }, cubeOptions: { raid: 17 } } } };
            disk[root + "guild.json"] = JSON.stringify(guild);
            const pets = JSON.parse(disk[root + "member_pet.json"]); pets[user].petexp = 100000000; disk[root + "member_pet.json"] = JSON.stringify(pets);
            d.member[user].lv = lv; d.member[user].adventureQuest = { totals: { raidPercent: 1 } };
            d.member[user].homeBadgeCube = { equippedBadgeIds: ["one", "two"], badges: {
                one: { raid: 10, castle: 0, petUpgrade: 0, explore: 0 }, two: { raid: 20, castle: 0, petUpgrade: 0, explore: 0 } } };
            write(d);
            const levelPercent = (lv - 1) * c.GLOBAL_CONFIG.level.baseCharmPercent + (Math.floor(lv / 10) - Math.floor(lv / 100)) * c.GLOBAL_CONFIG.level.normalPromotionPercent + Math.floor(lv / 100) * c.GLOBAL_CONFIG.level.majorPromotionPercent;
            const base = 100000000 + 600 * sealCount;
            const expected = base + Math.floor(base * Math.round((32.7 + levelPercent) * 1000) / 100000);
            const expectedData = vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify(d)) + ")", comparison);
            assert.strictEqual(comparison.calculateRaidExp(user, expectedData, pets, {}, {}, false, guild), expected);
            const output = attack(user, null), saved = read();
            const attackRow = saved.serverRaid.current.accounts[saved.member[user].serverRaidAccount.id].attacks[0];
            assert.strictEqual(attackRow.R, expected); assert.strictEqual(attackRow.D, expected); assert.strictEqual(attackRow.P, Math.floor(expected / 100));
            assert(output.includes("레이드매력: " + c.numberWithCommas(expected)));
        }
    } finally { for (const [name, original] of originals) c[name] = original; }
});

group("제보 치명타 수치 재현·R1% 지급 및 이전 D1% 지급 기록 재전송 유지", () => {
    start(); const d = read(); d.member.a.R = 116601136; write(d);
    const originalUpgrade = c.calculateEffectivePetUpgradeLevel; c.calculateEffectivePetUpgradeLevel = () => 882;
    vm.runInContext("Math.random=function(){return 0}", c);
    try {
        const output = attack("a", "reported-critical"), current = read();
        const participant = current.serverRaid.current.accounts[current.member.a.serverRaidAccount.id], row = participant.attacks[0];
        assert.strictEqual(row.D, 876840543); assert.strictEqual(row.P, 1166011);
        assert(output.includes("레이드매력: 116,601,136")); assert(output.includes("획득 포인트: 🅟1,166,011"));
        assert(output.includes("레이드매력의 1% 지급"));
        // 직전 버전에서 지급된 D1% 공격은 당시 지급액과 설명을 유지한다.
        row.rewardBasis = "damage"; row.P = 8768405; participant.attackReward = 8768405; current.member.a.point = 1008768405; write(current);
        const old = disk[memberPath]; assert(attack("a", "reported-critical").includes("공격 데미지의 1% 지급 (당시 기준)"));
        assert.strictEqual(disk[memberPath], old);
    } finally { c.calculateEffectivePetUpgradeLevel = originalUpgrade; }
});

group("종료 상금은 실제 확정 지급액과 일치·ALLSEE 1회·미참여·공동 순위·표시 무변경", () => {
    start(); const d = read(); d.member.b.server = c.GLOBAL_CONFIG.serverRaid.servers[1]; d.member.b.R = 50000; write(d);
    attack("a", "prize-a"); attack("b", "prize-b"); run("/서버대전종료", "master");
    const settling = read(), round = settling.serverRaid.current;
    // 설정 변경에도 종료 시 확정한 지급액으로 표시한다. 이전 저장 형식도 읽는다.
    delete round.results[1].rankReward;
    const originalRanks = c.GLOBAL_CONFIG.serverRaid.rewards.ranks; c.GLOBAL_CONFIG.serverRaid.rewards.ranks = [1, 2];
    try {
        const before = JSON.stringify(settling), output = c.buildServerRaidResultNotice(settling, round);
        assert.strictEqual(JSON.stringify(settling), before);
        assert.strictEqual(output.split("<ALLSEE>").length, 2);
        assert(output.includes("서버 레이드데미지 순위 집계📊\n💰 상금은 참여자 1인당 지급 기준입니다.\n<ALLSEE>\n━━━━━━━━━━━━"));
        assert(output.split("<ALLSEE>")[0].includes("참여자 1인당 상금: 5억 포인트"));
        assert(output.split("<ALLSEE>")[1].includes("상금: 4억 5천만 포인트"));
        assert(output.includes("미참여 서버는 상금이 없습니다."));
        assert.strictEqual(c.formatServerRaidPrize(50000000), "5천만 포인트");
        assert.strictEqual(c.formatServerRaidPrize(450012345), "4억 5,001만 2,345 포인트");
    } finally { c.GLOBAL_CONFIG.serverRaid.rewards.ranks = originalRanks; }
    tick(); assert.strictEqual(read().member.a.point, 1500001000); assert.strictEqual(read().member.b.point, 1450000500);
});

group("조회 명령 새 이름 2종과 안내 동기화·구 이름은 레이드 조회로 실행하지 않음", () => {
    assert(!c.isServerRaidCommand("/서버레이드기록 호이서버2"));
    for (const msg of ["/레이드기록", "/서버레이드기록"]) {
        const before = JSON.stringify(disk); traces = [];
        assert(run(msg).includes("명령어가 변경")); assert.strictEqual(JSON.stringify(disk), before);
        assert(!traces.some(t => t.type === "load" || t.type === "save"));
    }
    for (const msg of ["/레이드순위", "/서버레이드순위", "/서버레이드순위 호이서버2"]) assert(c.isServerRaidCommand(msg));
    start(); attack("a", null); end();
    assert(run("/레이드순위").includes("/서버레이드순위")); assert(run("/서버레이드순위").includes("/레이드순위"));
    const before = disk[memberPath]; assert(run("/서버레이드순위 호이서버2").includes("서버명을 입력하지")); assert.strictEqual(disk[memberPath], before);
});

group("실행 명령 운영 2방·DEV 테스트방 한정·타 방 실행 차단·방 간 5회 공유", () => {
    const commands = ["/서버대전시작", "/서버대전종료", "/서버대전전체초기화", "/레이드공격", "/레이드기록", "/서버레이드기록"];
    const before = JSON.stringify(disk);
    for (const room of ["room1", "room90", "room92", "private", "room8 "]) for (const user of ["master", "admin", "a"]) for (const msg of commands) {
        traces = []; assert(run(msg, user, undefined, room).includes("공성전 또는 팻 테스트방"));
        assert(!traces.some(t => t.type === "load" || t.type === "save" || t.type === "notice"));
        assert.strictEqual(JSON.stringify(disk), before); assert.strictEqual(timers.size, 0);
    }
    for (const room of ["room8", "test"]) for (const msg of commands) {
        traces = []; assert(run(msg, "master", undefined, room, false).includes("공성전 또는 팻 테스트방"));
        assert(!traces.some(t => t.type === "load" || t.type === "save"));
    }
    for (const msg of commands) {
        traces = []; assert(run("dev" + msg, "master", undefined, "room8").includes("DEV 레이드 명령어는 팻 테스트방"));
        assert(!traces.some(t => t.type === "load" || t.type === "save"));
    }
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["trusted-bot"];
    try {
        traces = []; assert(run("/서버대전시작", "오픈채팅봇", { operatorId: "trusted-bot" }, "room1").includes("공성전 또는 팻 테스트방"));
        assert(!traces.some(t => t.type === "load" || t.type === "save"));
    } finally { c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = []; }
    run("/서버대전시작", "master", undefined, "test"); tick(); tick(60000);
    const active = disk[memberPath]; traces = [];
    assert(run("/레이드공격", "a", undefined, "room1").includes("공성전 또는 팻 테스트방"));
    assert.strictEqual(disk[memberPath], active); assert(!traces.some(t => t.type === "load" || t.type === "save"));
    for (let i = 0; i < 6; i++) run("/레이드공격", "a", undefined, i % 2 ? "test" : "room8");
    const d = read(); assert.strictEqual(d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id].attacks.length, 5);
    run("/서버대전종료", "master", undefined, "test"); tick();
    assert(run("/레이드순위", "a", undefined, "test").includes("✅ 지급 완료"));
});

group("공격 UI 순서·일반/치명타 단일 상태·0매력 실제 치명타·마지막 0회", () => {
    start(); const plain = attack("a", "ui-normal");
    assert(plain.indexOf("공격 데미지:") < plain.indexOf("레이드매력:"));
    assert(plain.includes("└ 일반 공격 · 치명타 미발동")); assert(!plain.includes("🔥 치명타 발동!"));
    assert(plain.includes("💰 획득 포인트: 🅟1,000"));
    assert(plain.indexOf("🏰 우리 서버 현황") < plain.indexOf("현재 서버 순위:"));
    assert(plain.includes("이번 공격까지 합산된 기록입니다."));
    for (let i = 1; i < 5; i++) attack("a", "ui-" + i);
    assert(replies.join("\n").includes("남은 공격: 0/5회"));
    const d = read(); d.member.b.R = 0; write(d);
    vm.runInContext("Math.random=function(){return 0}", c);
    const zeroCritical = attack("b", "crit"), z = read();
    const row = z.serverRaid.current.accounts[z.member.b.serverRaidAccount.id].attacks[0];
    assert.strictEqual(row.R, 0); assert.strictEqual(row.D, 0); assert.strictEqual(row.P, 0); assert.strictEqual(row.critical, true);
    assert(zeroCritical.includes("└ 🔥 치명타 발동!")); assert(!zeroCritical.includes("일반 공격"));
});

group("같은 회차에 이전 D1%·신규 R1% 혼합 시 실제 지급 합계와 과거 기준 보존", () => {
    start(); attack("a", "old"); let d = read(), p = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    p.attacks[0].D = 170000; p.attacks[0].P = 1700; p.attacks[0].critical = true; p.attacks[0].rewardBasis = "damage";
    p.damage = "170000"; p.attackReward = 1700; d.member.a.point = 1000001700; write(d);
    const before = disk[memberPath]; const replay = attack("a", "old");
    assert(replay.includes("획득 포인트: 🅟1,700")); assert(replay.includes("당시 기준")); assert.strictEqual(disk[memberPath], before);
    vm.runInContext("Math.random=function(){return 0}", c);
    attack("a", "crit"); end(); d = read();
    assert.strictEqual(d.member.a.serverRaidAccount.latest.attackReward, 2700);
    const output = run("/레이드순위"); assert(output.includes("🅟2,700")); assert(output.includes("🅟500,002,700"));
    assert(output.includes("공격 당시 기준으로 지급된 포인트")); assert(!output.includes("공격마다 레이드매력의 1%"));
    assert.strictEqual(c.getServerRaidAttackRewardGuide([{ rewardBasis: "damage" }]), "공격마다 최종 데미지의 1% (당시 기준)");
    assert.strictEqual(c.getServerRaidAttackRewardGuide([{}]), "공격마다 레이드매력의 1%");
    assert.strictEqual(c.getServerRaidAttackRewardGuide(null), "공격 당시 기준으로 지급된 포인트");
});

group("실제 7인수 콜백 순위 조회는 모든 운영방·개인톡에서 준비/진행/정산/완료 중 허용", () => {
    const originalFlow = c.commandDataFlowLock, originalDepth = c.autoDailyQuestInternalDepth;
    c.commandDataFlowLock = { readLock: () => lock(), writeLock: () => lock() }; c.autoDailyQuestInternalDepth = 0;
    function verify(state) {
        assert.strictEqual(read().serverRaid.current ? read().serverRaid.current.state : "DONE", state);
        const before = JSON.stringify(disk);
        for (const room of ["room1", "room15", "room90", "room92", "unknown", "room8", "test", "private"]) for (const msg of ["/레이드순위", "/서버레이드순위"]) {
            replies = []; traces = []; c.response(room, msg, "a", room !== "private", c.replier, {}, "com.kakao.talk");
            assert.strictEqual(replies.length, 1, room + msg + state);
            assert(replies[0].includes(msg === "/레이드순위" ? "내 레이드 기록" : "서버 누적 순위"));
            assert(!traces.some(t => t.type === "save" || t.type === "notice")); assert.strictEqual(JSON.stringify(disk), before);
        }
    }
    try {
        run("/서버대전시작", "master"); verify("PREP"); tick(); tick(60000);
        attack("a", "live"); verify("ACTIVE"); run("/서버대전종료", "master"); verify("SETTLING"); tick(); verify("DONE");
        for (const msg of ["dev/레이드순위", "dev/서버레이드순위"]) assert(run(msg, "master", undefined, "room1").includes("DEV 레이드 명령어는 팻 테스트방"));
        const before = disk[memberPath]; assert(run("/서버레이드순위 안내", "a", undefined, "room1").includes("서버명을 입력하지")); assert.strictEqual(disk[memberPath], before);
    } finally { c.commandDataFlowLock = originalFlow; c.autoDailyQuestInternalDepth = originalDepth; }
});

group("여러 회차 누적 개인/서버 기여도·순위 일치 및 진행 중 공격 실시간 합산", () => {
    const d = read(); d.member.b.R = 300000; write(d);
    start(); attack("a", "r1a"); attack("b", "r1b"); end(); start(); attack("a", "r2a"); end();
    for (const msg of ["/레이드순위", "/서버레이드순위"]) {
        const output = run(msg); assert(output.includes("데미지: 200,000💞")); assert(output.includes("기여도: 40.00%")); assert(output.includes("순위: 2위 / 2명"));
    }
    start(); attack("a", "r3a"); attack("a", "r3a2");
    const before = disk[memberPath], summary = c.buildServerRaidCumulativeRecord(read(), "a");
    assert.strictEqual(summary.total, "700000"); assert.strictEqual(summary.own.damage, "400000");
    assert.strictEqual(summary.rows.length, 2); assert.strictEqual(summary.own.participations, 3); assert.strictEqual(summary.own.attackCount, 4);
    for (const msg of ["/레이드순위", "/서버레이드순위"]) {
        const output = run(msg); assert(output.includes("기여도: 57.14%")); assert(output.includes("순위: 1위 / 2명"));
    }
    const personal = run("/레이드순위"); assert(personal.includes("⏳ 대전 진행 중")); assert(personal.includes("서버 순위: 집계 중"));
    assert(!personal.includes("✅ 지급 완료")); assert(!personal.includes("💵 보상 합계")); assert.strictEqual(disk[memberPath], before);
});

group("정산 일부 완료·재시작에서도 누적 중복 없음·최신 회차는 정산 중 표시", () => {
    start(); attack("a", "round1a"); attack("b", "round1b"); end();
    start(); attack("a", "round2a"); attack("b", "round2b"); run("/서버대전종료", "master");
    let d = read(), id = d.member.a.serverRaidAccount.id;
    assert(c.settleServerRaidParticipant(d, c.buildServerRaidAccountIndex(d), id)); write(d);
    const snapshot = disk[memberPath], partial = c.buildServerRaidCumulativeRecord(d, "a");
    assert.strictEqual(partial.total, "400000"); assert(partial.rows.every(row => row.damage === "200000" && row.participations === 2 && row.attackCount === 2));
    let personal = run("/레이드순위"); assert(personal.includes("⏳ 정산 중")); assert(!personal.includes("✅ 지급 완료")); assert(!personal.includes("💵 보상 합계"));
    assert.strictEqual(disk[memberPath], snapshot); c.serverRaidWorkTimers = {}; timers.clear();
    run("/서버레이드순위", "a", undefined, "unknown"); tick();
    const after = c.buildServerRaidCumulativeRecord(read(), "a"); assert.strictEqual(after.total, partial.total); assert.deepStrictEqual(clone(after.rows), clone(partial.rows));
    personal = run("/레이드순위"); assert(personal.includes("✅ 지급 완료")); assert(personal.includes("🅟500,001,000"));
});

group("두 순위 UI 전체보기 정확히 1회·이동 안내 위·최근 참가/명단 아래·빈 기록 생략", () => {
    for (const msg of ["/레이드순위", "/서버레이드순위"]) assert(!run(msg).includes("<ALLSEE>"));
    assert(run("/서버레이드순위").includes("누적 참가자: 0명")); assert(run("/서버레이드순위").includes("👾 누적: 0💞"));
    assert(run("/서버레이드순위").includes("⭐0")); start(); attack("a", "allsee"); end();
    for (const msg of ["/레이드순위", "/서버레이드순위"]) {
        const output = run(msg), [summary, detail] = output.split("<ALLSEE>");
        assert.strictEqual(output.split("<ALLSEE>").length, 2); assert.strictEqual(replies.length, 1);
        assert(summary.includes(msg === "/레이드순위" ? "/서버레이드순위" : "/레이드순위"));
        assert(summary.includes("📊 기여도:")); assert(!summary.includes("💰 공격 보상"));
        assert(detail.includes(msg === "/레이드순위" ? "📋 최근 참가" : "👥 누적 기여도 순위"));
    }
    const stranger = run("/서버레이드순위", "c"); assert(stranger.split("<ALLSEE>")[0].includes("참가 기록 없음")); assert(stranger.split("<ALLSEE>")[1].includes("💛a"));
});

group("동점 공동 메달·큰 정수 누적·조회자 ID·닉네임 변경·서버 이동과 초기화", () => {
    start(); attack("a", "a"); attack("b", "b"); end();
    let d = read(); d.member.renamed = d.member.a; delete d.member.a; write(d);
    const output = run("/서버레이드순위", "renamed");
    assert(output.includes("🥇 [💛renamed] 님 ← 나")); assert(output.includes("🥇 [💛b] 님")); assert(!output.includes("🥈"));
    const id = d.member.renamed.serverRaidAccount.id; assert.strictEqual(c.buildServerRaidCumulativeRecord(d, "renamed").own.id, id);
    d.member.renamed.serverRaidAccount.total.damage = "90071992547409910000"; d.member.b.serverRaidAccount.total.damage = "90071992547409910000"; write(d);
    const summary = c.buildServerRaidCumulativeRecord(read(), "renamed"); assert.strictEqual(summary.total, "180143985094819820000"); assert.strictEqual(c.serverRaidPercent(summary.own.damage, summary.total), "50.00%");
    c.applyServerRaidMembershipChange(d.member.renamed, c.GLOBAL_CONFIG.serverRaid.servers[1]); write(d);
    assert(!run("/레이드순위", "renamed").includes("<ALLSEE>")); assert(run("/서버레이드순위", "b").includes("기여도: 100.00%"));
    run("/서버대전전체초기화", "master"); assert(run("/서버레이드순위", "b").includes("누적 참가자: 0명"));
});

group("0데미지 참가도 0%·동점 순위·기록 유지·공통 치명타 API 기존 반환값 보존", () => {
    let d = read(); d.member.a.R = 0; d.member.b.R = 0; write(d); start(); attack("a", "a"); attack("b", "b");
    const active = run("/서버레이드순위"); assert(active.includes("누적 참가자: 2명")); assert(active.includes("기여도: 0.00%")); assert(!active.includes("NaN"));
    end(); assert(run("/레이드순위").includes("기여도: 0.00%")); assert(run("/레이드순위").includes("순위: 1위 / 2명"));
    vm.runInContext("Math.random=function(){return 0}", c); const meta = {};
    assert.strictEqual(c.calculateCriticalDamage({ upgrade: 300 }, 100000, 300), 170000);
    assert.strictEqual(c.calculateCriticalDamage({ upgrade: 300 }, 0, 300, meta), 0); assert.strictEqual(meta.critical, true);
});

console.log("서버 레이드대전 " + groups + "개 검증 그룹 통과 (합성 데이터·메모리 파일 IO·실제 저장 함수·실제 진입/예약 작업)");
