const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");

// 기존 실제 저장·명령 테스트 환경을 매번 새 VM으로 만들고 합성 디스크만 복원한다.
function createFixture(saved) {
    const source = fs.readFileSync(path.join(__dirname, "test_server_raid.js"), "utf8");
    const boundary = source.indexOf('\ngroup("');
    assert(boundary > 0);
    return new Function("require", "__dirname", "saved", source.slice(0, boundary) + `
reset(); c.GLOBAL_CONFIG.serverRaid=clone(ticketConfig);
c.commandDataFlowLock={readLock:()=>lock(),writeLock:()=>lock()}; c.autoDailyQuestInternalDepth=0;
if(saved){ disk=clone(saved.disk); now=saved.now; }
var attempts=[];
return { c, main, info, block, read, write, run, start, attack, end, tick, clone,
    persist:()=>({disk:clone(disk),now}), raw:dev=>disk[(dev?devRoot:root)+"member.json"],
    now:()=>now, jump:value=>{now=value;}, advance:ms=>{now+=ms;},
    timers:()=>timers, attempts:()=>attempts, traces:()=>traces,
    failWrite:fn=>{failWrite=fn;},
    transport:fn=>{ c.Api.replyRoom=(room,text)=>{
        attempts.push({room,text:String(text)});
        if(fn&&fn(room,String(text))===false)return false;
        traces.push({type:"notice",room,text:String(text)});return true;
    }; },
    boot:()=>{
        c.initData=c.loadJsonFile(memberPath);
        vm.runInContext(block(main,"if (initData.serverRaid && serverRaidHasWork(initData.serverRaid)) {"),c);
    },
    schedule:(dev=false)=>{
        const state=read(dev).serverRaid;
        c.scheduleServerRaidWork(c.createCommandContext(dev,dev?"test":"room8"),state.generation,1,state.sequence);
    }
};`)(require, __dirname, saved);
}

// 미발송 합성 공지를 준비해 실제 예약·저장 처리의 순서를 검증한다.
function seedNotices(h, rooms, dev = false) {
    const d = h.read(dev), state = h.c.createServerRaidState("synthetic");
    state.outbox = ["first", "second", "third"].map(kind => ({ id: "synthetic:" + kind,
        generation: state.generation, text: kind, deliveries: rooms.map(room => ({ room, sent: false })) }));
    d.serverRaid = state; h.write(d, dev); h.schedule(dev);
}

// 발송 완료·취소되지 않은 공지를 조회한다.
function pending(h, dev = false) {
    return h.read(dev).serverRaid.outbox.flatMap(n => n.deliveries.filter(d => !d.sent && !d.cancelled).map(d => ({ id: n.id, room: d.room })));
}

// 특정 방의 모든 기존 공지가 완료됐는지 확인한다.
function roomDone(h, room, dev = false) {
    assert(h.read(dev).serverRaid.outbox.every(n => n.deliveries.every(d => d.room !== room || d.sent || d.cancelled)));
}

// 정상 공격자가 있는 서로 다른 두 서버를 구성한다.
function participatingRound(h) {
    h.start(); const d = h.read(); d.member.b.server = h.c.GLOBAL_CONFIG.serverRaid.servers[1]; d.member.b.R = 50000; h.write(d);
    h.attack("a", "hit-a"); h.attack("b", "hit-b");
}

// 상금과 핸디캡이 각각 한 번만 지급됐는지 검증한다.
function paidOnce(h) {
    const d = h.read();
    assert.strictEqual(d.serverRaid.current, null); assert.strictEqual(d.serverRaid.completed, 1);
    assert.strictEqual(d.member.a.point, 1300003000); assert.strictEqual(d.member.b.point, 1270001500);
    assert.strictEqual(d.member.b.bag[h.c.GLOBAL_CONFIG.serverRaid.items.attackTicket], 1);
}

