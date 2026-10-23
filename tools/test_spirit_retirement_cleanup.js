const assert = require('assert'), vm = require('vm');
const spirit = require('./test_spirit_retirement'), marble = require('./test_guild_marble');
const h = marble.createHarness(), { f, c } = h;
c.itemInfoData = spirit.itemInfo; c.isMaster = user => user === 'master';
for (const name of spirit.helpers) vm.runInContext(spirit.block(spirit.main, 'function ' + name + '('), c);
vm.runInContext(`function runSpirit(command,user){var ctx=createCommandContext(isDevCommandMessage(command),'table'),prior=enterCommandContext(ctx),sender=user||'master',msg=ctx.isDev?stripDevCommandPrefix(command):command;beginDataSaveTransaction();try{var data=loadJsonFile(filePath);${spirit.command}}catch(error){rollbackDataSaveTransaction();throw error;}finally{endDataSaveTransaction();exitCommandContext(prior);}}`, c);
let groups = 0;
// 실제 저장 함수에 전달할 비식별 회원과 정령·기타 장착 데이터를 준비하는 함수
function seed(noIds = false) {
    h.seed({ noIds });
    for (const root of [c.DATA_ROOT_PATH, c.DEV_DATA_ROOT_PATH]) {
        const data = f.get(root + 'member.json');
        data.member.a.bag.keep = 7; data.member.a.bag[c.GLOBAL_CONFIG.spiritRetirement.removedItem] = 5;
        data.member.a.spiritCharm = { castleExp: 3, raidExp: 4 }; f.put(root + 'member.json', data);
        f.put(root + 'member_pet.json', { a: { elemental: { name: 'original-a', grade: '정령왕', upgrade: 80 }, petexp: 333, ring: { keep: true }, miniPet: { battleExp: 20 } }, b: { elemental: { name: 'original-b', grade: '정령왕', upgrade: 1 }, petexp: 777 } });
    }
    f.clear();
}
// 명령의 실제 진입부와 저장 트랜잭션을 실행하는 함수
function run(dev = false, user = 'master', command = '/정령컨텐츠보상') {
    f.clear(); c.runSpirit(dev ? 'dev/' + command.slice(1) : command, user);
    assert.equal(c.getDataSaveTransaction(), null); assert.equal(c.commandContextThreadLocal.get(), null);
    return f.replies().join('\n');
}
// 정리 기능 도입 전 이미 지급한 원본 백업·완료 기록 상태를 만드는 함수
function legacy(dev = false, noIds = false) {
    seed(noIds); const root = dev ? c.DEV_DATA_ROOT_PATH : c.DATA_ROOT_PATH;
    const data = f.get(root + 'member.json'), pets = f.get(root + 'member_pet.json'), config = c.GLOBAL_CONFIG.spiritRetirement;
    const backup = JSON.parse(JSON.stringify({ memberData: data, petData: pets })), plan = c.buildSpiritRetirementPlan(data, pets);
    plan.backupPath = root + config.backupPrefix + 'legacy.json'; f.put(plan.backupPath, backup);
    c.applySpiritRetirementPlan(data, plan); f.put(root + 'member.json', data);
    return { root, data, pets, backupPath: plan.backupPath, plan };
}
// 독립된 정리·실패·재시도 시나리오를 실행하는 함수
function group(name, test) { seed(); test(); console.log('PASS spirit cleanup ' + (++groups) + ': ' + name); }
const memberPath = c.filePath, petPath = c.memberPetPath, config = c.GLOBAL_CONFIG.spiritRetirement;
group('신규 지급 후 원본만 삭제·아이템/매력/다른 펫/포인트/완료 기록 보존', () => {
    const before = f.get(petPath), points = f.read().member.a.point, bytes = Buffer.byteLength(JSON.stringify(before));
    const text = run(); const data = f.read(), pets = f.get(petPath);
    assert(text.includes('원본 2명 정리 완료')); assert.equal(data.member.a.bag[config.castleItem], 9200); assert.equal(data.member.a.bag[config.raidItem], 12000);
    assert.equal(data.member.a.bag.keep, 7); assert.equal(data.member.a.bag[config.removedItem], undefined); assert.equal(data.member.a.point, points);
    assert.deepEqual(data.member.a.spiritCharm, { castleExp: 3, raidExp: 4 }); assert.equal(data[config.ledgerKey].status, 'COMPLETE');
    for (const name of ['a', 'b']) { delete before[name].elemental; assert.deepEqual(pets[name], before[name]); }
    assert(Buffer.byteLength(JSON.stringify(pets)) < bytes);
    const backup = f.get(data[config.ledgerKey].backupPath); assert(backup.petData.a.elemental); assert(!backup.memberData[config.ledgerKey]);
});
group('기지급 후 아이템 일부/전량 사용해도 재지급 없이 정리·회원 원문 무저장', () => {
    const { root, data } = legacy(); c.openSpiritCharmItem(data, 'a', { mode: 'raidExp', count: 12000 }); data.member.a.bag[config.castleItem] -= 100;
    f.put(root + 'member.json', data); const before = f.raw(memberPath), backup = data[config.ledgerKey].backupPath;
    assert(run().includes('다시 지급하지 않았습니다')); assert.equal(f.raw(memberPath), before); assert.equal(f.get(petPath).a.elemental, undefined);
    assert(f.traces().filter(row => row.type === 'save').every(row => row.path === petPath || row.path === petPath + '.bak'));
    assert.equal(f.read()[config.ledgerKey].backupPath, backup);
});
group('정리 완료 후 반복 실행은 회원/펫/백업 모두 무저장', () => {
    run(); const before = f.files(); assert(run().includes('이미 완료')); assert.deepEqual(f.files(), before); assert.equal(f.traces().filter(row => row.type === 'save').length, 0);
    run(); assert.deepEqual(f.files(), before);
});
group('백업 또는 지급 저장 실패는 원본 보존·다시 실행해 정확히 한 번 지급', () => {
    for (const target of ['backup', 'member']) {
        seed(); const before = f.raw(memberPath), pets = f.raw(petPath);
        f.failPath(target === 'backup' ? c.DATA_ROOT_PATH + config.backupPrefix + 'uuid-1.json' : memberPath);
        assert.throws(() => run()); assert.equal(f.raw(memberPath), before); assert.equal(f.raw(petPath), pets);
        run(); assert.equal(f.read().member.a.bag[config.castleItem], 9200); assert.equal(f.get(petPath).a.elemental, undefined);
    }
});
group('지급 확정 뒤 정리 저장 실패는 지급 유지·다음 실행은 정리만·재지급0', () => {
    const pets = f.raw(petPath); f.failPath(petPath); assert.throws(() => run());
    const afterGrant = f.raw(memberPath); assert.equal(f.read().member.a.bag[config.castleItem], 9200); assert.equal(f.read()[config.ledgerKey].status, 'COMPLETE'); assert.equal(f.raw(petPath), pets);
    run(); assert.equal(f.raw(memberPath), afterGrant); assert.equal(f.get(petPath).a.elemental, undefined); assert.equal(f.read().member.a.bag[config.castleItem], 9200);
});
group('기지급 정리 저장 실패와 완료 응답 실패도 다음 실행에서 재지급하지 않음', () => {
    legacy(); const member = f.raw(memberPath), pets = f.raw(petPath); f.failPath(petPath); assert.throws(() => run()); assert.equal(f.raw(memberPath), member); assert.equal(f.raw(petPath), pets);
    f.replyFail(true); assert.throws(() => run()); assert.equal(f.raw(memberPath), member); assert.equal(f.get(petPath).a.elemental, undefined); f.replyFail(false); run(); assert.equal(f.raw(memberPath), member);
    seed(); f.replyFail(true); assert.throws(() => run()); const first = f.raw(memberPath); assert.equal(f.read().member.a.bag[config.castleItem], 9200); assert.equal(f.get(petPath).a.elemental, undefined); f.replyFail(false); run(); assert.equal(f.raw(memberPath), first);
});
group('누락/잘못된 백업·상세 지급 기록 변조·잘못된 완료 표시는 무삭제·무지급', () => {
    for (const type of ['missing', 'backup', 'record', 'status', 'version', 'path']) {
        const { data, backupPath } = legacy();
        if (type === 'missing') new c.java.io.File(backupPath).delete();
        if (type === 'backup') { const b = f.get(backupPath); b.petData.a.elemental.upgrade++; f.put(backupPath, b); }
        if (type === 'record') data[config.ledgerKey].users[0].castle++;
        if (type === 'status') data[config.ledgerKey].status = 'PENDING';
        if (type === 'version') data[config.ledgerKey].version++;
        if (type === 'path') data[config.ledgerKey].backupPath = c.DEV_DATA_ROOT_PATH + config.backupPrefix + 'legacy.json';
        f.put(memberPath, data); const before = f.raw(memberPath), pets = f.raw(petPath);
        assert.throws(() => run()); assert.equal(f.raw(memberPath), before); assert.equal(f.raw(petPath), pets); assert.equal(f.traces().filter(row => row.type === 'save').length, 0);
    }
});
group('기존 계정 ID의 닉변은 정리·같은 닉네임 다른 계정과 변경 원본은 보존', () => {
    legacy(); let data = f.read(), pets = f.get(petPath); data.member.renamed = data.member.a; delete data.member.a; pets.renamed = pets.a; delete pets.a;
    f.put(memberPath, data); f.put(petPath, pets); const before = f.raw(memberPath); run(); assert.equal(f.get(petPath).renamed.elemental, undefined); assert.equal(f.raw(memberPath), before);
    legacy(); data = f.read(); pets = f.get(petPath); data.member.a.serverRaidAccount.id = 'replacement'; pets.b.elemental.upgrade++;
    f.put(memberPath, data); f.put(petPath, pets); const snapshot = f.files(); assert(run().includes('2건은 보존')); assert.deepEqual(f.files(), snapshot);
});
group('ID 없는 기존 계정은 이름·원본 일치만 정리·확인 불가 닉변/추가 정령은 보존', () => {
    legacy(false, true); run(); assert.equal(f.get(petPath).a.elemental, undefined);
    legacy(false, true); const data = f.read(), pets = f.get(petPath); data.member.renamed = data.member.a; delete data.member.a; pets.renamed = pets.a; delete pets.a;
    pets.unpaid = { elemental: { grade: '정령왕', upgrade: 80 } }; f.put(memberPath, data); f.put(petPath, pets);
    const member = f.raw(memberPath); assert(run().includes('2건은 보존')); const result = f.get(petPath); assert(result.renamed.elemental); assert(result.unpaid.elemental); assert(!result.b.elemental); assert.equal(f.raw(memberPath), member);
});
group('DEV 신규·기지급 정리·백업은 PROD 무변경', () => {
    for (const already of [false, true]) {
        if (already) legacy(true); else seed(); const prod = Object.fromEntries(Object.entries(f.files()).filter(([p]) => p.startsWith(c.DATA_ROOT_PATH)));
        run(true); assert.equal(f.get(c.DEV_DATA_ROOT_PATH + 'member_pet.json').a.elemental, undefined); assert.equal(f.get(c.DEV_DATA_ROOT_PATH + 'member.json').member.a.bag[config.castleItem], 9200);
        assert.deepEqual(Object.fromEntries(Object.entries(f.files()).filter(([p]) => p.startsWith(c.DATA_ROOT_PATH))), prod);
    }
});
group('MASTER 이외·접미 명령은 신규 보상과 기지급 정리 모두 무변경', () => {
    for (const already of [false, true]) {
        if (already) legacy(); else seed(); const before = f.files();
        for (const user of ['a', 'sub', 'gm']) run(false, user); run(false, 'master', '/정령컨텐츠보상 설명'); assert.deepEqual(f.files(), before);
    }
});
group('실제 기본 7인수 응답으로 신규/기지급 정리와 반복 무저장 확인', () => {
    const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } }); c.commandDataFlowLock = { readLock: lock, writeLock: lock };
    c.autoDailyQuestInternalDepth = 0; c.isMasterIdentity = user => user === 'master'; c.errorLogPath = '/synthetic/error.json'; c.FileStream.write = (_p, text) => { throw Error(text); };
    for (const already of [false, true]) {
        if (already) legacy(); else seed(); c.response('table', '/정령컨텐츠보상', 'master', true, c.replier, null, 'com.kakao.talk'); assert(!f.get(petPath).a.elemental); const before = f.files(); f.clear();
        c.response('table', '/정령컨텐츠보상', 'master', true, c.replier, null, 'com.kakao.talk'); assert.deepEqual(f.files(), before); assert.equal(f.traces().filter(row => row.type === 'save').length, 0);
    }
});
group('분리 회원 파일 신규 지급·기지급 정리는 레이드/운영 로그 슬롯과 분리 버전 유지', () => {
    c.java.io.File.prototype.getName = function () { return this.path.split('/').pop(); }; c.java.io.File.prototype.lastModified = () => 0;
    c.MANAGED_BACKUP_SECONDARY_ROTATION_MS = 86400000; c.java.lang.String = function (v) { this.getBytes = () => Buffer.from(String(v), 'utf8'); };
    c.getManagedJsonBackupPath = p => p.endsWith('/member.json') ? p.replace(/member\.json$/, 'member_back.json') : null;
    c.getManagedJsonSecondaryBackupPath = p => p.endsWith('/member.json') ? p.replace(/member\.json$/, 'member_back2.json') : null;
    vm.runInContext(f.block(spirit.main, 'const MEMBER_STORAGE_SPLIT_CONFIG = {') + ';this.MEMBER_STORAGE_SPLIT_CONFIG=MEMBER_STORAGE_SPLIT_CONFIG;var memberSplitBackupCache={};', c);
    for (const name of ['getMemberSplitMarker', 'getMemberSplitStorePath', 'getMemberSplitBackupPath', 'requireMemberSplitStore', 'readMemberSplitStore', 'readPublishedMemberSplitStore', 'buildMemberSplitRaidSummary', 'attachMemberSplitStores', 'buildMemberSplitSavePlan', 'stringifyMemberSplitStore', 'preserveMemberSplitBackupStores', 'createMemberSplitMigrationStores', 'isProtectedManagedJsonPath', 'parseManagedJsonContent', 'loadJsonFile']) vm.runInContext(f.block(spirit.main, 'function ' + name + '('), c);
    const data = f.read(), key = c.MEMBER_STORAGE_SPLIT_CONFIG.key;
    data.serverRaid = JSON.parse(JSON.stringify(c.createServerRaidState('synthetic')));
    for (const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) data[log] = [{ keep: true }];
    const marker = { version: c.MEMBER_STORAGE_SPLIT_CONFIG.version, id: 'spirit-split', phase: 'COMPLETE', raidRevision: 0, logsRevision: 0 };
    const slots = c.createMemberSplitMigrationStores(data, marker);
    f.put(c.getMemberSplitStorePath('raid', 0), slots.raid); f.put(c.getMemberSplitStorePath('logs', 0), slots.logs);
    for (const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) delete data[log];
    data.serverRaid = c.buildMemberSplitRaidSummary(data.serverRaid); data.migrations = { [key]: marker }; f.write(data);
    const raid = f.raw(c.getMemberSplitStorePath('raid', 0)), logs = f.raw(c.getMemberSplitStorePath('logs', 0));
    run(); assert(!f.get(petPath).a.elemental); assert.equal(f.read().member.a.bag[config.castleItem], 9200);
    const paid = f.raw(memberPath), backup = f.get(f.read()[config.ledgerKey].backupPath);
    f.put(petPath, backup.petData); run(); assert.equal(f.raw(memberPath), paid); assert(!f.get(petPath).a.elemental);
    assert.equal(f.raw(c.getMemberSplitStorePath('raid', 0)), raid); assert.equal(f.raw(c.getMemberSplitStorePath('logs', 0)), logs);
    assert.deepEqual(f.read().migrations[key], marker);
});
console.log('PASS spirit cleanup: ' + groups + ' groups (synthetic accounts and actual save/response branches)');
