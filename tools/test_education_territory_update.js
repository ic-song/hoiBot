const assert = require('assert'), vm = require('vm');
const gm = require('./test_gm_education'), spirit = require('./test_spirit_retirement');
let groups = 0;
// 요청한 출력과 시간 제한을 합성 계정으로 검증한다.
function test(name, check) { check(); console.log('PASS education/territory ' + (++groups) + ': ' + name); }
// 실제 정보 명령 분기를 교육 원본·조회 캐시와 연결한다.
function infoHarness(h) {
    const { f, c } = h; let dev = false, reads = 0;
    const query = { GLOBAL_CONFIG: c.GLOBAL_CONFIG, DATA_ROOT_PATH: c.DATA_ROOT_PATH, gmEducationInfoCache: {},
        java: { io: { File: function (p) { this.exists = () => f.raw(p) !== undefined; this.lastModified = () => 1; this.length = () => (f.raw(p) || '').length; } } },
        resolveActiveDataPath: p => dev ? p.replace(c.DATA_ROOT_PATH, c.DEV_DATA_ROOT_PATH) : p,
        loadJsonFile: p => { if (p.endsWith('gmEducation.json')) reads++; return p === 'titles' ? { member: {} } : p === 'pets' ? {} : f.get(p); },
        memberPetPath: 'pets', memberTitlePath: 'titles', petData: {}, titleData: {}, guildData: {}, allsee: '<ALLSEE>', room91: 'audit',
        isAdminIdentity: u => u === 'admin', isMasterIdentity: u => u === 'master', getInfoLevelRequiredExperience: () => 1000,
        getTitle: () => '', generateBagOutput: () => ({ bagOutput: '가방 유지' }), getMyGuildInfo: () => null,
        formatInfoServerRaidServer: (_d, s) => s, getInfoAdventureLevelTitle: () => '모험가', checkRank: (_d, _p, _g, u) => u,
        formatDate: () => 'joined', numberWithCommas: String, formatInfoAdventureExperience: String,
        Api: { replyRoom() {} }, replier: { reply: text => query.output = text } };
    vm.createContext(query);
    for (const name of ['getGmEducationChapterCount', 'requireGmEducationStore', 'getGmEducationProgress']) vm.runInContext(spirit.block(gm.info, 'function ' + name + '('), query);
    const start = gm.info.indexOf('\t\tif ((msg === "/정보"');
    assert(start >= 0);
    const branch = spirit.block(gm.info, gm.info.slice(start + 2, gm.info.indexOf('\n', start)).trim());
    vm.runInContext('function inspect(data,msg,sender){' + branch + '}', query);
    return { query, reads: () => reads, run(target = 'a', sender = 'master', isDev = false, msg) {
        dev = isDev; query.output = ''; query.inspect(f.get((dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + 'member.json'), msg || '/정보 ' + target, sender); return query.output;
    } };
}
test('12챕터는 패키지 이름·수량 조회 안내, 공통 완료·보상·전체보기 유지', () => {
    const h = gm.createHarness(); h.seed(); const before = h.f.files(), manual = h.run('/교육 12');
    assert(manual.includes('📘 패키지 상품 확인')); assert(manual.includes('/패키지가방')); assert(manual.includes('이름과 보유 수량'));
    for (const text of ['/패키지리스트', '입금', '누락 문의', 'https://']) assert(!manual.includes(text));
    assert(manual.includes('GM 확인')); assert(manual.includes('다이아상자💎(소) 1개')); assert(manual.includes('실제 후원·결제·후원 이력 없이'));
    assert.equal(manual.split('<ALLSEE>').length - 1, 1); assert.deepEqual(h.f.files(), before);
});
test('정보 대상자의 0~12챕터·수료 표시, 대상/조회자 구분·캐시·기존 항목·무저장', () => {
    const h = gm.createHarness(); h.seed(); const q = infoHarness(h);
    for (let n = 0; n <= 12; n++) {
        if (n) h.run('/교육완료 a ' + n);
        const before = h.f.files(), text = q.run();
        const line = '• 호월 교육: 📘 ' + n + '/12챕터 완료 · ' + (n === 12 ? '전체 수료' : '다음 ' + (n + 1) + '챕터');
        assert(text.includes('• 레벨: ' + h.f.read().member.a.lv + '\n' + line + '\n• 가입일:'), text); assert.equal(text.split('• 호월 교육:').length - 1, 1);
        for (const field of ['보유 포인트', '다이아💎', '가방 유지', '<ALLSEE>']) assert(text.includes(field));
        assert.deepEqual(h.f.files(), before); const reads = q.reads(); q.run(); assert.equal(q.reads(), reads);
    }
    assert(q.run('master').includes('📘 0/12챕터 완료')); assert(q.run('a', 'admin').includes('전체 수료'));
    assert.equal(q.run('a', 'a'), ''); assert.equal(q.run('a', 'master', false, '/정보a'), '');
    assert(q.run('없는유저').includes('등록되지 않은 유저')); assert(q.run('a', 'master', false, '/정보').includes('등록되지 않은 유저'));
});
test('닉네임 변경·공백 닉네임도 계정 기록 조회, DEV 교육/캐시 분리', () => {
    const h = gm.createHarness(); h.seed(); h.run('/교육완료 a 1'); h.run('/교육완료 공백 이름 여 1'); const q = infoHarness(h);
    assert(q.run('공백 이름 여').includes('📘 1/12챕터 완료'));
    const data = h.f.read(); data.member.renamed = data.member.a; delete data.member.a; h.f.write(data);
    assert(q.run('renamed').includes('📘 1/12챕터 완료')); assert(q.run('a', 'master', true).includes('📘 0/12챕터 완료'));
    h.run('/교육완료 a 1', 'master', true); assert(q.run('a', 'master', true).includes('📘 1/12챕터 완료'));
    assert(q.run('renamed').includes('📘 1/12챕터 완료')); assert.equal(Object.keys(q.query.gmEducationInfoCache).length, 2);
});
test('복구 대기는 확정 수만 표시, 손상 JSON·원본/영수증 불일치·건너뛴 기록은 오류 유지', () => {
    const h = gm.createHarness(); h.seed(); h.run('/교육완료 a 1'); h.f.failPath(h.paths(false).store); h.run('/교육완료 a 2');
    let q = infoHarness(h); const before = h.f.files(); assert(q.run().includes('📘 1/12챕터 완료 · 다음 2챕터')); assert.deepEqual(h.f.files(), before);
    h.f.put(h.paths(false).store, { version: 9 }); q = infoHarness(h); assert.throws(() => q.run(), /교육 저장소/);
    h.seed(); h.run('/교육완료 a 1'); const data = h.f.read(); data.member.a.gmEducationRewards[0] = 'wrong'; h.f.write(data);
    q = infoHarness(h); assert.throws(() => q.run(), /불일치/);
    const store = h.store(); store.users['$id-a'].chapters[0].chapter = 2; h.f.put(h.paths(false).store, store);
    q = infoHarness(h); assert.throws(() => q.run(), /교육 챕터 기록/);
});
// 실제 타이머 예약·만료 함수를 메모리 상태와 예약 큐에 연결한다.
function timerHarness(auto = false) {
    const h = gm.createHarness(), war = { active: true, guildAttackCounts: {}, timeoutMissCounts: {}, eliminatedGuilds: {} };
    const data = { member: { a: { guildTerritoryAutoAttackEnabled: auto } } }, guild = { territoryWar: war };
    let scheduled, advances = 0;
    const lock = { lock() {}, unlock() {} }, context = { key: () => 'test', header: s => s };
    const c = { GLOBAL_CONFIG: h.c.GLOBAL_CONFIG, guildTerritoryWarTimers: {}, guildPath: 'guild', filePath: 'member', memberPetPath: 'pets', petSkillDataPath: 'skills', room8: 'territory',
        clearGuildTerritoryWarTimer() {}, getGuildTerritoryTurnRow: () => ({ guildId: 'g', user: 'a' }), getCurrentContext: () => context,
        saveJsonFile() {}, setTimeout: (fn, delay) => { scheduled = { fn, delay }; return 1; }, enterCommandContext() {}, exitCommandContext() {},
        dataTransactionLock: lock, beginDataSaveTransaction() {}, endDataSaveTransaction() {},
        loadJsonFile: p => p === 'guild' ? guild : p === 'member' ? data : {}, ensureGuildTerritoryWar: () => war,
        validateGuildTerritoryAutoAttack: () => ({ ok: true }), getGuildTerritoryAutoAttackTargetNo: () => 2,
        getGuildByIdSafe: () => ({ name: '길드' }), formatGuildDisplay: g => g.name, formatDateTime: () => 'now',
        processGuildTerritoryRiftEvent: () => null, Api: { replyRoom() {} }, isGuildTerritoryAllDone: () => false,
        advanceGuildTerritoryTurn: () => advances++, withGuildTerritoryDataMode: (_g, fn) => fn(), buildGuildTerritoryTurnMessage: () => [], castleMsg() {} };
    vm.createContext(c);
    for (const name of ['applyGuildTerritoryTimeoutMiss', 'startGuildTerritoryTurnTimer']) vm.runInContext(spirit.block(gm.main, 'function ' + name + '('), c);
    return { c, war, schedule() { return c.startGuildTerritoryTurnTimer(data, {}, guild, {}, {}, true); }, scheduled: () => scheduled, advances: () => advances };
}
test('수동 턴 10초 예약·만료마다 다음 턴·3회 누적 탈락·지난 타이머 무시', () => {
    const h = timerHarness(); h.schedule(); assert.equal(h.scheduled().delay, 10000);
    const stale = h.scheduled(); h.schedule(); stale.fn(); assert.equal(h.advances(), 0);
    for (let n = 1; n <= 3; n++) { h.scheduled().fn(); assert.equal(h.war.guildAttackCounts.g, n); assert.equal(h.war.timeoutMissCounts.g, n); assert.equal(h.advances(), n); assert.equal(h.scheduled().delay, 10000); }
    assert.equal(h.war.eliminatedGuilds.g.reason, 'TIMEOUT_MISS');
});
test('자동공격은 1초 유예·영지 번호 예약 유지', () => {
    const h = timerHarness(true); assert.equal(h.schedule(), 2); assert.equal(h.scheduled().delay, 1000);
});
console.log('PASS education/territory: ' + groups + ' groups; synthetic only');
