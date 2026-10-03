const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sources = ["main.js", "Info.js"].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8"));

// 현재 계산 함수를 운영 데이터 없이 격리 실행한다.
function fn(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error("unclosed function: " + name);
}

// 다른 매력 요소는 합성 값으로 고정하고 스킬·슬롯·비율 계산은 실제 함수를 사용한다.
function context(source, isInfo) {
    const c = {
        calculateCastleItem: () => 0,
        calculateItemInfoAll: () => ({ castleExp: 0, raidExp: 0 }),
        getHomeTotalExp: () => 0,
        getIntimacyExpFromBag: () => 0,
        getOwnedFurnitureCountByGrade: home => home.arcanaCount || 0,
        getPlacedFurnitureCountByGrade: home => home.royalCount || 0,
        getHomeBadgeCubeActiveOptionPercent: (_data, _user, mode) => c.percent.home[mode] || 0,
        getGuildContributionCubeMemberPercent: (_data, _guild, _user, mode) => c.percent.guild[mode] || 0,
        getAdventureLevelCharmPercent: () => c.percent.level,
        getInfoAdventureLevelSummary: () => ({ charmPercent: c.percent.level }),
        calculatePetUpgradeCharm: () => 0,
        numberWithCommas: n => Number(n).toLocaleString("en-US"),
        checkRank: (_data, _pets, _guild, user) => user,
        getRankEmoji: n => "R" + n,
        loadJsonFile: () => { throw Error("unexpected calculation IO"); },
        saveJsonFile: () => { throw Error("unexpected calculation save"); },
        percent: { home: {}, guild: {}, level: 0 },
        GLOBAL_CONFIG: { petSkill: { miniPetSupportCharmRate: Number(source.match(/miniPetSupportCharmRate:\s*([\d.]+)/)[1]) } }
    };
    vm.createContext(c);
    if (isInfo) {
        vm.runInContext("GLOBAL_CONFIG.petSkill.charmSkills = " + source.match(/charmSkills: (\{[\s\S]*?\n\t\t\})/)[1], c);
        vm.runInContext(source.match(/const TIER_PET_SKILL_EXP = \{[\s\S]*?\n\};/)[0], c);
    } else {
        vm.runInContext(sources[0].match(/const PET_SKILL_LIST = \[[\s\S]*?\n\];/)[0], c);
        vm.runInContext(sources[0].match(/const PET_SKILL_FIXED_ACTUAL_RATES = \{[\s\S]*?\n\};/)[0], c);
    }
    const names = ["normalizePetSkillName", "initPetSkillUser", "getEquippedPetSkillNames", "hasPetSkill", "isElite",
        "getMiniPetSkillCharmRate", "hasEquippedCreationMiniPet", "getEquippedNonTierPetSkillExp", "getEquippedTierPetSkillExp",
        "getMiniPetModeCharm", "calculateCastleExp", "calculateRaidExp", "calculateTotalExp",
        isInfo ? "isInfoPetSkillCharmConditionActive" : "isPetSkillCharmConditionActive",
        isInfo ? "applyInfoPercentWithExactFloor" : "applyPercentWithExactFloor"];
    if (isInfo) names.push("generateCastleRanking", "generateRaidRanking");
    else names.push("getPetModeCharmPercent", "getTierPetSkillSearchName", "getPetSkillData", "getTotalMinipetExp", "buildTotalExpTimeCheckDetail",
        "getPetSkillTotalRate", "getOpenablePetSkillCountByGrade", "getPetSkillFixedActualRateTotal", "getPetSkillRandomWeight",
        "getPetSkillActualRate", "formatPetSkillRate", "buildPetSkillInfoMessage", "formatPetSkillName", "buildTierPetSkillInfoLine",
        "buildMiniPetInfoRenewedMessage", "getMiniPetDisplayTitle",
        "buildGuildTerritoryCastleExpSnapshots", "fillGuildTerritoryCastleExpSnapshots", "createGuildTerritoryCastleBattleSnapshot");
    for (const name of names) vm.runInContext(fn(source, name), c);
    return c;
}
const contexts = sources.map((source, i) => context(source, i === 1));
let groups = 0;
function group(name, run) { run(); groups++; console.log("PASS " + name); }