// 방별 전송 실패·새 VM 재시작·저장 경계를 실제 코드로 검증한다.
function runTests() {
    let count = 0;
    function test(name, fn) { fn(createFixture()); console.log("PASS " + (++count) + ": " + name); }

    test("첫·중간·마지막 방의 false 실패는 나머지 방의 모든 공지를 막지 않음", h => {
        for (const failed of ["room1", "room2", "room3"]) {
            h = createFixture(); h.transport(room => room !== failed); seedNotices(h, ["room1", "room2", "room3"]); h.tick();
            for (const room of ["room1", "room2", "room3"].filter(r => r !== failed)) roomDone(h, room);
            assert.deepStrictEqual(h.attempts().filter(a => a.room === failed).map(a => a.text), ["first"]);
            assert.strictEqual(pending(h).length, 3); assert.strictEqual(h.timers().size, 1);
        }
    });
    test("전송 예외와 로그 예외가 함께 나도 다른 방은 완료", h => {
        h.transport(room => { if (room === "room2") throw Error("transport"); });
        h.c.debuggerLog = () => { throw Error("logging"); }; seedNotices(h, ["room1", "room2", "room3"]); h.tick();
        roomDone(h, "room1"); roomDone(h, "room3"); assert.strictEqual(pending(h).length, 3); assert.strictEqual(h.timers().size, 1);
    });
    test("여러 실패 방을 독립 재시도하고 성공한 방은 재전송하지 않음", h => {
        let failed = ["room1", "room2"]; h.transport(room => !failed.includes(room)); seedNotices(h, ["room1", "room2", "room3"]); h.tick();
        const completed = h.attempts().filter(a => a.room === "room3").length;
        failed = ["room2"]; h.tick(2000); roomDone(h, "room1"); assert(pending(h).every(d => d.room === "room2"));
        failed = []; h.tick(2000); assert.strictEqual(pending(h).length, 0); assert.strictEqual(h.timers().size, 0);
        assert.strictEqual(h.attempts().filter(a => a.room === "room3").length, completed);
    });
    test("같은 방의 이전 공지가 실패하면 후속 공지를 보류하고 복구 후 순서대로 전송", h => {
        let unavailable = true; h.transport(room => room !== "room2" || !unavailable); seedNotices(h, ["room2", "room3"]); h.tick(); h.tick(2000);
        assert.deepStrictEqual(h.attempts().filter(a => a.room === "room2").map(a => a.text), ["first", "first"]);
        assert.deepStrictEqual(h.attempts().filter(a => a.room === "room3").map(a => a.text), ["first", "second", "third"]);
        unavailable = false; h.tick(2000);
        assert.deepStrictEqual(h.attempts().filter(a => a.room === "room2").map(a => a.text), ["first", "first", "first", "second", "third"]);
    });
    test("후원문의방 결과만 남은 상태에서 새 회차 준비·시작은 정상 발송", h => {
        h.run("/서버대전시작", "master", undefined, "inquiry"); h.tick(); h.tick(60000); h.attack();
        h.transport((room, text) => !(room === "inquiry" && text.includes("이번 대전 우승")));
        h.end(); assert.strictEqual(pending(h).length, 1); assert.strictEqual(pending(h)[0].room, "inquiry");
        h.run("/서버대전시작", "master"); h.tick(); let round = h.read().serverRaid.current;
        assert.strictEqual(round.state, "PREP"); assert(h.read().serverRaid.outbox.find(n => n.id === round.id + ":prepare").deliveries.every(d => d.sent));
        h.tick(60000); round = h.read().serverRaid.current; assert.strictEqual(round.state, "ACTIVE");
        assert(h.read().serverRaid.outbox.find(n => n.id === round.id + ":start").deliveries.every(d => d.sent));
        assert.strictEqual(pending(h).length, 1); assert.strictEqual(h.read().member.a.point, 1300003000);
    });
    test("PREP 중 새 VM 재시작은 저장 시각으로 활성화·취소한 준비 안내 미발송", h => {
        h.transport(room => room !== "room2"); h.run("/서버대전시작", "master"); h.tick(); h.advance(3600000);
        const old = h; h = createFixture(h.persist()); assert.notStrictEqual(h.c, old.c); h.transport(room => room !== "room2"); h.boot(); h.tick();
        const state = h.read().serverRaid, round = state.current;
        assert.strictEqual(round.state, "ACTIVE"); assert.strictEqual(round.autoEndAt, h.now() + 1800000);
        assert(!h.attempts().some(a => a.text.includes("60초 뒤"))); roomDone(h, "room3");
        assert(state.outbox.find(n => n.id.endsWith(":prepare")).deliveries.every(d => d.sent || d.cancelled));
    });
    test("ACTIVE 중 새 VM 재시작·수신 불가 방도 자동 종료와 상금·핸디캡은 1회", h => {
        participatingRound(h); const deadline = h.read().serverRaid.current.autoEndAt;
        h = createFixture(h.persist()); h.transport(room => room !== "room2"); h.boot(); h.tick();
        assert.strictEqual(h.read().serverRaid.current.autoEndAt, deadline); h.jump(deadline); h.tick(0); paidOnce(h); roomDone(h, "room3");
        assert(pending(h).every(d => d.room === "room2"));
        const points = h.read().member.a.point; h.tick(2000); assert.strictEqual(h.read().member.a.point, points);
    });
    test("마감이 지난 ACTIVE를 새 VM에서 복원하면 즉시 한 번만 종료", h => {
        participatingRound(h); h.jump(h.read().serverRaid.current.autoEndAt + 60000);
        h = createFixture(h.persist()); h.transport(() => true); h.boot(); h.tick(); paidOnce(h);
        assert.strictEqual(h.timers().size, 0); h.run("/서버대전종료", "master"); h.tick(); paidOnce(h);
    });
    test("일부 참가자 지급 후 SETTLING 재시작도 미지급자만 정산", h => {
        participatingRound(h); h.run("/서버대전종료", "master"); const d = h.read();
        const keys = Object.keys(d.serverRaid.current.accounts); assert(h.c.settleServerRaidParticipant(d, h.c.buildServerRaidAccountIndex(d), keys[0])); h.write(d);
        h = createFixture(h.persist()); h.transport(room => room !== "room2"); h.boot(); h.tick(); paidOnce(h); roomDone(h, "room3");
    });
    test("완료 회차·미발송 공지만 재시작해도 성공 방은 생략하고 실패 방만 복원", h => {
        participatingRound(h); h.transport(room => room !== "room2"); h.end(); paidOnce(h);
        h = createFixture(h.persist()); h.transport(() => false); h.boot(); h.tick();
        assert(h.attempts().length > 0); assert(h.attempts().every(a => a.room === "room2")); paidOnce(h);
        h.transport(() => true); h.tick(2000); assert.strictEqual(pending(h).length, 0); paidOnce(h); assert.strictEqual(h.timers().size, 0);
    });
    test("발송 완료 저장 실패는 후속 전송 중단·재시작 복구·성공 저장 방 중복 없음", h => {
        h.transport(() => true); seedNotices(h, ["room1", "room2", "room3"]);
        const receiptKey = room => JSON.stringify(["synthetic:first", room]);
        h.failWrite((d, p) => p.endsWith("serverRaidNoticeReceipts.json") && d.sent[receiptKey("room2")]); h.tick();
        const receipts = JSON.parse(h.persist().disk[h.c.DATA_ROOT_PATH + "serverRaidNoticeReceipts.json"]);
        assert(!h.attempts().some(a => a.room === "room3")); assert(receipts.sent[receiptKey("room1")]);
        assert(!receipts.sent[receiptKey("room2")]);
        // 발송 직후 완료 저장 전 중단은 기존 at-least-once 경계로 재발송할 수 있다.
        h = createFixture(h.persist()); h.transport(() => true); h.boot(); h.tick();
        assert(!h.attempts().some(a => a.room === "room1" && a.text === "first")); assert.strictEqual(pending(h).length, 0);
    });
    test("읽기 예외에서 공지를 보내거나 빈 상태로 덮지 않고 재예약", h => {
        h.transport(() => true); seedNotices(h, ["room1", "room2"]); const before = h.raw(), load = h.c.loadJsonFile;
        h.c.loadJsonFile = () => { throw Error("read failure"); }; h.tick();
        assert.strictEqual(h.raw(), before); assert.strictEqual(h.attempts().length, 0); assert.strictEqual(h.timers().size, 1);
        h.c.loadJsonFile = load; h.tick(2000); assert.strictEqual(pending(h).length, 0);
    });
    test("DEV 실패와 운영 발송·저장·타이머 격리 및 DEV 새 VM 요청 복구", h => {
        h.transport((_room, text) => !text.startsWith("[DEV")); seedNotices(h, ["room1"]); seedNotices(h, ["test"], true); h.tick();
        assert.strictEqual(pending(h).length, 0); assert.strictEqual(pending(h, true).length, 3); const prod = h.raw();
        h = createFixture(h.persist()); h.transport(() => true); h.boot(); assert.strictEqual(h.timers().size, 0);
        h.run("dev/서버대전", "a"); h.tick(); assert.strictEqual(pending(h, true).length, 0); assert.strictEqual(h.raw(), prod);
        assert(h.attempts().every(a => a.room === "test" && a.text.startsWith("[DEV")));
    });
    test("전체 초기화 후 오래된 콜백은 공지·상태·보상을 바꾸지 않음", h => {
        h.transport(() => false); seedNotices(h, ["room1"]); h.tick(); const stale = [...h.timers().values()][0].fn;
        h.run("/서버대전전체초기화", "master"); const before = h.raw(), attempts = h.attempts().length; stale();
        assert.strictEqual(h.raw(), before); assert.strictEqual(h.attempts().length, attempts); assert.strictEqual(h.timers().size, 0);
    });
    test("발송 완료 저장 후 강제 중단을 재현해 새 VM이 해당 방을 재발송하지 않음", h => {
        h.transport(() => true); seedNotices(h, ["room1", "room2"]);
        const save = h.c.saveJsonFile; let crash;
        h.c.saveJsonFile = (d, p, ...args) => { save(d, p, ...args); if (!crash && p.endsWith("serverRaidNoticeReceipts.json")) { crash = h.persist(); throw Error("process stopped after persisted ack"); } };
        h.tick(); assert(crash); h = createFixture(crash); h.transport(() => true); h.boot(); h.tick();
        assert(!h.attempts().some(a => a.room === "room1" && a.text === "first")); assert.strictEqual(pending(h).length, 0);
    });
    test("입력 주체가 MASTER·인증된 봇이어도 같은 저장 회차·공지 정책", h => {
        for (const actor of ["master", "오픈채팅봇"]) {
            h = createFixture(); h.c.GLOBAL_CONFIG.serverRaid.authentication.operatorIds = ["trusted-bot"];
            h.transport(room => room !== "room2"); h.run("/서버대전시작", actor, actor === "master" ? undefined : { operatorId: "trusted-bot" }); h.tick();
            roomDone(h, "room3"); h.run("/서버대전종료", "master"); h.tick(); assert.strictEqual(h.read().serverRaid.current, null); roomDone(h, "room3");
        }
    });
    test("누락·손상 JSON으로 재시작하면 초기화·덮어쓰기 없이 기존 오류 유지", h => {
        seedNotices(h, ["room1"]);
        for (const kind of ["missing", "invalid"]) {
            const saved = h.persist();
            if (kind === "missing") delete saved.disk[h.c.filePath];
            else saved.disk[h.c.filePath] = "{invalid";
            const restored = createFixture(saved); restored.transport(() => true);
            assert.throws(() => restored.boot()); assert.deepStrictEqual(restored.persist().disk, saved.disk);
            assert.strictEqual(restored.attempts().length, 0); assert.strictEqual(restored.timers().size, 0);
        }
    });
    test("모든 방이 실패해도 자동 종료·정산은 완료하고 환경별 예약은 하나만 유지", h => {
        participatingRound(h); h.transport(() => false); h.jump(h.read().serverRaid.current.autoEndAt); h.tick(0); paidOnce(h);
        const failedRooms = h.attempts().map(a => a.room); assert.strictEqual(new Set(failedRooms).size, failedRooms.length);
        assert.strictEqual(h.timers().size, 1); h.schedule(); h.schedule(); assert.strictEqual(h.timers().size, 2);
        h.tick(1); assert.strictEqual(h.timers().size, 1); // 전투 확인 1개와 공지 재시도 1개는 별도 예약
        h.transport(() => true); h.tick(2000); paidOnce(h); assert.strictEqual(pending(h).length, 0); assert.strictEqual(h.timers().size, 0);
    });
    console.log("서버대전 방별 공지 " + count + "개 검증 그룹 통과 (새 VM 재시작·합성 저장/전송)");
    return count;
}

module.exports = { createFixture, runTests };
if (require.main === module) runTests();
