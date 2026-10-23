const assert = require('assert');
const { createHarness } = require('./test_guild_marble');
const h = createHarness(), { f, c } = h;
let groups = 0;
// 실제 7인수 응답의 잠금과 오류 처리를 관측하는 함수
function countedLock() {
    return { depth: 0, lock() { this.depth++; }, tryLock() { this.lock(); return true; }, unlock() { assert(this.depth > 0); this.depth--; } };
}
const readLock = countedLock(), writeLock = countedLock(), dataLock = countedLock();
c.commandDataFlowLock = { readLock: () => readLock, writeLock: () => writeLock };
c.dataTransactionLock = dataLock; c.autoDailyQuestInternalDepth = 0;
c.isMasterIdentity = user => user === 'gm'; c.errorLogPath = '/synthetic/error.json';
c.FileStream.write = (_path, text) => { throw Error('unexpected callback error: ' + text); };
// 모든 조기 반환과 정상 응답에서 잠금·컨텍스트 해제를 확인하는 함수
function run(command, user = 'a', dev = false, room = 'table', isGroupChat = true) {
    f.clear(); c.response(room, dev ? 'dev/' + command.slice(1) : command, user, isGroupChat, c.replier, null, 'com.kakao.talk');
    assert.equal(readLock.depth, 0); assert.equal(writeLock.depth, 0); assert.equal(dataLock.depth, 0);
    assert.equal(c.getDataSaveTransaction(), null); assert.equal(c.commandContextThreadLocal.get(), null);
    return f.replies().join('\n');
}
// 실제 참가비 차감 후 확정 순위가 존재하는 정산 대기와 선택적 기지급 상태를 준비하는 함수
function pending(kind = 'PAYOUT', dev = false, options = {}) {
    h.seed(); h.recruit(dev);
    const root = dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH, store = h.store(dev), game = store.guilds.$g.current;
    if (options.dead) { game.players[1].alive = false; game.players[1].gold = 0; game.players[1].eliminated = 1; }
    if (options.left) {
        const data = f.get(root + 'member.json'), guild = f.get(root + 'guild.json');
        delete data.member.a.guild; delete guild.guilds.g.members.a;
        f.put(root + 'member.json', data); f.put(root + 'guild.json', guild);
    }
    c.prepareGuildMarbleSettlement(game, kind);
    if (options.partial) {
        const result = game.results[0], player = game.players[result.index], data = f.get(root + 'member.json');
        player.paid = true; data.member[player.user].point += result.amount; f.put(root + 'member.json', data);
    }
    f.put(root + c.GLOBAL_CONFIG.guildMarble.fileName, store);
    return { root, game, store };
}
// 잘못된 입력은 모든 파일·순위·포인트를 보존하고 최신 게임판만 안내하는지 확인하는 함수
function denied(command, user = 'a', dev = false, room = 'table', isGroup = true) {
    const before = f.files(); c.Math.random = () => { throw Error('denied input must not draw'); };
    const text = run(command, user, dev, room, isGroup);
    assert.deepEqual(f.files(), before, command + ' by ' + user + ' changed data');
    assert.equal(f.traces().filter(row => row.type === 'save').length, 0);
    if (room === 'table') { assert(text.includes('👥 참가자 현황')); assert(text.includes('[16] 펜던트 공방📿')); }
    return text;
}
// 독립된 정산 예외 시나리오와 정상 재시도 결과를 실행하는 함수
function group(name, test) { test(); console.log('PASS settlement ' + (++groups) + ': ' + name); }

