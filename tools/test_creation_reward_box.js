const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// 현재 소스의 함수만 추출해 합성 데이터로 실행한다.
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

const boxConfig = source.match(/creationRewardBox: (\{[\s\S]*?\n        \})/)[1];
const openStart = source.indexOf('if (msg === "/창세오픈") {');
const openEnd = source.indexOf('// /컬렉션창세오픈', openStart);
const openCommand = "(function () {" + source.slice(openStart, openEnd) + "})()";
const user = "합성테스터";
const files = { member: "/sdcard/호이랜드_dev/member.json", pet: "/sdcard/호이랜드_dev/member_pet.json" };
let disk, backups, failure, saves;
const replies = [];
const threadLocal = { value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } };
const c = {
    sender: user, filePath: files.member, memberPetPath: files.pet, guildData: {}, allsee: "<ALLSEE>",
    castleSiegeFlag: false, dataSaveTransactionThreadLocal: threadLocal,
    dataTransactionLock: { lock() {}, unlock() {} },
    GLOBAL_CONFIG: { guaranteedPackage: {}, package: { maxUseOnce: 1000 }, supportPass: { premium: { miniPetBagBaseCount: 10, miniPetBagBonusCount: 5 } } },
    miniPetData: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "miniPetData.json"), "utf8")),
    normalizePendantTransitionBagItem: (_bag, name) => name,
    normalizeItemName: name => name,
    numberWithCommas: n => Number(n).toLocaleString("en-US"), checkRank: () => user,
    isHoiPassPremiumActive: () => c.premium === true,
    replier: { reply(message) { replies.push(message); } },
    resolveActiveDataPath: p => p, getAutoDailyBatchContext: () => null,
    getManagedJsonBackupPath: p => p + ".bak", isProtectedManagedJsonPath: () => true,
    ensureParentFolder: () => {}, debuggerLog: () => {},
    java: { io: { File: function (p) { this.exists = () => Object.hasOwn(disk, p); } } },
    writeVerifiedJsonFile(p, json, skipBackup) {
        if (failure === p) { failure = null; throw Error("synthetic save failure"); }
        JSON.parse(json);
        if (!skipBackup) backups[p] = disk[p];
        disk[p] = json;
        saves++;
    },
    restoreManagedJsonFromBackup(p) {
        assert(backups[p]); disk[p] = backups[p]; return { data: JSON.parse(disk[p]) };
    },
    FileStream: { write() { throw Error("Unexpected direct file write"); } }
};
vm.createContext(c);
vm.runInContext("GLOBAL_CONFIG.guaranteedPackage.creationRewardBox = " + boxConfig, c);
vm.runInContext("GLOBAL_CONFIG.guaranteedPackage.genesis = " + source.match(/genesis: (\{[\s\S]*?\n        \})/)[1], c);
// 가방 출력이 참조하는 기존 운영 설정은 이 테스트의 대상이 아니므로 자리만 제공한다.
for (const match of fn("generateBagOutput").matchAll(/GLOBAL_CONFIG\.([\w]+)\.([\w]+)/g)) {
    if (!c.GLOBAL_CONFIG[match[1]]) c.GLOBAL_CONFIG[match[1]] = {};
    c.GLOBAL_CONFIG[match[1]][match[2]] = "기존설정:" + match[1] + "." + match[2];
}
for (const name of ["hasItem", "removeItem", "addItem", "normalizeMiniPetRewardBoxItemName", "getOwnedMiniPetRewardBoxItem", "getMiniPetBagLimit", "sortMiniPetBag", "refreshMiniPetSortIndex", "getMiniPetModeCharm",
    "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "saveJsonFile",
    "getPackageBagItemName", "getUserPackageBagList", "getPackageByListNumber", "assertPackageLogData", "appendPackageLog", "formatPackageRewardSummary",
    "parsePackageRewardSpec", "parsePackageNaturalItemRewardSpec", "formatPackageRewardLines", "buildPackageRewardChoiceMessage", "handlePackageAddFlowMessage", "createPackageIdFromName", "addPackageInfoByCommand", "parsePackageGrantCommand", "grantPackageToUser",
    "parsePackageUseCommand", "validatePackageUse", "applyPackageRewards", "usePackageFromBag", "generateBagOutput", "buildPackageAddGuideMessage"])
    vm.runInContext(fn(name), c);

