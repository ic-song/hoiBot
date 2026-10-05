const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");

// 실제 함수·명령 분기를 추출하고 운영 파일 없이 실행한다.
function fn(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}
function branch(startText, endText) {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert(start >= 0 && end > start);
    return "(function(){" + source.slice(start, end) + "})()";
}
const raidCommand = branch("var raidSealCraftRequest = getRaidSealCraftRequest(msg);", 'if (msg === "/펫먹이조합"');
const bagCommand = branch('if (msg === "/미니펫가방")', 'if (msg === "/미니펫정보")');
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/";
const memberPath = root + "member.json", petPath = root + "member_pet.json";
const collectionPath = root + "miniPetCollection.json";
const actor = "합성 MASTER", target = "합성 대상 사용자", material = "잡템☠️", reward = "레이드타격대인장👑(+600👾)";
let disk, events, replies, failPath, groups = 0;
function lock() { return { lock() {}, unlock() {} }; }
function local() { return { value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } }; }

// Java 파일 교체 실패까지 재현하는 메모리 파일시스템이다.
function FakeFile(p) { this.path = String(p); }
FakeFile.prototype.exists = function () { return Object.hasOwn(disk, this.path); };
FakeFile.prototype.getPath = function () { return this.path; };
FakeFile.prototype.delete = function () { delete disk[this.path]; return true; };
FakeFile.prototype.renameTo = function (to) {
    if (this.path.endsWith(".tmp") && failPath === to.path) { failPath = null; return false; }
    if (!this.exists()) return false;
    disk[to.path] = disk[this.path]; delete disk[this.path];
    if (this.path.endsWith(".tmp")) events.push("save:" + to.path);
    return true;
};
const c = {
    DATA_ROOT_PATH: root, DEV_DATA_ROOT_PATH: devRoot, COMMON_DATA_FILE_MAP: {},
    filePath: memberPath, memberPetPath: petPath, miniPetCollectionPath: collectionPath,
    commandContextThreadLocal: local(), dataSaveTransactionThreadLocal: local(), dataTransactionLock: lock(),
    getProtectedJsonSaveLock: () => lock(), isProtectedManagedJsonPath: () => true,
    getManagedJsonBackupPath: p => p + ".bak", getManagedJsonSecondaryBackupPath: () => null,
    getAutoDailyBatchContext: () => null, ensureParentFolder() {}, debuggerLog() {},
    parseManagedJsonContent: text => JSON.parse(text),
    restoreManagedJsonFromBackup(p) { disk[p] = disk[p + ".bak"]; return { data: JSON.parse(disk[p]) }; },
    FileStream: { read: p => disk[p], write() { throw Error("unexpected direct write"); } },
    java: { io: {
        File: FakeFile,
        FileOutputStream: function (f) { this.path = f.path; disk[f.path] = ""; this.getFD = () => ({ sync() {} }); this.close = () => {}; },
        OutputStreamWriter: function (s) { this.write = text => { disk[s.path] = text; }; this.flush = () => {}; this.close = () => {}; }
    } },
    numberWithCommas: n => Number(n).toLocaleString("en-US"),
    checkRank: (_d, _p, _g, user) => "💛" + user,
    getHoiPassPremiumHeader: (_d, user) => user === target ? "[👑호이패스 프리미엄👑]\n" : "",
    getMiniPetBagLimit: (_d, user) => user === target ? 15 : 9,
    getMiniPetUpgradeDisplay: p => p.upgrade, allsee: "<ALLSEE>",
    normalizeMiniPetCollectionRegistered: r => r,
    isSealedVaultMutationCommandMessage: () => false, isAutoDailyEntryCommandMessage: () => false,
    commandDataFlowLock: { writeLock: () => "write", readLock: () => "read" },
    Master: [actor], getCurrentContext: undefined, testRoom: "test", room92: "admin",
    replier: { reply(text) { replies.push(text); events.push("reply"); } },
    loadJsonFile(p) { events.push("load:" + p); return JSON.parse(disk[c.resolveActiveDataPath(p)]); },
    GLOBAL_CONFIG: { pointShop: { limits: { maxSafeNumber: 9007199254740991 } }, permissions: { additionalServerAdminRooms: ["extra"] } }
};
vm.createContext(c);
vm.runInContext("GLOBAL_CONFIG.raidSealCraft = " + source.match(/raidSealCraft: (\{[\s\S]*?\n    \}),\n    stoneBox/)[1], c);
for (const name of ["getRaidSealCraftRequest", "craftRaidSealItems", "isPointShopSafeCount", "isPointShopSafeAmount",
    "getStoneBoxOpenRequest", "isServerRaidMutationCommand", "isExclusiveDataMutationCommandMessage", "getResponseDataFlowLock",
    "isDevCommandMessage", "stripDevCommandPrefix", "createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataFileName", "resolveActiveDataPath",
    "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "writeVerifiedJsonFile", "saveJsonFile",
    "isMaster", "sortMiniPetBag", "refreshMiniPetSortIndex", "buildMiniPetBagRenewedMessage", "getMiniPetCollectionData", "getMiniPetCollectionRanking"]) vm.runInContext(fn(name), c);

