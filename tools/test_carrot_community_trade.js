const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// 합성 데이터에서 실제 명령 분기와 함수를 실행하기 위해 추출한다.
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
function branch(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert(a >= 0 && b > a, start);
    return "(function () {" + source.slice(a, b) + "})()";
}
const trades = [
    branch(String.raw`if (/^\/당근\s+`, String.raw`if (/^\/미니펫당근\s+`),
    branch(String.raw`if (/^\/미니펫당근\s+`, String.raw`if (/^\/가구당근\s+`),
    branch(String.raw`if (/^\/가구당근\s+`, 'if (msg.startsWith("/온도 "))'),
    branch(String.raw`if (/^\/펫스킬당근\s+`, 'if (msg === "/호이행복재단")')
];
const entryStart = source.indexOf("var data = null;", source.indexOf("function response("));
const entryEnd = source.indexOf("if (isAccountSuspensionBlockedMessage(msg))", entryStart);
const entry = "(function () {" + source.slice(entryStart, entryEnd) + " entryContinued = true; })()";
const room = source.match(/const room5 = "([^"]+)"/)[1];
const giver = "보내는 합성유저", receiver = "받는 합성유저";
const carrot = "🥕당근이세요?", thermometer = "🌡️당근온도기";
const inputs = ["/당근 " + receiver + " 1 2", "/미니펫당근 " + receiver + " 1", "/가구당근 " + receiver + " 1", "/펫스킬당근 " + receiver + " 1 2"];
const c = {
    sender: giver, guildData: {}, room, isGroupChat: true,
    filePath: "member.json", memberPetPath: "member_pet.json", guildPath: "guild.json", homeDataFile: "home.json", petSkillDataPath: "skill.json",
    GLOBAL_CONFIG: { carrotTrade: { communityRoom: room, communityLink: source.match(/communityLink: "([^"]+)"/)[1] }, items: { carrotName: carrot, carrotThermometerName: thermometer },
        supportPass: { premium: { miniPetBagBaseCount: 10, miniPetBagBonusCount: 5 } }, petSkill: {} },
    miniPetData: { gradeTable: [{ grade: "일반" }] }, PET_SKILL_BAG_MAX_COUNT: 100,
    normalizePendantTransitionBagItem: (_bag, name) => name, normalizePetSkillName: name => name,
    numberWithCommas: n => String(n), checkRank: (_d, _p, _g, name) => "킹" + name,
    generateBagOutput: () => ({ sortedItemList: ["합성아이템"] }), isTradableItem: () => true,
    isTierKing: tier => tier === "킹", isMemberTierKing: (d, user) => d.member[user].rank.tier === "킹",
    isHoiPassPremiumActive: () => false, getFurnitureBagLimit: () => 100,
    initSweetHomeUser: d => d, isRetiredPetSkill: () => false, formatPetSkillName: name => name,
    hasActiveHoiPassAccess: () => { c.passChecks++; return c.pass; }, getChatExperienceQueryTarget: () => null,
    isAdminIdentity: () => false, isMasterIdentity: () => false, isPassFreeHomeBadgeCommand: () => false,
    getAttendanceNoticeCommandPrefix: () => null, recordBlockedPrivateChatAttempt: () => { c.privateNotices++; return false; },
    getBlockedPrivateChatNoticeKind: () => null, Api: { replyRoom() { throw Error("예상하지 않은 외부 메시지"); } },
    loadJsonFile(file) { c.loads.push(file); return c.stores[file]; },
    saveJsonFile(d, file) { c.saves.push(file); c.stores[file] = d; },
    replier: { reply(message) { c.replies.push(message); } }
};
vm.createContext(c);
for (const name of ["isCarrotTradeCommand", "isCarrotTradeRoomAllowed", "buildCarrotTradeBlockedMessage", "hasItem", "removeItem", "addItem",
    "getMiniPetBagLimit", "isMiniPetBagFull", "sortMiniPetBag", "refreshMiniPetSortIndex", "sortFurnitureList",
    "initPetSkillUser", "getPetSkillBagList", "getPetSkillBagTotalCount", "getPetSkillBagRemainCount", "normalizePetSkillStoredNames", "addPetSkillToBag", "removePetSkillFromBag"])
    vm.runInContext(fn(name), c);