const item = c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox.itemName;
function read(p) { return JSON.parse(disk[p]); }
function reload() {
    c.data = vm.runInContext("JSON.parse(" + JSON.stringify(disk[files.member]) + ")", c);
    c.petData = vm.runInContext("JSON.parse(" + JSON.stringify(disk[files.pet]) + ")", c);
}
function reset(count = 1, bagSize = 0, premium = false) {
    c.premium = premium;
    const bag = Array.from({ length: bagSize }, (_, i) => ({ name: "기존" + i, emoji: "🐹", grade: "일반", battleExp: i, castleExp: i, raidExp: i, sortIndex: i + 1 }));
    disk = { [files.member]: JSON.stringify({ member: { [user]: { bag: count ? { [item]: count } : {}, point: 123 } } }), [files.pet]: JSON.stringify({ [user]: { miniPetBag: bag } }) };
    backups = {}; failure = null; saves = 0; replies.length = 0; reload();
}
function run(msg = "/창세오픈", command = openCommand) {
    reload(); c.msg = msg; replies.length = 0; backups = {};
    c.beginDataSaveTransaction();
    try { vm.runInContext(command, c); }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.endDataSaveTransaction(); }
    return replies.join("\n");
}

// 1. 실제 등록·지급·패키지가방·사용·일반가방을 거쳐 보상상자를 획득한다.
reset(0);
vm.runInContext("packageList = []; packageLogs = { lastId: 0, logs: [] };", c);
const added = c.addPackageInfoByCommand("운영자", "/패키지추가 합성패키지🎁 | 합성 설명 | item:" + item + ":2", c.packageList);
assert(added.ok);
assert(c.grantPackageToUser(c.data, "운영자", "/패키지지급 " + user + " 1 1", c.packageList, c.packageLogs).ok);
assert.strictEqual(c.getUserPackageBagList(c.data, user, c.packageList).length, 1);
assert(c.usePackageFromBag(c.data, c.petData, {}, user, "/패키지사용 1", c.packageList, c.packageLogs).ok);
assert.strictEqual(c.data.member[user].bag[item], 2);
assert.strictEqual(c.getUserPackageBagList(c.data, user, c.packageList).length, 0);
assert(c.generateBagOutput(c.data.member[user].bag).bagOutput.includes(item));
assert.deepStrictEqual(Array.from(c.packageLogs.logs, log => log.type), ["GRANT", "USE"]);
disk[files.member] = JSON.stringify(c.data);
assert(run().includes("호이똥💩(+990,000💞)[창세]"));
assert.strictEqual(read(files.member).member[user].bag[item], 1);
const pet = read(files.pet)[user].miniPetBag[0];
assert.deepStrictEqual([pet.name, pet.emoji, pet.grade, pet.battleExp, pet.castleExp, pet.raidExp], ["호이똥", "💩", "창세", 990000, 990000, 990000]);
assert(c.buildPackageAddGuideMessage().includes("item:" + item + ":1"));
console.log("PASS 1: 기존 패키지 등록·지급·가방·사용 연동");

// 2. 미보유, 일반/프리미엄 가방 한도에서는 차감·저장이 없다.
for (const [count, bagSize, premium] of [[0, 0, false], [1, 10, false], [1, 15, true]]) {
    reset(count, bagSize, premium); const before = JSON.stringify(disk);
    run(); assert.strictEqual(JSON.stringify(disk), before); assert.strictEqual(saves, 0);
}
for (const [size, premium] of [[9, false], [14, true]]) {
    reset(1, size, premium); run(); assert.strictEqual(read(files.pet)[user].miniPetBag.length, size + 1);
}
console.log("PASS 2: 미보유와 일반·프리미엄 한도 경계");

