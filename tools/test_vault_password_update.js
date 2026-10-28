// 기존 15개 정책의 실제 저장 기록을 합성해 새 자릿수·20개 정책 전환을 검증한다.
const assert = require('assert'), h = require('./test_mini_games');
const base = '/sdcard/호이랜드/';
let groups = 0;
function test(name, fn) { fn(); console.log('PASS VAULT PASSWORD ' + (++groups) + ' ' + name); }
function ok(result) { assert(!result.error, result.error); return result.text; }
function fixture(number, won = false, paid = true, dev = false) {
    const f = h.fixture(); f.seed(dev); ok(f.run('/금고', 'a', dev));
    const state = f.state(dev), c = f.c, config = c.GLOBAL_CONFIG.vaultRobbery, currentStages = config.stages;
    const store = { schemaVersion: 4, serial: 0, current: null, awards: {}, replyPending: {}, dailyWinners: [] };
    config.stages = config.previousStages;
    try {
        for (let n = 1; n <= number; n++) {
            c.startVaultRobberyRound(store, state.vault.current.day, n, false, f.now() - 100, undefined, {});
            store.current.answer = c.getVaultRobberyStage(n).minNumber + 10;
            if (n < number || won) {
                const result = c.applyVaultRobberyGuess(store, n === number ? f.id('a', dev) : 'historical-' + n, 'synthetic', store.current.answer, true, f.now() - 50);
                const award = store.awards[result.awardKey], isPaid = n < number || paid;
                award.paid = isPaid; award.notice = isPaid ? 'SENT' : 'WAITING'; award.nextOpened = n < number;
                state.ledger[award.rewardId] = { id: award.rewardId, kind: 'vault', gameId: award.gameId, day: award.day, accountId: award.accountId, amount: award.amount, at: award.at, status: isPaid ? 'PAID' : 'PENDING', paidAt: isPaid ? award.at : null };
            }
        }
    } finally { config.stages = currentStages; }
    store.schemaVersion = 3;
    store.current.usage['$' + f.id('a', dev)] = 2;
    if (!won) store.current.hints = [{ accountId: f.id('a', dev), name: 'synthetic', guess: config.previousStages[number <= 3 ? 0 : number <= 7 ? 1 : 2].minNumber, direction: 'UP' }];
    state.vault = store; f.putState(state, dev);
    return f;
}

test('2·3·8번째 범위 교체는 횟수·상금·당첨·원장 보존, 기존 판 보관, 반복 무변경', () => {
    for (const n of [2, 3, 8]) {
        const f = fixture(n), before = f.state(), original = before.vault.current, member = f.read();
        ok(f.run('/금고')); const after = f.state(), stage = f.c.getVaultRobberyStage(n);
        assert.equal(after.vault.schemaVersion, 4); assert.equal(after.vault.current.number, n); assert.notEqual(after.vault.current.id, original.id);
        assert.deepEqual(after.vault.current.usage, original.usage); assert.deepEqual(after.vault.current.hints, []);
        assert.equal(after.vault.current.prize, original.prize); assert(after.vault.current.answer >= stage.minNumber && after.vault.current.answer <= stage.maxNumber);
        assert.deepEqual(after.vault.dailyWinners, before.vault.dailyWinners); assert.deepEqual(after.ledger, before.ledger); assert.deepEqual(f.read(), member);
        assert.deepEqual(JSON.parse(f.disk()[base + 'miniGameArchive_2026-10.json']).days['vault:' + original.id], original);
        const saved = JSON.stringify(after); ok(f.run('/금고')); assert.equal(JSON.stringify(f.state()), saved);
        f.clock(f.now() + 1); ok(f.run('/금고 ' + stage.minNumber)); assert.equal(f.state().vault.current.usage['$' + f.id()], 3);
    }
});

test('1·4·7·9·15번째 미당첨 판은 기존 정답·힌트·ID·횟수 유지', () => {
    for (const n of [1, 4, 7, 9, 15]) {
        const f = fixture(n), current = f.state().vault.current; ok(f.run('/금고'));
        assert.deepEqual(f.state().vault.current, current); assert.equal(f.state().vault.schemaVersion, 4);
    }
});

test('기존 15개 종료 기록에서 16번째 시작, 지급 이력 보존·재지급 없음', () => {
    const f = fixture(15, true), before = f.state(), points = f.read().member.a.point;
    ok(f.run('/금고')); const after = f.state();
    assert.equal(after.vault.current.number, 16); assert(after.vault.current.answer >= 100000 && after.vault.current.answer <= 999999);
    assert.equal(after.vault.dailyWinners.length, 15); assert.equal(f.read().member.a.point, points); assert.deepEqual(after.ledger, before.ledger);
    assert.equal(f.c.getVaultRobberyPaidTotal(after.vault), 10600000000);
    for (const key of after.vault.dailyWinners) assert.equal(after.vault.awards[key].answer, before.vault.awards[key].answer);
});

test('기존 8번째 미지급 당첨은 원래 5자리 정답·보상ID·금액으로 1회 지급', () => {
    const f = fixture(8, true, false), before = f.state(), original = before.vault.awards[before.vault.current.winner], points = f.read().member.a.point;
    ok(f.run('/금고')); const after = f.state(), award = after.vault.awards[original.gameId];
    assert.equal(award.answer, original.answer); assert.equal(award.rewardId, original.rewardId); assert.equal(award.amount, 1000000000); assert(award.paid);
    assert.equal(after.vault.current.number, 9); assert.equal(f.read().member.a.point, points + 1000000000);
    ok(f.run('/금고')); assert.equal(f.read().member.a.point, points + 1000000000);
});

test('정책 전환 게시 중단 후 새 전역에서 보관·새 정답·횟수를 복구', () => {
    for (const filename of ['miniGameArchive_2026-10.json', 'miniGameState.json', 'miniGamePending.json']) {
        const f = fixture(2), original = f.state().vault.current;
        f.crashAfter((p, value) => p.endsWith('/' + filename) && (filename !== 'miniGamePending.json' || value.pending === null));
        assert(f.run('/금고').error);
        const restarted = h.fixture(); restarted.seed(); Object.assign(restarted.disk(), f.disk()); restarted.clock(f.now() + 1);
        ok(restarted.run('/금고')); const saved = restarted.state();
        assert.equal(saved.vault.schemaVersion, 4); assert.equal(saved.vault.current.serial, original.serial + 1);
        assert.deepEqual(saved.vault.current.usage, original.usage); assert(saved.vault.current.answer >= 1000);
        assert.deepEqual(JSON.parse(restarted.disk()[base + 'miniGameArchive_2026-10.json']).days['vault:' + original.id], original);
    }
});

test('이전 정책 손상 거부·DEV 전환은 PROD 무변경', () => {
    const f = fixture(8), broken = f.state(); broken.vault.current.answer = 999; f.putState(broken);
    const raw = f.disk()[base + 'miniGameState.json']; assert(f.run('/금고').error); assert.equal(f.disk()[base + 'miniGameState.json'], raw);
    const dev = fixture(2, false, true, true), prod = dev.disk()[base + 'member.json']; ok(dev.run('/금고', 'a', true));
    assert.equal(dev.state(true).vault.schemaVersion, 4); assert.equal(dev.disk()[base + 'member.json'], prod); assert(!dev.disk()[base + 'miniGameState.json']);
});

console.log('PASS vault password update ' + groups + ' groups');
