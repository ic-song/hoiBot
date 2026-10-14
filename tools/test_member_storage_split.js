const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 실제 명령 진입·저장 함수를 메모리 파일시스템과 합성 계정으로 검증한다.
const harness = fs.readFileSync(path.join(__dirname, "test_server_raid.js"), "utf8");
const fixture = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\ngroup("')) + `
return { c, main, block, run, start, attack, end, tick, read, write, infoContext,
 reset, disk:()=>disk, traces:()=>traces, fail:fn=>{failWrite=fn;}, clear:()=>{traces=[];},
 reload:()=>{c.serverRaidWorkTimers={};timers=new Map();}, now:()=>now, advance:ms=>{now+=ms;}
};`)(require, __dirname);
const { c, main, block, run, start, attack, end, tick } = fixture;
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/", memberPath = root + "member.json";
const clone = v => JSON.parse(JSON.stringify(v));
const native = v => vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify(v)) + ")", c);
const reads = [];
let recoveries = 0, groups = 0;
c.java.io.File.prototype.getName = function () { return this.path.split("/").pop(); };
c.java.io.File.prototype.lastModified = () => fixture.now();
c.java.lang = { String: function (v) { this.getBytes = () => Buffer.from(String(v), "utf8"); } };
c.formatDateTime = d => d.toISOString();
c.MANAGED_BACKUP_SECONDARY_ROTATION_MS = 60000;
c.parseJsonContent = text => vm.runInContext("JSON.parse(" + JSON.stringify(text) + ")", c);
c.getManagedJsonBackupPath = p => p.endsWith("/member.json") ? p.replace(/member\.json$/, "member_back.json") : null;
c.getManagedJsonSecondaryBackupPath = p => p.endsWith("/member.json") ? p.replace(/member\.json$/, "member_back2.json") : null;
c.restoreManagedJsonFromBackup = () => { recoveries++; return null; };
c.FileStream.read = p => { reads.push(p); return fixture.disk()[p]; };
c.FileStream.write = (p, text) => { fixture.disk()[p] = text; };
vm.runInContext(block(main, "const MEMBER_STORAGE_SPLIT_CONFIG = {") + ";this.MEMBER_STORAGE_SPLIT_CONFIG=MEMBER_STORAGE_SPLIT_CONFIG;var memberSplitBackupCache={};", c);
const helpers = ["getMemberSplitMarker", "getMemberSplitStorePath", "getMemberSplitBackupPath", "requireMemberSplitStore", "readMemberSplitStore",
    "readPublishedMemberSplitStore", "buildMemberSplitRaidSummary", "attachMemberSplitStores", "prepareMemberSplitResidualLogRecovery", "buildMemberSplitSavePlan", "writeMemberSplitSlot",
    "preserveMemberSplitBackupStores", "getMemberSplitByteLength", "createMemberSplitMigrationStores", "verifyMemberSplitMigrationSource", "completeMemberSplitMigration",
    "isProtectedManagedJsonPath", "parseManagedJsonContent", "loadJsonFile", "appendPetMusouAutomationLog", "appendGuildTerritoryAutomationDataLog", "appendTerritoryPassAuditLog", "appendTerritoryPassPayoutLogs"];
for (const name of helpers) vm.runInContext(block(main, "function " + name + "("), c);
const key = c.MEMBER_STORAGE_SPLIT_CONFIG.key;
const raw = (dev = false) => fixture.read(dev);
const load = (mode, dev = false) => {
    const prior = c.enterCommandContext(c.createCommandContext(dev, dev ? "test" : "room8"));
    try { return c.loadJsonFile(memberPath, mode); } finally { c.exitCommandContext(prior); }
};
function setup() {
    fixture.reset(); c.memberSplitBackupCache = {}; reads.length = 0; recoveries = 0;
    for (const dev of [false, true]) {
        const data = raw(dev);
        data.serverRaid = clone(c.createServerRaidState("old-generation"));
        data.serverRaid.history = [{ id: "past", accounts: { synthetic: { attacks: [{ R: 100000, D: 170000, P: 3000 }], note: "가상".repeat(400) } } }];
        data.serverRaid.eventReceipts = { old: { roundId: "past", accountId: "synthetic" } };
        data.serverRaid.outbox = [{ deliveries: [{ room: "test", sent: true }], text: "합성 완료 공지" }];
        for (const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) data[name] = [{ feature: "SYNTHETIC", result: "OK", detail: "기록".repeat(200) }];
        fixture.write(data, dev);
    }
}
function group(name, fn) { setup(); fn(); console.log("PASS " + (++groups) + ": " + name); }
function cleanup() { return run("/데이터정리", "master", undefined, "test"); }
function migrate(dev = false) { run((dev ? "dev/" : "/") + "데이터정리", "master", undefined, "test"); assert.equal(raw(dev).migrations[key].phase, "COMPLETE"); }
function save(data, dev = false, skip = false) {
    const prior = c.enterCommandContext(c.createCommandContext(dev, dev ? "test" : "room8"));
    try { c.saveJsonFile(data, memberPath, skip); } finally { c.exitCommandContext(prior); }
}
function mutate(fn) { const d = load("raid"); fn(d); save(d); return d; }
function store(kind, dev = false) {
    const m = raw(dev).migrations[key], revision = m[kind + "Revision"];
    return JSON.parse(fixture.disk()[(dev ? devRoot : root) + (kind === "raid" ? "serverRaidData" : "memberOperationLogs") + (revision % 2 ? "_next" : "") + ".json"]);
}

group("마이그레이션 전 기존 저장 형식·기능 유지", () => {
    const d = load(); assert(!d.__memberSplitContext); d.member.a.point++; save(d);
    assert.equal(raw().member.a.point, 1000000001); assert.equal(raw().petMusouAutomationLogs.length, 1);
});
group("실제 /데이터정리 진입: 원본 백업·전체 내용 검증·회원 경량화", () => {
    const before = raw(); migrate(); const after = raw(), m = after.migrations[key];
    assert.deepStrictEqual(after.member, before.member); assert.deepStrictEqual(store("raid").data, before.serverRaid);
    for (const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) { assert(!Object.hasOwn(after, name)); assert.deepStrictEqual(store("logs").data[name], before[name]); }
    assert.deepStrictEqual(JSON.parse(fixture.disk()[m.backupPath]), before);
    assert(after.serverRaid.storageSummary); assert(!after.serverRaid.history);
    assert(Buffer.byteLength(JSON.stringify(after)) < Buffer.byteLength(JSON.stringify(before)));
});
group("재실행은 분리 중복 작업 없이 완료 상태 유지", () => {
    migrate(); const before = clone(fixture.disk()); run("/데이터정리", "admin"); assert.deepStrictEqual(fixture.disk(), before);
});
group("준비·진행·정산 중 마이그레이션 차단", () => {
    for (const state of ["PREP", "ACTIVE", "SETTLING"]) {
        const d = raw(); d.serverRaid.current = { state }; fixture.write(d); const before = clone(fixture.disk());
        assert(cleanup().includes("분리할 수 없습니다")); assert.deepStrictEqual(fixture.disk(), before);
    }
});
group("권한 없는 사용자와 안내 접미 입력은 분리 미실행", () => {
    const before = clone(fixture.disk()); run("/데이터정리", "a"); run("/데이터정리 해봐", "master"); assert.deepStrictEqual(fixture.disk(), before);
});
group("기존 고정 파일 충돌은 원본 변경 전에 중단", () => {
    fixture.disk()[root + "serverRaidData_next.json"] = "foreign"; const before = clone(fixture.disk());
    assert.throws(() => cleanup(), /덮어쓸 수 없습니다/); assert.deepStrictEqual(fixture.disk(), before);
});
group("잘못된 원본 로그 구조는 COPYING 전환 전에 거부", () => {
    const d = raw(); d.petMusouAutomationLogs = {}; fixture.write(d); const before = clone(fixture.disk());
    assert.throws(() => cleanup(), /운영 로그/); assert.deepStrictEqual(fixture.disk(), before);
});
group("잘못된 레이드 공지 구조도 COPYING 전환 전에 거부", () => {
    const d = raw(); d.serverRaid.outbox = [{ deliveries: [null] }]; fixture.write(d); const before = clone(fixture.disk());
    assert.throws(() => cleanup(), /공지 전송/); assert.deepStrictEqual(fixture.disk(), before);
});
for (const target of ["raid", "logs", "publish"]) group(target + " 저장 실패: 원본 유지·일반 변경 차단·재실행 복구", () => {
    const before = raw(); fixture.fail((d, p) => target === "publish" ? p === memberPath && d.migrations?.[key]?.phase === "COMPLETE" : p === root + (target === "raid" ? "serverRaidData.json" : "memberOperationLogs.json"));
    assert.throws(() => cleanup()); const partial = raw();
    assert.equal(partial.migrations[key].phase, "COPYING"); assert.deepStrictEqual(partial.member, before.member); assert.deepStrictEqual(partial.serverRaid, before.serverRaid);
    assert.throws(() => load(), /다시 실행/); assert.equal(recoveries, 0); assert(load("bootstrap").member);
    migrate(); assert.deepStrictEqual(store("raid").data, before.serverRaid);
});
group("분리 로그는 비열거로 연결·기존 기록 함수와 최대 개수 보존", () => {
    migrate(); const d = load(); assert(!Object.keys(d).includes("petMusouAutomationLogs"));
    for (let i = 0; i < 150; i++) c.appendPetMusouAutomationLog(d, native({ index: i })); save(d);
    assert.equal(load().petMusouAutomationLogs.length, c.GLOBAL_CONFIG.petMusou.automationLogMax);
    assert.equal(load().petMusouAutomationLogs.at(-1).index, 149); assert(!Object.hasOwn(raw(), "petMusouAutomationLogs"));
});
group("일반 포인트 저장은 레이드 상세와 로그 버전 무변경", () => {
    migrate(); const before = clone(store("raid")), logs = clone(store("logs")); let d = load(); d.member.a.point++; save(d);
    reads.length = 0; fixture.clear(); d = load(); d.member.a.point++; save(d);
    assert.deepStrictEqual(store("raid"), before); assert.deepStrictEqual(store("logs"), logs);
    assert(!reads.some(p => p.includes("serverRaidData"))); assert(!fixture.traces().some(t => t.type === "save" && /serverRaidData|memberOperationLogs/.test(t.path)));
});
group("파일 없음·손상·잘못된 버전은 기본값/자동 복구 없이 오류", () => {
    migrate(); const p = root + "memberOperationLogs.json", before = fixture.disk()[p];
    for (const bad of [undefined, "{broken", JSON.stringify({ ...JSON.parse(before), version: 99 })]) {
        if (bad === undefined) delete fixture.disk()[p]; else fixture.disk()[p] = bad;
        assert.throws(() => load()); assert.equal(recoveries, 0); assert(load("bootstrap").member); fixture.disk()[p] = before;
    }
    fixture.disk()[root + "serverRaidData.json"] = "bad"; assert.throws(() => load("raid")); assert.equal(recoveries, 0);
});
group("완료 게시 전 새 슬롯이 남아도 이전 공개 버전으로 읽기", () => {
    migrate(); const old = store("raid"); const unpublished = clone(old); unpublished.revision = 1; unpublished.data.sequence = 77;
    fixture.disk()[root + "serverRaidData_next.json"] = JSON.stringify(unpublished);
    assert.equal(load("raid").serverRaid.sequence, old.data.sequence);
});
group("레이드와 로그 동시 변경: 게시 실패 시 두 슬롯과 회원 롤백", () => {
    migrate(); const before = raw(), raid = store("raid"), logs = store("logs"), d = load("raid");
    d.serverRaid.sequence++; d.petMusouAutomationLogs.push(native({ extra: true })); d.member.a.point++;
    fixture.fail((_d, p) => p === memberPath); assert.throws(() => save(d));
    assert.deepStrictEqual(raw(), before); assert.deepStrictEqual(store("raid"), raid); assert.deepStrictEqual(store("logs"), logs);
    assert(!Object.hasOwn(fixture.disk(), root + "serverRaidData_next.json")); assert(!Object.hasOwn(fixture.disk(), root + "memberOperationLogs_next.json"));
});
group("같은 트랜잭션 세 번 저장 후 실패: 덮어쓴 슬롯도 시작 시점 복원", () => {
    migrate(); const before = raw(), raid = store("raid"); const d = load("raid"); c.beginDataSaveTransaction();
    try {
        for (let i = 0; i < 2; i++) { d.serverRaid.sequence++; save(d); }
        fixture.fail((_d, p) => p === memberPath); d.serverRaid.sequence++; assert.throws(() => save(d));
    } finally { c.endDataSaveTransaction(); }
    assert.deepStrictEqual(raw(), before); assert.deepStrictEqual(store("raid"), raid); assert(!Object.hasOwn(fixture.disk(), root + "serverRaidData_next.json"));
});
group("오래된 스냅샷은 현재 공개 슬롯을 덮어쓰지 못함", () => {
    migrate(); const stale = load("raid"); mutate(d => { d.serverRaid.sequence++; }); const before = clone(fixture.disk());
    stale.serverRaid.sequence += 5; assert.throws(() => save(stale), /오래된/); assert.deepStrictEqual(fixture.disk(), before);
});
group("DEV 분리·기록 저장·백업은 PROD 무변경", () => {
    const before = clone(fixture.disk()); migrate(true); const d = load("raid", true); d.serverRaid.sequence++; save(d, true);
    for (const [p, text] of Object.entries(before)) if (p.startsWith(root)) assert.equal(fixture.disk()[p], text);
    assert(raw(true).migrations[key].backupPath.startsWith(devRoot)); assert.equal(store("raid", true).revision, 1);
});
group("실제 레이드 시작·공격·중복 이벤트·종료 정산·재시작", () => {
    migrate(); start(); assert(raw().serverRaid.storageSummary); assert.equal(load("raid").serverRaid.current.state, "ACTIVE");
    const before = raw().member.a.point; attack("a", "unique"); const paid = raw().member.a.point; assert.equal(paid - before, 3000);
    fixture.reload(); attack("a", "unique"); assert.equal(raw().member.a.point, paid);
    end(); const after = raw().member.a.point; end(); assert.equal(raw().member.a.point, after);
    assert(!load("raid").serverRaid.current); assert(load("raid").serverRaid.history.length >= 2); assert(raw().serverRaid.storageSummary);
});
group("Info 기존 잠금·서버 우승 횟수는 얇은 요약으로 유지", () => {
    migrate(); start(); assert(fixture.infoContext.isInfoServerRaidLocked(raw())); end(); assert(!fixture.infoContext.isInfoServerRaidLocked(raw()));
    const d = load("raid"); const server = c.GLOBAL_CONFIG.serverRaid.servers[0]; d.serverRaid.wins[server] = 7; save(d);
    assert(c.formatServerRaidServer(raw(), server).endsWith("⭐7"));
});
group("회원 1차 백업의 동일 버전 분리 파일 보존·직접 복원 후 정확한 읽기", () => {
    migrate(); mutate(d => { d.serverRaid.sequence = 1; }); mutate(d => { d.serverRaid.sequence = 2; }); mutate(d => { d.serverRaid.sequence = 3; });
    const backup = JSON.parse(fixture.disk()[root + "member_back.json"]); assert.equal(backup.migrations[key].raidRevision, 2);
    fixture.disk()[memberPath] = JSON.stringify(backup); assert.equal(load("raid").serverRaid.sequence, 2);
});
group("회원 2차 백업과 분리 2차 백업을 함께 회전", () => {
    migrate(); mutate(d => { d.serverRaid.sequence = 1; });
    c.java.io.File.prototype.lastModified = () => fixture.now() - 60001;
    try { mutate(d => { d.serverRaid.sequence = 2; }); mutate(d => { d.serverRaid.sequence = 3; }); }
    finally { c.java.io.File.prototype.lastModified = () => fixture.now(); }
    const backup = JSON.parse(fixture.disk()[root + "member_back2.json"]); fixture.disk()[memberPath] = JSON.stringify(backup);
    assert.equal(load("raid").serverRaid.sequence, 1);
});
group("자동 일괄 저장 컨텍스트를 유지하고 마지막에만 분리 파일 게시", () => {
    migrate(); const batch = { managedPaths: { [memberPath]: true }, files: {}, dirtyPaths: {} }; const original = c.getAutoDailyBatchContext;
    c.getAutoDailyBatchContext = () => batch;
    try { const d = load(); d.petMusouAutomationLogs.push(native({ batch: true })); save(d); assert.equal(raw().migrations[key].logsRevision, 0);
        assert.strictEqual(load(), d); batch.committing = true; save(d); assert.equal(raw().migrations[key].logsRevision, 1);
    } finally { c.getAutoDailyBatchContext = original; }
});
group("복사 중 원본 수정 감지: 원본 제거/완료 전환 없이 중단", () => {
    fixture.fail((_d, p) => p === root + "serverRaidData.json"); assert.throws(() => cleanup());
    const partial = raw(); partial.member.a.point++; fixture.write(partial); assert.throws(() => cleanup(), /원본 백업과 다릅니다/);
    assert.equal(raw().migrations[key].phase, "COPYING"); assert(raw().serverRaid.history);
});
group("자동 복구된 얇은 회원 파일도 로그·레이드 상세 연결 후 사용", () => {
    migrate(); const healthy = fixture.disk()[memberPath], restore = c.restoreManagedJsonFromBackup;
    fixture.disk()[memberPath] = "broken";
    c.restoreManagedJsonFromBackup = p => { fixture.disk()[p] = healthy; return { data: native(JSON.parse(healthy)) }; };
    try { const d = load("raid"); assert(d.__memberSplitContext); assert(d.serverRaid.history); assert(d.petMusouAutomationLogs.length); }
    finally { c.restoreManagedJsonFromBackup = restore; }
});
group("나머지 운영 로그 3종도 기존 기록 함수로 분리 파일 저장", () => {
    migrate(); const d = load(); c.getTodaySupportPassDateValue = () => "2026-10-12";
    c.appendGuildTerritoryAutomationDataLog(d, native({ user: "a", action: "ON" }));
    c.appendTerritoryPassAuditLog(d, "master", "a", "ADD", null, native({ permanent: true }));
    c.appendTerritoryPassPayoutLogs(d, native({ grantedUsers: ["a"], skippedUsers: ["b"] }), "master"); save(d);
    const persisted = store("logs").data; assert.equal(persisted.guildTerritoryAutomationLogs.at(-1).action, "ON");
    assert.equal(persisted.territoryPassAuditLogs.at(-1).expireAt, "영구권"); assert.equal(persisted.supportPassPayoutLogs.length, 3);
    for (const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) assert(!Object.hasOwn(raw(), name));
});
group("다른 실행 문맥의 정상 로그 배열도 검증·추가·저장에서 유지", () => {
    migrate(); const d = load();
    const foreignLogs = vm.runInNewContext('({supportPassPayoutLogs:[{existing:true}],guildTerritoryAutomationLogs:[{existing:true}],territoryPassAuditLogs:[{existing:true}],petMusouAutomationLogs:[{existing:true}]})');
    assert.equal(vm.runInContext('Array', c)[Symbol.hasInstance](foreignLogs.petMusouAutomationLogs), false);
    c.requireMemberSplitStore({ version: 1, id: 'scope-test', revision: 0, data: foreignLogs }, 'logs');
    for (const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) d[name] = foreignLogs[name];
    c.getTodaySupportPassDateValue = () => '2026-10-12';
    c.appendPetMusouAutomationLog(d, native({ added: true })); c.appendGuildTerritoryAutomationDataLog(d, native({ added: true }));
    c.appendTerritoryPassAuditLog(d, 'master', 'a', 'ADD', null, native({ permanent: true }));
    c.appendTerritoryPassPayoutLogs(d, native({ grantedUsers: ['a'], skippedUsers: [] }), 'master'); save(d);
    for (const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys) { assert.equal(store('logs').data[name].length, 2); assert(store('logs').data[name][0].existing); }
});
group("별도 문맥 JSON 파서로 읽은 회원·레이드·로그도 엄격 검증 후 저장", () => {
    migrate(); const parser = c.parseJsonContent;
    c.parseJsonContent = text => vm.runInNewContext('JSON.parse(' + JSON.stringify(text) + ')');
    try { const d = load('raid'); c.appendPetMusouAutomationLog(d, native({ independentParser: true })); d.serverRaid.sequence++; save(d);
        assert.equal(raw().migrations[key].logsRevision, 1); assert.equal(store('raid').data.sequence, 1); assert.equal(store('logs').data.petMusouAutomationLogs.length, 2);
    } finally { c.parseJsonContent = parser; }
});
group("실제 손상 로그는 Array.isArray에서도 계속 차단하며 키 표시", () => {
    migrate(); const logs = store('logs'); logs.data.petMusouAutomationLogs = { length: 0 };
    fixture.disk()[root + 'memberOperationLogs.json'] = JSON.stringify(logs);
    assert.throws(() => load(), /운영 로그.*petMusouAutomationLogs/); assert.equal(recoveries, 0);
});
function injectResiduals(rows, extra) {
    const d = raw(); d.petMusouAutomationLogs = rows;
    if (extra) Object.assign(d, extra); fixture.write(d); return d;
}

group("잔류 로그 복구는 버전이 다른 기존 회원·분리 백업도 원본 보존 후 재구성", () => {
    migrate();
    for (let i = 0; i < 8; i++) mutate(d => { d.petMusouAutomationLogs.push(native({ index: i })); });
    const mismatched = JSON.parse(fixture.disk()[root+'memberOperationLogs_back.json']);
    mismatched.revision = 8; fixture.disk()[root+'memberOperationLogs_back.json'] = JSON.stringify(mismatched);
    const rows = Array.from({length:9}, (_v,index)=>({residual:index})); const before=injectResiduals(rows);
    const beforeDisk=clone(fixture.disk()), oldLogs=clone(store('logs').data);
    c.java.io.File.prototype.lastModified = () => fixture.now()-60001;
    try { assert(cleanup().includes('잔류 기록 9건 보존')); }
    finally { c.java.io.File.prototype.lastModified = () => fixture.now(); }
    assert.deepStrictEqual(raw().member,before.member);
    assert.deepStrictEqual(store('logs').data.petMusouAutomationLogs,oldLogs.petMusouAutomationLogs.concat(rows));
    const archivePath=Object.keys(fixture.disk()).find(p=>p.includes('log_recovery_')&&p.endsWith('_backup_set.json'));
    assert(archivePath); const archived=JSON.parse(fixture.disk()[archivePath]);
    for(const item of archived.files) assert.equal(item.text,Object.hasOwn(beforeDisk,item.path)?beforeDisk[item.path]:null);
    for(const generation of [1,2]) {
        const suffix=generation===1?'_back':'_back2'; const member=JSON.parse(fixture.disk()[root+'member'+suffix+'.json']);
        assert(!Object.hasOwn(member,'petMusouAutomationLogs'));
        for(const kind of ['raid','logs']) {
            const external=JSON.parse(fixture.disk()[root+(kind==='raid'?'serverRaidData':'memberOperationLogs')+suffix+'.json']);
            assert.equal(external.id,member.migrations[key].id); assert.equal(external.revision,member.migrations[key][kind+'Revision']);
        }
    }
});

for (const suffix of ['_back','_back2']) group('복구는 '+suffix+' 손상·누락 파일도 원문 보관 후 현재 데이터로 재구성', () => {
    migrate(); injectResiduals([{recovery:true}]);
    fixture.disk()[root+'member'+suffix+'.json']='broken-member-backup';
    fixture.disk()[root+'memberOperationLogs'+suffix+'.json']='broken-log-backup';
    delete fixture.disk()[root+'serverRaidData'+suffix+'.json'];
    const before=clone(fixture.disk()); cleanup();
    const archived=JSON.parse(fixture.disk()[Object.keys(fixture.disk()).find(p=>p.endsWith('_backup_set.json'))]);
    assert.equal(archived.files.find(f=>f.path===root+'member'+suffix+'.json').text,'broken-member-backup');
    assert.equal(archived.files.find(f=>f.path===root+'memberOperationLogs'+suffix+'.json').text,'broken-log-backup');
    assert.equal(archived.files.find(f=>f.path===root+'serverRaidData'+suffix+'.json').text,null);
    assert.deepStrictEqual(raw().member,JSON.parse(before[memberPath]).member);
    mutate(d=>{ d.petMusouAutomationLogs.push(native({after:true})); });
    assert.equal(load().petMusouAutomationLogs.length,3);
});

for (const target of ['serverRaidData_back','memberOperationLogs_back','member_back','serverRaidData_back2','memberOperationLogs_back2','member_back2'])
group(target+' 재구성 실패: 회원·분리 슬롯·두 백업 세트 전체 원복 후 재시도', () => {
    migrate(); injectResiduals([{recovery:true}]); const before=clone(fixture.disk());
    fixture.fail((_d,p)=>p===root+target+'.json'); assert.throws(()=>cleanup());
    for (const [p,text] of Object.entries(before)) assert.equal(fixture.disk()[p],text,p);
    for (const p of Object.keys(fixture.disk())) if (!p.includes('log_recovery_')) assert(Object.hasOwn(before,p),'unrestored new file '+p);
    cleanup(); assert(!Object.hasOwn(raw(),'petMusouAutomationLogs')); assert.equal(load().petMusouAutomationLogs.length,2);
});

group('원본 보관 실패 또는 현재 레이드 누락이면 백업 재구성 없이 중단', () => {
    migrate(); injectResiduals([{recovery:true}]); let before=clone(fixture.disk());
    fixture.fail((_d,p)=>p.endsWith('_backup_set.json')); assert.throws(()=>cleanup());
    for(const [p,text] of Object.entries(before)) assert.equal(fixture.disk()[p],text,p);
    delete fixture.disk()[root+'serverRaidData.json']; before=clone(fixture.disk());
    assert.throws(()=>cleanup(),/회원 분리 파일이 없습니다/); assert.deepStrictEqual(fixture.disk(),before);
});

group('일반 저장에서는 불일치 백업을 자동 재구성하지 않고 계속 차단', () => {
    migrate(); mutate(d=>{d.petMusouAutomationLogs.push(native({log:true}));});
    const backup=JSON.parse(fixture.disk()[root+'memberOperationLogs_back.json']); backup.revision=88;
    fixture.disk()[root+'memberOperationLogs_back.json']=JSON.stringify(backup); const before=clone(fixture.disk());
    c.java.io.File.prototype.lastModified = () => fixture.now()-60001;
    try { assert.throws(()=>mutate(d=>{d.member.a.point++;}),/회원 백업과 분리 백업의 버전이 일치하지 않습니다/); }
    finally { c.java.io.File.prototype.lastModified = () => fixture.now(); }
    assert.deepStrictEqual(fixture.disk(),before);
});
group("분리 완료 후 잔류 로그 9건: 일반 읽기 오류 재현·명시적 정리로 복구", () => {
    migrate(); const rows = Array.from({ length: 9 }, (_v, index) => ({ feature: 'SYNTHETIC_MUSOU', index }));
    const before = injectResiduals(rows); const oldLogs = clone(store('logs').data); const oldRaid = clone(store('raid'));
    assert.throws(() => load(), /분리 완료 회원 파일에 운영 로그가 남아 있습니다: petMusouAutomationLogs/);
    assert.equal(recoveries, 0); assert(cleanup().includes('잔류 기록 9건 보존'));
    assert(!Object.hasOwn(raw(), 'petMusouAutomationLogs')); assert.deepStrictEqual(raw().member, before.member);
    assert.deepStrictEqual(store('raid'), oldRaid); assert.deepStrictEqual(store('logs').data.petMusouAutomationLogs, oldLogs.petMusouAutomationLogs.concat(rows));
    assert.equal(load().petMusouAutomationLogs.length, 10);
    const backup = Object.keys(fixture.disk()).find(p => p.includes('log_recovery_')); assert(backup); assert.deepStrictEqual(JSON.parse(fixture.disk()[backup]), before);
});
group("동일한 행도 삭제 없이 보존·복구 재실행에서 중복 추가 없음", () => {
    migrate(); const existing = clone(store('logs').data.petMusouAutomationLogs);
    injectResiduals(existing); cleanup(); const count = load().petMusouAutomationLogs.length; assert.equal(count, 2);
    cleanup(); assert.equal(load().petMusouAutomationLogs.length, count); assert.equal(raw().migrations[key].logsRevision, 1);
});
group("빈 잔류 배열도 정리·분리 파일 재작성 없이 회원 필드만 제거", () => {
    migrate(); injectResiduals([]); assert(cleanup().includes('잔류 로그 필드 1개 정리'));
    assert(!Object.hasOwn(raw(), 'petMusouAutomationLogs')); assert.equal(raw().migrations[key].logsRevision, 0); assert.equal(load().petMusouAutomationLogs.length, 1);
});
group("실제 손상 잔류/분리 데이터는 복구 명령에서도 변경 없이 거부", () => {
    migrate(); injectResiduals({ length: 9 }); let before = clone(fixture.disk()); assert.throws(() => cleanup(), /잘못된 회원 잔류 운영 로그/); assert.deepStrictEqual(fixture.disk(), before);
    injectResiduals([{ index: 1 }]); delete fixture.disk()[root+'memberOperationLogs.json']; before = clone(fixture.disk());
    assert.throws(() => cleanup(), /회원 분리 파일이 없습니다/); assert.deepStrictEqual(fixture.disk(), before);
});
for (const target of ['slot','member']) group(target+' 복구 저장 실패: 잔류 원본·분리 기록 유지·재시도 가능', () => {
    migrate(); const before = injectResiduals([{ recovery: true }]); const oldLogs = clone(store('logs'));
    fixture.fail((_d, p) => p === (target === 'slot' ? root+'memberOperationLogs_next.json' : memberPath));
    assert.throws(() => cleanup()); assert.deepStrictEqual(raw(), before); assert.deepStrictEqual(store('logs'), oldLogs);
    cleanup(); assert(!Object.hasOwn(raw(), 'petMusouAutomationLogs')); assert.equal(load().petMusouAutomationLogs.length, 2);
});
group("복구는 진행 대회·소수점·가방 등 게임 데이터와 기존 정리 미실행", () => {
    migrate(); const before = injectResiduals([{ recovery: true }]); before.petMusou = { active: true, signupOpen: true, startReady: false }; before.member.a.point = 12.7;
    before.member.a.bag['영지자동공격권⚔️'] = 4; fixture.write(before); cleanup();
    assert.deepStrictEqual(raw().petMusou, before.petMusou); assert.deepStrictEqual(raw().member, before.member);
});
group("권한 없는 복구·접미 안내 입력은 거부·DEV 복구는 운영 무변경", () => {
    migrate(); injectResiduals([{ recovery: true }]); const before = clone(fixture.disk());
    assert.throws(() => run('/데이터정리', 'a'), /운영 로그가 남아/); assert.throws(() => run('/데이터정리 해봐','master',undefined,'test'), /운영 로그가 남아/); assert.deepStrictEqual(fixture.disk(), before);
    migrate(true); const dev = raw(true); dev.petMusouAutomationLogs = [{ dev: true }]; fixture.write(dev, true);
    run('dev/데이터정리','master',undefined,'test'); assert(!Object.hasOwn(raw(true),'petMusouAutomationLogs'));
    assert.equal(fixture.disk()[memberPath], before[memberPath]); assert(Object.keys(fixture.disk()).filter(p=>p.startsWith(devRoot)&&p.includes('log_recovery_')).length===2);
});
group("실제 7인수 MAIN 응답은 관리자에게 잔류 오류와 복구 안내·버전 기록", () => {
    migrate(); injectResiduals([{ recovery: true }]);
    const lock = () => ({ lock(){}, unlock(){} }); c.commandDataFlowLock = { readLock: lock, writeLock: lock };
    c.autoDailyQuestInternalDepth = 0; c.HoiBotVersion = 'diagnostic-test'; c.errorLogPath = root+'errorLog.json';
    vm.runInContext(fixture.block(main,'function isAdminIdentity('),c);
    c.response('test','/호이봇버전','master',true,c.replier,null,'com.kakao.talk');
    const reply = fixture.traces().filter(t=>t.type==='reply').at(-1).text;
    assert(reply.includes('MAIN 회원 파일 분리 오류')); assert(reply.includes('petMusouAutomationLogs')); assert(reply.includes('/데이터정리'));
    const report = JSON.parse(fixture.disk()[c.errorLogPath]); assert.equal(typeof report.error,'string'); assert(report.error.includes('로그가 남아')); assert(report.version);
    const count = fixture.traces().filter(t=>t.type==='reply').length;
    c.response('room8','/호이봇버전','a',true,c.replier,null,'com.kakao.talk'); assert.equal(fixture.traces().filter(t=>t.type==='reply').length,count);
    fixture.fail((_d,p)=>p===root+'memberOperationLogs_next.json');
    c.response('test','/데이터정리','master',true,c.replier,null,'com.kakao.talk');
    assert(fixture.traces().filter(t=>t.type==='reply').at(-1).text.includes('MAIN 회원 파일 분리 오류')); assert(raw().petMusouAutomationLogs);
    c.response('test','/데이터정리','master',true,c.replier,null,'com.kakao.talk');
    assert(fixture.traces().filter(t=>t.type==='reply').at(-1).text.includes('운영 로그 복구 완료')); assert(!Object.hasOwn(raw(),'petMusouAutomationLogs'));
});
group("분리 백업 회전 실패도 저장 중단·원본과 백업 세트 복원", () => {
    migrate(); mutate(d => { d.serverRaid.sequence = 1; }); const before = raw(), priorBackup = fixture.disk()[root + "member_back2.json"];
    c.java.io.File.prototype.lastModified = () => fixture.now() - 60001;
    fixture.fail((_d, p) => p === root + "memberOperationLogs_back2.json");
    try { assert.throws(() => mutate(d => { d.serverRaid.sequence = 2; })); }
    finally { c.java.io.File.prototype.lastModified = () => fixture.now(); }
    assert.deepStrictEqual(raw(), before); assert.equal(fixture.disk()[root + "member_back2.json"], priorBackup); assert.equal(load("raid").serverRaid.sequence, 1);
});
// 기존 긴 정리 명령도 실제 분기로 실행하여 비열거 로그·얇은 회원 저장과의 호환을 확인한다.
function prepareCleanupBody() {
    const cleanupBlock = block(main, 'if (msg === "/데이터정리" && (isAdmin(sender) || isMaster(sender)))');
    for (const name of ["collectDeletedAccountNames", "cleanupDeletedAccountResiduals", "removeDeletedAccountBoardRows", "initPetHomeCommentsData", "requirePetHomeActivityData", "ensureFreeMarketData", "ensurePunchRankData", "requireMiniPetRobberyStore", "getMiniPetRobberyRows", "validateMiniPetRobberyPending", "buildMiniPetRobberyMigration", "isSearchAuthenticationCount"])
        vm.runInContext(block(main, "function " + name + "("), c);
    for (const match of cleanupBlock.matchAll(/(?:loadJsonFile\(|saveJsonFile\(\w+,\s*)(\w+)\)/g)) {
        if (!c[match[1]]) c[match[1]] = root + match[1] + ".json";
        if (!Object.hasOwn(fixture.disk(), c[match[1]])) fixture.disk()[c[match[1]]] = JSON.stringify({ member: {}, user: {}, users: {}, alerts: {}, recentVisitors: {}, petHomeSocial: {} });
    }
    c.petHomePlacedFurniturePath = root + "not-separated-furniture.json";
    delete fixture.disk()[c.petHomePlacedFurniturePath];
    c.formatPointValue = String;
    vm.runInContext("function runCleanupBody(data,petData,petSkillData,guildData,currencyLogData,memberStorageMigrationResult){beginDataSaveTransaction();try{" + cleanupBlock + "}catch(error){rollbackDataSaveTransaction();throw error;}finally{endDataSaveTransaction();}}", c);
}
group("실제 기존 정리 본문과 완료 UI도 분리 회원·로그를 정상 저장", () => {
    migrate(); prepareCleanupBody(); const d = load(); d.member.a.point = 12.7; d.member.a.bag["영지자동공격권⚔️"] = 3;
    c.sender = "admin"; c.msg = "/데이터정리";
    c.runCleanupBody(d, loadFile(c.memberPetPath), native({}), native({}), native({}), native({ changed: false }));
    assert.equal(raw().member.a.point, 12); assert(!raw().member.a.bag["영지자동공격권⚔️"]); assert(raw().serverRaid.storageSummary);
    assert.equal(store("logs").data.petMusouAutomationLogs.length, 1);
    const output = fixture.traces().filter(t => t.type === "reply").at(-1).text;
    assert(output.includes("회원 파일 분리")); assert(output.includes("[9] 회원 목록 외 잔여 데이터 정리"));
});
function loadFile(p) { return c.loadJsonFile(p); }
group("이후 기존 정리 저장 실패로 완료된 마이그레이션이 취소되지 않음", () => {
    migrate(); prepareCleanupBody(); const d = load(); const before = raw(); d.member.a.point = 12.7;
    c.sender = "admin"; c.msg = "/데이터정리"; c.beginDataSaveTransaction(); fixture.fail((_d, p) => p === c.memberPetPath);
    try { assert.throws(() => c.runCleanupBody(d, loadFile(c.memberPetPath), native({}), native({}), native({}), native({ changed: false }))); }
    finally { c.endDataSaveTransaction(); }
    assert.deepStrictEqual(raw(), before); assert.equal(load("raid").serverRaid.history.length, 1); assert.equal(raw().migrations[key].phase, "COMPLETE");
});
group("가방 숫자 0만 제거·보유 재화/구독/명칭 통합 보존·재실행 0건", () => {
    migrate(); prepareCleanupBody(); const d = load();
    d.member.a.bag = native({ "빈이용권": 0, "빈확률UP": 0, "보유이용권": 3, "캐슬공격권⚔": 0, "영지공격권⚔": 2 });
    d.member.admin.bag = native({ "빈가방항목": 0, "정수상한": 9007199254740991, "소수": 0.5 });
    d.member.a.pass = native({ doll: { enabled: true, permanent: true, dailyRewardLastDate: "20261014" } });
    const passBefore = clone(d.member.a.pass);
    c.sender = "admin"; c.msg = "/데이터정리";
    const execute = data => c.runCleanupBody(data, loadFile(c.memberPetPath), native({}), native({}), native({}), native({ changed: false }));
    execute(d);
    assert.deepStrictEqual(raw().member.a.bag, { "보유이용권": 3, "영지공격권⚔": 2 });
    assert.deepStrictEqual(raw().member.admin.bag, { "정수상한": 9007199254740991, "소수": 0.5 });
    assert.deepStrictEqual(raw().member.a.pass, passBefore);
    assert(fixture.traces().filter(t => t.type === "reply").at(-1).text.includes("가방 수량 0 항목 삭제 : 4개 / 2명"));
    execute(load());
    assert(fixture.traces().filter(t => t.type === "reply").at(-1).text.includes("가방 수량 0 항목 삭제 : 0개 / 0명"));
});
group("가방 0 항목 정리는 DEV만 저장·이후 저장 실패 시 원상복구", () => {
    migrate(); prepareCleanupBody(); const d = load(); d.member.a.bag.zero = 0; save(d);
    const before = clone(raw()); c.sender = "admin"; c.msg = "/데이터정리";
    c.beginDataSaveTransaction(); fixture.fail((_d, p) => p === c.memberPetPath);
    try { assert.throws(() => c.runCleanupBody(load(), loadFile(c.memberPetPath), native({}), native({}), native({}), native({ changed: false }))); }
    finally { c.endDataSaveTransaction(); fixture.fail(() => false); }
    assert.deepStrictEqual(raw(), before);
    migrate(true);
    for (const [p, text] of Object.entries(fixture.disk())) {
        if (p.startsWith(root) && !Object.hasOwn(fixture.disk(), devRoot + p.slice(root.length))) fixture.disk()[devRoot + p.slice(root.length)] = text;
    }
    const prev = c.enterCommandContext(c.createCommandContext(true, "test"));
    try {
        const dev = c.loadJsonFile(memberPath); dev.member.a.bag.zero = 0;
        c.saveJsonFile(dev, memberPath);
        c.runCleanupBody(c.loadJsonFile(memberPath), c.loadJsonFile(c.memberPetPath), native({}), native({}), native({}), native({ changed: false }));
        assert(!Object.hasOwn(raw(true).member.a.bag, "zero"));
        assert.deepStrictEqual(raw(), before);
    } finally { c.exitCommandContext(prev); }
});
console.log("PASS: " + groups + " member storage split groups (synthetic data only)");
