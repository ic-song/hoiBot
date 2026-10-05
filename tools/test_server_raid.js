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
    loadJsonFile(p) { traces.push({ type: "load", path: p }); return JSON.parse(disk[c.resolveActiveDataPath(p)]); },
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
    "isMaster", "isAttendanceGameCommand", "isAdventurePetNameInputCandidate", "isAdventureReferralInputCandidate", "getWorldNewsDraftKey", "normalizeHoiServerLabel", "noticeMsg", "isAutoDailyEntryCommandMessage", "isExclusiveDataMutationCommandMessage", "getResponseDataFlowLock",
    "getCappedUpgradeForCrit", "getCritChance", "calculateCritChance", "getCritMultiplier", "calculateCriticalDamage"]) vm.runInContext(block(main, "function " + name + "("), c);
vm.runInContext(main.slice(main.indexOf("function serverRaidHeader("), main.indexOf("// 길드 영지전 관련 함수들")), c);
const entryStart = main.indexOf("// 서버 레이드대전 진입:");
const entryEnd = main.indexOf('if (ctx.isDev && msg === "/데이터백업")', entryStart);
vm.runInContext("function runEntry(){" + main.slice(entryStart, entryEnd) + "}", c);
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
function run(msg, user = "a", event, room = "test", group = true, native) {
    if ((msg === "/서버대전시작" || msg === "dev/서버대전시작") && event === undefined) event = { id: "control-start-" + (++uuid) };
    replies = []; c.sender = user; c.serverRaidEvent = event; c.room = room; c.isGroupChat = group;
    c.packageName = native ? "com.kakao.talk" : undefined;
    c.ctx = c.createCommandContext(c.isDevCommandMessage(msg), room); c.msg = c.ctx.isDev ? c.stripDevCommandPrefix(msg) : msg;
    const previous = c.enterCommandContext(c.ctx); c.beginDataSaveTransaction();
    try { native ? c.runEntry(null, null, null, null, null, null, c.packageName, false, native.logId, native.channelId, native.userHash) : c.runEntry(null, null, null, null, null, null, null, event); }
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
function attack(user = "a", id = "event-1", dev = false, room = "test") { return run((dev ? "dev/" : "/") + "레이드공격", user, id === null ? undefined : { id }, room); }
function end(dev = false) { run((dev ? "dev/" : "/") + "서버대전종료", "master"); tick(); }
function group(name, f) { reset(); f(); groups++; console.log("PASS " + groups + ": " + name); }

group("정확한 6개 명령·접미 미실행·MASTER 및 인증된 운영봇 권한", () => {
    for (const msg of ["/서버대전시작 해봐", "/서버대전종료 1", "/서버대전전체초기화 확인", "/레이드공격 1", "/레이드기록 대상"]) {
        const before = disk[memberPath]; run(msg); assert.strictEqual(disk[memberPath], before); assert(!c.isServerRaidMutationCommand(msg));
    }
    for (const user of ["a", "admin", "오픈채팅봇"]) for (const msg of ["/서버대전시작", "/서버대전종료", "/서버대전전체초기화"]) {
        const before = disk[memberPath]; assert(run(msg, user).includes("권한")); assert.strictEqual(disk[memberPath], before);
    }
    assert(!run("/서버대전시작", "master", undefined, "room1").includes("60초")); assert(!read().serverRaid);
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["trusted-bot"];
    run("/서버대전시작", "오픈채팅봇", { id: "bot-start", operatorId: "trusted-bot" }); assert(c.isServerRaidLocked(read()));
    assert(run("/서버대전전체초기화", "오픈채팅봇", { operatorId: "trusted-bot" }).includes("권한"));
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = [];
});
group("60초 준비·저장 후 공지·기존 공지방과 명령방 중복 제외", () => {
    run("/서버대전시작", "master", undefined, "room92"); const initial = read();
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
group("R1% 버림·치명타 D만 반영·각 공격 R/D/P 보존", () => {
    start(); const d = read(); d.member.a.R = 100099; write(d);
    const output = attack(); let current = read(); const a = current.serverRaid.current.accounts[current.member.a.serverRaidAccount.id];
    assert.deepStrictEqual([a.attacks[0].R, a.attacks[0].D, a.attacks[0].P], [100099, 100099, 1000]);
    vm.runInContext("Math.random=function(){return 0}", c);
    const critical = attack("a", "crit"); current = read(); const result = current.serverRaid.current.accounts[current.member.a.serverRaidAccount.id].attacks[1];
    assert.strictEqual(result.D, 170168); assert.strictEqual(result.P, 1000); assert(critical.includes("치명타 발동"));
    assert(output.includes("레이드매력의 1% 지급")); assert.strictEqual(current.member.a.point, 1000002000);
});
group("여러 방 입력도 계정 서버 고정·6회 요청 중 5회만 반영", () => {
    start(); for (let i = 0; i < 6; i++) attack("a", "cross-room-" + i, false, "room" + (i + 1));
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
group("기본 7인수 콜백은 식별 연동 전 공격 미차감·미지급", () => {
    const idle = disk[memberPath]; assert(run("/서버대전시작", "master", null).includes("준비하고")); assert.strictEqual(disk[memberPath], idle); assert(!c.isServerRaidLocked(read()));
    start(); const before = disk[memberPath];
    assert(attack("a", null).includes("참여를 준비")); assert.strictEqual(disk[memberPath], before);
});
group("MASTER 포함 Main·Info 잠금·기록 인수 안내보다 잠금 우선", () => {
    start();
    for (const user of ["a", "master", "admin"]) for (const msg of ["/정보 a", "/내정보", "/서버순위", "ㅈㅈㅈ", "/종합순위", "/레이드기록", "/서버레이드기록 호이서버2", "/서버변경 호이서버2", "/서버이동 a 호이서버2[2030]", "ㅊㅊ", "출발한다"]) {
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
    const before = disk[memberPath]; assert(run("/레이드공격", "noPass", { id: "private" }, "private", false).includes("프리미엄")); assert.strictEqual(disk[memberPath], before);
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
    const personal = run("/레이드기록"); assert(personal.includes("2026.10.05 21:01")); assert(!personal.includes("/5회")); assert(!personal.includes("서버 전체 데미지")); assert(personal.includes("✅ 보상 지급 완료"));
    const latest = clone(read().member.a.serverRaidAccount.latest); start(); end(); assert.deepStrictEqual(read().member.a.serverRaidAccount.latest, latest);
    const cumulative = run("/서버레이드기록"); assert(cumulative.includes("누적 진행: 2회")); assert(cumulative.includes("참가 1회 · 공격 5회")); assert(cumulative.includes("83.33%")); assert(cumulative.includes("← 나"));
    assert(cumulative.indexOf("나의 서버 기여도") < cumulative.indexOf("<ALLSEE>"));
    const before = disk[memberPath]; assert(run("/서버레이드기록", "c").includes("순위: 미참여")); assert(run("/서버레이드기록 호이서버2").includes("서버명을 입력하지")); assert.strictEqual(disk[memberPath], before);
});
group("이동·재입장 기록 미복원·남은 명단 기여도 재계산·확정 개인 결과 보존", () => {
    start(); attack("a", "a"); attack("b", "b"); end(); const d = read();
    const official = JSON.stringify(d.serverRaid.history); const bLatest = JSON.stringify(d.member.b.serverRaidAccount.latest); const oldPoint = d.member.a.point;
    const destination = c.GLOBAL_CONFIG.serverRaid.servers[1]; assert(c.applyServerRaidMembershipChange(d.member.a, destination));
    assert(!d.member.a.serverRaidAccount.latest); assert(!d.member.a.serverRaidAccount.total); assert.strictEqual(d.member.a.serverRaidAccount.period, 1); assert.strictEqual(d.member.a.point, oldPoint);
    write(d); assert(run("/레이드기록").includes("참가 기록이 없습니다")); assert(run("/서버레이드기록", "b").includes("100.00%"));
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
    end(); const idle = disk[memberPath]; run("/레이드기록"); run("/서버레이드기록"); assert.strictEqual(disk[memberPath], idle);
    disk[memberPath] = "invalid json"; assert.throws(() => run("/레이드기록"), SyntaxError); assert.strictEqual(disk[memberPath], "invalid json");
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
    assert.strictEqual(saves.length, 28); // 지급 1 + 완료 1 + 기존 공지 12방·입력방 1곳에 공지 2회
    assert.strictEqual(read().member["synthetic-999"].point, 500000000); assert.strictEqual(read().serverRaid.completed, 1);
    assert.strictEqual(read().member["synthetic-999"].serverRaidAccount.total.participations, 1);
});
group("이전부터 대기 중인 펫이름·추천인·관리자 소식 입력도 잠금, 일반 대화 유지", () => {
    start(); const d = read(); d.member.a.adventureOnboarding = { stage: "WAIT_REFERRAL" }; d.member.b.adventureOnboarding = { stage: "WAIT_PET_NAME" }; write(d);
    c.worldNewsDraftState[c.getWorldNewsDraftKey("master", "test")] = { step: "title" };
    for (const [msg, user] of [["없음", "a"], ["합성 추천인", "a"], ["합성 펫이름", "b"], ["새 소식 제목", "master"], ["호월 봇 이용약관", "c"]]) {
        const before = disk[memberPath]; assert(run(msg, user).includes("지금은 서버 레이드대전")); assert.strictEqual(disk[memberPath], before);
    }
    const before = disk[memberPath]; assert.strictEqual(run("일반 대화", "c"), ""); assert.strictEqual(disk[memberPath], before);
});
group("기록 조회에서도 기존 출석·계정정지·일대일 패스 제한 유지", () => {
    for (const msg of ["/레이드기록", "/서버레이드기록"]) {
        const before = disk[memberPath];
        assert(run(msg, "absent").includes("출석체크")); assert(run(msg, "suspended").includes("계정정지")); assert(run(msg, "noPass", undefined, "private", false).includes("프리미엄"));
        assert.strictEqual(disk[memberPath], before);
    }
});
group("네이티브 확장 콜백 logId·channelId는 큰 정수 문자열로 수신·공격 재전송 차단", () => {
    const native = { logId: { toString: () => "18446744073709551615" }, channelId: { toString: () => "9007199254740993123" }, userHash: "native-user" };
    run("/서버대전시작", "master", undefined, "test", true, native); tick(); tick(60000);
    native.logId = { toString: () => "18446744073709551614" };
    run("/레이드공격", "a", undefined, "test", true, native); const before = disk[memberPath];
    run("/레이드공격", "a", undefined, "test", true, native); assert.strictEqual(disk[memberPath], before);
    const a = read().serverRaid.current.accounts[read().member.a.serverRaidAccount.id]; assert.strictEqual(a.attacks[0].id, "event:com.kakao.talk|9007199254740993123|18446744073709551614");
    for (const bad of [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, 0, false, null, undefined, "0", "1e20"]) {
        assert.strictEqual(c.getServerRaidNativeId(bad), null); const beforeBad = disk[memberPath];
        run("/레이드공격", "a", undefined, "test", true, { ...native, logId: bad }); assert.strictEqual(disk[memberPath], beforeBad);
    }
});
group("네이티브 운영봇은 등록된 앱·방·사용자 해시만 인증·동일 닉네임 위조 거부", () => {
    const native = { logId: "18446744073709551615", channelId: "9007199254740993123", userHash: "registered-bot" };
    c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["com.kakao.talk|9007199254740993123|registered-bot"];
    assert(run("/서버대전시작", "오픈채팅봇", undefined, "test", true, { ...native, userHash: "imposter" }).includes("권한")); assert(!read().serverRaid);
    assert(run("/서버대전시작", "오픈채팅봇", undefined, "test", true, { ...native, channelId: "123" }).includes("권한")); assert(!read().serverRaid);
    run("/서버대전시작", "오픈채팅봇", undefined, "test", true, native); assert(c.isServerRaidLocked(read()));
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
        assert(run("dev/레이드기록").includes("DEV 데이터가 준비되지"));
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

console.log("서버 레이드대전 " + groups + "개 검증 그룹 통과 (합성 데이터·메모리 파일 IO·실제 저장 함수·실제 진입/예약 작업)");
