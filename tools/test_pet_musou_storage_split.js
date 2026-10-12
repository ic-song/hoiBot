const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 회원 파일 분리 후 실제 펫무쌍 모집·턴 타이머와 운영 로그 저장을 함께 검증한다.
const harness = fs.readFileSync(path.join(__dirname, "test_member_storage_split.js"), "utf8");
const test = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\ngroup("')) + `
return {c,fixture,setup,migrate,load,save,native,raw,key,store};`)(require, __dirname);
const { c, fixture, setup, migrate, load, save, native, raw, key, store } = test;
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const names = ["ensurePetMusouData", "ensureHoiPassPremiumAutomationSettings", "autoRegisterHoiPassPremiumPetMusouUsers",
    "getPetMusouGuildInfo", "shufflePetMusouUsers", "createPetMusouBattleSnapshot", "buildPetMusouPreparedParticipantList",
    "joinPetMusou", "beginPetMusou", "getPetMusouCurrentAttacker", "preparePetMusouNextRound", "shouldFinishPetMusou",
    "finishPetMusou", "getPetMusouFlagName", "buildPetMusouAliveParticipantList", "buildPetMusouStatusMessage",
    "processPetMusouTimeout", "clearPetMusouOpeningTimer", "openPetMusouForAttacks", "startPetMusouOpeningTimer",
    "clearPetMusouTurnTimer", "startPetMusouTurnTimer", "recoverPetMusouTurnIfNeeded", "getPetMusouKstDateTime",
    "getPetMusouScheduleTimeText", "getPetMusouScheduleKey", "getActivePetMusouStartTimes", "isPetMusouTicketEventActive",
    "runScheduledPetMusouStart", "runPetMusouScheduleTick"];
for (const name of names) vm.runInContext(fixture.block(source, "function " + name + "("), c);
c.getMyGuildInfo = () => ({ guildId: "synthetic-guild", guild: { name: "합성길드" } });
c.calculateTotalExp = () => 10000000;
c.hasPetSkill = () => false;
c.isHoiPassPremiumActive = (_d, user) => user === "a" || user === "b";
c.formatGuildDisplay = () => "합성길드";
c.ensureMatzangFieldData = () => ({ active: false });
c.ensureGuildTerritoryWar = () => ({ active: false, pendingStart: false });
c.getTodaySupportPassDateValue = () => "2026-10-12";
const notices = [];
c.castleMsg = text => notices.push(text);
c.noticeMsg = text => notices.push(text);
let groups = 0;
function group(name, fn) {
    setup(); c.petMusouOpeningTimers = {}; c.petMusouTurnTimers = {}; notices.length = 0;
    try { fn(); console.log("PASS " + (++groups) + ": " + name); }
    finally { c.commandContextThreadLocal.remove(); }
}
function prepare(dev = false) {
    migrate(dev); const ctx = c.createCommandContext(dev, dev ? "test" : "room8"); c.enterCommandContext(ctx);
    const d = load(undefined, dev), pets = c.loadJsonFile(c.memberPetPath), skills = c.loadJsonFile(c.petSkillDataPath), guild = c.loadJsonFile(c.guildPath);
    for (const user of ["a", "b"]) d.member[user].premiumAutomation = native({ petMusouAutoReady: true, autoAttendance: false });
    // 별도 실행 문맥의 정상 배열을 직접 주입하여 기존 코드의 오류 조건도 재현한다.
    d.petMusouAutomationLogs = vm.runInNewContext('[{existing:true}]');
    const registered = c.autoRegisterHoiPassPremiumPetMusouUsers(d, pets, skills, guild, "");
    assert.equal(registered.registeredCount, 2);
    save(d, dev); return { d, pets, skills, guild, ctx, dev };
}
function start(p) {
    const result = c.beginPetMusou(p.d, p.pets, native({}), p.skills, p.guild);
    assert(result.ok); save(p.d, p.dev);
    c.startPetMusouOpeningTimer(p.d, p.pets, p.skills, p.guild, c.replier, true, true);
}
function data(p) { return load(undefined, p.dev); }

group("프리미엄 자동 준비·운영 로그 추가 뒤 모집 시작·60초 확정·턴 저장", () => {
    const p = prepare(); start(p); fixture.tick(c.GLOBAL_CONFIG.petMusou.startGraceMs + 1);
    const d = data(p); assert(d.petMusou.active && d.petMusou.startReady); assert.equal(Object.keys(d.petMusou.players).length, 2);
    assert.equal(d.petMusouAutomationLogs.length, 3); assert(d.petMusouAutomationLogs[0].existing);
    assert(d.petMusou.turnDeadlineAt > fixture.now()); assert(raw().serverRaid.storageSummary); assert(!Object.hasOwn(raw(), "petMusouAutomationLogs"));
});
group("실제 12초 턴 타임아웃·패널티·자동 준비 OFF 로그·종료 저장", () => {
    const p = prepare(); start(p); fixture.tick(c.GLOBAL_CONFIG.petMusou.startGraceMs + 1);
    const initial = data(p); const attacker = initial.petMusou.turnQueue[0]; const before = initial.member[attacker].point;
    fixture.tick(c.GLOBAL_CONFIG.petMusou.turnTimeoutMs + 1); const d = data(p);
    assert.equal(d.member[attacker].point, before - c.GLOBAL_CONFIG.petMusou.timeoutPenaltyPoint);
    assert.equal(d.member[attacker].premiumAutomation.petMusouAutoReady, false);
    assert(d.petMusouAutomationLogs.some(log => log.user === attacker && log.result === "TIMEOUT_ELIMINATED"));
    fixture.tick(c.GLOBAL_CONFIG.petMusou.turnTimeoutMs + 1); assert(!data(p).petMusou.active);
    assert(data(p).petMusouAutomationLogs[0].existing); assert(raw().serverRaid.storageSummary);
});
group("재시작 후 만료 턴 복구도 기존 운영 로그 보존", () => {
    const p = prepare(); start(p); fixture.tick(c.GLOBAL_CONFIG.petMusou.startGraceMs + 1);
    const before = data(p); const attacker = before.petMusou.turnQueue[0]; fixture.reload(); c.petMusouTurnTimers = {};
    fixture.advance(c.GLOBAL_CONFIG.petMusou.turnTimeoutMs + 1);
    const d = data(p); c.recoverPetMusouTurnIfNeeded(d, p.pets, p.skills, p.guild, c.replier, true, native({}));
    const after = data(p); assert.equal(after.member[attacker].premiumAutomation.petMusouAutoReady, false);
    assert.equal(after.petMusouAutomationLogs.filter(log => log.result === "TIMEOUT_ELIMINATED").length, 1);
    c.recoverPetMusouTurnIfNeeded(after, p.pets, p.skills, p.guild, c.replier, true, native({}));
    assert.equal(data(p).petMusouAutomationLogs.filter(log => log.result === "TIMEOUT_ELIMINATED").length, 1);
});
group("정시 12:30 시작·일정 로그·중복 시작 차단", () => {
    const p = prepare(); const target = Date.parse("2026-10-12T03:30:00Z"); fixture.advance(target - fixture.now());
    c.runPetMusouScheduleTick(p.ctx, c.replier, new c.Date()); const before = fixture.disk()[c.filePath];
    assert(data(p).petMusou.active); assert(data(p).petMusouAutomationLogs.some(log => log.feature === "PET_MUSOU_SCHEDULE" && log.result === "SUCCESS"));
    c.runPetMusouScheduleTick(p.ctx, c.replier, new c.Date()); assert.equal(fixture.disk()[c.filePath], before);
});
group("DEV 모집·공격 턴·운영 로그는 PROD 파일 무변경", () => {
    const original = fixture.disk()[c.filePath]; const p = prepare(true); start(p); fixture.tick(c.GLOBAL_CONFIG.petMusou.startGraceMs + 1);
    fixture.tick(c.GLOBAL_CONFIG.petMusou.turnTimeoutMs + 1);
    assert.equal(fixture.disk()[c.filePath], original); assert(data(p).petMusouAutomationLogs.some(log => log.result === "TIMEOUT_ELIMINATED"));
});
console.log("PASS: " + groups + " pet musou / split storage integration groups (synthetic only)");