// 3. 재로드 후 재요청·잘못된 접미 입력은 추가 보상을 지급하지 않는다.
reset(); run(); const consumed = JSON.stringify(disk); run();
assert.strictEqual(JSON.stringify(disk), consumed);
reset(); const beforeInvalid = JSON.stringify(disk);
for (const msg of ["/창세오픈 1", "/창세오픈 해봐", "/창세오픈방법"]) run(msg);
assert.strictEqual(JSON.stringify(disk), beforeInvalid);
reset(2); run(); run();
assert.strictEqual(read(files.pet)[user].miniPetBag.length, 2);
assert(!read(files.member).member[user].bag[item]);
console.log("PASS 3: 재요청·연속 오픈·잘못된 명령어 차단");

// 4. 실제 저장 트랜잭션으로 첫/두 번째 파일 저장 실패 후 재시작 상태를 검증한다.
for (const file of [files.pet, files.member]) {
    reset(); const before = JSON.stringify(disk); failure = file;
    assert.throws(() => run(), /synthetic save failure/);
    assert.strictEqual(JSON.stringify(disk), before);
    assert.strictEqual(replies.length, 0);
    reload(); assert.strictEqual(c.data.member[user].bag[item], 1);
    assert.strictEqual(c.petData[user].miniPetBag.length, 0);
    run(); assert.strictEqual(read(files.pet)[user].miniPetBag.length, 1);
}
console.log("PASS 4: 두 저장 지점 실패·롤백·재시작·재시도");

// 5. 새 미니펫의 정렬 번호와 기존 대표100%·보조50% 계산 호환성을 검증한다.
reset(2, 2); run(); run(); reload();
const newPets = c.petData[user].miniPetBag.filter(p => p.name === "호이똥");
assert.strictEqual(newPets.length, 2);
assert.notStrictEqual(newPets[0], newPets[1]);
assert.deepStrictEqual(Array.from(c.petData[user].miniPetBag, p => p.sortIndex), [1, 2, 3, 4]);
c.petData[user].miniPet = newPets[0]; c.petData[user].miniPetSupport = newPets[1];
assert.strictEqual(c.getMiniPetModeCharm(user, c.petData), 1485000);
newPets[0].battleExp++; assert.strictEqual(newPets[1].battleExp, 990000);
assert(source.includes('if (msg === "/창조오픈")'));
console.log("PASS 5: 정렬·독립 개체·기존 매력 계산 호환");

// 구·신규 이름이 함께 있어도 1회에 한 종류 1개만 소모하고 두 보상을 혼동하지 않는다.
const genesisStart = source.indexOf('if (msg === "/창조오픈") {');
const genesisEnd = source.indexOf('// 기존 이름 또는 신규 창세등급 확정', genesisStart);
const genesisCommand = "(function () {" + source.slice(genesisStart, genesisEnd) + "})()";
const creation = c.GLOBAL_CONFIG.guaranteedPackage.genesis;
for (const box of [creation, c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox]) {
    for (const heldName of [...box.legacyItemNames, box.itemName]) {
        reset(0);
        const member = read(files.member);
        member.member[user].bag[heldName] = 1;
        disk[files.member] = JSON.stringify(member);
        if (box === creation) {
            reload(); c.msg = "/창조오픈"; backups = {};
            c.beginDataSaveTransaction();
            try { vm.runInContext(genesisCommand, c); }
            finally { c.endDataSaveTransaction(); }
        } else run();
        assert(!read(files.member).member[user].bag[heldName]);
        assert.strictEqual(read(files.pet)[user].miniPetBag[0].name, box.reward.name);
        assert.strictEqual(read(files.pet)[user].miniPetBag[0].grade, box.reward.grade);
        assert.strictEqual(read(files.pet)[user].miniPetBag[0].battleExp, box.reward.battleExp);
    }
}
reset(1);
let mixed = read(files.member);
const legacyGenesisItem = creation.legacyItemNames[0];
const legacyGenesisBox = c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox.legacyItemNames[0];
mixed.member[user].bag[legacyGenesisBox] = 1;
mixed.member[user].bag[legacyGenesisItem] = 2;
disk[files.member] = JSON.stringify(mixed);
run();
assert.strictEqual(read(files.member).member[user].bag[item], 1);
assert.strictEqual(read(files.member).member[user].bag[legacyGenesisItem], 2);
assert(!read(files.member).member[user].bag[legacyGenesisBox]);
run(); assert.strictEqual(read(files.pet)[user].miniPetBag.length, 2);
assert.strictEqual(read(files.member).member[user].bag[legacyGenesisItem], 2);
// 기존 패키지 구성품은 설정을 덮어쓰지 않고 신규 이름으로 지급한다.
reset(0);
for (const box of [creation, c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox]) {
    for (const legacyName of box.legacyItemNames) {
        c.applyPackageRewards(c.data, user, { rewards: [{ type: "item", name: legacyName, count: 1 }] }, 1);
        assert(c.data.member[user].bag[box.itemName] >= 1);
        assert(!c.data.member[user].bag[legacyName]);
    }
}
console.log("PASS 6: 기존·신규 아이템 호환, 1개 소모, 보상 구분, 기존 패키지 구성품 연동");

