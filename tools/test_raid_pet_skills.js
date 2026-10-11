// 레이드 펫스킬 명령·저장 복구·Main/Info 매력 계산을 합성 데이터로 검증한다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
const user = "테스터";
const itemName = "호월토벌대📙 확정(/호월토벌대오픈)";
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
    open: extractCommand('if (msg === "/호월토벌대오픈") {', 'if (msg === "/베란다오픈") {'),
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
        petSkill: { raidSubjugation: {}, largeVerandaItemName: itemName, largeVerandaSkillName: "베란다 대확장", largeVerandaFurnitureSlotBonus: 6, verandaFurnitureSlotBonus: 3, unbindItemName: unbindName },
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
    replier: { reply(message) {
        if (message.indexOf("호월토벌대📙를 획득했습니다!") !== -1) assert.strictEqual(saveCount, 2, "성공 안내 전에 두 파일 저장 필요");
        replies.push(message);
        if (context.replyFailure) throw Error("reply failure");
    } },
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
        if (!skipBackup && context.isProtectedManagedJsonPath(file)) backups[file] = disk[file];
        disk[file] = jsonText;
        saveCount++;
    },
    restoreManagedJsonFromBackup(file) {
        if (!backups[file]) return null;
        disk[file] = backups[file];
        return { data: JSON.parse(backups[file]) };
    },
    loadJsonFile: file => { assert(Object.prototype.hasOwnProperty.call(disk, file), "missing fixture file"); return vm.runInContext("JSON.parse(" + JSON.stringify(disk[file]) + ")", context); },
    normalizePendantTransitionBagItem: (bag, item) => item,
    isHoiPassPremiumActive: () => false,
    canEquipTierPetSkill: () => ({ ok: true }),
    getPetSkillSlotCount: () => context.slotCount,
    slotCount: 30,
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
// 실제 정의와 설정을 읽고, 파일 저장·외부 응답만 메모리로 대체한다.
vm.runInContext("PET_SKILL_LIST = " + source.match(/const PET_SKILL_LIST = (\[[\s\S]*?\n\]);/)[1], context);
vm.runInContext("PET_SKILL_COMPAT_GROUPS = " + source.match(/const PET_SKILL_COMPAT_GROUPS = (\[[\s\S]*?\n\]);/)[1], context);
vm.runInContext("PET_SKILL_FIXED_ACTUAL_RATES = " + source.match(/const PET_SKILL_FIXED_ACTUAL_RATES = (\{[\s\S]*?\n\});/)[1], context);
vm.runInContext("GLOBAL_CONFIG.petSkill.raidSubjugation = " + source.match(/raidSubjugation: (\{[\s\S]*?\n        \})/)[1], context);
vm.runInContext("GLOBAL_CONFIG.petSkillCollection = " + source.match(/petSkillCollection: (\{[\s\S]*?\n    \})/)[1], context);
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
    "rollbackDataSaveTransaction", "saveJsonFile", "getPetSkillTotalRate",
    "getOpenablePetSkillCountByGrade", "getPetSkillFixedActualRateTotal", "getPetSkillActualRate",
    "formatPetSkillRate", "buildTierPetSkillInfoLine", "buildPetSkillInfoMessage", "pickRandomPetSkill",
    "isPetSkillCharmConditionActive", "getEquippedNonTierPetSkillExp", "getPetSkillCollectionTargetList",
    "getPetSkillCollectionCount", "normalizePetSkillStoredNames", "isExclusiveDataMutationCommandMessage"
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
    context.slotCount = 30;
    context.replyFailure = false;
    context.noPet = false;
    replies.length = 0;
}