// VM 내부 배열로 생성해 실제 Rhino 방식 instanceof Array 초기화와 함께 검증한다.
function fixture(c, primary, support, equipped = ["창조림", "엘리트 박사"]) {
    const p = grade => grade ? { grade, name: grade, emoji: "🐹", battleExp: 0 } : null;
    const input = {
        data: { member: { test: { bag: {}, lv: 1, battle: { score: 0 } } } },
        pets: { test: { petname: "합성펫", petimg: "🐶", pettitle: "", petexp: 0,
            miniPet: p(primary), miniPetSupport: p(support), miniPetBag: [p("창조"), p("엘리트")] } },
        skills: { test: { petSkills: { equipped, lockedPremium: [], bag: { "창조림": 1, "엘리트 박사": 1 } } } },
        home: {}
    };
    vm.runInContext("fixture = " + JSON.stringify(input), c);
    c.percent = { home: {}, guild: {}, level: 0 };
    return c.fixture;
}
function values(c, f) {
    return [c.calculateCastleExp("test", f.data, f.pets, f.home, f.skills, false, {}),
        c.calculateRaidExp("test", f.data, f.pets, f.home, f.skills, false, {}),
        c.calculateTotalExp("test", f.data, f.pets, f.home, f.skills, {})];
}

group("representative/support/both/mixed grade formula parity", () => {
    const cases = [
        ["창조", null, 500000], [null, "창조", 250000], ["창조", "창조", 750000],
        ["엘리트", null, 1500000], [null, "엘리트", 750000], ["엘리트", "엘리트", 2250000],
        ["창조", "엘리트", 1250000], ["엘리트", "창조", 1750000],
        ["일반", "일반", 0], ["창세", "창세", 0], [null, null, 0]
    ];
    for (const [primary, support, expected] of cases) for (const c of contexts) {
        const f = fixture(c, primary, support);
        assert.deepStrictEqual(values(c, f), [expected, expected, expected * 2]);
    }
});

group("inventory only, unequipped/locked skills and duplicate aliases", () => {
    for (const c of contexts) {
        assert.deepStrictEqual(values(c, fixture(c, null, null)), [0, 0, 0]);
        const f = fixture(c, "창조", "엘리트", []);
        vm.runInContext('fixture.skills.test.petSkills.lockedPremium = ["창조림", "엘리트 박사"]', c);
        assert.deepStrictEqual(values(c, f), [0, 0, 0]);
        assert.deepStrictEqual(values(c, fixture(c, "창조", "창조", ["창조림", "창조림📙", "[펫스킬북]창조림"])), [750000, 750000, 1500000]);
        assert.strictEqual(c.getMiniPetSkillCharmRate({}, "missing", "creationMiniPet"), 0);
    }
});

group("legacy elite grade spellings retained and creation grade exact", () => {
    for (const c of contexts) for (const grade of ["엘리트", "엘리트급", "ELITE"]) {
        assert.deepStrictEqual(values(c, fixture(c, grade, grade)), [2250000, 2250000, 4500000]);
    }
    for (const c of contexts) for (const grade of ["창세", "창조+", "마스터"]) {
        assert.deepStrictEqual(values(c, fixture(c, grade, grade)), [0, 0, 0]);
    }
});

group("raw pet charm plus conditional bonus without double halving", () => {
    for (const c of contexts) {
        const f = fixture(c, "창조", "엘리트");
        f.pets.test.miniPet.battleExp = 101;
        f.pets.test.miniPetSupport.battleExp = 5;
        assert.strictEqual(c.getMiniPetModeCharm("test", f.pets), 103);
        assert.deepStrictEqual(values(c, f), [1250103, 1250103, 2500206]);
        if (c.getTotalMinipetExp) assert.strictEqual(c.getTotalMinipetExp("test", f.pets), 206);
    }
});

