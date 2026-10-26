const assert = require('assert'), vm = require('vm');
const gm = require('./test_gm_education'), spirit = require('./test_spirit_retirement'), loading = require('./test_command_data_loading');
const names = ['isGuildTerritoryRiftControlCommandMessage', 'isGuildTerritoryWarCommandLockActive', 'isGuildTerritoryAllowedDuringWarCommand', 'isGuildTerritoryBlockedDuringWarCommand'];
const start = gm.main.indexOf('function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {');
const end = gm.main.indexOf('        if (new java.io.File(resolveActiveDataPath(DATA_ROOT_PATH + GLOBAL_CONFIG.miniGames.pendingName))', start);
const finallyStart = gm.main.indexOf('    } finally {\n        if (commandContextEntered)', end), finallyEnd = gm.main.indexOf('\n}', finallyStart) + 2;
assert(start >= 0 && end > start && finallyStart > end);
const probe = gm.main.slice(start, end).replace('function response(', 'function territoryEntryProbe(') + '        acceptedCommands.push(msg);\n' + gm.main.slice(finallyStart, finallyEnd);
const forbidden = ['/펫정보', '/내정보', '/정보 a', 'ㅊㅊ', 'ㅍㅍㅍ', 'ㅈㅈㅈ', 'ㅁㅂ', 'ㅁㄱ', 'ㅎㅈ', '/포인트', '/가방', '/패키지가방', '/패키지지급 a 1', '/교육 12', '/레이드공격', '/초기화', '1삭제', '2취소', '/리셋', '/필터추가 금칙어', '/메인방제한 ON', '/디버깅모드', '/매력버프체크', '/영지공격 1 해봐', '/길드영지종료 해봐', '/글자수전체정리 1', '등록한다', '출발한다', '일반 채팅'];
const allowed = ['/영지공격 1', '/영지공격 7', '/영지공격 8', '/영지공격 9', '/영지온', '/영지오프', '/길드영지', '/길드영지순서', '/길드영지순위', '/길드영지준비', '/길드영지준비확인', '/길드영지확인', '/길드영지시작', '/길드영지종료', '/길드영지초기화', '/영지순위보상', '/영지보상순위', '/길드영지보상지급', '/영지순위보상지급', '/차원의문온', '/차원의문오프', '/날기억해줘온', '/날기억해줘오프', '/균열', '/대균열', '/안정 1', '/불안정 3', '/글자수전체정리'];
// 실제 Main 콜백과 진입 경계를 같은 합성 파일·잠금 환경에 연결한다.
function fixture() {
    const h = gm.createHarness(); h.seed(); const c = h.c;
    for (const name of names) vm.runInContext(spirit.block(gm.main, 'function ' + name + '('), c);
    const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } });
    c.commandDataFlowLock = { readLock: lock, writeLock: lock }; c.autoDailyQuestInternalDepth = 0;
    c.isMasterIdentity = u => u === 'master'; c.errorLogPath = '/synthetic/error'; c.acceptedCommands = [];
    c.FileStream.write = (_p, text) => { throw Error(text); };
    vm.runInContext(probe, c);
    return h;
}
// 역할·환경·명령 형식을 교차해 차단 전 저장과 허용 명령 누락을 확인한다.
function runTests() {
    const h = fixture(), { c, f } = h; let checks = 0;
    for (const dev of [false, true]) {
        const guildPath = (dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + 'guild.json';
        f.put(guildPath, { guilds: {}, territoryWar: { active: true } });
        for (const sender of ['a', 'master', 'admin', '오픈채팅봇']) for (const text of forbidden) {
            const input = dev ? 'dev/' + text.replace(/^\//, '') : text, before = f.files(); f.clear();
            c.response(c.testRoom, input, sender, true, c.replier, null, 'test');
            assert.deepEqual(f.files(), before, text); assert.equal(c.getDataSaveTransaction(), null);
            assert(f.traces().filter(t => t.type === 'load').every(t => t.path.endsWith('guild.json')), text);
            checks++;
        }
        for (const text of allowed) {
            c.acceptedCommands = []; const input = dev ? 'dev/' + text.slice(1) : text;
            c.territoryEntryProbe(c.testRoom, input, 'master', true, c.replier, null, 'test');
            assert.deepEqual(Array.from(c.acceptedCommands), [text], text); checks++;
        }
        f.put(guildPath, { guilds: {}, territoryWar: { active: false } });
        for (const text of ['/펫정보', 'ㅊㅊ', '/정보 a']) {
            c.acceptedCommands = []; c.territoryEntryProbe(c.testRoom, dev ? 'dev/' + text.replace(/^\//, '') : text, 'a', true, c.replier, null, 'test');
            assert.equal(c.acceptedCommands.length, 1, text); checks++;
        }
    }
    const info = loading.createInfoFixture();
    for (const base of [loading.prod, loading.dev]) info.disk[base + 'guildData.json'] = JSON.stringify({ guilds: {}, territoryWar: { active: true } });
    for (const dev of [false, true]) for (const sender of ['u', 'master', 'admin', '오픈채팅봇']) for (const text of ['/펫정보', '/내정보', '/정보 u', '/포인트', 'ㅍㅍㅍ', 'ㅈㅈㅈ', '/매력버프체크']) {
        const before = { ...info.disk }, result = info.run(dev ? 'dev/' + text.replace(/^\//, '') : text, sender);
        assert.deepEqual(result.errors, [], text); assert.deepEqual(result.messages, [], text); assert.deepEqual(result.writes, [], text);
        assert.deepEqual(info.disk, before); assert(!result.reads.some(p => /member(?:_pet|_title)?\.json$/.test(p)), text); checks++;
    }
    console.log('PASS territory command lock: ' + checks + ' cases; Main/Info actual 7-argument callbacks, roles, DEV, no mutation and entry allowlist');
}
module.exports = { probe, names, forbidden, allowed, runTests };
if (require.main === module) runTests();