group('PAYOUT/REFUND·DEV/PROD의 잘못된 수량/접미와 권한 없는 참가비 입력 무저장', () => {
    for (const kind of ['PAYOUT', 'REFUND']) for (const dev of [false, true]) {
        pending(kind, dev);
        for (const command of ['/마블참가비 0', '/마블참가비 11', '/마블참가비 999999999999999999999', '/마블참가비 -1', '/마블참가비 1.5', '/마블참가비 3 해봐', '/마블굴리기 설명']) denied(command, 'master', dev);
        for (const user of ['a', 'e', 'sub', 'gm']) denied('/마블참가비 3', user, dev);
        denied('/마블참가비 3', 'master', dev);
    }
});
group('모집/취소/중단 권한과 행동 단계는 정산 중에도 우회 불가', () => {
    for (const kind of ['PAYOUT', 'REFUND']) {
        pending(kind);
        for (const command of ['/마블시작', '/마블모집취소', '/마블중단']) for (const user of ['a', 'e', 'sub', 'gm']) { if (command === '/마블시작' && user === 'sub') continue; denied(command, user); }
        for (const command of ['/마블준비', '/마블준비취소', '/마블모집취소', '/마블구매', '/마블건설', '/마블통과', '/마블중단', '/마블중단확인']) denied(command, command === '/마블모집취소' || command === '/마블중단' ? 'master' : 'a');
        for (const user of ['e', 'sub', 'gm', 'master']) denied('/마블굴리기', user);
        denied('/마블굴리기', 'a', false, 'wrong-room'); denied('/마블시작', 'master', false, 'wrong-room'); denied('/마블시작', 'master', false, 'table', false);
    }
});
group('진행·정산 조회와 가이드는 미처리 지급을 실행하지 않음', () => {
    pending(); for (const command of ['/길드마블', '/마블판']) denied(command);
    const before = f.files(); assert(run('/마블가이드').includes('📘 길드마블 가이드')); assert.deepEqual(f.files(), before);
});
group('길드마스터 재시도와 참가자/탈락자/탈퇴자 재시도는 미지급만 한 번 지급', () => {
    for (const kind of ['PAYOUT', 'REFUND']) for (const dev of [false, true]) for (const role of ['master', 'sub', 'a', 'dead', 'left']) {
        const { root, game } = pending(kind, dev, { partial: true, dead: role === 'dead', left: role === 'left' });
        const before = f.get(root + 'member.json'), otherRoot = dev ? c.DATA_ROOT_PATH : c.DEV_DATA_ROOT_PATH, untouched = f.raw(otherRoot + 'member.json');
        const expected = game.results.map(result => ({ user: game.players[result.index].user, amount: game.players[result.index].paid ? 0 : result.amount }));
        c.Math.random = () => { throw Error('must not repeat settlement lottery'); };
        const command = role === 'master' || role === 'sub' ? '/마블시작' : '/마블굴리기', user = role === 'dead' ? 'b' : role === 'left' ? 'a' : role;
        const text = run(command, user, dev); assert(text.includes(kind === 'REFUND' ? '환급 완료' : '지급 완료'));
        const after = f.get(root + 'member.json'), row = h.store(dev).guilds.$g;
        for (const payment of expected) assert.equal(after.member[payment.user].point, before.member[payment.user].point + payment.amount);
        assert.equal(row.current, null); assert.equal(row.last.kind, kind); assert.equal(row.usage.count, 1);
        assert.equal(f.raw(otherRoot + 'member.json'), untouched);
        run('/마블굴리기', user, dev); assert.deepEqual(f.get(root + 'member.json'), after);
    }
});
group('거절 입력 이후 정상 정산 재시도가 저장 실패하면 순위·포인트 복구 후 재시도', () => {
    for (const kind of ['PAYOUT', 'REFUND']) for (const target of ['member.json', c.GLOBAL_CONFIG.guildMarble.fileName]) {
        const { root } = pending(kind), points = f.raw(root + 'member.json'), fixed = JSON.stringify(h.game().results);
        denied('/마블참가비 0', 'master'); f.failPath(root + target); assert.throws(() => h.run('/마블굴리기', 'a'));
        assert.equal(f.raw(root + 'member.json'), points); h.run('/마블판', 'a'); assert.equal(JSON.stringify(h.game().results), fixed);
        run('/마블굴리기', 'a'); assert.equal(h.store().guilds.$g.current, null);
    }
});
console.log('PASS guild marble settlement: ' + groups + ' regression groups (actual seven-argument response; synthetic only)');