group("equipment changes, repeated queries and restart without accumulation", () => {
    for (const c of contexts) {
        const f = fixture(c, "창조", "창조", ["창조림"]);
        const before = JSON.stringify(f);
        for (let i = 0; i < 5; i++) assert.strictEqual(values(c, f)[2], 1500000);
        assert.strictEqual(JSON.stringify(f), before);
        f.pets.test.miniPet = null;
        assert.strictEqual(values(c, f)[2], 500000);
        f.pets.test.miniPet = f.pets.test.miniPetSupport;
        f.pets.test.miniPetSupport = null;
        assert.strictEqual(values(c, f)[2], 1000000);
        const restored = context(c === contexts[1] ? sources[1] : sources[0], c === contexts[1]);
        vm.runInContext("fixture = " + JSON.stringify(f), restored);
        assert.strictEqual(values(restored, restored.fixture)[2], 1000000);
        vm.runInContext("fixture.skills.test.petSkills.equipped = []", c);
        assert.strictEqual(values(c, f)[2], 0);
    }
});

group("unrelated weapon/furniture/tier skill stacking preserved", () => {
    for (const c of contexts) {
        const f = fixture(c, "창조", "엘리트", ["창조림", "엘리트 박사", "장미칼", "아르카나 하우스", "🪽 엠퍼러의 천공 날개"]);
        assert.deepStrictEqual(values(c, f), [1850000, 1850000, 3700000]);
        f.home.arcanaCount = 4;
        assert.strictEqual(values(c, f)[2], 3700000);
        f.home.arcanaCount = 5;
        assert.deepStrictEqual(values(c, f), [2350000, 2350000, 4700000]);
    }
});

group("existing percentage order and exact floor in both files", () => {
    for (const c of contexts) {
        const f = fixture(c, "창조", "엘리트");
        f.pets.test.miniPet.battleExp = 101;
        f.pets.test.miniPetSupport.battleExp = 5;
        c.percent = { home: { castle: 10, raid: 20 }, guild: { castle: 5, raid: 3 }, level: 2 };
        f.data.member.test.adventureQuest = { totals: { castlePercent: 0.005, raidPercent: 0.01 } };
        const expected = [1462683, 1562753, 3025436]; // 1,250,103에 17.005% / 25.010% 적용 후 내림
        assert.deepStrictEqual(values(c, f), expected);
        assert.strictEqual(c.calculateCastleExp("test", f.data, f.pets, f.home, f.skills, true, {}), 1337672);
    }
});

group("castle/raid leaderboard sorting and displayed scores agree with pet info", () => {
    const c = contexts[1], f = fixture(c, "창조", "창조", ["창조림"]);
    f.pets.plain = { petname: "기본펫", petimg: "🐶", pettitle: "", petexp: 700000 };
    f.data.member.plain = { bag: {}, lv: 1 };
    for (const [name, mode] of [["generateCastleRanking", "castle"], ["generateRaidRanking", "raid"]]) {
        const out = c[name](f.pets, f.data, f.home, {}, f.skills).rankingMsg1;
        assert(out.indexOf("합성펫") < out.indexOf("기본펫"), mode + " ordering");
        assert(out.includes("750,000") && out.includes("700,000"));
    }
});

group("skill information contains current rates and slot amounts", () => {
    const c = contexts[0];
    c.isPrayerSkillName = () => false;
    for (const [name, rate, amount] of [["창조림", "0.3", "25만"], ["엘리트 박사", "0.1", "75만"]]) {
        const output = c.buildPetSkillInfoMessage(c.getPetSkillData(name));
        assert(output.includes("획득 확률: " + rate + "%"));
        assert(output.includes("대표 장착 · 100%") && output.includes("보조 장착 · 50%"));
        assert(output.includes("캐슬매력 +" + amount) && output.includes("레이드매력 +" + amount));
    }
    const f = fixture(c, "창조", "엘리트");
    assert.strictEqual(c.buildTotalExpTimeCheckDetail("test", f.data, f.pets, f.home, f.skills).total, 2500000);
});