function reset() {
    c.data = vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify({ member: {
        [giver]: { rank: { tier: "킹" }, room: "호이서버1[30]", bag: { [carrot]: 200, "합성아이템": 5 } },
        [receiver]: { rank: { tier: "킹" }, room: "호이서버2[2030]", bag: {} }
    } })) + ")", c);
    c.petData = { [giver]: { miniPetBag: [{ name: "합성펫", emoji: "🐹", grade: "일반", battleExp: 100, sortIndex: 1 }] }, [receiver]: { miniPetBag: [] } };
    c.home = { [giver]: { furnitureBag: [{ name: "합성가구", emoji: "🪑", exp: 100, id: "1" }] }, [receiver]: { furnitureBag: [] } };
    c.petSkillData = vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify({ [giver]: { petSkills: { equipped: [], lockedPremium: [], bag: { "기도": 4 } } }, [receiver]: { petSkills: { equipped: [], lockedPremium: [], bag: {} } } })) + ")", c);
    c.stores = { "member.json": c.data, "member_pet.json": c.petData, "home.json": c.home, "skill.json": c.petSkillData, "guild.json": {} };
    c.room = room; c.isGroupChat = true; c.pass = true; c.passChecks = 0; c.privateNotices = 0;
    c.saves = []; c.loads = []; c.replies = []; c.entryContinued = false;
}
function run(msg) {
    c.msg = msg;
    vm.runInContext(entry, c);
    if (c.entryContinued) for (const trade of trades) vm.runInContext(trade, c);
}

// 1. 서버·관리방·테스트방·유사 방명 및 일대일톡은 패스 유무와 무관하게 네 거래를 차단한다.
for (const destination of ["호이서버1[30]", "서버관리자", "팻 테스트방", "호이월드 커뮤니티", room + " 사칭", room]) {
    for (const group of [true, false]) {
        if (destination === room && group) continue;
        for (const pass of [false, true]) for (const msg of inputs) {
            reset(); c.room = destination; c.isGroupChat = group; c.pass = pass;
            const before = JSON.stringify(c.stores);
            run(msg);
            assert.strictEqual(JSON.stringify(c.stores), before);
            assert.deepStrictEqual(c.saves, []);
            assert.strictEqual(c.replies.length, 1);
            assert(c.replies[0].includes("[킹" + giver + "]님"));
            assert(c.replies[0].includes(c.GLOBAL_CONFIG.carrotTrade.communityLink));
            assert.strictEqual(c.passChecks, 0); assert.strictEqual(c.privateNotices, 0);
        }
    }
}
console.log("PASS 1: 네 거래의 다른 방·일대일톡 차단과 전체 데이터 미변경");

// 2. 소속 서버가 다른 회원도 실제 커뮤니티 단체방에서는 기존 수수료로 거래한다.
for (let i = 0; i < inputs.length; i++) {
    reset(); run(inputs[i]);
    assert.strictEqual(c.data.member[giver].bag[carrot], 200 - [2, 20, 10, 100][i]);
    assert.strictEqual(c.data.member[receiver].bag[thermometer], 2);
    assert.strictEqual(c.data.member[giver].carrotGiven, 1);
    if (i === 0) { assert.strictEqual(c.data.member[giver].bag["합성아이템"], 3); assert.strictEqual(c.data.member[receiver].bag["합성아이템"], 2); }
    if (i === 1) { assert.strictEqual(c.petData[giver].miniPetBag.length, 0); assert.strictEqual(c.petData[receiver].miniPetBag.length, 1); }
    if (i === 2) { assert.strictEqual(c.home[giver].furnitureBag.length, 0); assert.strictEqual(c.home[receiver].furnitureBag.length, 1); }
    if (i === 3) { assert.strictEqual(c.petSkillData[giver].petSkills.bag["기도"], 2); assert.strictEqual(c.petSkillData[receiver].petSkills.bag["기도"], 2); }
    assert(c.saves.includes("member.json"));
}
console.log("PASS 2: 소속 서버 무관 정상 거래·기존 수수료·온도기·거래 횟수");

