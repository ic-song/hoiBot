// 성능 수치 비교 없이 보관 변경 추적·지급·기존 복구 형식의 회귀를 검증한다.
const assert = require('assert'), h = require('./test_mini_games');
const base = '/sdcard/호이랜드/', archivePath = base + 'miniGameArchive_2026-10.json';
function ok(result) { assert(!result.error, result.error); return result; }
function readArchive(f) { return JSON.parse(f.disk()[archivePath]); }
let groups = 0;
function test(name, fn) { fn(); console.log('PASS MINI MEMORY ' + (++groups) + ' ' + name); }

test('vault replacements preserve the complete old round while later usage reset only changes the active round', () => {
    const f = h.fixture(); f.seed(); ok(f.run('/금고')); ok(f.run('/금고 100'));
    const before = f.state().vault.current; f.clock(f.now() + 1); ok(f.run('/금고리셋', 'master'));
    const archived = readArchive(f); assert.deepEqual(archived.days['vault:' + before.id], before);
    assert.equal(Object.keys(archived.operations).length, 1);
    f.clock(f.now() + 1); ok(f.run('/금고 100'));
    ok(f.run('/금고횟수리셋 a', 'master'));
    assert.deepEqual(readArchive(f).days['vault:' + before.id], before);
    assert.equal(f.state().vault.current.usage['$' + f.id()], 0);
    assert.equal(Object.keys(readArchive(f).operations).length, 2);
});

test('first and second vault prizes keep separate immutable archives and never repay a completed prize', () => {
    const f = h.fixture(); f.seed(); ok(f.run('/금고')); const first = f.state().vault.current;
    const points = f.read().member.a.point; f.clock(f.now() + 1); ok(f.run('/금고 ' + first.answer));
    const frozenFirst = readArchive(f).days['vault:' + first.id]; assert(frozenFirst.winner);
    const second = f.state().vault.current; assert.equal(second.number, 2);
    f.clock(f.now() + 1); ok(f.run('/금고 ' + second.answer));
    assert.deepEqual(readArchive(f).days['vault:' + first.id], frozenFirst);
    assert.equal(f.read().member.a.point, points + first.prize + second.prize);
    for (let i = 0; i < 3; i++) ok(f.run('/금고'));
    assert.equal(f.read().member.a.point, points + first.prize + second.prize);
});

test('read-only balance statistics preserve the archive and do not publish history again', () => {
    const f = h.fixture(); f.seed(); for (const user of ['a', 'b', 'c', 'admin', 'master']) ok(f.run('/밸런스 1 이유', user));
    f.clock(f.now() + 86400000); f.dailyReset();
    ok(f.run('/밸런스결과', 'master')); ok(f.run('/밸런스결과', 'master'));
    const archive = f.disk()[archivePath], state = f.disk()[base + 'miniGameState.json'];
    const result = ok(f.run('/밸런스결과', 'master'));
    assert(result.text.includes('보상 대상: 5명'));
    assert.equal(f.disk()[archivePath], archive); assert.equal(f.disk()[base + 'miniGameState.json'], state);
    assert(!result.traces.some(t => t.type === 'save' && t.path === archivePath));
});

test('large existing history survives a new admin record and legacy journal replay after interrupted publication', () => {
    const f = h.fixture(); f.seed(); ok(f.run('/금고'));
    const history = { version: 1, days: { existing: { text: '합성 보관 기록'.repeat(10000) } }, rewards: {}, games: {}, notices: {} };
    f.disk()[archivePath] = JSON.stringify(history); const state = f.state(); state.archives['miniGameArchive_2026-10.json'] = true; f.putState(state);
    f.crashAfter(p => p === base + 'miniGameState.json'); f.clock(f.now() + 1);
    assert(f.run('/금고리셋', 'master').error);
    const pending = JSON.parse(f.disk()[base + 'miniGamePending.json']);
    assert.equal(pending.version, 1); assert(Array.isArray(pending.pending));
    for (const row of pending.pending) assert.equal(typeof row.text, 'string');
    ok(f.run('/금고')); assert.equal(JSON.parse(f.disk()[base + 'miniGamePending.json']).pending, null);
    const archived = readArchive(f); assert.deepEqual(archived.days.existing, history.days.existing);
    assert.equal(Object.keys(archived.operations).length, 1);
});

console.log('PASS mini-game memory safety ' + groups + ' groups');