group("charm diagnostic includes tier skills and final percentage bonuses", () => {
    const c = contexts[0];
    const tier = fixture(c, "창조", "엘리트", ["창조림", "엘리트 박사", "🪽 엠퍼러의 천공 날개"]);
    const tierResult = c.buildTotalExpTimeCheckDetail("test", tier.data, tier.pets, tier.home, tier.skills, {});
    assert.strictEqual(tierResult.total, 2700000);
    const f = fixture(c, "창조", "엘리트");
    f.pets.test.miniPet.battleExp = 101;
    f.pets.test.miniPetSupport.battleExp = 5;
    c.percent = { home: { castle: 10, raid: 20 }, guild: { castle: 5, raid: 3 }, level: 2 };
    f.data.member.test.adventureQuest = { totals: { castlePercent: 0.005, raidPercent: 0.01 } };
    const detail = c.buildTotalExpTimeCheckDetail("test", f.data, f.pets, f.home, f.skills, {});
    assert.strictEqual(detail.total, 3025436);
    assert(detail.lines.includes("캐슬 합계: 1,462,683💕"));
    assert(detail.lines.includes("레이드 합계: 1,562,753💕"));
});

group("actual pet info and leaderboard command branches use equipped skills", () => {
    const c = contexts[1], replies = [];
    c.GLOBAL_CONFIG.daily = { miniPetBattleMax: 15, miniPetBattleFree: 1 };
    for (const name of ["formatPetInfo", "formatKoreanShort", "getMiniPetUpgradeDisplay"]) vm.runInContext(fn(sources[1], name), c);
    Object.assign(c, {
        msg: "/펫정보", sender: "test", allsee: "<ALLSEE>",
        petTitleData: { member: { test: {} } }, guildData: {},
        homeDataFile: "home", petExplorePath: "explore", trialTowerPath: "tower", castleBattlePath: "castle",
        initSweetHomeUser: home => home, getHoiPassPremiumHeader: () => "",
        calculateEffectivePetUpgradeLevel: () => 0, getCritChance: () => 0, getCritMultiplier: () => 1,
        getIntimacyLvFromBag: () => "", getIntimacyUserRank: () => 0, getUserIntimacyInfo: () => ({ exp: 0 }),
        getMemberRank: () => 1, getTitle: () => "", getPetSkillSlotCount: () => 20, getCastleBattleRankEmoji: () => "",
        hasInfoPrivateChatPass: () => false, isInfoSupportPassActive: () => false,
        getC: () => "", formatDoneLine: () => "", getPetExploreRank: () => null, getMiniPetBattleRank: () => "순위없음",
        getWeeklyQuestRemainText: () => "", replier: { reply: message => replies.push(message) }
    });
    // 선택한 명령이 원래 로드하는 합성 파일만 허용한다.
    c.loadJsonFile = file => { assert(["home", "explore", "tower", "castle"].includes(file)); return {}; };
    const start = sources[1].indexOf('if (msg === "/펫정보" ||');
    const end = sources[1].indexOf('if (msg === "/펫매력순위")', start);
    const rankStart = sources[1].indexOf('if (msg === "/캐슬매력순위")');
    const rankEnd = sources[1].indexOf('if (msg == "/시련의탑순위")', rankStart);
    assert(start >= 0 && end > start && rankEnd > rankStart);
    vm.runInContext("function runPetInfo() { " + sources[1].slice(start, end) + " }", c);
    vm.runInContext("function runRank() { " + sources[1].slice(rankStart, rankEnd) + " }", c);
    for (const [primary, support, mode, total] of [[null, "창조", 250000, 500000], ["엘리트", "엘리트", 2250000, 4500000]]) {
        const f = fixture(c, primary, support);
        Object.assign(c, { data: f.data, petData: f.pets, petSkillData: f.skills });
        c.msg = "/펫정보";
        replies.length = 0;
        c.runPetInfo();
        const output = replies.join("\n");
        assert(output.includes("종합매력👑: " + c.formatKoreanShort(total)));
        assert(output.includes("캐슬매력⚔️: " + c.formatKoreanShort(mode)));
        assert(output.includes("레이드매력👾: " + c.formatKoreanShort(mode)));
        for (const command of ["/캐슬매력순위", "/레이드매력순위"]) {
            c.msg = command;
            replies.length = 0;
            c.runRank();
            assert(replies.join("\n").includes(c.numberWithCommas(mode)));
            assert(replies.join("\n").includes("<ALLSEE>"));
        }
    }
});

