const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 기존 합성 파일시스템에서 새 회차의 실제 운영 설정과 7인수 콜백을 검증한다.
const harness = fs.readFileSync(path.join(__dirname, "test_server_raid.js"), "utf8");
const fixture = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\ngroup("')) + `
return { c, block, read, write, run, start, attack, end, tick, clone,
  config: ticketConfig,
  reset: () => { reset(); c.GLOBAL_CONFIG.serverRaid=clone(ticketConfig);
    c.commandDataFlowLock={readLock:()=>lock(),writeLock:()=>lock()}; c.autoDailyQuestInternalDepth=0;
  },
  now: () => now, advance: ms => { now+=ms; },
  raw: dev => disk[(dev ? devRoot : root)+"member.json"],
  traces: () => traces,
  fail: fn => { failWrite=fn; },
  callback: (msg,user="a",room="room1",group=true) => {
    replies=[]; c.response(room,msg,user,group,c.replier,null,"com.kakao.talk"); return replies.join("\\n");
  },
  reload: () => { c.serverRaidWorkTimers={}; timers=new Map(); },
  clear: () => { traces=[]; replies=[]; }
};`)(require, __dirname);
const { c, read, write, run, start, attack, end, tick, clone } = fixture;
const ticket = fixture.config.items.attackTicket;
let groups = 0;
function group(name, fn) { fixture.reset(); fn(); console.log("PASS " + (++groups) + ": " + name); }
function giveTickets(count, user = "a", dev = false) { const d = read(dev); d.member[user].bag[ticket] = count; write(d, dev); }
function hit(count, user = "a", prefix = "hit", dev = false) { for (let i = 0; i < count; i++) attack(user, prefix + i, dev); }

group("최종 3개 조회 명령·접미 미실행·옛 서버 조회는 변경 안내", () => {
    for (const msg of ["/레이드전적", "/레이드순위", "/서버대전"]) assert(c.isServerRaidQueryCommand(msg));
    for (const msg of ["/레이드전적 1", "/레이드순위 대상", "/서버대전시작 안내", "/서버대전 안내", "/서버레이드전체순위"]) assert(!c.isServerRaidCommand(msg));
    for (const [old, current] of [["/레이드기록", "/레이드전적"], ["/서버레이드기록", "/레이드순위"], ["/서버레이드순위", "/레이드순위"], ["/서버레이드순위 대상", "/레이드순위"]]) {
        const before = fixture.raw(); fixture.clear();
        assert(run(old, "a", undefined, old.indexOf("/서버레이드순위") === 0 ? "room1" : "room8").includes("👉 " + current));
        assert.strictEqual(fixture.raw(), before); assert(!fixture.traces().some(t => t.type === "save" || t.type === "load"));
    }
});

group("실제 7인수 콜백·모든 운영방 조회·기존 자격 검사와 DEV 제한 유지", () => {
    assert(fixture.callback("/서버대전").includes("현재 진행 중인 서버대전이 없습니다"));
    start();
    for (const msg of ["/서버대전", "/레이드전적", "/레이드순위", "/레이드턴", "ㄹㄹ"]) {
        for (const room of ["room1", "room8", "test"]) assert(fixture.callback(msg, "a", room).length > 0);
        assert(run(msg, "absent", undefined, "room1").includes("출석체크부터"));
        assert(run(msg, "noPass", undefined, "room1", false).includes("프리미엄 필요"));
        assert(!run(msg, "suspended", undefined, "room1").includes("우리 서버 순위"));
    }
    assert(run("dev/서버대전", "a", undefined, "room1").includes("팻 테스트방에서만"));
    assert(run("dev/서버대전", "a", undefined, "test").includes("현재 진행 중인 서버대전이 없습니다"));
});

group("실시간 현황·현재 회차만 집계·실제 공격 계정 중복 제외·등록 10개 서버", () => {
    start(); hit(3); attack("b", "b1");
    const d = read(); d.serverRaid.wins[d.member.a.server] = 9; write(d);
    const before = fixture.raw(); fixture.clear(); const text = fixture.callback("/서버대전");
    assert(text.includes("👾 이번 대전 데미지: 400,000💞")); assert(text.includes("👥 이번 대전 참가자: 2명"));
    assert(text.includes("📂 전체 서버 실시간 순위 펼쳐보기<ALLSEE>\n🌐 전체 서버 실시간 순위"));
    assert.strictEqual((text.match(/<ALLSEE>/g) || []).length, 1);
    assert.strictEqual((text.match(/👾 데미지:/g) || []).length, 10);
    assert.strictEqual((text.match(/📍우리 서버/g) || []).length, 1);
    for (const server of fixture.config.servers) assert(text.includes(server + "⭐"));
    assert(text.includes(d.member.a.server + "⭐9 📍우리 서버"));
    assert.strictEqual(fixture.raw(), before); assert(!fixture.traces().some(t => t.type === "save"));
    assert.strictEqual(read().member.c.serverRaidAccount, undefined);
    attack("a", "a4"); assert(run("/서버대전").includes("👾 이번 대전 데미지: 500,000💞"));
    end(); const old = run("/레이드전적"); assert(old.includes("📋 내 레이드 기록") && old.includes("✅ 지급 완료"));
    start(); attack("a", "new");
    assert(run("/서버대전").includes("👾 이번 대전 데미지: 100,000💞"));
    assert(run("/레이드순위").includes("🏆 서버 누적 순위"));
    assert(run("/레이드전적").includes("📋 내 레이드 기록"));
});

group("준비·정산·마감·종료 화면과 실제 KST 시각·조회 자체 무변경", () => {
    run("/서버대전시작", "master");
    let d = read(); const round = d.serverRaid.current;
    let text = c.buildServerRaidCurrentStatus(d, "a", fixture.now());
    assert(text.includes("준비 중")); assert(text.includes("자동 종료 예정: " + c.formatServerRaidKstTime(round.prepareUntil + round.durationMs)));
    assert(text.includes(c.formatServerRaidKstTime(round.prepareUntil)));
    tick(60001); d = read();
    assert(c.buildServerRaidCurrentStatus(d, "a", fixture.now()).includes("진행 중"));
    assert(c.buildServerRaidCurrentStatus(d, "a", fixture.now()).includes(c.formatServerRaidKstTime(d.serverRaid.current.autoEndAt)));
    const saved = JSON.stringify(d);
    assert(c.buildServerRaidCurrentStatus(d, "a", d.serverRaid.current.autoEndAt).includes("정산 중"));
    assert.strictEqual(JSON.stringify(d), saved);
    d.serverRaid.current.state = "SETTLING"; assert(c.buildServerRaidCurrentStatus(d, "a", fixture.now()).includes("정산 중"));
    d.serverRaid.current.state = "DONE"; assert(c.buildServerRaidCurrentStatus(d, "a", fixture.now()).includes("현재 진행 중인"));
});

group("큰 데미지 정확 합산·공동 순위·0 데미지 실제 참가·집계의 원본 무변경", () => {
    start(); hit(2); attack("b", "b"); attack("c", "c");
    const d = read(), round = d.serverRaid.current, participants = Object.values(round.accounts);
    participants.find(p => p.id === d.member.a.serverRaidAccount.id).damage = "9007199254740993";
    participants.find(p => p.id === d.member.b.serverRaidAccount.id).damage = "7";
    const third = participants.find(p => p.id === d.member.c.serverRaidAccount.id);
    third.server = fixture.config.servers[1]; third.damage = "9007199254741000";
    const before = JSON.stringify(round), rows = c.buildServerRaidCurrentRows(round);
    assert.strictEqual(rows.length, 10); assert.strictEqual(rows[0].damage, "9007199254741000");
    assert.strictEqual(rows[0].rank, 1); assert.strictEqual(rows[1].rank, 1); assert.strictEqual(rows[2].rank, 3);
    assert.strictEqual(rows.find(r => r.id === d.member.a.server).members.length, 2);
    assert.strictEqual(JSON.stringify(round), before);
    assert(c.buildServerRaidCurrentStatus(d, "a", fixture.now()).includes("9,007,199,254,741,000💞"));
    third.damage = "0";
    assert.strictEqual(c.buildServerRaidCurrentRows(round).find(r => r.id === third.server).members.length, 1);
    assert(c.buildServerRaidCurrentStatus(d, "unassigned", fixture.now()).includes("참가 가능한 소속 서버 없음"));
});

group("기본5+서공권10=15회·6~15회 정상·16~18회 무료·19회부터 기존 패널티", () => {
    giveTickets(11); start();
    assert(run("/레이드턴").includes("기본 5/5 · 추가 10/10 남음"));
    hit(5); const point = read().member.a.point;
    for (let i = 6; i <= 15; i++) {
        const text = attack("a", "valid" + i);
        assert(text.includes("추가 " + (15 - i) + "/10")); assert(!text.includes("패널티"));
    }
    let d = read(), p = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    assert.strictEqual(p.attacks.length, 15); assert.strictEqual(p.excessAttempts || 0, 0);
    assert.strictEqual(d.member.a.bag[ticket], 1); assert.strictEqual(d.member.a.point - point, 30000);
    const after = d.member.a.point;
    for (let i = 1; i <= 3; i++) attack("a", "excess" + i);
    assert.strictEqual(read().member.a.point, after);
    assert(attack("a", "excess4").includes("패널티")); assert.strictEqual(read().member.a.point, after - 10000000);
    assert.strictEqual(read().member.a.bag[ticket], 1);
    for (const guide of ["/레이드공격", "/레이드전적", "/레이드순위", "/서버대전"]) assert(run("ㄹㄹ").includes(guide));
});

group("티켓 보유 0·1·9·10·초과 보유의 실제 가용 횟수", () => {
    start();
    for (const count of [0, 1, 9, 10, 11, 9999]) {
        giveTickets(count); const d = read();
        const status = c.getServerRaidAttackAvailability(d.serverRaid.current, null, d.member.a);
        assert.strictEqual(status.additionalRemaining, Math.min(count, 10));
        assert.strictEqual(status.held, count);
    }
    giveTickets(1); hit(6); assert.strictEqual(c.getServerRaidTicketCount(read().member.a, ticket), 0);
    giveTickets(20); assert(run("/레이드턴").includes("추가 9/10 남음"));
});

group("이전 회차 한도5 보존·다음 회차10·시작 및 준비 안내도 저장된 정책 사용", () => {
    c.GLOBAL_CONFIG.serverRaid.limits.ticketAttacks = 5; giveTickets(20); start();
    const oldRound = read().serverRaid.current;
    c.GLOBAL_CONFIG.serverRaid.limits.ticketAttacks = 10;
    assert(run("/레이드턴").includes("추가 5/5"));
    assert(c.buildServerRaidPreparationNotice(oldRound).includes("최대 5회 추가"));
    hit(10); assert(!attack("a", "old-excess").includes("💥 공격 결과:"));
    assert.strictEqual(read().serverRaid.current.policy.ticketAttacks, 5);
    end(); start(); assert.strictEqual(read().serverRaid.current.policy.ticketAttacks, 10);
    assert(c.buildServerRaidPreparationNotice(read().serverRaid.current).includes("최대 10회 추가"));
    assert(fixture.traces().some(t => t.type === "notice" && t.text.includes("서공권 추가 공격: 최대 10회")));
});

group("추가 공격 저장 실패·재시도·이벤트 재전송에서 티켓과 보상 중복 없음", () => {
    giveTickets(10); start(); hit(5); const before = fixture.raw();
    fixture.fail((d, target) => target.endsWith("/member.json") && Object.values(d.serverRaid.current.accounts).some(p => p.attacks.length === 6));
    assert.throws(() => attack("a", "failed-ticket")); assert.strictEqual(fixture.raw(), before);
    attack("a", "failed-ticket"); const after = fixture.raw();
    assert.strictEqual(read().member.a.bag[ticket], 9);
    attack("a", "failed-ticket"); assert.strictEqual(fixture.raw(), after);
    fixture.reload(); attack("a", "failed-ticket"); assert.strictEqual(fixture.raw(), after);
});

group("레거시 7인수 공격·공성전/테스트방 한도 공유·15회 정산 1회만", () => {
    giveTickets(10); start();
    for (let i = 0; i < 15; i++) {
        const text = fixture.callback("/레이드공격", "a", i % 2 ? "test" : "room8");
        assert(text.includes("💥 공격 결과:"), "공격 " + (i + 1) + ": " + text);
    }
    let d = read(); const p = d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];
    assert.strictEqual(p.attacks.length, 15); assert.strictEqual(c.getServerRaidTicketCount(d.member.a, ticket), 0);
    end(); const paid = read().member.a.point;
    run("/서버대전종료", "master"); tick(); assert.strictEqual(read().member.a.point, paid);
    assert(run("/레이드전적").includes("누적 공격: 15회"));
    assert(run("/서버대전").includes("현재 진행 중인 서버대전이 없습니다"));
});

group("DEV 회차 새 한도 및 현황 조회는 DEV 저장만 사용", () => {
    const prodBefore = fixture.raw(); giveTickets(10, "a", true); start(true); hit(15, "a", "devhit", true);
    assert(run("dev/서버대전").includes("👥 이번 대전 참가자: 1명"));
    assert(run("dev/레이드턴").includes("추가 0/10"));
    assert.strictEqual(fixture.raw(), prodBefore);
    assert.strictEqual(c.getServerRaidTicketCount(read(true).member.a, ticket), 0);
});

console.log("서버 레이드 수정요청서 신규 " + groups + "개 검증 그룹 통과");
