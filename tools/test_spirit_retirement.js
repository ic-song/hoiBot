const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const info = fs.readFileSync(path.join(__dirname, '..', 'Info.js'), 'utf8').replace(/\r\n/g, '\n');
// 검증할 현재 함수·명령을 줄 단위 경계로 추출하는 함수
function block(source, marker) {
    const start = source.indexOf(marker); assert(start >= 0, marker);
    const line = source.lastIndexOf('\n', start) + 1, indent = source.slice(line, start);
    assert(!indent.trim(), marker);
    const end = source.indexOf('\n' + indent + '}', start); assert(end > start, marker);
    return source.slice(start, end + indent.length + 2);
}
const configScope = { testRoom: 'test' }; for (let i = 1; i <= 100; i++) configScope['room' + i] = 'room' + i;
vm.createContext(configScope); vm.runInContext(block(main, 'const GLOBAL_CONFIG = {') + ';this.config=GLOBAL_CONFIG;', configScope);
const config = configScope.config, itemInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/itemInfo.json'), 'utf8'));
const helpers = ['requireSpiritRetirementCount', 'buildSpiritRetirementPlan', 'applySpiritRetirementPlan', 'countSpiritRetirementSources', 'buildSpiritRetirementCleanupPlan', 'getSpiritCharmOpenRequest', 'openSpiritCharmItem', 'getSpiritOpenedCharm'];
const commandStart = main.indexOf('        if (msg === "/정령컨텐츠보상") {');
const commandEnd = main.indexOf('        if (!isExcludedRequestMonitoring', commandStart);
const command = main.slice(commandStart, commandEnd);
// 전환 이전 운영 함수로 보상 전 수치를 독립 계산하는 함수
const baseline = cp.execFileSync('git', ['show', '6e13f008f7031b0df50b5b1bfd155417fe578c3b:main.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
// 독립된 Main·Info·전환 전 매력 계산 환경을 준비하는 함수
function context(source = main, legacy = false) {
    const c = { GLOBAL_CONFIG: config, itemInfoData: itemInfo, raidSpecialItem: { dept2: {} }, numberWithCommas: String,
        getMiniPetModeCharm: () => 0, getHomeTotalExp: () => 0, hasPetSkill: () => false,
        getPetHomeFurnitureCharm: () => ({ bonus: 0 }), getEquippedNonTierPetSkillExp: () => 0, getEquippedTierPetSkillExp: () => 0,
        calculateCastleItem: () => 0, getIntimacyExpFromBag: () => 0, getPetModeCharmPercent: () => 37.5,
        getHomeBadgeCubeActiveOptionPercent: () => 37.5, getGuildContributionCubeMemberPercent: () => 0,
        getAdventureLevelCharmPercent: () => 0, getInfoAdventureLevelSummary: () => ({ charmPercent: 0 }),
        applyPercentWithExactFloor: (n, p) => Math.floor(n * (100 + p) / 100), applyInfoPercentWithExactFloor: (n, p) => Math.floor(n * (100 + p) / 100),
        calculatePendantItemInfo: () => ({ battleExp: 0, castleExp: 0, raidExp: 0 }), calculatePendantItemInfoForInfo: () => ({ battleExp: 0, castleExp: 0, raidExp: 0 }) };
    vm.createContext(c);
    const names = legacy ? [] : source === info ? ['requireSpiritRetirementCount', 'getSpiritOpenedCharm'] : helpers;
    for (const n of names.concat(['calculateItemInfo', 'calculateItemInfoAll', 'calculateCastleExp', 'calculateRaidExp'])) vm.runInContext(block(source, 'function ' + n + '('), c);
    return c;
}
// 합성 데이터로 보상·매력·입력·지급처 회귀 검증을 실행하는 함수
function runTests() {
    const c = context(), old = context(baseline, true), query = context(info);
    let cases = 0;
    for (const grade of Object.keys(itemInfo.elemental)) for (const upgrade of [0, 1, 80, itemInfo.elemental[grade].maxLevel]) {
        const data = { member: { synthetic: { bag: {}, lv: 1 } } }, pets = { synthetic: { elemental: { grade, upgrade }, petexp: 333, dollCharm: 201 } };
        const before = ['calculateCastleExp', 'calculateRaidExp'].map(n => old[n]('synthetic', data, pets, {}, {}, false, {}));
        const plan = c.buildSpiritRetirementPlan(data, pets);
        c.applySpiritRetirementPlan(data, plan);
        assert.equal(c.getSpiritOpenedCharm(data.member.synthetic).castleExp, 0);
        assert.deepEqual(JSON.parse(JSON.stringify(c.calculateItemInfo('elemental', 'synthetic', data, pets))), { battleExp: 0, raidExp: 0, castleExp: 0, message: '' });
        const unopened = ['calculateCastleExp', 'calculateRaidExp'].map(n => c[n]('synthetic', data, pets, {}, {}, false, {}));
        delete pets.synthetic.elemental;
        assert.deepEqual(['calculateCastleExp', 'calculateRaidExp'].map(n => c[n]('synthetic', data, pets, {}, {}, false, {})), unopened);
        assert.deepEqual(['calculateCastleExp', 'calculateRaidExp'].map(n => query[n]('synthetic', data, pets, {}, {}, false, {})), unopened);
        for (const [mode, item] of [['castleExp', config.spiritRetirement.castleItem], ['raidExp', config.spiritRetirement.raidItem]]) {
            const count = data.member.synthetic.bag[item];
            assert(c.openSpiritCharmItem(data, 'synthetic', { mode, count }).ok);
            assert(!data.member.synthetic.bag[item]);
        }
        assert.deepEqual(['calculateCastleExp', 'calculateRaidExp'].map(n => c[n]('synthetic', data, pets, {}, {}, false, {})), before);
        assert.deepEqual(['calculateCastleExp', 'calculateRaidExp'].map(n => query[n]('synthetic', data, pets, {}, {}, false, {})), before);
        assert.throws(() => c.applySpiritRetirementPlan(data, plan), /한 번/);
        cases++;
    }
    console.log('PASS ' + cases + ' grade/upgrade cases: actual previous charm equals Main and Info after all rewards opened, including 37.5% bonuses and fractional doll charm');
    const item = config.spiritRetirement.raidItem, seed = { member: { synthetic: { bag: { [item]: 7 } } } };
    const bulk = JSON.parse(JSON.stringify(seed)), single = JSON.parse(JSON.stringify(seed));
    c.openSpiritCharmItem(bulk, 'synthetic', { mode: 'raidExp', count: 7 });
    for (let i = 0; i < 7; i++) c.openSpiritCharmItem(single, 'synthetic', { mode: 'raidExp', count: 1 });
    assert.deepEqual(bulk, single);
    for (const input of ['/레이드매력오픈 -1', '/레이드매력오픈 1.5', '/레이드매력오픈 문자', '/레이드매력오픈 1 해봐', '/캐슬매력오픈 1 설명']) assert.equal(c.getSpiritCharmOpenRequest(input), null);
    for (const count of [0, -1, 1.5, NaN, Infinity, 8, 9007199254740992]) {
        const data = JSON.parse(JSON.stringify(seed)), original = JSON.stringify(data);
        assert.equal(c.openSpiritCharmItem(data, 'synthetic', { mode: 'raidExp', count }).ok, false);
        assert.equal(JSON.stringify(data), original);
    }
    const invalid = { member: { a: { bag: {} }, b: { bag: {} } } }, invalidPets = { a: { elemental: { grade: '정령왕', upgrade: 80 } }, b: { elemental: { grade: 'missing', upgrade: 1 } } };
    const original = JSON.stringify(invalid); assert.throws(() => c.buildSpiritRetirementPlan(invalid, invalidPets)); assert.equal(JSON.stringify(invalid), original);
    const over = JSON.parse(JSON.stringify(seed)); over.member.synthetic.spiritCharm = { castleExp: 0, raidExp: 9007199254740991 };
    const overText = JSON.stringify(over); assert.throws(() => c.openSpiritCharmItem(over, 'synthetic', { mode: 'raidExp', count: 1 })); assert.equal(JSON.stringify(over), overText);
    console.log('PASS item boundaries, malformed suffixes, single/bulk parity, no partial rewards on invalid grade and no mutation on overflow');
    vm.runInContext(block(main, 'function rollEventBox(') + '\n' + block(main, 'function rollflowerBox(') + '\n' + block(main, 'function runCombineAll('), c);
    assert.equal(c.rollEventBox().gainItems['양념치킨🐔'], 100); assert.equal(c.rollflowerBox().gainItems['양념치킨🐔'], 100);
    const combineData = { member: { a: { bag: { '정령조각🥀': 100, other: 2 } } } }, combineBefore = JSON.stringify(combineData);
    c.runCombineAll('a', combineData); assert.equal(JSON.stringify(combineData), combineBefore);
    assert(main.includes('"양념치킨🐔": GLOBAL_CONFIG.spiritRetirement.baseballCount')); assert.equal(config.spiritRetirement.baseballCount, 2);
    assert(!JSON.stringify(config).replace(JSON.stringify(config.spiritRetirement), '').includes(config.spiritRetirement.removedItem));
    for (const removed of ['/정령강화', '/정령이름 ', '/강화뽑기', '/정령조합', '/정령이름조합']) assert(!main.includes('if (msg === "' + removed + '"') && !main.includes('if (msg.startsWith("' + removed + '"'));
    assert(!info.includes('msg === "/정령순위"')); assert(!info.includes('정령🔯:'));
    vm.runInContext(block(main, 'function applyStarterPet(') + '\n' + block(main, 'function normalizeItemName(') + '\n' + block(main, 'function isNeverSellItemWithList('), c);
    const starter = {}; c.applyStarterPet(starter, 'new', {}); assert(!starter.elemental); assert.equal(starter.upgrade, 90);
    for (const rewardItem of [config.spiritRetirement.raidItem, config.spiritRetirement.castleItem]) assert(c.isNeverSellItemWithList({ nonItems: [] }, rewardItem));
    const packages = fs.readFileSync(path.join(__dirname, '..', 'data/packageInfo.json'), 'utf8'); assert(!packages.includes(config.spiritRetirement.removedItem));
    c.normalizePendantTransitionBagItem = (_bag, item) => item;
    c.normalizeMiniPetRewardBoxItemName = name => name;
    for (const name of ['addItem', 'addItemToBag', 'applyPackageRewards', 'formatPackageRewardSummary', 'formatPackageRewardLines']) vm.runInContext(block(main, 'function ' + name + '('), c);
    c.GLOBAL_CONFIG = config;
    vm.runInContext('var oldPackage={rewards:[{type:"item",name:GLOBAL_CONFIG.spiritRetirement.removedItem,count:10},{type:"item",name:"keep",count:2}]}; var oldData={member:{a:{bag:{}}}}; var oldLines=applyPackageRewards(oldData,"a",oldPackage,3);', c);
    assert.equal(c.oldData.member.a.bag.keep, 6); assert(!c.oldData.member.a.bag[config.spiritRetirement.removedItem]);
    assert(!c.formatPackageRewardSummary(c.oldPackage.rewards).includes(config.spiritRetirement.removedItem));
    assert(!c.formatPackageRewardLines(c.oldPackage.rewards).includes(config.spiritRetirement.removedItem));
    assert(!c.oldLines.join('\n').includes(config.spiritRetirement.removedItem));
    console.log('PASS drops, retired commands/displays, pass and package reward removal, elemental auto-combine disabled');
}
module.exports = { main, info, block, config, itemInfo, helpers, command, context };
if (require.main === module) runTests();