// 3. 킹 미만, 아이템 부족, 잘못된 가방 번호에서는 거래가 진행되지 않는다.
for (const msg of inputs) {
    reset(); c.data.member[giver].rank.tier = "뉴비"; run(msg); assert.deepStrictEqual(c.saves, []);
    reset(); c.data.member[receiver].rank.tier = "뉴비"; run(msg); assert.deepStrictEqual(c.saves, []);
    reset(); c.data.member[giver].bag[carrot] = 0; run(msg); assert.deepStrictEqual(c.saves, []);
    reset(); const before = JSON.stringify(c.stores); run(msg.replace(/\d+(?: \d+)?$/, msg.startsWith("/당근 ") || msg.startsWith("/펫스킬당근 ") ? "999 1" : "999"));
    assert.strictEqual(JSON.stringify(c.stores), before); assert.deepStrictEqual(c.saves, []);
}
console.log("PASS 3: 티어·수수료 부족·가방 번호 검증");

// 4. 실행 명령에 안내 문구나 음수·소수를 붙이면 거래가 실행되지 않는다.
for (const msg of inputs) for (const invalid of [msg + " 해봐", msg.replace(/\d+$/, "-1"), msg.replace(/\d+$/, "1.5")]) {
    reset(); const before = JSON.stringify(c.stores); run(invalid);
    assert.strictEqual(JSON.stringify(c.stores), before); assert.deepStrictEqual(c.saves, []);
}
reset(); run(inputs[0].replaceAll(" ", "\t")); assert.strictEqual(c.data.member[receiver].bag["합성아이템"], 2);
console.log("PASS 4: 정확한 실행 형식·공백 입력·오입력 미소모");

// 5. 거래 게시판·완료·등록 및 펜던트 거래는 이번 공통 제한의 대상이 아니다.
for (const msg of ["/당근게시판", "/당근완료", "/당근등록 내용", "/당근게시판삭제", "/당근온도순위", "/펜던트당근 닉 1", "/당근거래방법"]) assert(!c.isCarrotTradeCommand(msg));
reset(); c.isGroupChat = false; c.pass = false; run("/가방");
assert.strictEqual(c.passChecks, 1); assert.strictEqual(c.privateNotices, 1);
console.log("PASS 5: 적용 대상 분리·기존 일대일톡 패스 차단 유지");

// 실제 저장 트랜잭션으로 거래 종류별 모든 저장 지점 실패를 검증한다.
let disk, backups, failFile;
const protectedFiles = ["member.json", "member_pet.json", "skill.json"];
c.dataSaveTransactionThreadLocal = { value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } };
c.dataTransactionLock = { lock() {}, unlock() {} };
c.resolveActiveDataPath = file => file;
c.getAutoDailyBatchContext = () => null;
c.getManagedJsonBackupPath = file => protectedFiles.includes(file) ? file + ".bak" : null;
c.isProtectedManagedJsonPath = file => protectedFiles.includes(file);
c.ensureParentFolder = () => {};
c.debuggerLog = () => {};
c.java = { io: { File: function (file) { this.exists = () => Object.hasOwn(disk, file); } } };
c.writeVerifiedJsonFile = (file, json, skipBackup) => {
    if (failFile === file) { failFile = null; throw Error("synthetic trade save failure"); }
    JSON.parse(json);
    if (!skipBackup && protectedFiles.includes(file)) backups[file] = disk[file];
    disk[file] = json;
};
c.restoreManagedJsonFromBackup = file => { assert(backups[file]); disk[file] = backups[file]; return { data: JSON.parse(disk[file]) }; };
c.FileStream = { write() { throw Error("가구 원본에 검증 없는 직접 저장"); } };
for (const name of ["getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "saveJsonFile"])
    vm.runInContext(fn(name), c);
for (let i = 0; i < inputs.length; i++) {
    const paths = [["member.json"], ["member.json", "member_pet.json"], ["member.json", "home.json"], ["member.json", "skill.json"]][i];
    for (const file of paths) {
        reset(); disk = Object.fromEntries(Object.entries(c.stores).map(([p, d]) => [p, JSON.stringify(d)])); backups = {}; failFile = file;
        const before = JSON.stringify(disk);
        c.beginDataSaveTransaction();
        try { assert.throws(() => run(inputs[i]), /synthetic trade save failure/); }
        finally { c.rollbackDataSaveTransaction(); c.endDataSaveTransaction(); }
        assert.strictEqual(JSON.stringify(disk), before, "거래 실패 후 재시작 상태 " + file);
        assert(!c.replies.some(message => message.includes("거래 완료")), "저장 실패 전에 거래 성공 안내");
    }
}
console.log("PASS 6: 거래 4종의 모든 저장 지점 실패·롤백·성공 안내 차단");
