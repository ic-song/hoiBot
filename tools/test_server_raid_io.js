const assert = require("assert"), fs = require("fs"), path = require("path");
const { createFixture } = require("./test_server_raid_delivery.js");

// 회원 분리 저장 테스트의 준비 코드만 재사용해 운영 파일 없이 실제 저장 경로를 실행한다.
function storageFixture(sourceOverride) {
    const realFs = require("fs");
    const source = realFs.readFileSync(path.join(__dirname, "test_member_storage_split.js"), "utf8");
    const localRequire = name => {
        if (name !== "fs" || !sourceOverride) return require(name);
        return Object.assign({}, realFs, { readFileSync(p, ...args) {
            return String(p).replace(/\\/g, "/").endsWith("/main.js") ? sourceOverride : realFs.readFileSync(p, ...args);
        } });
    };
    return new Function("require", "__dirname", source.slice(0, source.indexOf('\ngroup("')) +
        "\nreturn {fixture,c,setup,migrate,load,save,store};")(localRequire, __dirname);
}

// 실제 FileStream 읽기·검증 저장·fsync의 논리 바이트 수를 계측한다.
function measure(h, action) {
    const { c, fixture: f } = h, counts = { readBytes: 0, writeBytes: 0, reads: 0, writes: 0, syncs: 0, memberWrites: 0 };
    const read = c.FileStream.read, Stream = c.java.io.FileOutputStream, Writer = c.java.io.OutputStreamWriter;
    c.FileStream.read = p => { const text = read(p); counts.reads++; counts.readBytes += Buffer.byteLength(String(text || ""), "utf8"); return text; };
    c.java.io.FileOutputStream = function(...args) {
        const s = new Stream(...args), fd = s.getFD(); s.getFD = () => ({ sync() { counts.syncs++; fd.sync(); } }); return s;
    };
    c.java.io.OutputStreamWriter = function(s, ...args) {
        const w = new Writer(s, ...args), write = w.write;
        w.write = text => { counts.writes++; counts.writeBytes += Buffer.byteLength(String(text), "utf8"); if (s.path.endsWith("/member.json.tmp")) counts.memberWrites++; return write(text); }; return w;
    };
    try { action(f); } finally { c.FileStream.read = read; c.java.io.FileOutputStream = Stream; c.java.io.OutputStreamWriter = Writer; }
    return counts;
}

// 운영 규모와 비슷한 크기의 가상 문자열만 사용해 공격·공지 저장 부담을 비교한다.
function profile(sourceOverride) {
    const h = storageFixture(sourceOverride); h.setup();
    let d = h.fixture.read(); d.syntheticPadding = "m".repeat(1400000);
    d.serverRaid.history = Array.from({ length: 12 }, (_, i) => ({ id: "synthetic-history-" + i, accounts: {}, note: "r".repeat(270000) }));
    for (const key of h.c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) d[key] = [{ feature: "SYNTHETIC", detail: "l".repeat(44000) }];
    h.fixture.write(d); h.migrate(); h.fixture.start();
    const attack = measure(h, f => f.attack("a", "synthetic-io"));
    const notices = measure(h, f => { f.run("/서버대전종료", "master"); f.tick(); });
    return { attack, notices };
}