// 회원·가방·컬렉션은 식별 정보 없는 합성 데이터로 시작한다.
function reset(point = 10000000000, count = 6000) {
    const data = { member: { [actor]: { point, bag: { [material]: count } }, [target]: { point: 0, bag: {} } } };
    const pets = { [actor]: { miniPetBag: [] }, [target]: { miniPetBag: [
        { name: "low", grade: "일반", emoji: "🐹", battleExp: 10, sortIndex: 1 },
        { name: "high", grade: "일반", emoji: "🐹", battleExp: 100, sortIndex: 2, upgrade: 3 }
    ], miniPet: { name: "대표", battleExp: 123 }, miniPetSupport: { name: "보조", battleExp: 456 } } };
    const collection = { member: { [target]: { collection: { stage: 3, completedStage: 2, registered: { 일반: true, 신화: false } } } } };
    disk = {};
    for (const [p, obj] of [[memberPath, data], [petPath, pets], [collectionPath, collection]]) {
        disk[p] = JSON.stringify(obj); disk[p.replace(root, devRoot)] = JSON.stringify(obj);
    }
    c.sender = actor; c.castleSiegeFlag = false;
    c.commandContextThreadLocal.remove(); c.dataSaveTransactionThreadLocal.remove();
    failPath = null; events = []; replies = [];
}
function run(msg, command = raidCommand, room = "test") {
    events = []; replies = [];
    const previous = c.enterCommandContext(c.createCommandContext(c.isDevCommandMessage(msg), room));
    c.msg = c.isDevCommandMessage(msg) ? c.stripDevCommandPrefix(msg) : msg;
    c.data = JSON.parse(disk[c.resolveActiveDataPath(memberPath)]);
    c.petData = JSON.parse(disk[c.resolveActiveDataPath(petPath)]); c.guildData = {};
    vm.runInContext('miniPetData={gradeTable:[{grade:"일반"}]}', c);
    c.beginDataSaveTransaction();
    try { vm.runInContext(command, c); }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return replies.join("\n");
}
function read(p = memberPath) { return JSON.parse(disk[p]); }
function group(name, f) { f(); groups++; console.log("PASS " + groups + ": " + name); }

