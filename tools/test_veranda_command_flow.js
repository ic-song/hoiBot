const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const user = "테스터";
const itemName = "베란다 대확장📙(/베란다오픈)";
const unbindName = "펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호)";
const files = { member: "member.json", skills: "petSkillData.json", home: "petSweetHomeData.json", placed: "petHomePlacedFurniture.json" };

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name + " 함수 누락");
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name + " 함수 끝을 찾지 못했습니다");
}

function extractCommand(startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert(start >= 0 && end > start, startText + " 명령 분기 누락");
    return "(function () { " + source.slice(start, end) + " })()";
}

const commands = {
    open: extractCommand('if (msg === "/베란다오픈") {', 'if (\n                    msg === "/펫스킬오픈"'),
    equip: extractCommand('if (/^\\/펫스킬장착\\s+\\d+$/.test(msg)) {', 'if (/^\\/펫스킬소멸\\s+\\d+$/.test(msg)) {'),
    unequip: extractCommand('if (/^\\/펫스킬소멸\\s+\\d+$/.test(msg)) {', 'if (msg === "/슈킹")')
};

let disk = {};
let backups = {};
let failOnceAt = null;
let saveCount = 0;
const replies = [];
const threadLocal = { value: null, get() { return this.value; }, set(value) { this.value = value; }, remove() { this.value = null; } };
const context = {
    sender: user,
    GLOBAL_CONFIG: {
        petSkill: { largeVerandaItemName: itemName, largeVerandaSkillName: "베란다 대확장", largeVerandaFurnitureSlotBonus: 6, verandaFurnitureSlotBonus: 3, unbindItemName: unbindName },
        supportPass: { premium: { furnitureSlotBonusCount: 0, furnitureBagBaseCount: 100, furnitureBagBonusCount: 0, skillSlotBonus: 0 } },
        diamondTycoon: { skillName: "광산에서 재벌까지" }
    },
    PET_SKILL_LIST: [
        { name: "베란다 확장", grade: "한정판", limitedEdition: true, openable: false },
        { name: "베란다 대확장", grade: "한정판", limitedEdition: true, openable: false }
    ],
    PET_SKILL_COMPAT_GROUPS: [],
    PET_SKILL_BAG_MAX_COUNT: 100,
    PET_SKILL_MAX_EQUIP_SLOT: 30,
    PET_SKILL_FIXED_ACTUAL_RATES: {},
    filePath: files.member,
    petSkillDataPath: files.skills,
    homeDataFile: files.home,
    petHomePlacedFurniturePath: files.placed,
    dataSaveTransactionThreadLocal: threadLocal,
    dataTransactionLock: { lock() {}, unlock() {} },
    java: { io: { File: function (file) { this.exists = () => Object.prototype.hasOwnProperty.call(disk, file); } } },
    replier: { reply(message) { replies.push(message); } },
    resolveActiveDataPath: value => value,
    getAutoDailyBatchContext: () => null,
    getManagedJsonBackupPath: file => file === files.member || file === files.skills ? file + ".bak" : null,
    isProtectedManagedJsonPath: file => file === files.member || file === files.skills,
    ensureParentFolder: () => {},
    debuggerLog: () => {},
    FileStream: { write() { throw new Error("검증 저장이 아닌 직접 쓰기 호출"); } },
    writeVerifiedJsonFile(file, jsonText, skipBackup) {
        if (failOnceAt === file) {
            failOnceAt = null;
            throw new Error("저장 실패 모의: " + file);
        }
        JSON.parse(jsonText);
        if (!skipBackup && (file === files.member || file === files.skills)) backups[file] = disk[file];
        disk[file] = jsonText;
        saveCount++;
    },
    restoreManagedJsonFromBackup(file) {
        if (!backups[file]) return null;
        disk[file] = backups[file];
        return { data: JSON.parse(backups[file]) };
    },
    loadJsonFile: file => Object.prototype.hasOwnProperty.call(disk, file) ? vm.runInContext("JSON.parse(" + JSON.stringify(disk[file]) + ")", context) : null,
    normalizePendantTransitionBagItem: (bag, item) => item,
    isHoiPassPremiumActive: () => false,
    canEquipTierPetSkill: () => ({ ok: true }),
    getPetSkillSlotCount: () => 30,
    recordAdventureQuestAction: () => false,
    isPrayerSkillName: () => false,
    getTierPetSkillSearchName: () => "",
    numberWithCommas: value => String(value),
    checkRank: () => user,
    getMyGuildInfo: () => null,
    isGuildLeader: () => false,
    hasEquippedCreationMiniPet: () => false
};
vm.createContext(context);
[
    "normalizePetSkillName", "formatPetSkillName", "getPetSkillData", "initPetSkillUser",
    "normalizePetSkillStoredNames", "getPetSkillBagList", "getPetSkillBagTotalCount",
    "getPetSkillBagRemainCount", "addPetSkillToBag", "removePetSkillFromBag",
    "getEquippedPetSkillNames", "hasPetSkill", "isPetSkillCompatible",
    "hasItem", "removeItem", "getFurnitureBagLimit", "getVerandaFurnitureSlotBonus",
    "getFurnitureMaxSlots", "initSweetHomeUser", "buildPlacedFurnitureSummary",
    "normalizePlacedFurnitureSummary", "canCreatePlacedFurnitureData",
    "getPlacedFurnitureList", "requirePlacedFurnitureDataMap", "ensurePlacedFurnitureUser",
    "refreshPlacedFurnitureSummary", "sortFurnitureList", "releaseVerandaExpansionFurniture",
    "getPetSkillRandomWeight", "getDataSaveTransaction", "beginDataSaveTransaction",
    "endDataSaveTransaction", "prepareManagedJsonTransactionEntry",
    "rollbackDataSaveTransaction", "saveJsonFile"
].forEach(name => vm.runInContext(extractFunction(name), context));