let count = 0;
function test(label, fn) { fn(); console.log("PASS " + (++count) + ": " + label); }
// 이미 진행 중인 회차에 합성 공지만 추가하고 독립 발송 작업을 예약한다.
function addNotice(h, id, text, rooms) {
    const d = h.read(); d.serverRaid.outbox.push({ id, text, generation: d.serverRaid.generation, deliveries: rooms.map(room => ({ room, sent: false })) });
    h.write(d); h.c.scheduleServerRaidNoticeWork(h.c.createCommandContext(false, "room8"), 0);
}
test("전송 도중 공격 저장을 다시 읽어 이전 회원 스냅샷으로 덮지 않음", () => {
    const h = createFixture(); h.start(); let injected = false;
    h.transport(() => { if (!injected) { injected = true; h.attack("a", "during-send"); } return true; });
    addNotice(h, "concurrent", "notice", ["room1", "room2"]); h.tick();
    assert(injected); assert.equal(h.read().member.a.point, 1000003000);
    const id = h.read().member.a.serverRaidAccount.id; assert.equal(h.read().serverRaid.current.accounts[id].attacks.length, 1);
    assert(h.read().serverRaid.outbox.find(n => n.id === "concurrent").deliveries.every(d => d.sent));
});
test("전송 중 전체 초기화는 후속 과거 공지를 취소하고 새 회차로 진행", () => {
    const h = createFixture(); h.start(); let reset = false;
    h.transport(() => { if (!reset) { reset = true; h.run("/서버대전전체초기화", "master"); } return true; });
    const old = h.read().serverRaid.generation;
    addNotice(h, "cancelled", "old", ["room1", "room2"]); h.tick();
    assert.notEqual(h.read().serverRaid.generation, old); assert.equal(h.attempts().filter(a => a.text === "old").length, 1);
    h.transport(() => true); h.start(); assert.equal(h.read().serverRaid.current.state, "ACTIVE");
});
test("전송 중 수동 종료·정산 완료는 늦은 전송 확인으로 되돌아가지 않음", () => {
    const h = createFixture(); h.start(); h.attack(); let ended = false;
    h.transport(() => { if (!ended) { ended = true; h.run("/서버대전종료", "master"); h.tick(); } return true; });
    addNotice(h, "before-close", "extra", ["room1"]); h.tick();
    assert(ended); assert.equal(h.read().serverRaid.current, null); assert.equal(h.read().member.a.point, 1300003000); assert.equal(h.read().serverRaid.completed, 1);
});
for (const kind of ["missing", "invalid", "version", "generation"]) test("설치된 전송 영수증 " + kind + " 오류는 초기화·덮어쓰기·추가 발송 없음", () => {
    let h = createFixture(); h.transport(() => false); h.start();
    const saved = h.persist(), p = h.c.DATA_ROOT_PATH + "serverRaidNoticeReceipts.json";
    assert(saved.disk[p]);
    if (kind === "missing") delete saved.disk[p];
    else if (kind === "invalid") saved.disk[p] = "{bad";
    else { const d = JSON.parse(saved.disk[p]); if (kind === "version") d.version = 99; else d.generation = "wrong"; saved.disk[p] = JSON.stringify(d); }
    h = createFixture(saved); h.transport(() => true); h.boot(); h.tick();
    assert.equal(h.attempts().length, 0); assert.deepStrictEqual(h.persist().disk, saved.disk);
});
test("첫 영수증 설치 중 회원 저장 실패는 설치 표시·새 파일 모두 롤백", () => {
    const h = createFixture(); h.transport(() => true); h.run("/서버대전시작", "master");
    h.failWrite((d, p) => p === h.c.filePath && d.serverRaid.noticeReceiptsVersion === 1); h.tick();
    assert(!h.read().serverRaid.noticeReceiptsVersion); assert(!h.persist().disk[h.c.DATA_ROOT_PATH + "serverRaidNoticeReceipts.json"]); assert.equal(h.attempts().length, 0);
    h.tick(2000); assert(h.read().serverRaid.noticeReceiptsVersion === 1); assert(h.attempts().length > 0);
});
test("한 묶음 100건 경계에서도 다음 예약으로 이어지고 중복 발송 없음", () => {
    const h = createFixture(), d = h.read(); d.serverRaid = h.c.createServerRaidState("many");
    for (let i = 0; i < 121; i++) d.serverRaid.outbox.push({ id: "id-" + i, text: "text-" + i, generation: "many", deliveries: [{ room: "room1", sent: false }] });
    h.write(d); h.transport(() => true); h.schedule(); h.tick();
    assert.equal(h.attempts().length, 121); assert.equal(new Set(h.attempts().map(a => a.text)).size, 121);
    assert(h.read().serverRaid.outbox.every(n => n.deliveries.every(d => d.sent)));
});
test("전송 스레드 시작 실패는 게임 상태 보존·한 작업 재예약 후 정상 복구", () => {
    const h = createFixture(), Thread = h.c.java.lang.Thread; h.transport(() => true);
    h.c.java.lang.Thread = function() { this.setDaemon = () => {}; this.start = () => { throw Error("thread start"); }; };
    h.run("/서버대전시작", "master"); h.tick(); assert.equal(h.read().serverRaid.current.state, "PREP"); assert.equal(h.attempts().length, 0);
    h.c.java.lang.Thread = Thread; h.tick(2000); assert(h.attempts().length > 0);
});
test("변하지 않은 운영 로그 백업은 연속 레이드 공격마다 재작성하지 않음", () => {
    const h = storageFixture(); h.setup(); h.migrate(); h.fixture.start(); h.fixture.attack("a", "first");
    h.fixture.clear(); h.fixture.attack("a", "second");
    assert(!h.fixture.traces().some(t => t.type === "save" && /memberOperationLogs_back/.test(t.path)));
    h.c.java.io.File.prototype.lastModified = () => h.fixture.now() - 60001;
    const m = h.load("raid"); m.member.a.point++; h.save(m);
    assert(h.fixture.traces().some(t => t.type === "save" && /memberOperationLogs_back2/.test(t.path))); // 정기 백업 회전의 원본 검증 유지
});
test("분리 저장의 최종 공지 상태 게시 실패도 영수증은 보존·재시도 무중복", () => {
    const h = storageFixture(); h.setup(); h.migrate(); h.fixture.start(); h.fixture.attack("a", "a");
    let sent = 0; h.c.Api.replyRoom = () => { sent++; return true; };
    h.fixture.run("/서버대전종료", "master");
    h.fixture.fail((d, p) => p === h.c.filePath && d.serverRaid.hasPendingNotices === false);
    h.fixture.tick(); const completed = sent, points = h.load("raid").member.a.point;
    assert(completed > 0); assert(h.fixture.read().serverRaid.hasPendingNotices);
    assert(Object.keys(JSON.parse(h.fixture.disk()[h.c.DATA_ROOT_PATH + "serverRaidNoticeReceipts.json"]).sent).length > 0);
    h.fixture.tick(2000); assert.equal(sent, completed); assert.equal(h.load("raid").member.a.point, points);
    assert.equal(h.fixture.read().serverRaid.hasPendingNotices, false);
});
if (require.main === module) {
    const child = require("child_process");
    const baseline = child.execFileSync("git", ["show", "a57a53a961d7ebdc2005356fe0a0f63061a9155a:main.js"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const before = profile(baseline), after = profile();
    assert(after.attack.writeBytes < before.attack.writeBytes); assert(after.attack.syncs < before.attack.syncs);
    assert(after.notices.writeBytes < before.notices.writeBytes / 4); assert(after.notices.memberWrites < before.notices.memberWrites / 4);
    const result = { groups: count, synthetic: true, baseline: "a57a53a", before, after };
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(result, null, 2));
}
module.exports = { storageFixture, measure, profile };

