const assert = require('assert'), gm = require('./test_gm_education');
let groups = 0;
// 신규 표시와 추가 교육방을 합성 기록으로 검증한다.
function test(name, check) { check(); console.log('PASS education followup ' + (++groups) + ': ' + name); }
// 완료 시각과 조회 월을 고정하여 한국시간 결과를 확인한다.
function fixture(at = '2026-10-26T12:35:42Z') {
    const h = gm.createHarness(); h.seed(); let time = Date.parse(at);
    h.c.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [time])); } static now() { return time; } };
    h.clock = at => { time = Date.parse(at); }; return h;
}
// 교육방별 실제 일곱 인수 콜백으로 권한과 저장을 확인한다.
function callback(h, text, room, user = 'master') {
    const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } });
    h.c.commandDataFlowLock = { readLock: lock, writeLock: lock }; h.c.autoDailyQuestInternalDepth = 0;
    h.c.isMasterIdentity = u => h.c.Master.indexOf(u) !== -1; h.c.errorLogPath = '/synthetic/error';
    h.c.FileStream.write = (_p, t) => { throw Error(t); }; h.f.clear();
    h.c.response(room, text, user, true, h.c.replier, null, 'test'); return h.f.replies().join('\n');
}
test('교육방·교육방2 실제 콜백의 동일 UI·공통 진도·두 방 재완료 무보상', () => {
    const h = fixture(), reward = h.c.GLOBAL_CONFIG.gmEducation.rewardItem;
    for (const text of ['/교육', '/교육 12', '/교육명령어', '/교육실적', '/교육실적전체']) assert.equal(callback(h, text, '교육방'), callback(h, text, '교육방2'));
    assert(callback(h, '/교육완료 a 1', '교육방').includes('1/12'));
    const first = h.f.files(); callback(h, '/교육완료 a 1', '교육방2'); assert.deepEqual(h.f.files(), first);
    assert(callback(h, '/교육완료 a 2', '교육방2').includes('2/12')); assert(callback(h, '/교육 a', '교육방').includes('2/12'));
    assert.equal(h.f.read().member.a.bag[reward], 2); assert.equal(h.store().users['$id-a'].chapters.length, 2);
    for (const room of ['교육방', '교육방2']) {
        const prev = h.c.enterCommandContext(h.c.createCommandContext(false, room)); assert(!h.c.isMaster('master')); h.c.exitCommandContext(prev);
    }
});
test('두 방 일반/Admin 거절·유사 방 거절·영지전이 교육 허용보다 우선', () => {
    const h = fixture(), before = h.f.files();
    for (const room of ['교육방', '교육방2']) for (const user of ['a', 'sub', 'admin']) for (const text of ['/교육', '/교육실적전체', '/교육완료 a 1']) assert(callback(h, text, room, user).includes('MASTER만'));
    for (const room of ['교육방3', '새 교육방2', '교육방2 ']) assert(callback(h, '/교육완료 a 1', room).includes('MASTER만'));
    assert.deepEqual(h.f.files(), before);
    h.f.put(h.c.guildPath, { guilds: {}, territoryWar: { active: true } }); const active = h.f.files();
    // 기본 교육 하네스의 영지전 대체 함수를 실제 판별 함수로 복원한다.
    const vm = require('vm'), spirit = require('./test_spirit_retirement');
    for (const n of ['isGuildTerritoryWarCommandLockActive', 'isGuildTerritoryBlockedDuringWarCommand', 'isGuildTerritoryAllowedDuringWarCommand', 'isGuildTerritoryRiftControlCommandMessage']) vm.runInContext(spirit.block(gm.main, 'function ' + n + '('), h.c);
    assert(callback(h, '/교육완료 a 1', '교육방2').includes('영지전 진행 중')); assert.deepEqual(h.f.files(), active);
});
test('신규 완료 원본·지급 영수증 시각 일치, KST 초 단위 표시·조회 무저장', () => {
    const h = fixture(); h.run('/교육완료 a 1');
    assert.equal(h.store().users['$id-a'].chapters[0].completedAt, '2026-10-26T12:35:42.000Z');
    assert.equal(h.f.read().member.a.gmEducationRewardTimes[0], '2026-10-26T12:35:42.000Z');
    const before = h.f.files(), personal = h.run('/교육실적'), all = h.run('/교육실적전체');
    assert(personal.includes('1챕터 · 2026.10.26 21:35:42')); assert(all.includes('1챕터 · 2026.10.26 21:35:42'));
    assert(all.includes('👤 [')); assert.equal(all.split('<ALLSEE>').length - 1, 1); assert.deepEqual(h.f.files(), before);
    assert.equal(h.run('/교육실적전체'), h.run('/교육실적 전체'));
    assert.equal(h.run('/교육실적전체 2026-10'), h.run('/교육실적 전체 2026-10'));
});
test('시간 없는 구기록은 날짜만·동일 날짜 원래 순서 보존, 시각 기록은 최신순', () => {
    const h = fixture(); for (let n = 1; n <= 4; n++) { h.clock('2026-10-26T12:35:' + (40 + n) + 'Z'); h.run('/교육완료 a ' + n); }
    const store = h.store(), data = h.f.read();
    store.users['$id-a'].chapters[0].completedAt = '2026-10-26'; store.users['$id-a'].chapters[1].completedAt = '2026-10-26';
    delete data.member.a.gmEducationRewardTimes; h.f.put(h.paths(false).store, store); h.f.write(data);
    const before = h.f.files(), result = h.run('/교육실적전체'), lines = result.split('\n').filter(s => / · \d+챕터 · /.test(s));
    assert.equal(lines.length, 4); assert(lines[0].includes('4챕터 · 2026.10.26 21:35:44')); assert(lines[1].includes('3챕터 · 2026.10.26 21:35:43'));
    assert(lines[2].endsWith('1챕터 · 2026.10.26')); assert(lines[3].endsWith('2챕터 · 2026.10.26')); assert(!result.includes('00:00:00')); assert.deepEqual(h.f.files(), before);
});
test('한국시간 월 경계·자정 실제 시각·지난달 별칭·날짜 없는 기록 보존', () => {
    const h = fixture('2026-10-31T14:59:59Z'); h.run('/교육완료 a 1'); h.clock('2026-10-31T15:00:00Z'); h.run('/교육완료 a 2');
    const before = h.f.files(), oct = h.run('/교육실적전체 2026-10'), nov = h.run('/교육실적전체');
    assert(oct.includes('1챕터 · 2026.10.31 23:59:59')); assert(!oct.includes('2챕터 ·'));
    assert(nov.includes('2챕터 · 2026.11.01 00:00:00')); assert(!nov.includes('1챕터 ·')); assert.deepEqual(h.f.files(), before);
    for (const input of ['/교육실적전체방법', '/교육실적전체 2026-10 해봐', '/교육실적전체 2026-13']) { h.run(input); assert.deepEqual(h.f.files(), before); }
});
test('116개 원본 = 66·24·24·2 GM 합계 = 상세 기록 수, 공동2등 다음4등·TOP3 유지', () => {
    const h = fixture(), data = h.f.read(), base = data.member.a;
    for (let n = 0; n < 10; n++) { data.member['student' + n] = JSON.parse(JSON.stringify(base)); data.member['student' + n].serverRaidAccount.id = 'student-id-' + n; }
    for (const name of ['gm2', 'gm3']) { data.member[name] = JSON.parse(JSON.stringify(base)); data.member[name].serverRaidAccount.id = name + '-id'; h.c.Master.push(name); }
    h.f.write(data);
    for (let n = 0; n < 116; n++) h.run('/교육완료 student' + Math.floor(n / 12) + ' ' + (n % 12 + 1), n < 66 ? 'master' : n < 90 ? 'gm' : n < 114 ? 'gm2' : 'gm3');
    const before = h.f.files(), result = h.run('/교육실적전체'), [top, detail] = result.split('<ALLSEE>');
    assert(result.includes('전체 완료 챕터: 116개')); assert(top.includes('1등 ') && top.includes('2등 ')); assert(!top.includes('4등 ')); assert(detail.includes('4등 '));
    const counts = Array.from(detail.matchAll(/👤 \[[^\]]+\] · (\d+)개/g), m => Number(m[1])); assert.deepEqual(counts, [66, 24, 24, 2]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 116); assert.equal(detail.split('\n').filter(s => /^\[[^\]]+\] · \d+챕터 · /.test(s)).length, 116);
    assert.deepEqual(h.f.files(), before);
});
console.log('PASS education followup: ' + groups + ' groups; synthetic only');