function reset() {
    disk = {
        [files.member]: JSON.stringify({ member: { [user]: { bag: { [itemName]: 1, [unbindName]: 2 } } } }),
        [files.skills]: JSON.stringify({ [user]: { petSkills: { equipped: [], lockedPremium: [], bag: { "베란다 확장": 1 } } } }),
        [files.home]: JSON.stringify({ [user]: { floor: 0, furnitureBag: [], placedFurnitureSummary: { count: 0, totalExp: 0, royalLumiereCount: 0, gradeCounts: {} } } }),
        [files.placed]: JSON.stringify({ [user]: [] })
    };
    backups = {};
    failOnceAt = null;
    saveCount = 0;
    replies.length = 0;
}

function read(file) { return JSON.parse(disk[file]); }
function run(message) {
    context.msg = message;
    context.data = context.loadJsonFile(files.member);
    context.petData = { [user]: { petname: "호호이" } };
    context.petSkillData = context.loadJsonFile(files.skills);
    context.guildData = {};
    replies.length = 0;
    backups = {};
    context.beginDataSaveTransaction();
    try {
        vm.runInContext(commands.open, context);
        vm.runInContext(commands.equip, context);
        vm.runInContext(commands.unequip, context);
    } catch (error) {
        context.rollbackDataSaveTransaction();
        throw error;
    } finally {
        context.endDataSaveTransaction();
    }
    return replies.join("\n");
}

function furniture(count) {
    const list = [];
    for (let i = 1; i <= count; i++) list.push({ id: "가구" + i, name: "가구" + i, exp: i, placedAt: i });
    return list;
}
function ids() {
    const home = read(files.home)[user];
    const placed = Object.prototype.hasOwnProperty.call(disk, files.placed) ? read(files.placed)[user] : home.placedFurniture;
    const all = placed.concat(home.furnitureBag).map(item => item.id);
    assert.strictEqual(new Set(all).size, all.length, "가구 중복");
    return { placed, bag: home.furnitureBag, all };
}

