const assert = require('assert'), vm = require('vm'), cp = require('child_process');
const { createFixture } = require('./test_server_raid_delivery.js');
const clone = value => JSON.parse(JSON.stringify(value));
const baseline = cp.execFileSync('git', ['show', '0d26cbd0:main.js'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).replace(/\r\n/g, '\n');
const helperNames = ['isAdmin', 'getSupportPassConfigs', 'getSupportPassDateValue', 'getTodaySupportPassDateValue', 'isSupportPassActive', 'isHoiPassPremiumActive', 'getMiniPetBagLimit', 'getFurnitureBagLimit', 'getPendantBagLimit', 'sortMiniPetBag', 'refreshMiniPetSortIndex', 'sortFurnitureList', 'initSweetHomeUser', 'getPendantGradeSortRank', 'sortPendantBagByGrade', 'countAllMiniPetBagItems', 'countAllFurnitureBagItems', 'cleanAllMiniPetBags', 'cleanAllFurnitureBags', 'cleanAllPendantBags', 'buildTextLengthCleanupMessage'];

// 운영 스냅샷을 사용하지 않고 일반·프리미엄·만료 사용자와 장착/가방 데이터를 만든다.
function seed(h) {
    const state = h.persist();
    for (const prefix of [h.c.DATA_ROOT_PATH, h.c.DEV_DATA_ROOT_PATH]) {
        const data = JSON.parse(state.disk[prefix + 'member.json']), pets = JSON.parse(state.disk[prefix + 'member_pet.json']), home = {};
        for (const [user, count] of [['a', 14], ['b', 18], ['c', 12]]) {
            data.member[user].pass = { premium: { enabled: true, permanent: user === 'b', endDate: '20.01.01' } };
            pets[user].miniPetBag = Array.from({ length: count }, (_, i) => ({ name: 'mini' + i, grade: i % 2 ? '고급' : '일반', battleExp: i * 10, sortIndex: 999 }));
            pets[user].pendantBag = Array.from({ length: user === 'a' ? 53 : 50 }, (_, i) => ({ name: 'pendant' + String(i).padStart(2, '0'), grade: i % 2 ? '창조' : '최하급', durability: 5 }));
            pets[user].miniPet = { name: 'equipped-mini', battleExp: 777 };
            pets[user].miniPetSub = { name: 'equipped-sub', battleExp: 333 };
            pets[user].pendant = { name: 'equipped-pendant', grade: '창조', upgrade: 7 };
            pets[user].collection = { completedStage: 3 };
            home[user] = { floor: 100, visitCnt: 7, likeCnt: 8, comment: 'keep', feeds: [{ content: 'keep' }], placedFurnitureSummary: { count: 1, totalExp: 999 }, placedFurniture: [{ id: 'equipped-furniture', exp: 999 }], furnitureBag: Array.from({ length: count }, (_, i) => ({ id: 'f' + i, name: 'furniture' + i, exp: i * 100 })) };
        }
        state.disk[prefix + 'member.json'] = JSON.stringify(data);
        state.disk[prefix + 'member_pet.json'] = JSON.stringify(pets);
        state.disk[prefix + 'home.json'] = JSON.stringify(home);
    }
    return state;
}

// 실제 메뉴 진입부와 기존 글자수 정리 분기를 실제 저장/롤백 함수에 연결한다.
function createTextFixture(saved) {
    let h = createFixture(saved);
    if (!saved) h = createFixture(seed(h));
    const c = h.c;
    for (const name of helperNames) vm.runInContext(h.block(h.main, 'function ' + name + '('), c);
    c.miniPetData = { gradeTable: [{ grade: '일반' }, { grade: '고급' }] };
    const start = h.main.indexOf('function response('), end = h.main.indexOf('// 확인 응답도', start);
    const loads = 'var data=loadJsonFile(filePath),petData=loadJsonFile(memberPetPath),guildData=loadJsonFile(guildPath);';
    const tail = 'return msg;}catch(error){rollbackDataSaveTransaction();throw error;}finally{if(commandContextEntered)exitCommandContext(prevCtx);if(dataSaveTransactionEntered)endDataSaveTransaction();if(responseTransactionAcquired)dataTransactionLock.unlock();responseDataLock.unlock();}}';
    const branch = h.block(h.main, 'if (msg === "/글자수전체정리") {');
    vm.runInContext(h.main.slice(start, end).replace('function response(', 'function runTextMenu(') + loads + branch + tail, c);
    vm.runInContext('function runBaseline(msg,sender,room){var responseDataLock=getResponseDataFlowLock(msg),ctx=createCommandContext(false,room),prevCtx=enterCommandContext(ctx),commandContextEntered=true,dataSaveTransactionEntered=true,responseTransactionAcquired=true;responseDataLock.lock();dataTransactionLock.lock();beginDataSaveTransaction();try{' + loads + h.block(baseline, 'if (msg === "/글자수전체정리") {') + tail, c);
    function call(msg, user = 'master', room = 'test', opts = {}) {
        const replies = []; c.replier = { reply: opts.reply || (s => replies.push(String(s))) };
        const result = c.runTextMenu(room, msg, user, opts.group === undefined ? true : opts.group, c.replier, {}, 'test');
        return { result, replies };
    }
    function choose(user = 'master', room = 'test', dev = false) {
        call(dev ? 'dev/초기화' : '/초기화', user, room);
        const state = c.manualResetSessions[(dev ? 'DEV:' : 'PROD:') + user];
        assert(state && state.choices.includes('textCleanup'));
        return call((dev ? 'dev/' : '') + (state.choices.indexOf('textCleanup') + 1), user, room);
    }
    function read(name, dev = false) { return JSON.parse(c.FileStream.read((dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + name)); }
    return { h, c, call, choose, read, branch };
}

function runTests() {
    let count = 0;
    function test(name, run) { run(); console.log('PASS reset cleanup ' + (++count) + ': ' + name); }
    test('추가는 운영용 2종뿐이며 기존 30항목 순서와 개인/개별 정리 명령은 유지', () => {
        const f = createTextFixture(), before = createFixture();
        const entries = clone(f.c.GLOBAL_CONFIG.manualReset.entries);
        const c = {}; vm.createContext(c); vm.runInContext('this.entries=({' + before.block(baseline, 'manualReset: {') + '}).manualReset.entries;', c);
        assert.deepStrictEqual(entries.slice(0, 30), clone(c.entries));
        assert.deepStrictEqual(entries.slice(30).map(e => [e.id, e.command]), [['textCleanup', '/글자수전체정리'], ['filterCleanup', '/필터데이터정리']]);
        for (const msg of ['/미니펫전체정리', '/가구전체정리', '/펜던트전체정리', '/정리', 'ㅇㅇㅇ', '/가구가방정리 100', '/미니펫가방정리 100', '/펜던트가방정리 1~2', '/데이터정리', '/리셋', '/주기리셋']) assert(!f.c.isManualResetLegacyCommand(msg), msg);
    });
    test('권한과 방을 기존 실행 조건과 대조: MASTER·GM 관리자·주문기록방 봇·일반 사용자', () => {
        const f = createTextFixture(), c = f.c, entries = c.GLOBAL_CONFIG.manualReset.entries;
        for (const user of ['master', 'admin', '오픈채팅봇', 'a']) for (const room of ['test', 'room90', 'room92', 'room8', c.GLOBAL_CONFIG.permissions.orderLogRoom]) {
            const ctx = c.createCommandContext(false, room), prev = c.enterCommandContext(ctx);
            try {
                const text = c.isMaster(user) || (room === c.room90 && (c.isAdmin(user) || user === '오픈채팅봇'));
                const filter = c.isAdmin(user) || c.isMaster(user);
                assert.equal(c.isManualResetEntryAllowed(entries[30], user, {}, {}), text, user + '/' + room);
                assert.equal(c.isManualResetEntryAllowed(entries[31], user, {}, {}), filter, user + '/' + room);
            } finally { c.exitCommandContext(prev); }
            f.call('/초기화', user, room);
            const choices = c.manualResetSessions['PROD:' + user];
            if (user === 'a') assert(!choices.choices.includes('textCleanup') && !choices.choices.includes('filterCleanup'));
            if (user === 'admin' && room === 'test') assert(!choices.choices.includes('textCleanup') && choices.choices.includes('filterCleanup'));
            if (user === 'admin' && room === 'room90') assert(choices.choices.includes('textCleanup'));
        }
    });
    test('메뉴와 선택은 무저장, 정리 표시·기준 안내·정확한 확인 입력', () => {
        const f = createTextFixture(), before = f.h.persist();
        assert(f.call('/초기화').replies[0].includes('[정리] 글자수 전체 정리'));
        const output = f.choose().replies[0]; assert(output.includes('기존 정렬·보관 한도') && output.includes('정말 정리') && output.includes('1삭제 / 2취소'));
        for (const msg of ['1삭제 해봐', '1', '삭제', '확인']) f.call(msg);
        assert.deepStrictEqual(f.h.persist(), before); assert.equal(f.c.manualResetSessions['PROD:master'].stage, 'confirm');
    });
    test('직접 명령·접미사는 안내만 출력하고 저장·정리 함수 호출 없이 종료', () => {
        const f = createTextFixture(), before = f.h.persist(); f.c.cleanAllMiniPetBags = () => { throw Error('must not execute'); };
        for (const msg of ['/글자수전체정리', '/글자수전체정리 1 해봐', '/글자수전체정리방법', '/필터데이터정리', '/필터데이터정리 1', '/필터데이터정리방법', 'dev/글자수전체정리']) assert(f.call(msg).replies[0].includes('통합되었습니다'));
        assert.deepStrictEqual(f.h.persist(), before);
    });
    test('원래 실행 결과·정렬·일반10/프리미엄15/만료10·펜던트50·저장 파일이 동일', () => {
        const f = createTextFixture(), saved = f.h.persist(), old = createTextFixture(saved);
        old.c.replier = { reply() {} }; old.c.runBaseline('/글자수전체정리', 'master', 'test');
        f.choose(); f.call('1삭제'); assert.deepStrictEqual(f.h.persist(), old.h.persist());
        for (const [user, limit] of [['a', 10], ['b', 15], ['c', 10]]) { const pet = f.read('member_pet.json')[user]; assert.equal(pet.miniPetBag.length, limit); assert.equal(pet.pendantBag.length, 50); assert.equal(f.read('home.json')[user].furnitureBag.length, limit); assert.equal(pet.miniPetBag[0].name, 'mini' + (user === 'a' ? 13 : user === 'b' ? 17 : 11)); }
        assert.equal(f.read('member.json').member.a.point, 1000000000);
    });
    test('장착·재화·댓글·피드·방문·컬렉션은 유지하고 2개 저장소만 변경', () => {
        const f = createTextFixture(), before = f.h.persist(), pets = f.read('member_pet.json'), home = f.read('home.json');
        f.choose(); f.call('1삭제');
        for (const user of ['a', 'b', 'c']) { for (const key of ['miniPet', 'miniPetSub', 'pendant', 'collection']) assert.deepStrictEqual(f.read('member_pet.json')[user][key], pets[user][key]); for (const key of ['placedFurniture', 'placedFurnitureSummary', 'floor', 'visitCnt', 'likeCnt', 'comment', 'feeds']) assert.deepStrictEqual(f.read('home.json')[user][key], home[user][key]); }
        for (const [path, value] of Object.entries(before.disk)) if (![f.c.memberPetPath, f.c.homeDataFile].includes(path) && !path.endsWith('.bak')) assert.equal(f.h.persist().disk[path], value, path);
    });
    test('취소·60초 경계·다른 사용자/방/그룹·중복 확인·재시작은 무추가 삭제', () => {
        const f = createTextFixture(); f.choose(); const before = f.h.persist();
        for (const [user, room, opts] of [['admin', 'test', {}], ['master', 'room90', {}], ['master', 'test', { group: false }]]) f.call('1삭제', user, room, opts);
        assert.deepStrictEqual(f.h.persist(), before); f.call('2취소'); f.call('1삭제'); assert.deepStrictEqual(f.h.persist(), before);
        f.choose(); f.h.advance(60000); assert(f.call('1삭제').replies[0].includes('만료')); assert.deepStrictEqual(f.h.persist().disk, before.disk);
        f.choose(); const fresh = createTextFixture(f.h.persist()); fresh.call('1삭제'); assert.deepStrictEqual(fresh.h.persist(), f.h.persist());
        f.call('1삭제'); const done = f.h.persist(); f.call('1삭제'); assert.deepStrictEqual(f.h.persist(), done);
    });
    test('확인 직전 권한 상실은 취소하고 파일을 읽다 실패해도 대기는 소비', () => {
        const f = createTextFixture(); f.choose(); f.c.Master = []; const before = f.h.persist(); assert(f.call('1삭제').replies[0].includes('권한이 변경')); assert.deepStrictEqual(f.h.persist(), before);
        for (const name of ['member.json', 'guild.json', 'member_pet.json', 'home.json']) for (const failure of ['missing', 'json']) { const initial = createTextFixture(); initial.choose(); const read = initial.c.loadJsonFile; initial.c.loadJsonFile = path => path === initial.c.DATA_ROOT_PATH + name ? (failure === 'missing' ? (() => { throw Error('missing'); })() : JSON.parse('{')) : read(path); const saved = initial.h.persist(); assert.throws(() => initial.call('1삭제')); assert.deepStrictEqual(initial.h.persist(), saved); assert(!initial.c.manualResetSessions['PROD:master']); }
    });
    test('각 저장 지점 실패는 선행 저장까지 원복하고 새 메뉴로 재시도', () => {
        for (const name of ['member_pet.json', 'home.json']) { const f = createTextFixture(); f.choose(); const before = f.h.persist(); f.h.failWrite((_data, path) => path === f.c.DATA_ROOT_PATH + name); assert.throws(() => f.call('1삭제')); for (const path of [f.c.memberPetPath, f.c.homeDataFile, f.c.filePath]) assert.equal(f.h.persist().disk[path], before.disk[path]); assert(!f.c.manualResetSessions['PROD:master']); f.choose(); f.call('1삭제'); assert.equal(f.read('member_pet.json').a.miniPetBag.length, 10); }
    });
    test('확인 때 변경된 프리미엄·신규 가방 데이터에 최신 기준 적용', () => {
        const f = createTextFixture(); f.choose(); const data = f.h.read(); data.member.a.pass.premium = { enabled: true, permanent: true }; f.h.write(data);
        const read = f.c.loadJsonFile; f.c.loadJsonFile = p => { const value = read(p); if (p === f.c.memberPetPath) for (let i = 0; i < 4; i++) value.a.miniPetBag.push({ name: 'latest' + i, grade: '고급', battleExp: 9999 }); return value; };
        f.call('1삭제'); assert.equal(f.read('member_pet.json').a.miniPetBag.length, 15); assert(f.read('member_pet.json').a.miniPetBag.some(x => x.name === 'latest0')); assert.equal(f.read('home.json').a.furnitureBag.length, 14);
    });
    test('DEV 확인은 DEV 두 파일만 정리하며 운영 대기를 유지', () => {
        const f = createTextFixture(); f.choose(); f.choose('master', 'test', true); const before = f.h.persist(); f.call('dev/1삭제');
        for (const [path, value] of Object.entries(before.disk)) if (path.startsWith(f.c.DATA_ROOT_PATH)) assert.equal(f.h.persist().disk[path], value);
        assert.equal(f.read('member_pet.json', true).a.miniPetBag.length, 10); assert(f.c.manualResetSessions['PROD:master']); f.call('1삭제'); assert.equal(f.read('member_pet.json').a.miniPetBag.length, 10);
    });
    test('정리 대상 0건 재실행은 저장하지 않고 수량 불일치도 무저장', () => {
        const f = createTextFixture(); f.choose(); f.call('1삭제'); const before = f.h.persist(); let saves = 0; const save = f.c.saveJsonFile; f.c.saveJsonFile = (...args) => { saves++; return save(...args); }; f.choose(); assert(f.call('1삭제').replies[0].includes('초과 데이터가 없습니다')); assert.equal(saves, 0); assert.deepStrictEqual(f.h.persist(), before);
        const broken = createTextFixture(); broken.choose(); broken.c.countAllMiniPetBagItems = () => 0; const saved = broken.h.persist(); assert(broken.call('1삭제').replies[0].includes('수량이 일치하지 않아')); assert.deepStrictEqual(broken.h.persist(), saved);
    });
    test('새 메뉴에서 필터·글자수 차단 문구가 있어도 확인 실행 가능, Info 중복 처리 없음', () => {
        const f = createTextFixture(); f.c.setMessageFilterCache(['초기화', '정리', '삭제'], 'PROD', true); f.choose(); f.call('1삭제'); assert.equal(f.read('member_pet.json').a.miniPetBag.length, 10);
        const start = f.h.info.indexOf('if (getMessageFilterRequest(msg))'), end = f.h.info.indexOf('if (ctx.isDev) {', start), c = { getMessageFilterRequest: () => null, containsMessageFilterWord: () => { throw Error('must skip'); }, getCachedMessageFilterWords: () => { throw Error('must skip'); } }; vm.createContext(c); vm.runInContext('function probe(msg){var ctx={isDev:false};' + f.h.info.slice(start, end) + 'return "passed";}', c); for (const msg of ['/초기화', '/글자수전체정리', '/필터데이터정리', '31', '1삭제', '2취소']) assert.equal(c.probe(msg), undefined);
    });
    test('정리 계산·필터 정리·원래 실행 분기와 모든 후속 게임 본문은 운영 기준과 동일', () => {
        const f = createTextFixture(); for (const name of helperNames.filter(x => x !== 'isAdmin').concat('cleanupMessageFilterData')) assert.equal(f.h.block(f.h.main, 'function ' + name + '('), f.h.block(baseline, 'function ' + name + '('));
        for (const marker of ['if (msg === "/필터데이터정리") {', 'if (msg === "/글자수전체정리") {', 'if (msg == "/미니펫전체정리") {', 'if (msg == "/가구전체정리") {', 'if (msg === "/펜던트전체정리") {']) assert.equal(f.h.block(f.h.main, marker), f.h.block(baseline, marker));
        const start = '// 확인 응답도 원래 명령의 출석·정지·대전·장소 검사를 통과하도록 연결한다.', end = '///////////////////////////////////////////////////////////////////////////////////////////////'; assert.equal(f.h.main.slice(f.h.main.indexOf(start), f.h.main.indexOf(end, f.h.main.indexOf(start))), baseline.slice(baseline.indexOf(start), baseline.indexOf(end, baseline.indexOf(start))));
    });
    console.log('PASS reset cleanup menu: ' + count + ' groups (synthetic only; original entry/cleanup/save branches)');
}
if (require.main === module) runTests();
module.exports = { createTextFixture, helperNames };