group("50억·3천개 정확한 경계와 여러 개 조합", () => {
    for (const [msg, qty] of [["/레이드인장조합", 1], ["/레이드인장조합 2", 2], ["/레이드인장조합\t2", 2], ["/레이드인장조합  0002", 2]]) {
        reset(5000000000 * qty, 3000 * qty); const out = run(msg);
        const m = read().member[actor]; assert.strictEqual(m.point, 0); assert.strictEqual(m.bag[reward], qty); assert(!Object.hasOwn(m.bag, material));
        assert(out.includes("완성")); assert(out.includes(c.numberWithCommas(5000000000 * qty)));
        assert(events.indexOf("reply") > events.indexOf("save:" + memberPath));
    }
});
group("재료·포인트 부족은 모두 미차감", () => {
    for (const [p, n] of [[5000000000, 2999], [4999999999, 3000], [1000000000, 1000], [0, 0], [9999999999, 6000]]) {
        reset(p, n); const before = disk[memberPath]; const out = run(n === 6000 ? "/레이드인장조합 2" : "/레이드인장조합");
        assert(out.includes("부족")); assert.strictEqual(disk[memberPath], before); assert(!events.some(e => e.startsWith("save:")));
    }
});
group("0·거대 정수·소수·음수·지수·접미·유사 명령 차단", () => {
    for (const suffix of ["0", "9".repeat(400), "9007199254740991", "1801440", "-1", "1.5", "1e3", "2 해봐", "NaN", "Infinity"]) {
        reset(); const before = disk[memberPath]; run("/레이드인장조합 " + suffix); assert.strictEqual(disk[memberPath], before);
        assert(!replies.join("").includes("완성"));
    }
    reset(); assert.strictEqual(run("/레이드인장조합방법"), "");
});
group("손상 보유량·최종 인장 초과는 미차감", () => {
    for (const field of [material, reward, "point"]) for (const value of ["6000", null, -1, 1e80]) {
        reset(); const d = read(); if (field === "point") d.member[actor].point = value; else d.member[actor].bag[field] = value;
        disk[memberPath] = JSON.stringify(d); const before = disk[memberPath]; run("/레이드인장조합"); assert.strictEqual(disk[memberPath], before);
    }
    reset(); const d = read(); d.member[actor].bag[reward] = 9007199254740991; disk[memberPath] = JSON.stringify(d);
    const before = disk[memberPath]; run("/레이드인장조합"); assert.strictEqual(disk[memberPath], before);
});
group("실제 저장 실패 복구·재시도·공성전 차단", () => {
    reset(5000000000, 3000); const before = disk[memberPath]; failPath = memberPath;
    assert.throws(() => run("/레이드인장조합")); assert.strictEqual(disk[memberPath], before); assert.strictEqual(replies.length, 0);
    run("/레이드인장조합"); assert.strictEqual(read().member[actor].bag[reward], 1);
    assert(run("/레이드인장조합").includes("부족")); assert.strictEqual(read().member[actor].bag[reward], 1);
    reset(); c.castleSiegeFlag = true; const original = disk[memberPath]; assert.strictEqual(run("/레이드인장조합"), ""); assert.strictEqual(disk[memberPath], original);
});
group("DEV 저장 분리와 조합 쓰기 잠금", () => {
    reset(); const original = disk[memberPath]; run("dev/레이드인장조합 2"); assert.strictEqual(disk[memberPath], original);
    assert.strictEqual(read(memberPath.replace(root, devRoot)).member[actor].bag[reward], 2);
    assert.strictEqual(c.getResponseDataFlowLock("/레이드인장조합 2"), "write");
    assert.strictEqual(c.getResponseDataFlowLock("dev/레이드인장조합 2"), "write");
    assert.strictEqual(c.getRaidSealCraftRequest("/레이드인장조합 2 해봐"), null);
});
group("MASTER 대상 UI 동일·원본 순서/번호/장착 불변·무저장", () => {
    reset(); const original = disk[petPath]; const out = run("/미니펫가방 " + target, bagCommand);
    assert(out.includes("[👑호이패스 프리미엄👑]")); assert(out.includes("💛" + target)); assert(out.includes("[2/15]")); assert(out.includes("컬렉션+2💫[1/2] (1등📊)"));
    assert(out.indexOf("high") < out.indexOf("low")); assert.strictEqual(JSON.stringify(c.petData), original); assert.strictEqual(disk[petPath], original);
    assert(!events.some(e => e.startsWith("save:"))); assert.strictEqual(events.filter(e => e.startsWith("load:")).length, 1);
    vm.runInContext('expected=buildMiniPetBagRenewedMessage(' + JSON.stringify(target) + ',data,JSON.parse(JSON.stringify(petData)),guildData,loadJsonFile(miniPetCollectionPath),miniPetData)', c);
    assert.strictEqual(out, c.expected);
});
group("MASTER 명단과 기존 방 권한 적용", () => {
    for (const [sender, room, allowed] of [[actor, "test", true], [actor, "admin", true], [actor, "extra", true], [actor, "normal", false], [target, "test", false]]) {
        reset(); c.sender = sender; const out = run("/미니펫가방 " + target, bagCommand, room);
        assert.strictEqual(out.includes("MASTER만 가능합니다"), !allowed);
        if (!allowed) assert.strictEqual(events.length, 1);
    }
});
group("없는 회원·상속 키·빈 가방·미등록 펫 안내", () => {
    reset(); assert(run("/미니펫가방 없는 유저", bagCommand).includes("찾을 수 없습니다"));
    for (const name of ["__proto__", "constructor", "toString"]) assert(run("/미니펫가방 " + name, bagCommand).includes("찾을 수 없습니다"));
    for (const owner of [{ miniPetBag: [] }, {}, null]) {
        reset(); const p = read(petPath); if (owner) p[target] = owner; else delete p[target]; disk[petPath] = JSON.stringify(p);
        assert(run("/미니펫가방 " + target, bagCommand).includes("[💛" + target + "]님의 미니펫가방이 비어 있습니다."));
        assert(!events.some(e => e.startsWith("load:") || e.startsWith("save:")));
    }
});
group("기존 본인 정렬·저장 유지·전체보기·조회 DEV 분리", () => {
    reset(); c.sender = target; const out = run("/미니펫가방", bagCommand);
    assert(out.includes("high")); assert.strictEqual(read(petPath)[target].miniPetBag[0].name, "high"); assert(events.includes("save:" + petPath));
    reset(); const p = read(petPath); while (p[target].miniPetBag.length < 6) p[target].miniPetBag.push({ name: "extra", grade: "일반", battleExp: 1 });
    disk[petPath] = JSON.stringify(p); assert(run("/미니펫가방 " + target, bagCommand).includes("<ALLSEE>"));
    reset(); const devP = read(petPath.replace(root, devRoot)); devP[target].miniPetBag[0].name = "DEV 전용"; disk[petPath.replace(root, devRoot)] = JSON.stringify(devP);
    const before = disk[petPath]; assert(run("dev/미니펫가방 " + target, bagCommand).includes("DEV 전용")); assert.strictEqual(disk[petPath], before);
    assert.strictEqual(run("/미니펫가방정리 3000", bagCommand), "");
});
group("컬렉션 로드 실패를 숨기지 않고 원본 보존·공백 인자", () => {
    reset(); const before = disk[petPath]; disk[collectionPath] = "invalid JSON";
    assert.throws(() => run("/미니펫가방 " + target, bagCommand));
    assert.strictEqual(disk[petPath], before); assert.strictEqual(replies.length, 0);
    reset(); assert(run("/미니펫가방\t " + target + "  ", bagCommand).includes("💛" + target));
    assert(run("/미니펫가방   ", bagCommand).includes("사용법"));
    assert.strictEqual(run("/미니펫가방 " + target + "\nextra", bagCommand), "");
});
console.log("Raid seal and mini-pet queries: " + groups + " groups passed");