reset();
assert.strictEqual(context.getPetSkillRandomWeight(context.PET_SKILL_LIST[1]), 0, "대확장 일반 뽑기 제외");
assert.match(run("/베란다오픈"), /베란다 대확장/);
assert.strictEqual(read(files.member).member[user].bag[itemName], undefined);
assert.strictEqual(read(files.skills)[user].petSkills.bag["베란다 대확장"], 1);
assert.match(run("/펫스킬장착 1"), /1개 → 4개/);
assert.match(run("/펫스킬장착 1"), /4개 → 10개/);
assert.strictEqual(context.getFurnitureMaxSlots(context.loadJsonFile(files.member), context.petData, user, 0, context.loadJsonFile(files.skills)), 10);
assert.match(run("/펫스킬장착 1"), /사용법/); // 빈 가방에서는 장착되지 않음

let placedData = read(files.placed);
placedData[user] = furniture(10);
disk[files.placed] = JSON.stringify(placedData);
let homeData = read(files.home);
homeData[user].placedFurnitureSummary = context.buildPlacedFurnitureSummary(placedData[user]);
disk[files.home] = JSON.stringify(homeData);
const before = Object.assign({}, disk);
for (const failingFile of [files.skills, files.placed, files.home, files.member]) {
    failOnceAt = failingFile;
    assert.throws(() => run("/펫스킬소멸 2"), /저장 실패 모의/);
    assert.deepStrictEqual(disk, before, failingFile + " 저장 실패 후 데이터 복구");
}

assert.match(run("/펫스킬소멸 2"), /6개를 가구가방으로 회수/);
let state = ids();
assert.strictEqual(state.placed.length, 4);
assert.strictEqual(state.bag.length, 6);
assert.deepStrictEqual(state.placed.map(item => item.exp).sort((a, b) => a - b), [7, 8, 9, 10]);
assert.strictEqual(context.getFurnitureMaxSlots(context.loadJsonFile(files.member), context.petData, user, 0, context.loadJsonFile(files.skills)), 4);
assert.match(run("/펫스킬소멸 1"), /3개를 가구가방으로 회수/);
state = ids();
assert.strictEqual(state.placed.length, 1);
assert.strictEqual(state.bag.length, 9);
assert.strictEqual(state.all.length, 10);
assert.strictEqual(read(files.member).member[user].bag[unbindName], undefined);

reset();
run("/베란다오픈");
run("/펫스킬장착 1");
run("/펫스킬장착 1");
placedData = read(files.placed);
placedData[user] = furniture(10);
disk[files.placed] = JSON.stringify(placedData);
homeData = read(files.home);
homeData[user].furnitureBag = furniture(100).map(item => Object.assign({}, item, { id: "가방" + item.id }));
disk[files.home] = JSON.stringify(homeData);
const blockedBefore = Object.assign({}, disk);
assert.match(run("/펫스킬소멸 2"), /가구가방 공간이 부족/);
assert.deepStrictEqual(disk, blockedBefore, "가구가방 만석 시 상태 변경");

reset();
run("/베란다오픈");
run("/펫스킬장착 1");
run("/펫스킬장착 1");
homeData = read(files.home);
homeData[user].placedFurniture = furniture(10);
homeData[user].placedFurnitureSummary = context.buildPlacedFurnitureSummary(homeData[user].placedFurniture);
disk[files.home] = JSON.stringify(homeData);
delete disk[files.placed];
assert.match(run("/펫스킬소멸 2"), /6개를 가구가방으로 회수/);
assert.strictEqual(Object.prototype.hasOwnProperty.call(disk, files.placed), false, "기존 형식에서 상세 파일을 임의 생성함");
assert.strictEqual(read(files.home)[user].placedFurniture.length, 4);
assert.strictEqual(read(files.home)[user].furnitureBag.length, 6);

reset();
const wrongCommandBefore = Object.assign({}, disk);
assert.strictEqual(run("/베란다오픈 해봐"), "");
assert.deepStrictEqual(disk, wrongCommandBefore);
disk[files.member] = JSON.stringify({ member: { [user]: { bag: { [unbindName]: 2 } } } });
assert.match(run("/베란다오픈"), /아이템이 필요/);
assert.strictEqual(read(files.skills)[user].petSkills.bag["베란다 대확장"], undefined);
console.log("PASS veranda command integration: open, equip, stack, remove, rollback, bag limit, guard");