// 7. 콜론·자연어·단계별 등록 모두 기존 아이템명을 동일한 신규 이름으로 저장한다.
for (const box of [creation, c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox]) {
    for (const legacy of box.legacyItemNames) {
        for (const spec of ["item:" + legacy + ":2", legacy + " x2"]) {
            const parsed = c.parsePackageRewardSpec(spec);
            assert.strictEqual(parsed.rewards[0].name, box.itemName);
            assert.strictEqual(parsed.rewards[0].count, 2);
        }
        vm.runInContext("userState = {}; userState[sender] = { packageAdd: { step: 'ITEM_COUNT', pendingReward: { name: " + JSON.stringify(legacy) + " }, rewards: [] } };", c);
        assert(c.handlePackageAddFlowMessage(user, "2", c.packageList).ok);
        assert.strictEqual(c.userState[user].packageAdd.rewards[0].name, box.itemName);
    }
}
assert.strictEqual(c.parsePackageRewardSpec("item:다른상자🎁:3").rewards[0].name, "다른상자🎁");
assert.strictEqual(c.parsePackageRewardSpec("point:100").rewards[0].count, 100);
console.log("PASS 7: 세 가지 등록 방식의 이름 일치·다른 구성품 유지");

// 8. 두 등급의 모든 구·신규 아이템을 저장 실패·가방 한도·재시도 조건으로 대조한다.
for (const box of [creation, c.GLOBAL_CONFIG.guaranteedPackage.creationRewardBox]) {
    const msg = box === creation ? "/창조오픈" : "/창세오픈";
    const command = box === creation ? genesisCommand : openCommand;
    for (const heldName of [...box.legacyItemNames, box.itemName]) {
        for (const file of [files.pet, files.member]) {
            reset(0); const member = read(files.member); member.member[user].bag[heldName] = 2;
            disk[files.member] = JSON.stringify(member); const before = JSON.stringify(disk); failure = file;
            assert.throws(() => run(msg, command), /synthetic save failure/);
            assert.strictEqual(JSON.stringify(disk), before);
            assert.strictEqual(replies.length, 0);
            run(msg, command);
            assert.strictEqual(read(files.member).member[user].bag[heldName], 1);
            assert.strictEqual(read(files.pet)[user].miniPetBag.length, 1);
            assert.strictEqual(read(files.pet)[user].miniPetBag[0].name, box.reward.name);
        }
        reset(0, 10); const member = read(files.member); member.member[user].bag[heldName] = 2;
        disk[files.member] = JSON.stringify(member); const before = JSON.stringify(disk);
        run(msg, command); assert.strictEqual(JSON.stringify(disk), before); assert.strictEqual(saves, 0);
    }
}
console.log("PASS 8: 두 등급 구·신규 보유분의 실패·미소모·재시도 일관성");
