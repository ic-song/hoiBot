// 매력 진단의 원본 합계·퀘스트 포함 비율을 실제 Main/Info 계산과 대조한다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");

// 검증 대상 함수만 운영 파일 IO 없이 실행한다.
function fn(text, name) {
    const start = text.indexOf("function " + name + "(");
    assert(start >= 0, name);
    let depth = 0;
    for (let i = text.indexOf("{", start); i < text.length; i++) {
        if (text[i] === "{") depth++;
        if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
    }
    throw Error(name);
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

// 보너스 원본은 합성 값으로 고정하고, 계산·진단 함수는 실제 소스를 실행한다.
function setup(filename, base = 57440000, questRaid = 0.08, questCastle = 0.005) {
    const c = calculator(filename);
    c.homePercent = 33.6;
    c.guildPercent = 0;
    c.levelPercent = 2.15;
    c.numberWithCommas = n => Number(n).toLocaleString("en-US");
    c.checkRank = (_d, _p, _g, user) => user;
    c.HoiBotVersion = source.match(/const HoiBotVersion = "([^"]+)"/)[1];
    c.isHoiPassPremiumActive = () => false;
    c.calculateEffectivePetUpgradeLevel = () => 0;
    c.GLOBAL_CONFIG.pet = { totalCharmPerUpgrade: 1000 };
    c.GLOBAL_CONFIG.supportPass = { premium: { cubeOptionBonusPercent: 1 } };
    c.getHomeBadgeCubeOptionDebugDetail = (_d, _u, key) => ({
        equippedBadgeIds: ["합성뱃지", null], basePercent: key === "petUpgrade" ? 0 : c.homePercent,
        totalBuffAppliedPercent: key === "petUpgrade" ? 0 : c.homePercent,
        totalBuffActive: false, premiumBonusPercent: 0, appliedPercent: key === "petUpgrade" ? 0 : c.homePercent
    });
    if (filename === "main.js") {
        for (const name of ["buildCharmBuffDebugMessage", "buildTotalExpTimeCheckDetail",
            "formatHomeBadgeCubeDebugOptionFormula", "formatHomeBadgeCubeCardPercent",
            "removePercentWithExactCeil", "formatAdventureLevelPercent", "formatAdventureQuestPercent"]) {
            vm.runInContext(fn(source, name), c);
        }
    }
    vm.runInContext("f = " + JSON.stringify({
        data: { member: { test: { bag: {}, lv: 1, adventureQuest: { totals: { raidPercent: questRaid, castlePercent: questCastle } } } } },
        pets: { test: { petname: "합성펫", petexp: base, upgrade: 0 } }, home: {},
        skills: { test: { petSkills: { equipped: [], lockedPremium: [], bag: {} } } }, guild: {}
    }), c);
    return c;
}

// 실제 진단 UI를 입력 스냅샷 변경 없이 생성한다.
function report(c) {
    const f = c.f, before = JSON.stringify(f);
    const result = c.buildCharmBuffDebugMessage(f.data, f.pets, f.home, f.skills, f.guild, "test");
    assert.strictEqual(JSON.stringify(f), before, "진단에서 재화·장비·퀘스트 변경 금지");
    return result;
}

let groups = 0;
function group(name, run) { run(); groups++; console.log("PASS " + name); }

group("quest bonus kept out of raw base and logged with exact precision", () => {
    const c = setup("main.js"), out = report(c);
    const raid = out.split("[레이드매력]")[1].split("[종합매력]")[0];
    assert(raid.includes("기본 매력: 57,440,000"), raid);
    assert(raid.includes("모험가 레벨: +2.15%"), raid);
    assert(raid.includes("퀘스트: +0.08%"), raid);
    assert(raid.includes("합산 버프: +35.83%"), raid);
    assert(raid.includes("78,020,752 / 공용함수 78,020,752 [✅일치]"), raid);
    assert(!out.includes("[❌불일치]"), out);
    assert(out.includes("퀘스트: +0.005%"), out);
});

group("Main/Info independent arithmetic once; absence, zero and small quest values", () => {
    for (const quest of [0, 0.005, 0.08, 1.235]) {
        for (const filename of ["main.js", "Info.js"]) {
            const c = setup(filename, 57440000, quest, 0), f = c.f;
            const expected = Number(57440000n * BigInt(100000 + 33600 + 2150 + Math.round(quest * 1000)) / 100000n);
            assert.strictEqual(c.calculateRaidExp("test", f.data, f.pets, f.home, f.skills, false, f.guild), expected);
            if (filename === "main.js") assert(!report(c).includes("[❌불일치]"));
            delete f.data.member.test.adventureQuest;
            const expectedWithoutQuest = 77974800;
            assert.strictEqual(c.calculateRaidExp("test", f.data, f.pets, f.home, f.skills, false, f.guild), expectedWithoutQuest);
        }
    }
});

group("small floor boundaries preserve actual integer base", () => {
    for (const base of [0, 1, 3, 99, 101, 100005, 4000000000001]) {
        const c = setup("main.js", base, 0.005, 0.01), f = c.f;
        const detail = c.buildTotalExpTimeCheckDetail("test", f.data, f.pets, f.home, f.skills, f.guild);
        assert.strictEqual(detail.raidBase, base);
        assert.strictEqual(detail.castleBase, base);
        assert(!report(c).includes("[❌불일치]"));
    }
});

group("all constituent values remain visible even with zero millisecond timings", () => {
    const c = setup("main.js", 7, 0.08, 0.005), f = c.f;
    c.calculateCastleItem = () => 123;
    c.calculateItemInfoAll = () => ({ castleExp: 10, raidExp: 11 });
    c.getIntimacyExpFromBag = () => 200;
    c.getHomeTotalExp = () => 125;
    vm.runInContext('f.skills.test.petSkills.equipped = ["레이드정복자", "호월토벌대", "레이드돌격대", "레이드타격대", "장미칼", "인테리어 장인"]; f.pets.test.miniPet = {battleExp:101}; f.pets.test.miniPetSupport = {battleExp:5}; Date.now = function () { return 100; }', c);
    const detail = c.buildTotalExpTimeCheckDetail("test", f.data, f.pets, f.home, f.skills, f.guild);
    assert.strictEqual(detail.raidBase, 13500258);
    assert.strictEqual(detail.castleBase, 500580);
    assert(detail.rows.every(row => row.ms === 0));
    const out = report(c);
    for (const text of ["레이드-정령/반지/펜던트/가방", "레이드-펫스킬: 13,500,000", "레이드-홈/가구: 137", "캐슬-친밀도: 200"]) {
        assert(out.includes(text), out);
    }
    assert(!out.includes("[❌불일치]"));
});

group("five repeated reads preserve snapshots and totals", () => {
    const c = setup("main.js"), expected = report(c);
    for (let i = 0; i < 5; i++) assert.strictEqual(report(c), expected);
});
console.log("PASS charm buff diagnostics: " + groups + " groups (synthetic data, no runtime IO)");