function read(file) { return JSON.parse(disk[file]); }
function run(message) {
    context.msg = message;
    context.data = context.loadJsonFile(files.member);
    context.petData = context.noPet ? {} : { [user]: { petname: "호호이" } };
    context.petSkillData = context.loadJsonFile(files.skills);
    context.guildData = {};
    replies.length = 0;
    saveCount = 0;
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

// 파일별 계산 함수를 격리해 동일한 합성 매력 요소로 비교한다.
function calculator(filename) {
    const text = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").replace(/\r\n/g, "\n");
    const info = filename === "Info.js";
    const c = {
        GLOBAL_CONFIG: { petSkill: { miniPetSupportCharmRate: 0.5 } },
        calculateCastleItem: () => 0,
        calculateItemInfoAll: () => ({ raidExp: 0, castleExp: 0 }),
        getHomeTotalExp: () => 0,
        getIntimacyExpFromBag: () => 0,
        calculatePetUpgradeCharm: () => 0,
        getPlacedFurnitureCountByGrade: () => 0,
        getHomeBadgeCubeActiveOptionPercent: () => c.homePercent,
        getGuildContributionCubeMemberPercent: () => c.guildPercent,
        getAdventureLevelCharmPercent: () => c.levelPercent,
        getInfoAdventureLevelSummary: () => ({ charmPercent: c.levelPercent }),
        homePercent: 0, guildPercent: 0, levelPercent: 0,
        loadJsonFile: () => { throw Error("calculation must not load files"); },
        saveJsonFile: () => { throw Error("calculation must not save files"); }
    };
    vm.createContext(c);
    if (info) {
        vm.runInContext("GLOBAL_CONFIG.petSkill.charmSkills = " + text.match(/charmSkills: (\{[\s\S]*?\n\t\t\})/)[1], c);
        vm.runInContext(text.match(/const TIER_PET_SKILL_EXP = \{[\s\S]*?\n\};/)[0], c);
    } else {
        vm.runInContext(source.match(/const PET_SKILL_LIST = \[[\s\S]*?\n\];/)[0], c);
    }
    const names = ["normalizePetSkillName", "initPetSkillUser", "getEquippedPetSkillNames", "hasPetSkill",
        "getEquippedNonTierPetSkillExp", "getEquippedTierPetSkillExp", "getMiniPetModeCharm",
        "calculateCastleExp", "calculateRaidExp", "calculateTotalExp",
        info ? "isInfoPetSkillCharmConditionActive" : "isPetSkillCharmConditionActive",
        info ? "applyInfoPercentWithExactFloor" : "applyPercentWithExactFloor"];
    if (!info) names.push("getPetSkillData", "getTierPetSkillSearchName", "getPetModeCharmPercent");
    for (const name of names) {
        const start = text.indexOf("function " + name + "(");
        assert(start >= 0, filename + ": " + name);
        let depth = 0;
        for (let i = text.indexOf("{", start); i < text.length; i++) {
            if (text[i] === "{") depth++;
            if (text[i] === "}" && --depth === 0) {
                vm.runInContext(text.slice(start, i + 1), c);
                break;
            }
        }
    }
    return c;
}

const names = ["레이드정복자", "호월토벌대", "레이드돌격대", "레이드타격대"];
const amounts = [7000000, 3000000, 2000000, 1000000];
const comments = ["이번 보스는 좀 버티려나?", "호월이 어디 있어? 간식 줄게, 나와 봐!", "내가 먼저 간다! 다들 따라와!", "다 같이 치자! 하나, 둘, 셋!"];
let groups = 0;
function group(name, test) { reset(); test(); groups++; console.log("PASS " + name); }
function setSkills(equipped, bag = {}, lockedPremium = []) {
    disk[files.skills] = JSON.stringify({ [user]: { petSkills: { equipped, bag, lockedPremium } } });
}
function bonus(type = "raidExp") {
    return context.getEquippedNonTierPetSkillExp(context.loadJsonFile(files.skills), {}, {}, user, type);
}

group("4 skill grades, effects and probability-free information", () => {
    names.forEach((name, i) => {
        const skill = context.getPetSkillData(name + "📙");
        assert.strictEqual(skill.grade, ["SS", "한정판", "A", "B"][i]);
        assert.strictEqual(skill.raidExp, amounts[i]);
        assert.strictEqual(skill.castleExp, undefined);
        const message = context.buildPetSkillInfoMessage(skill);
        assert(!/확률|%/.test(message), message);
        assert(message.includes("해제하면 지급된 매력은 회수"));
    });
    assert(context.buildPetSkillInfoMessage(context.getPetSkillData("낡은 목검")).includes("확률:"));
});

group("fixed rates preserved, D remainder and limited draw exclusion", () => {
    assert(Math.abs(context.getPetSkillTotalRate() - 100) < 1e-9);
    assert(Math.abs(context.getPetSkillFixedActualRateTotal() - 58.6) < 1e-9);
    for (const [name, rate] of [[names[0], 0.1], [names[1], 0], [names[2], 0.4], [names[3], 0.6]]) {
        assert(Math.abs(context.getPetSkillActualRate(context.getPetSkillData(name)) - rate) < 1e-9);
    }
    assert.strictEqual(context.getOpenablePetSkillCountByGrade("D"), 6);
    const list = context.PET_SKILL_LIST;
    let accumulated = 0;
    for (const skill of list) {
        const weight = context.getPetSkillRandomWeight(skill);
        if (skill.grade === "D") assert(Math.abs(weight - 6.9) < 1e-9);
        if (weight > 0) {
            context.drawRoll = (accumulated + weight / 2) / 100;
            vm.runInContext("Math.random = function () { return drawRoll; }", context);
            assert.strictEqual(context.pickRandomPetSkill().name, skill.name);
        }
        accumulated += weight;
    }
});

group("confirmed open consumes one, grants bag only and saves before success", () => {
    assert.strictEqual(context.GLOBAL_CONFIG.petSkill.raidSubjugation.itemName, itemName);
    const message = run("/호월토벌대오픈");
    assert.strictEqual(message, "🎉 [" + user + "] 님,\n호월토벌대📙를 획득했습니다!\n\n📙 펫스킬가방에 추가되었습니다.\n👉 장착: /펫스킬장착 [번호]");
    assert.strictEqual(saveCount, 2);
    assert.strictEqual(read(files.member).member[user].bag[itemName], undefined);
    assert.strictEqual(read(files.skills)[user].petSkills.bag[names[1]], 1);
    assert.deepStrictEqual(read(files.skills)[user].petSkills.equipped, []);
    assert.strictEqual(bonus(), 0);
    assert.match(run("/호월토벌대오픈"), /아이템이 필요/);
    assert.strictEqual(read(files.skills)[user].petSkills.bag[names[1]], 1);
});

group("two items produce two books without automatically equipping", () => {
    const member = read(files.member);
    member.member[user].bag[itemName] = 2;
    disk[files.member] = JSON.stringify(member);
    run("/호월토벌대오픈");
    run("/호월토벌대오픈");
    assert.strictEqual(read(files.skills)[user].petSkills.bag[names[1]], 2);
    assert.strictEqual(bonus(), 0);
});

group("no pet and full bag never consume, 99 books allow one", () => {
    const before = Object.assign({}, disk);
    context.noPet = true;
    assert.match(run("/호월토벌대오픈"), /펫이 없습니다/);
    assert.deepStrictEqual(disk, before);
    context.noPet = false;
    setSkills([], { "낡은 목검": 100 });
    const full = Object.assign({}, disk);
    assert.match(run("/호월토벌대오픈"), /공간이 부족/);
    assert.deepStrictEqual(disk, full);
    setSkills([], { "낡은 목검": 99 });
    run("/호월토벌대오픈");
    assert.strictEqual(context.getPetSkillBagTotalCount(context.loadJsonFile(files.skills), user), 100);
});

group("exact command guards and exclusive write lock including dev prefix", () => {
    for (const message of ["/호월토벌대오픈 1", "/호월토벌대오픈 해봐", "/호월토벌대오픈확인"]) {
        const before = Object.assign({}, disk);
        assert.strictEqual(run(message), "");
        assert.deepStrictEqual(disk, before);
    }
    context.isDevCommandMessage = text => text.indexOf("dev/") === 0;
    context.stripDevCommandPrefix = text => text.slice(4);
    context.isServerRaidMutationCommand = () => false;
    context.getRaidSealCraftRequest = () => null;
    context.getStoneBoxOpenRequest = () => null;
    context.isSealedVaultMutationCommandMessage = () => false;
    assert(context.isExclusiveDataMutationCommandMessage("/호월토벌대오픈"));
    assert(context.isExclusiveDataMutationCommandMessage("dev//호월토벌대오픈"));
    assert(!context.isExclusiveDataMutationCommandMessage("/호월토벌대오픈 1"));
});

group("equip four distinct skills with exact comments; block same skill", () => {
    setSkills([], Object.fromEntries(names.map(name => [name, 2])));
    let total = 0;
    names.forEach((name, i) => {
        const index = context.getPetSkillBagList(context.loadJsonFile(files.skills), user).indexOf(name) + 1;
        assert(run("/펫스킬장착 " + index).endsWith(name + "📙 " + comments[i]));
        total += amounts[i];
        assert.strictEqual(bonus(), total);
        assert.strictEqual(bonus("castleExp"), 0);
        assert.match(run("/펫스킬장착 " + index), /이미 장착/);
        assert.strictEqual(bonus(), total);
    });
    assert.strictEqual(total, 13000000);
});

group("slot exhaustion, bad arguments and locked premium give no effect", () => {
    setSkills([], { [names[0]]: 1 }, names);
    context.slotCount = 0;
    const before = Object.assign({}, disk);
    assert.match(run("/펫스킬장착 1"), /슬롯이 부족/);
    assert.deepStrictEqual(disk, before);
    for (const command of ["/펫스킬장착 0", "/펫스킬장착 9999", "/펫스킬장착 1 해봐"]) run(command);
    assert.deepStrictEqual(disk, before);
    assert.strictEqual(bonus(), 0);
});

group("unequip removes only own bonus; prior equipped skills remain", () => {
    const member = read(files.member);
    member.member[user].bag[unbindName] = 4;
    disk[files.member] = JSON.stringify(member);
    setSkills(names.concat(["장미칼"]));
    let expected = 13500000;
    for (const amount of amounts) {
        run("/펫스킬소멸 1");
        expected -= amount;
        assert.strictEqual(bonus(), expected);
        assert.strictEqual(bonus("castleExp"), 500000);
    }
    assert.strictEqual(read(files.member).member[user].bag[unbindName], undefined);
});

group("open failures at either save restore both files and allow one retry", () => {
    for (const file of [files.member, files.skills]) {
        reset();
        const before = Object.assign({}, disk);
        failOnceAt = file;
        assert.throws(() => run("/호월토벌대오픈"), /저장 실패 모의/);
        assert.deepStrictEqual(disk, before);
        assert.deepStrictEqual(replies, []);
        run("/호월토벌대오픈");
        assert.strictEqual(read(files.skills)[user].petSkills.bag[names[1]], 1);
        assert.strictEqual(read(files.member).member[user].bag[itemName], undefined);
    }
});

group("equip and unequip save failure restore state", () => {
    setSkills([], { [names[0]]: 1 });
    const before = Object.assign({}, disk);
    failOnceAt = files.skills;
    assert.throws(() => run("/펫스킬장착 1"), /저장 실패 모의/);
    assert.deepStrictEqual(disk, before);
    run("/펫스킬장착 1");
    const equipped = Object.assign({}, disk);
    for (const file of [files.skills, files.member]) {
        failOnceAt = file;
        assert.throws(() => run("/펫스킬소멸 1"), /저장 실패 모의/);
        assert.deepStrictEqual(disk, equipped);
    }
    assert.strictEqual(bonus(), 7000000);
});

group("callback-style reply failure rollback and invalid JSON stay visible", () => {
    const before = Object.assign({}, disk);
    context.replyFailure = true;
    assert.throws(() => run("/호월토벌대오픈"), /reply failure/);
    assert.deepStrictEqual(disk, before);
    context.replyFailure = false;
    disk[files.skills] = "invalid JSON";
    const invalid = Object.assign({}, disk);
    assert.throws(() => run("/호월토벌대오픈"));
    assert.deepStrictEqual(disk, invalid);
});

group("collection includes four new skills and retains name-based records", () => {
    const target = context.getPetSkillCollectionTargetList().map(skill => skill.name);
    names.forEach(name => assert(target.includes(name)));
    setSkills([], { "낡은 목검": 1 });
    const persisted = read(files.skills);
    persisted[user].petSkillCollection = { "낡은 목검": 11, "베란다 대확장": 2 };
    disk[files.skills] = JSON.stringify(persisted);
    run("/호월토벌대오픈");
    assert.deepStrictEqual(read(files.skills)[user].petSkillCollection, persisted[user].petSkillCollection);
    assert.strictEqual(context.getPetSkillCollectionCount(persisted[user].petSkillCollection, "낡은 목검"), 11);
});

group("DEV open and failed save use actual context paths without changing PROD", () => {
    const original = {
        resolve: context.resolveActiveDataPath, load: context.loadJsonFile,
        backup: context.getManagedJsonBackupPath, protected: context.isProtectedManagedJsonPath
    };
    context.DATA_ROOT_PATH = "/sdcard/호이랜드/";
    context.DEV_DATA_ROOT_PATH = "/sdcard/호이랜드_dev/";
    context.COMMON_DATA_FILE_MAP = {};
    context.commandContextThreadLocal = { get: () => context.activeContext };
    for (const name of ["getDataFileName", "createCommandContext", "getCurrentContext", "resolveActiveDataPath"]) {
        vm.runInContext(extractFunction(name), context);
    }
    context.activeContext = context.createCommandContext(true);
    const devMember = context.resolveActiveDataPath(files.member);
    const devSkills = context.resolveActiveDataPath(files.skills);
    const prodMember = context.DATA_ROOT_PATH + files.member;
    const prodSkills = context.DATA_ROOT_PATH + files.skills;
    disk[devMember] = disk[prodMember] = disk[files.member];
    disk[devSkills] = disk[prodSkills] = disk[files.skills];
    context.loadJsonFile = file => original.load(context.resolveActiveDataPath(file));
    context.isProtectedManagedJsonPath = file => /(?:^|\/)(?:member|petSkillData)\.json$/.test(file);
    context.getManagedJsonBackupPath = file => context.isProtectedManagedJsonPath(file) ? file + ".bak" : null;
    try {
        const before = Object.assign({}, disk);
        failOnceAt = devSkills;
        assert.throws(() => run("/호월토벌대오픈"), /저장 실패 모의/);
        assert.deepStrictEqual(disk, before);
        run("/호월토벌대오픈");
        assert.strictEqual(read(devMember).member[user].bag[itemName], undefined);
        assert.strictEqual(read(devSkills)[user].petSkills.bag[names[1]], 1);
        assert.strictEqual(disk[prodMember], before[prodMember]);
        assert.strictEqual(disk[prodSkills], before[prodSkills]);
        assert.strictEqual(disk[files.member], before[files.member]);
        assert.strictEqual(disk[files.skills], before[files.skills]);
    } finally {
        context.activeContext = null;
        context.resolveActiveDataPath = original.resolve;
        context.loadJsonFile = original.load;
        context.getManagedJsonBackupPath = original.backup;
        context.isProtectedManagedJsonPath = original.protected;
    }
});

group("Main/Info parity, percentage order, no mutation and deduplication", () => {
    for (const filename of ["main.js", "Info.js"]) {
        const c = calculator(filename);
        vm.runInContext("fixture = " + JSON.stringify({
            data: { member: { test: { bag: {}, lv: 1, adventureQuest: { totals: { raidPercent: 0.01 } } } } },
            pets: { test: { petname: "합성펫", petexp: 101 } },
            skills: { test: { petSkills: { equipped: names.concat([names[0] + "📙", "장미칼"]), lockedPremium: [], bag: {} } } },
            home: {}
        }), c);
        c.homePercent = 20; c.guildPercent = 3; c.levelPercent = 2;
        const f = c.fixture, before = JSON.stringify(f);
        const raid = Math.floor(13500101 * 1.2501);
        const castle = Math.floor(500101 * 1.25);
        for (let i = 0; i < 5; i++) {
            assert.strictEqual(c.calculateRaidExp("test", f.data, f.pets, f.home, f.skills, false, {}), raid, filename);
            assert.strictEqual(c.calculateCastleExp("test", f.data, f.pets, f.home, f.skills, false, {}), castle, filename);
            assert.strictEqual(c.calculateTotalExp("test", f.data, f.pets, f.home, f.skills, {}), raid + castle, filename);
        }
        assert.strictEqual(JSON.stringify(f), before);
        vm.runInContext('fixture.skills.test.petSkills.equipped = ["장미칼"]', c);
        assert.strictEqual(c.calculateRaidExp("test", f.data, f.pets, f.home, f.skills, false, {}), Math.floor(500101 * 1.2501));
    }
});
console.log("PASS raid pet skills: " + groups + " scenario groups (synthetic storage only)");