group("ongoing territory snapshot retained; new rounds receive current bonus", () => {
    const c = contexts[0], f = fixture(c, "창조", "창조", ["창조림"]);
    c.calculateEffectivePetUpgradeLevel = () => 0;
    c.calculateCritChance = () => 0;
    c.getCritMultiplier = () => 1;
    c.getGuildTerritoryDefenderName = () => null;
    const war = { territories: {}, castleExpSnapshots: { test: 500000 }, castleBattleSnapshots: { test: { baseExp: 500000 } } };
    c.ensureGuildTerritoryWar = () => war;
    c.fillGuildTerritoryCastleExpSnapshots(f.data, f.pets, f.home, f.skills, {}, ["test"]);
    assert.strictEqual(war.castleExpSnapshots.test, 500000);
    delete war.castleBattleSnapshots.test;
    c.fillGuildTerritoryCastleExpSnapshots(f.data, f.pets, f.home, f.skills, {}, ["test"]);
    assert.strictEqual(war.castleBattleSnapshots.test.baseExp, 500000);
    const next = c.buildGuildTerritoryCastleExpSnapshots(f.data, f.pets, f.home, f.skills, {}, war, [{ user: "test" }]);
    assert.strictEqual(next.test, 750000);
    assert.strictEqual(war.castleBattleSnapshots.test.baseExp, 750000);
});
group("reported elite representative and creation support display matches actual totals", () => {
    const c = contexts[0];
    Object.assign(c, {
        getHoiPassPremiumHeader: () => "", getMiniPetBattleRank: () => "순위없음", allsee: "<ALLSEE>"
    });
    c.GLOBAL_CONFIG.daily = { miniPetBattleMax: 15, miniPetBattleFree: 1 };
    const f = fixture(c, "엘리트", "창조");
    Object.assign(f.pets.test.miniPet, { name: "아르케", emoji: "🌌", battleExp: 12000000 });
    Object.assign(f.pets.test.miniPetSupport, { name: "호이빛", emoji: "💖", battleExp: 1630000, upgrade: 28 });
    const before = JSON.stringify(f);
    const output = c.buildMiniPetInfoRenewedMessage("test", f.data, f.pets, {}, {}, false, f.skills);
    assert(output.includes("└ 매력 12,000,000💞"));
    assert(output.includes("└ 매력 815,000💞"));
    assert(output.includes("엘리트 박사📙: +3,000,000💞"));
    assert(output.includes("창조림📙: +500,000💞"));
    assert(output.includes("등급 펫스킬 추가: +3,500,000💞"));
    assert(output.includes("종합매력 반영: +29,130,000"));
    assert(output.includes("캐슬매력 +14,565,000"));
    assert.deepStrictEqual(values(c, f), [14565000, 14565000, 29130000]);
    assert.strictEqual(JSON.stringify(f), before);
    for (const skillNames of [[], ["창조림", "창조림📙"], ["엘리트 박사"]]) {
        vm.runInContext("fixture.skills.test.petSkills.equipped = " + JSON.stringify(skillNames), c);
        const result = c.buildMiniPetInfoRenewedMessage("test", f.data, f.pets, {}, {}, false, f.skills);
        assert(result.includes("종합매력 반영: +" + c.numberWithCommas(values(c, f)[2])));
    }
    vm.runInContext('fixture.skills.test.petSkills.equipped = ["창조림", "엘리트 박사"]', c);
    f.pets.test.miniPet = null;
    f.pets.test.miniPetSupport.grade = "창세";
    const inactive = c.buildMiniPetInfoRenewedMessage("test", f.data, f.pets, {}, {}, false, f.skills);
    assert(inactive.includes("등급 펫스킬 추가: +0💞"));
    assert(inactive.includes("장착 등급 조건 미충족"));
    assert(inactive.includes("종합매력 반영: +1,630,000"));
    assert(sources[0].includes("miniTitleForInfo, robberEquippedForInfo, petSkillData)"));
    assert(sources[0].includes("miniTitleForTarget, robberEquippedForTarget, petSkillData)"));
});
console.log("Mini-pet conditional skills: " + groups + " groups passed");
