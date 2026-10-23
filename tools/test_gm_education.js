const assert = require('assert'), vm = require('vm');
const marble = require('./test_guild_marble'), spirit = require('./test_spirit_retirement');
const main = marble.main, info = spirit.info;
const core = main.slice(main.indexOf('// 교육 명령의 조회 인자'), main.indexOf('// 길드마블의 실행 명령'));
const recovery = main.slice(main.indexOf('        // 교육 지급 영수증을 기준으로'), main.indexOf('        // 중단된 두 파일 게시를 다른 회원 변경보다'));
const entry = main.slice(main.indexOf('        var gmEducationRequest ='), main.indexOf('        if (msg === "/정령컨텐츠보상")'));
assert(core && recovery && entry);
// 실제 교육·권한·저장·응답 함수를 합성 계정과 메모리 파일로 연결하는 함수
function createHarness() {
    const h = marble.createHarness(), { f, c } = h;
    vm.runInContext(core, c);
    for (const name of ['isMaster', 'requireSpiritRetirementCount', 'normalizePendantTransitionItemName', 'normalizeUniversalCollectionKeyBagItems', 'normalizePendantTransitionBagItem', 'addItemToBag']) vm.runInContext(spirit.block(main, 'function ' + name + '('), c);
    vm.runInContext(`function runGm(message,user,where){var msg=isDevCommandMessage(message)?stripDevCommandPrefix(message):message,sender=user||'master',room=where||testRoom;
var previous=enterCommandContext(createCommandContext(isDevCommandMessage(message),room));beginDataSaveTransaction();try{${recovery}var data=loadJsonFile(filePath);${entry}}
catch(error){rollbackDataSaveTransaction();throw error;}finally{endDataSaveTransaction();exitCommandContext(previous);}}`, c);
    // 운영 스냅샷과 무관한 교육 전 계정을 만드는 함수
    function seed(noIds = false) {
        h.seed({ noIds }); c.Master = ['master', 'gm'];
        for (const root of [c.DATA_ROOT_PATH, c.DEV_DATA_ROOT_PATH]) {
            const data = f.get(root + 'member.json'); data.member['공백 이름 여'] = JSON.parse(JSON.stringify(data.member.a));
            if (!noIds) data.member['공백 이름 여'].serverRaidAccount.id = 'space-id';
            data.member['1'] = JSON.parse(JSON.stringify(data.member.b)); if (!noIds) data.member['1'].serverRaidAccount.id = 'numeric-id';
            f.put(root + 'member.json', data);
        }
        f.clear();
    }
    const run = (text, user = 'master', dev = false, room) => { f.clear(); c.runGm(dev ? 'dev/' + text.slice(1) : text, user, room); assert.equal(c.getDataSaveTransaction(), null); return f.replies().join('\n'); };
    const paths = dev => ({ member: (dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + 'member.json', store: (dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + c.GLOBAL_CONFIG.gmEducation.fileName, pending: (dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH) + c.GLOBAL_CONFIG.gmEducation.pendingName });
    const store = (dev = false) => { const p = paths(dev).store; return f.raw(p) === undefined ? { version: 1, users: {} } : f.get(p); };
    return { ...h, seed, run, paths, store };
}
// 요구사항과 중단 경계를 독립 시나리오로 검증하는 함수
function runTests() {
    const h = createHarness(), { f, c, seed, run, paths, store } = h;
    const p = paths(false), reward = c.GLOBAL_CONFIG.gmEducation.rewardItem;
    let groups = 0;
    const saves = () => f.traces().filter(t => t.type === 'save');
    function group(name, check) { seed(); check(); console.log('PASS GM ' + (++groups) + ': ' + name); }
    group('MASTER·허용 방만 교육 명령 사용·일반/Admin·금지 방 무변경', () => {
        const before = f.files();
        for (const user of ['a', 'sub']) for (const msg of ['/교육', '/교육 a', '/교육 1', '/교육실적 전체', '/교육완료 a 1']) assert(run(msg, user).includes('MASTER'));
        assert(run('/교육완료 a 1', 'master', false, 'forbidden').includes('MASTER')); assert.deepEqual(f.files(), before);
    });
    group('신규 0/10·10매뉴얼·안내·빈 실적은 무저장·순서 자동 변경 없음', () => {
        assert(run('/교육 a').includes('0/10')); assert(run('/교육').includes('1→10'));
        for (let chapter = 1; chapter <= 10; chapter++) { const text = run('/교육 ' + chapter); assert(text.includes(chapter + '/10')); assert(text.includes('다이아상자💎(소) 1개')); assert.equal(text.split('<ALLSEE>').length - 1, 1); assert(text.includes('GM 확인')); assert.equal(saves().length, 0); }
        assert(run('/교육실적').includes('아직 교육 실적')); assert(!run('/교육실적 전체').includes('<ALLSEE>')); assert.equal(f.raw(p.store), undefined); assert.equal(f.raw(p.pending), undefined);
    });
    group('정수1~10·필수 챕터·추가 문구·명령 접미 거부·공백 닉네임 정확 해석', () => {
        const before = f.files();
        for (const text of ['/교육완료 a', '/교육완료 a 0', '/교육완료 a 11', '/교육완료 a 1.5', '/교육완료 a -1', '/교육완료 a 1 해봐', '/교육완료 a 01', '/교육완료 a NaN', '/교육완료 a 1\n']) { run(text); assert.equal(saves().length, 0); }
        run('/교육완료방법 a 1'); assert.deepEqual(f.files(), before);
        assert(run('/교육완료 공백 이름 여 1').includes('1/10')); assert.equal(f.read().member['공백 이름 여'].bag[reward], 1); assert(!f.read().member.a.bag[reward]);
    });
    group('건너뛰기·없는 유저는 무지급·다음 챕터 안내·현재 기록 유지', () => {
        const before = f.files(); assert(run('/교육완료 a 2').includes('1챕터를 먼저')); assert(run('/교육완료 없는 유저 1').includes('찾을 수 없습니다')); assert.deepEqual(f.files(), before);
        run('/교육완료 a 1'); const once = f.files(); assert(run('/교육완료 a 3').includes('2챕터를 먼저')); assert.deepEqual(f.files(), once);
    });
    group('순차 10개 지급·수료 추가보상0·반복 재지급/재실적0·모든 타 재화 유지', () => {
        const before = f.read(); for (let chapter = 1; chapter <= 10; chapter++) { const text = run('/교육완료 a ' + chapter); assert(text.includes(chapter + '/10')); assert.equal(f.read().member.a.bag[reward], chapter); }
        assert(run('/교육 a').includes('🎓')); assert(run('/교육실적').includes('10회')); const snapshot = f.files();
        for (let chapter = 1; chapter <= 10; chapter++) assert(run('/교육완료 a ' + chapter, 'gm').includes('이미 완료')); assert.deepEqual(f.files(), snapshot);
        const after = f.read(); assert.equal(after.member.a.point, before.member.a.point); assert.equal(after.member.a.gmEducationRewards.length, 10); assert.equal(Object.values(store().users)[0].chapters.length, 10);
    });
    group('GM 교대·동률 공동순위·교육 인원 중복 제외·완료한 담당 챕터만 집계', () => {
        run('/교육완료 a 1'); run('/교육완료 a 2', 'gm'); run('/교육완료 b 1'); run('/교육완료 b 2', 'gm');
        const own = run('/교육실적 gm'); assert(own.includes('2회')); assert(own.includes('2명')); assert(own.includes('2챕터'));
        const all = run('/교육실적 전체'); assert(all.includes('전체 교육 인원: 2명')); assert(all.includes('진행 중: 2명')); assert(all.includes('완료 챕터: 4회')); assert.equal((all.match(/공동 1등/g) || []).length, 4);
        assert(run('/교육실적 c').includes('아직 교육 실적')); assert(run('/교육실적 no-such-GM').includes('찾을 수 없습니다')); assert.equal(saves().length, 0);
    });
    group('기존 ID 없는 대상과 GM도 영속 ID 발급·조회는 ID 발급/저장 없음', () => {
        seed(true); run('/교육 a'); assert(!f.read().member.a.serverRaidAccount); assert.equal(saves().length, 0);
        run('/교육완료 a 1'); const first = f.read(); assert(first.member.a.serverRaidAccount.id); assert(first.member.master.serverRaidAccount.id); assert.equal(first.member.a.bag[reward], 1);
        run('/교육완료 a 1'); assert.equal(f.read().member.a.bag[reward], 1); assert.equal(f.read().member.a.serverRaidAccount.id, first.member.a.serverRaidAccount.id);
    });
    group('숫자 계정은 @닉네임/기존 계정 ID로 조회·매뉴얼과 분리', () => {
        const data = f.read(); data.member['@1'] = JSON.parse(JSON.stringify(data.member.c)); data.member['@1'].serverRaidAccount.id = 'at-id'; f.write(data);
        assert(run('/교육 1').includes('시작 안내')); assert(run('/교육 @1').includes('교육 진행: 0/10')); assert(run('/교육 numeric-id').includes('교육 진행: 0/10')); assert.equal(saves().length, 0);
        run('/교육완료 1 1'); assert(run('/교육 @1').includes('1/10')); assert.equal(f.read().member['1'].bag[reward], 1); assert(run('/교육 @@1').includes('0/10'));
    });
    group('대상·GM 닉변 유지·같은 닉네임 신규 계정에 이전 실적/완료 이전 없음', () => {
        run('/교육완료 a 1'); let data = f.read(); data.member.renamed = data.member.a; delete data.member.a; data.member.teacher = data.member.master; delete data.member.master;
        data.member.a = JSON.parse(JSON.stringify(data.member.b)); data.member.a.serverRaidAccount.id = 'replacement'; f.write(data); c.Master = ['teacher', 'gm'];
        assert(run('/교육 renamed', 'teacher').includes('1/10')); assert(run('/교육 a', 'teacher').includes('0/10')); assert(run('/교육실적 teacher', 'teacher').includes('1회'));
        assert(run('/교육완료 renamed 1', 'teacher').includes('이미 완료')); run('/교육완료 renamed 2', 'gm'); assert(run('/교육실적 teacher', 'teacher').includes('1회')); assert(run('/교육실적 gm', 'teacher').includes('1회'));
    });
    group('pending 저장 실패면 지급0·재실행 한 번 지급', () => {
        f.failPath(p.pending); assert(run('/교육완료 a 1').includes('확인 중')); assert(!f.read().member.a.bag[reward]); assert.equal(f.raw(p.pending), undefined); run('/교육완료 a 1'); assert.equal(f.read().member.a.bag[reward], 1);
    });
    group('지급 저장 실패는 완료0·다음 요청에서 원 GM 지급/완료 복구·중복0', () => {
        f.failPath(p.member); assert(run('/교육완료 a 1').includes('확인 중')); assert(!f.read().member.a.bag[reward]); assert.equal(Object.keys(store().users).length, 0); assert(f.get(p.pending));
        run('/교육완료 a 1', 'gm'); assert.equal(f.read().member.a.bag[reward], 1); assert.equal(store().users['$id-a'].chapters[0].gmId, 'id-master'); assert.equal(f.raw(p.pending), undefined);
    });
    group('지급 후 완료 저장 실패는 지급 유지·아이템 사용/GM 교대 뒤도 재지급0', () => {
        f.failPath(p.store); assert(run('/교육완료 a 1').includes('확인 중')); assert.equal(f.read().member.a.bag[reward], 1); const receipt = f.read().member.a.gmEducationRewards[0];
        const data = f.read(); delete data.member.a.bag[reward]; f.write(data); run('/교육완료 a 1', 'gm'); assert(!f.read().member.a.bag[reward]); assert.equal(store().users['$id-a'].chapters[0].txId, receipt); assert.equal(store().users['$id-a'].chapters[0].gmId, 'id-master');
    });
    group('복구 실패 중 다음 챕터는 차단·복구되면 먼저 원 챕터 확정', () => {
        f.failPath(p.member); run('/교육완료 a 1'); f.failPath(p.member); assert.throws(() => run('/교육완료 a 2', 'gm')); assert(!f.read().member.a.bag[reward]); assert.equal(Object.keys(store().users).length, 0);
        run('/교육 a', 'gm'); assert.equal(f.read().member.a.bag[reward], 1); assert.equal(store().users['$id-a'].chapters.length, 1);
    });
    group('복구 중 대상 닉변과 GM 닉변·삭제에도 최초 ID/GM 실적 유지', () => {
        f.failPath(p.store); run('/교육완료 a 1'); let data = f.read(); data.member.renamed = data.member.a; delete data.member.a; delete data.member.master; f.write(data);
        run('/교육 renamed', 'gm'); assert.equal(f.read().member.renamed.bag[reward], 1); assert.equal(store().users['$id-a'].chapters[0].gmId, 'id-master'); assert(run('/교육실적 전체', 'gm').includes('[master]'));
    });
    group('확정 응답 실패는 지급·교육 유지·다시 실행 무저장/재지급0', () => {
        f.replyFail(true); assert.throws(() => run('/교육완료 a 1')); f.replyFail(false); const before = f.files(); run('/교육완료 a 1'); assert.deepEqual(f.files(), before); assert.equal(f.read().member.a.bag[reward], 1);
    });
    group('잘못된 가방·수량·정수초과는 pending/완료/지급 모두 미생성', () => {
        for (const value of [null, [], { [reward]: -1 }, { [reward]: 1.5 }, { [reward]: '1' }, { [reward]: 9007199254740991 }]) { seed(); const data = f.read(); data.member.a.bag = value; f.write(data); const before = f.files(); assert.throws(() => run('/교육완료 a 1')); assert.deepEqual(f.files(), before); }
    });
    group('손상된 교육 JSON·완료/영수증·pending은 빈 데이터로 덮지 않고 오류', () => {
        run('/교육완료 a 1'); let bad = store(); bad.users['$id-a'].chapters[0].chapter = 2; f.put(p.store, bad); const before = f.files(); assert.throws(() => run('/교육 a')); assert.deepEqual(f.files(), before);
        seed(); run('/교육완료 a 1'); let data = f.read(); data.member.a.gmEducationRewards[0] = 'wrong'; f.write(data); assert.throws(() => run('/교육 a')); assert.equal(saves().length, 0);
        seed(); f.put(p.pending, { version: 9 }); const raw = f.files(); assert.throws(() => run('/교육 a')); assert.deepEqual(f.files(), raw);
    });
    group('DEV의 완료·복구·실적은 PROD 회원/교육/가방 무변경', () => {
        const prod = f.raw(p.member); f.failPath(paths(true).store); run('/교육완료 a 1', 'master', true); run('/교육 a', 'gm', true);
        assert.equal(f.raw(p.member), prod); assert.equal(f.raw(p.store), undefined); assert.equal(f.get(paths(true).member).member.a.bag[reward], 1); assert.equal(store(true).users['$id-a'].chapters.length, 1);
    });
    group('확정 후 진행/실적/매뉴얼 반복 조회 0저장', () => {
        run('/교육완료 a 1'); const before = f.files(); for (let n = 0; n < 5; n++) for (const text of ['/교육 a', '/교육 10', '/교육실적', '/교육실적 전체']) { run(text); assert.equal(saves().length, 0); } assert.deepEqual(f.files(), before);
    });
    group('Info와 Main 검증·진행 함수 동일·0/부분/수료/복구중 영수증 표시 일치', () => {
        for (const name of ['requireGmEducationStore', 'getGmEducationProgress']) assert.equal(spirit.block(main, 'function ' + name + '('), spirit.block(info, 'function ' + name + '(').replace(/\r\n/g, '\n'));
        const query = {}; vm.createContext(query); for (const name of ['requireGmEducationStore', 'getGmEducationProgress']) vm.runInContext(spirit.block(info, 'function ' + name + '('), query);
        assert.equal(query.getGmEducationProgress(store(), f.read().member.a), 0); run('/교육완료 a 1'); assert.equal(query.getGmEducationProgress(store(), f.read().member.a), 1);
        f.failPath(p.store); run('/교육완료 a 2'); assert.equal(query.getGmEducationProgress(store(), f.read().member.a, true), 1); run('/교육 a');
        for (let n = 3; n <= 10; n++) run('/교육완료 a ' + n); assert.equal(query.getGmEducationProgress(store(), f.read().member.a), 10);
    });
    group('교육 완료 잠금 분류·실제 기본7인수 응답의 권한/지급/반복 유지', () => {
        assert(c.isExclusiveDataMutationCommandMessage('/교육완료 a 1')); assert(c.isExclusiveDataMutationCommandMessage('dev/교육완료 a 1'));
        const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } }); c.commandDataFlowLock = { readLock: lock, writeLock: lock }; c.autoDailyQuestInternalDepth = 0; c.isMasterIdentity = u => ['master','gm'].includes(u);
        c.errorLogPath = '/synthetic/error.json'; c.FileStream.write = (_p, t) => { throw Error(t); };
        c.response(c.testRoom, '/교육완료 a 1', 'master', true, c.replier, null, 'com.kakao.talk'); assert.equal(f.read().member.a.bag[reward], 1); const before = f.files();
        c.response(c.testRoom, '/교육완료 a 1', 'gm', true, c.replier, null, 'com.kakao.talk'); assert.deepEqual(f.files(), before);
    });
    group('실제 내정보 분기: 레벨 다음 한 줄·0/부분/수료·캐시 갱신·반복 교육읽기0/저장0', () => {
        const profile = spirit.block(info, 'if (msg === "/내정보") {'); let educationReads = 0;
        const query = { GLOBAL_CONFIG: { gmEducation: c.GLOBAL_CONFIG.gmEducation }, DATA_ROOT_PATH: c.DATA_ROOT_PATH, gmEducationInfoCache: {},
            java: { io: { File: function (path) { this.exists = () => f.raw(path) !== undefined; this.lastModified = () => 1; this.length = () => (f.raw(path) || '').length; } } },
            resolveActiveDataPath: p => p, loadJsonFile: p => { if (p === paths(false).store) educationReads++; return p === 'home' ? {} : f.get(p); },
            homeDataFile: 'home', initSweetHomeUser: d => d, petData: {}, titleData: {}, petTitleData: {}, guildData: {}, allsee: '<ALLSEE>',
            getHomeTotalExp: () => 0, getInfoLevelRequiredExperience: () => 1000, getMyGuildInfo: () => null, getTitle: () => '', isInfoSupportPassActive: () => false,
            formatInfoServerRaidServer: (_d, s) => s, getInfoAdventureLevelTitle: () => '모험가', checkRank: (_d, _p, _g, u) => u, formatDate: () => 'joined', numberWithCommas: String,
            formatInfoAdventureExperience: String, getHomeLikeRank: () => 1, getCarrotRank: () => 1, getThermoRank: () => 1, replier: { reply: text => query.output = text } };
        vm.createContext(query); for (const name of ['requireGmEducationStore','getGmEducationProgress']) vm.runInContext(spirit.block(info,'function '+name+'('),query);
        vm.runInContext('function profile(data,sender){var msg="/내정보";' + profile + '}', query);
        query.profile(f.read(),'a'); assert(query.output.includes('• 레벨: 1\n• 호월 교육: 📚 0/10 · 다음 1챕터\n• 가입일:'));
        run('/교육완료 a 1'); query.profile(f.read(),'a'); assert(query.output.includes('📚 1/10 · 다음 2챕터')); assert.equal(educationReads,1);
        for(let n=0;n<5;n++)query.profile(f.read(),'a'); assert.equal(educationReads,1);
        for(let n=2;n<=10;n++)run('/교육완료 a '+n); const before=f.files(); query.profile(f.read(),'a'); assert(query.output.includes('🎓 수료 · 10/10')); assert.equal(educationReads,2); assert.deepEqual(f.files(),before);
        assert(query.output.includes('보유 포인트')); assert(query.output.includes('다이아💎')); assert(query.output.includes('내정보 상세보기'));
    });
    group('분리 회원에서도 교육 지급·복구가 레이드/운영 로그 슬롯 무변경', () => {
        c.java.io.File.prototype.getName=function(){return this.path.split('/').pop();}; c.java.io.File.prototype.lastModified=()=>0;
        c.MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000; c.java.lang.String=function(v){this.getBytes=()=>Buffer.from(String(v),'utf8');};
        c.getManagedJsonBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back.json'):null;
        c.getManagedJsonSecondaryBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back2.json'):null;
        vm.runInContext(f.block(main,'const MEMBER_STORAGE_SPLIT_CONFIG = {')+';this.MEMBER_STORAGE_SPLIT_CONFIG=MEMBER_STORAGE_SPLIT_CONFIG;var memberSplitBackupCache={};',c);
        for(const n of ['getMemberSplitMarker','getMemberSplitStorePath','getMemberSplitBackupPath','requireMemberSplitStore','readMemberSplitStore','readPublishedMemberSplitStore','buildMemberSplitRaidSummary','attachMemberSplitStores','buildMemberSplitSavePlan','stringifyMemberSplitStore','preserveMemberSplitBackupStores','createMemberSplitMigrationStores','isProtectedManagedJsonPath','parseManagedJsonContent','loadJsonFile'])vm.runInContext(f.block(main,'function '+n+'('),c);
        const data=f.read(), key=c.MEMBER_STORAGE_SPLIT_CONFIG.key; data.serverRaid=JSON.parse(JSON.stringify(c.createServerRaidState('synthetic')));
        for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)data[log]=[{keep:true}];
        const marker={version:c.MEMBER_STORAGE_SPLIT_CONFIG.version,id:'gm-split',phase:'COMPLETE',raidRevision:0,logsRevision:0};
        const slots=c.createMemberSplitMigrationStores(data,marker); f.put(c.getMemberSplitStorePath('raid',0),slots.raid); f.put(c.getMemberSplitStorePath('logs',0),slots.logs);
        for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)delete data[log]; data.serverRaid=c.buildMemberSplitRaidSummary(data.serverRaid); data.migrations={[key]:marker}; f.write(data);
        const raid=f.raw(c.getMemberSplitStorePath('raid',0)),logs=f.raw(c.getMemberSplitStorePath('logs',0));
        run('/교육완료 a 1'); f.failPath(p.store); run('/교육완료 a 2'); run('/교육 a','gm'); assert.equal(f.read().member.a.bag[reward],2);
        assert.equal(f.raw(c.getMemberSplitStorePath('raid',0)),raid); assert.equal(f.raw(c.getMemberSplitStorePath('logs',0)),logs); assert.deepEqual(f.read().migrations[key],marker);
    });
    console.log('PASS GM education: ' + groups + ' requirement/exception groups; synthetic only');
}
module.exports = { main, info, core, recovery, entry, createHarness };
if (require.main === module) runTests();
