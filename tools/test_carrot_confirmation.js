const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const base = fs.readFileSync(path.join(__dirname, "test_member_display_search_auth.js"), "utf8");
const { c, fixture, block } = new Function("require", "__dirname", base.slice(0, base.indexOf('\npass("')) + "\nreturn {c,fixture,block};")(require, __dirname);
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/", carrot = c.GLOBAL_CONFIG.items.carrotName, material = "합성재료", giver = "보내는 남", receiver = "받는 여";
const clone = value => JSON.parse(JSON.stringify(value));
const room = c.GLOBAL_CONFIG.carrotTrade.communityRoom;
c.petSkillDataPath = root + "petSkillData.json"; c.itemListPath = root + "itemList.json";
c.checkRank = (_d, _p, _g, name) => name; c.isHoiPassPremiumActive = () => false; c.getFurnitureBagLimit = () => 100;
c.isGlobalOperatorCommandAllowed = () => false;
c.hasPetSkill = () => false; c.isRetiredPetSkill = () => false; c.normalizePetSkillName = name => name;
c.formatPetSkillName = name => name + "📙"; c.getPetSkillData = () => null; c.PET_SKILL_LIST = []; c.PET_SKILL_BAG_MAX_COUNT = 100;
c.miniPetData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data/miniPetData.json"), "utf8"));
c.java.util = { UUID: { randomUUID: () => "trade-" + (++nextId) } };
c.commandDataFlowLock = { writeLock: () => ({ lock() {}, unlock() {} }) };
let now = 100000, nextId = 0, timers = [];
const NativeDate = vm.runInContext("Date", c);
c.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
c.setTimeout = (fn, delay) => { timers.push({ fn, at: now + delay, delay }); return timers.length; };
c.Api = { replyRoom() {} }; c.testRoom = "test";
vm.runInContext(block(main, "const ticketTierData ="), c);
const helpers = ["parseJsonContent", "hasItem", "removeItem", "addItem", "normalizePendantTransitionItemName", "normalizePendantTransitionBagItem", "normalizeUniversalCollectionKeyBagItems", "normalizeItemName", "generateBagOutput", "isSearchAuthenticationCount", "isTierKing", "isMemberTierKing", "isTradableItem", "getMiniPetBagLimit", "isMiniPetBagFull", "sortMiniPetBag", "refreshMiniPetSortIndex", "sortFurnitureList", "initSweetHomeUser", "buildPlacedFurnitureSummary", "initPetSkillUser", "normalizePetSkillStoredNames", "getPetSkillBagList", "getPetSkillBagTotalCount", "getPetSkillBagRemainCount", "addPetSkillToBag", "removePetSkillFromBag", "getPendantBagLimit", "getPendantGradeSortRank", "getPendantGradeInfo", "sortPendantBagByGrade", "formatPendantDisplay", "formatPendantNameWithIcon", "normalizePendantPromotionLevel", "getFreeMarketMiniPetDisplayName", "getFreeMarketMiniPetNumber", "formatFreeMarketMiniPetDetail", "getFreeMarketFurnitureDisplayName", "formatFreeMarketFurnitureDetail", "isCarrotTradeCommand", "isCarrotTradeRoomAllowed", "buildCarrotTradeBlockedMessage"];
const domain = main.slice(main.indexOf("// 당근거래 5종의 입력 범위를 식별하는 함수"), main.indexOf("// 커뮤니티 제한 대상인 당근거래 네 명령어만 식별하는 함수"));
for (const name of helpers) vm.runInContext(block(main, "function " + name + "("), c);
vm.runInContext(domain, c);
const earlyEntry = main.slice(main.indexOf("        // 확인 응답도 원래 명령의 출석·정지·대전·장소 검사를 통과하도록 연결한다."), main.indexOf("        // 방 제한은 복구·자동 저장·요청 과부하 기록보다 먼저 확인한다."));
vm.runInContext("function carrotBranch(){" + earlyEntry + "if (typeof testPolicyGate === 'function' && testPolicyGate(msg)) return;" + block(main, "if (isCarrotTradeEntryMessage(msg) ||") + "}", c);
const roomBlock = block(main, "if (isCarrotTradeCommand(msg) && !isCarrotTradeRoomAllowed(room, isGroupChat))");
vm.runInContext("function carrotRoomBlock(){" + roomBlock + "; return false;}", c);
const keys = ["member.json", "member_pet.json", "home.json", "petSkillData.json", "itemList.json"];
const snapshot = (dev = false) => keys.map(name => fixture.raw((dev ? devRoot : root) + name));
const pending = (user = giver, dev = false) => c.carrotTradePending[c.getCarrotTradePendingKey(user, dev)];
function prepare(stock = 5000, dev = false) {
    if (!dev) { fixture.reset(); c.carrotTradePending = {}; timers = []; now = 100000; }
    const r = dev ? devRoot : root, d = fixture.read(dev);
    d.member[giver] = { agree: true, point: 123456, rank: { tier: "킹" }, bag: { [carrot]: stock, [material]: 5 } };
    d.member[receiver] = { point: 654321, rank: { tier: "킹" }, bag: {} }; fixture.write(d, dev);
    const mini = { id: "pet-1", name: "합성펫", emoji: "🐹", grade: "일반", battleExp: 100, upgrade: 3, sortIndex: 1, option: { luck: 2 } };
    const pendant = { id: "pendant-1", name: "합성펜던트", grade: "일반", durability: 4, maxDurability: 5, upgrade: 7, options: { charm: 3 } };
    fixture.put(r + "member_pet.json", { [giver]: { miniPetBag: [mini], pendantBag: [pendant] }, [receiver]: { miniPetBag: [], pendantBag: [] } });
    fixture.put(r + "home.json", { [giver]: { floor: 200, furnitureBag: [{ id: "f-1", name: "합성가구", emoji: "🪑", grade: "일반", exp: 120, display: "old", options: { charm: 8 } }] }, [receiver]: { floor: 200, furnitureBag: [] } });
    fixture.put(r + "petSkillData.json", { [giver]: { petSkills: { equipped: [], lockedPremium: [], bag: { "기도": 4 } } }, [receiver]: { petSkills: { equipped: [], lockedPremium: [], bag: {} } } });
    fixture.put(r + "itemList.json", { untradableList: [] });
}
function request(type, count = 2, target = receiver) {
    const commands = { miniPet: "/미니펫당근", furniture: "/가구당근", pendant: "/펜던트당근", skill: "/펫스킬당근" };
    if (type === "bag") { const list = Array.from(c.generateBagOutput(fixture.read().member[giver].bag).sortedItemList); return "/당근 " + target + " " + (list.indexOf(material) + 1) + " " + count; }
    return commands[type] + " " + target + " 1" + (type === "skill" ? " " + count : "");
}
function run(command, user = giver, where = room, dev = false, group = true) {
    fixture.clear(); const ctx = c.createCommandContext(dev, where), previous = c.enterCommandContext(ctx);
    c.beginDataSaveTransaction(); c.ctx = ctx; c.msg = command; c.sender = user; c.room = where; c.isGroupChat = group;
    try {
        c.data = c.loadJsonFile(c.filePath); c.petData = c.loadJsonFile(c.memberPetPath); c.petSkillData = c.loadJsonFile(c.petSkillDataPath); c.guildData = {};
        if (c.isCarrotTradeCommand(command) && !c.isCarrotTradeRoomAllowed(where, group)) c.carrotRoomBlock(); else c.carrotBranch();
    } catch (error) { c.rollbackDataSaveTransaction(); throw error; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return fixture.replies().join("\n");
}
function tick(ms) { now += ms; const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now); due.forEach(t => t.fn()); }
function setMember(change, dev = false) { const d = fixture.read(dev); change(d); fixture.write(d, dev); }
function setFile(file, change, dev = false) { const p = (dev ? devRoot : root) + file, d = fixture.get(p); change(d); fixture.put(p, d); }
const types = ["bag", "miniPet", "furniture", "skill", "pendant"];
const costs = { bag: 2, miniPet: 100, furniture: 100, skill: 600, pendant: 300 };
let groups = 0;
function test(name, fn) { prepare(); fn(); console.log("PASS CARROT " + (++groups) + ": " + name); }
function runTests() {
test("5종 최초 확인 무저장·무차감과 최종 전송·비용·부수보상·포인트 보존", () => {
    for (const type of types) {
        prepare(); const before = snapshot(), command = request(type), confirm = run(command);
        assert.deepStrictEqual(snapshot(), before); assert(pending()); assert(!fixture.traces().some(t => t.type === "save"));
        assert(confirm.startsWith("[" + giver + "] 님\n")); assert(confirm.includes("🥕 당근 " + costs[type] + "개 소모")); assert(confirm.endsWith("※ 60초 이내에 입력해 주세요."));
        const done = run("거래한다"), d = fixture.read();
        assert(done.includes("완료!")); assert(!pending()); assert(done.includes("🥕 소모 " + costs[type] + "개\n👌 잔여 " + (5000 - costs[type]).toLocaleString("en-US") + "개"));
        assert.strictEqual(d.member[giver].bag[carrot], 5000 - costs[type]); assert.strictEqual(d.member[giver].point, 123456); assert.strictEqual(d.member[receiver].point, 654321);
        assert.strictEqual(d.member[receiver].bag[c.GLOBAL_CONFIG.items.carrotThermometerName] || 0, type === "pendant" ? 0 : 2);
        assert.strictEqual(d.member[giver].carrotGiven || 0, type === "pendant" ? 0 : 1);
        const paid = snapshot(); assert.strictEqual(run("거래한다"), ""); assert.deepStrictEqual(snapshot(), paid);
        if (type === "bag") assert.strictEqual(d.member[receiver].bag[material], 2);
        if (type === "miniPet" || type === "pendant") { const field = type === "miniPet" ? "miniPetBag" : "pendantBag"; assert.strictEqual(fixture.get(root + "member_pet.json")[receiver][field].length, 1); }
        if (type === "furniture") { const item = fixture.get(root + "home.json")[receiver].furnitureBag[0]; assert.strictEqual(item.display, undefined); assert.deepStrictEqual(item.options, { charm: 8 }); }
        if (type === "skill") assert.strictEqual(fixture.get(root + "petSkillData.json")[receiver].petSkills.bag["기도"], 2);
    }
});
test("당근 부족 600/500/100·정확한 비용 잔여0·확정 때 재검사", () => {
    prepare(500); const before = snapshot(); const text = run(request("skill"));
    assert(text.includes("필요 600개 · 보유 500개\n🥕 부족 100개")); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
    for (const type of types) {
        prepare(costs[type]); run(request(type)); assert(run("거래한다").includes("👌 잔여 0개"));
        prepare(); run(request(type)); setMember(d => { d.member[giver].bag[carrot] = costs[type] - 1; }); const before = snapshot();
        assert(run("거래한다").includes("당근이 부족")); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
    }
});
test("본인·방·정확한 문구·전후 공백·다른 계정과 PROD/DEV 분리", () => {
    run(request("bag")); const state = pending(), before = snapshot();
    for (const input of ["거래한다 해봐", "✅ 거래한다", "안한다!", "/거래한다", "그냥 대화"]) { run(input); assert.strictEqual(pending().id, state.id); }
    run("거래한다", receiver); run("안한다", giver, "다른방"); run("거래한다", giver, room, false, false);
    assert.strictEqual(pending().id, state.id); assert.deepStrictEqual(snapshot(), before);
    prepare(5000, true); run(request("skill"), giver, room, true); assert(pending(giver, true));
    const prod = snapshot(); assert(run(" /거래한다 ", giver, room, true).includes("완료!")); assert.deepStrictEqual(snapshot(), prod); assert(pending());
    assert(run(" \t거래한다\n").includes("완료!"));
});
test("유저당 공통 대기1건·새 요청 덮어쓰기/시간 연장 금지·취소 무차감", () => {
    run(request("bag")); const state = pending(), before = snapshot(); now += 20000;
    for (const type of types) { assert(run(request(type)).includes("확인 대기 중")); assert.strictEqual(pending().id, state.id); assert.strictEqual(pending().expiresAt, state.expiresAt); }
    assert(run(" 안한다 ").includes("차감되지 않았습니다")); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
    assert.strictEqual(run("안한다"), "");
});
test("60초 정확한 경계·자동 만료·이전 타이머가 새 거래를 건드리지 않음", () => {
    run(request("bag")); const before = snapshot(); now += 59999; assert(pending()); assert(run("거래한다").includes("완료!"));
    prepare(); run(request("bag")); const state = pending(); now = state.expiresAt; assert(run("거래한다").includes("만료")); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
    prepare(); run(request("bag")); const oldTimer = timers[0]; run("안한다"); now += 1000; run(request("skill")); const next = pending();
    fixture.clear(); now += 59000; oldTimer.fn(); assert.strictEqual(pending().id, next.id); assert.strictEqual(fixture.replies().length, 0);
    tick(1000); assert(!pending()); assert(fixture.replies().join("\n").includes("만료")); const amount = fixture.replies().length; oldTimer.fn(); assert.strictEqual(fixture.replies().length, amount);
});
test("실제 대상 식별·번호 변경·강화/옵션 변경 취소·동명 다른 물품 방지", () => {
    for (const type of ["miniPet", "furniture", "pendant"]) {
        const file = type === "furniture" ? "home.json" : "member_pet.json", field = { miniPet: "miniPetBag", furniture: "furnitureBag", pendant: "pendantBag" }[type];
        prepare(); run(request(type)); setFile(file, d => { const other = clone(d[giver][field][0]); other.id += "other"; other.name = "AAA다른물품"; other.grade = "창조"; other.exp = 9999; other.sortIndex = 1; d[giver][field][0].sortIndex = 2; d[giver][field].unshift(other); });
        assert(run("거래한다").includes("완료!")); assert(fixture.get(root + file)[receiver][field].some(x => /^(pet-1|f-1|pendant-1)$/.test(x.id)));
        prepare(); run(request(type)); setFile(file, d => { d[giver][field][0].upgrade = 999; }); const before = snapshot();
        assert(run("거래한다").includes("정보가 변경")); assert.deepStrictEqual(snapshot(), before); assert(!pending());
        prepare(); setFile(file, d => { delete d[giver][field][0].id; }); run(request(type)); setFile(file, d => { const other = clone(d[giver][field][0]); other.name = "다른물품"; other.sortIndex = 1; other.exp = 9999; d[giver][field][0].sortIndex = 2; d[giver][field].unshift(other); });
        assert(run("거래한다").includes("완료!"));
    }
});
test("ID 없는 완전 동일 개체는 순서 변경 시 식별 불가로 무차감 취소", () => {
    prepare(); setFile("member_pet.json", d => { const pet = d[giver].miniPetBag[0]; delete pet.id; const other = clone(pet); other.sortIndex = 2; d[giver].miniPetBag.push(other); });
    run(request("miniPet")); setFile("member_pet.json", d => { d[giver].miniPetBag.push({ name: "세번째", emoji: "🐹", grade: "일반", battleExp: 10, sortIndex: 3 }); });
    const before = snapshot(); const text = run("거래한다"); assert(text.includes("가방 번호가 변경")); assert(!text.includes("완료!")); assert.deepStrictEqual(snapshot(), before); assert(!pending());
});
test("수량 감소·계정 소멸·티어/금지 조건·수신 공간 변경은 무차감 종료", () => {
    for (const type of types) for (const scenario of ["target", "tier", "stock", "capacity"]) {
        prepare(); run(request(type));
        if (scenario === "target") setMember(d => { delete d.member[receiver]; });
        if (scenario === "tier") setMember(d => { d.member[receiver].rank.tier = "새싹"; });
        if (scenario === "stock") {
            if (type === "bag") setMember(d => { d.member[giver].bag[material] = 1; });
            else if (type === "skill") setFile("petSkillData.json", d => { d[giver].petSkills.bag["기도"] = 1; });
            else setFile(type === "furniture" ? "home.json" : "member_pet.json", d => { d[giver][{ miniPet: "miniPetBag", furniture: "furnitureBag", pendant: "pendantBag" }[type]] = []; });
        }
        if (scenario === "capacity") {
            if (type === "bag") setFile("itemList.json", d => { d.untradableList.push(material); });
            else if (type === "skill") setFile("petSkillData.json", d => { d[receiver].petSkills.bag["기도"] = 100; });
            else setFile(type === "furniture" ? "home.json" : "member_pet.json", d => { const field = { miniPet: "miniPetBag", furniture: "furnitureBag", pendant: "pendantBag" }[type]; d[receiver][field] = Array.from({ length: 100 }, () => clone(d[giver][field][0])); });
        }
        const before = snapshot(); assert(!run("거래한다").includes("완료!")); assert.deepStrictEqual(snapshot(), before); assert(!pending());
    }
});
test("당근 자체 전송·비정상 입력·안전정수 초과는 확인 대기 없음", () => {
    const list = Array.from(c.generateBagOutput(fixture.read().member[giver].bag).sortedItemList), index = list.indexOf(carrot) + 1, before = snapshot();
    assert(run("/당근 " + receiver + " " + index + " 1").includes("당근 아이템은 거래할 수 없습니다")); assert(!pending());
    for (const type of types) for (const suffix of [" 해봐", " -1", " 1.2", " 0", " 9007199254740992"]) { run(request(type) + suffix); assert(!pending()); assert.deepStrictEqual(snapshot(), before); }
    assert(!c.getCarrotTradeRequest("/펫스킬당근 " + receiver + " 1 9007199254740991").type);
});
test("모든 거래 저장 지점의 실패·원문 복원·응답 재실행 무효·새 요청 재시도", () => {
    for (const type of types) {
        const files = type === "bag" ? ["member.json"] : ["member.json", { miniPet: "member_pet.json", furniture: "home.json", skill: "petSkillData.json", pendant: "member_pet.json" }[type]];
        for (const file of files) {
            prepare(); const command = request(type); run(command); const before = snapshot(); fixture.failPath(root + file);
            assert.throws(() => run("거래한다")); assert.deepStrictEqual(snapshot(), before); assert(!pending()); assert(!fixture.replies().some(x => x.includes("완료!")));
            assert.strictEqual(run("거래한다"), ""); run(command); assert(run("거래한다").includes("완료!"));
        }
    }
});
test("JSON 누락/손상·재시작·확인/완료/만료 응답 실패의 경계", () => {
    for (const mode of ["remove", "corrupt"]) for (const type of ["bag", "furniture"]) {
        prepare(); run(request(type)); fixture[mode](root + (type === "bag" ? "itemList.json" : "home.json")); const before = snapshot();
        assert.throws(() => run("거래한다")); assert.deepStrictEqual(snapshot(), before); assert(!pending());
    }
    prepare(); run(request("bag")); const before = snapshot(); c.carrotTradePending = {}; assert.strictEqual(run("거래한다"), ""); assert.deepStrictEqual(snapshot(), before);
    prepare(); fixture.replyFail(true); assert.throws(() => run(request("bag"))); fixture.replyFail(false); assert(!pending());
    run(request("bag")); fixture.replyFail(true); run("거래한다"); fixture.replyFail(false); assert.strictEqual(fixture.read().member[receiver].bag[material], 2); assert(!pending());
    prepare(); run(request("bag")); fixture.replyFail(true); tick(60000); fixture.replyFail(false); assert(!pending());
});
test("자유시장 표시 기준·숫자 쉼표·UI 치환·번호 안내 조건", () => {
    for (const type of types) {
        prepare(); const text = run(request(type));
        if (type === "miniPet") assert(text.includes("강화+3") && text.includes("[일반]"));
        if (type === "furniture") assert(text.includes("120💕") && text.includes("[일반]"));
        if (type === "pendant") assert(text.includes("(+7)") && text.includes("⚒️4/5"));
        assert(!text.includes("{아이템명}") && !text.includes("포인트")); const done = run("거래한다"); assert(!done.endsWith("━━━━━━━━━━━━"));
    }
    prepare(3000); setMember(d => { d.member[giver].bag[material] = 1231; }); run(request("bag", 1231)); const done = run("거래한다"); assert(done.includes("1,231개")); assert(done.includes("잔여 1,769개"));
    prepare(); setMember(d => { d.member[giver].bag["AAA앞아이템"] = 1; }); const command = request("bag"); run(command); setMember(d => { delete d.member[giver].bag["AAA앞아이템"]; }); assert(run("거래한다").includes("가방 번호가 변경"));
    prepare(); run(request("miniPet")); assert(!run("거래한다").includes("가방 번호가 변경"));
});
test("원래 명령으로 공통 정책 재검사·약관 조건 유지·실패 뒤 대기 해제", () => {
    for (const type of types) {
        prepare(); const command = request(type); run(command); const before = snapshot();
        let checked; c.testPolicyGate = value => { checked = value; return true; };
        assert.strictEqual(run("거래한다"), ""); assert.strictEqual(checked, command); assert(!pending()); assert.deepStrictEqual(snapshot(), before); c.testPolicyGate = null;
        prepare(); setMember(d => { d.member[giver].agree = false; }); const text = run(request(type));
        if (type === "skill") assert(pending()); else { assert(text.includes("약관")); assert(!pending()); }
    }
});
test("손상된 당근/부수보상·범위 초과와 동일 개체 남은 번호 변경", () => {
    for (const value of [null, "5000", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        prepare(); setMember(d => { d.member[giver].bag[carrot] = value; }); const before = snapshot(); assert.throws(() => run(request("bag"))); assert.deepStrictEqual(snapshot(), before); assert(!pending());
    }
    for (const value of [null, "2", -1, Number.MAX_SAFE_INTEGER]) {
        prepare(); setMember(d => { d.member[receiver].bag[c.GLOBAL_CONFIG.items.carrotThermometerName] = value; }); const before = snapshot(); assert(!run(request("bag")).includes("확인!")); assert.deepStrictEqual(snapshot(), before); assert(!pending());
    }
    prepare(); setFile("member_pet.json", d => { const a = d[giver].miniPetBag[0]; delete a.id; const b = clone(a); b.sortIndex = 2; d[giver].miniPetBag.push(b); });
    run(request("miniPet")); assert(run("거래한다").includes("가방 번호가 변경"));
    prepare(); setFile("member_pet.json", d => { const a = clone(d[giver].miniPetBag[0]); a.id = "other"; a.battleExp = 10; a.sortIndex = 2; d[giver].miniPetBag.push(a); });
    run("/미니펫당근 " + receiver + " 2"); assert(!run("거래한다").includes("가방 번호가 변경"));
});
test("설정 변경·슬롯가방 상한·수신 강화정보 보존·특수 계정명", () => {
    run(request("skill")); const before = snapshot(), cost = c.GLOBAL_CONFIG.carrotTrade.costs.skill; c.GLOBAL_CONFIG.carrotTrade.costs.skill++;
    try { assert(run("거래한다").includes("소모 기준이 변경")); assert.deepStrictEqual(snapshot(), before); assert(!pending()); } finally { c.GLOBAL_CONFIG.carrotTrade.costs.skill = cost; }
    prepare(); setMember(d => { delete d.member[giver].bag[material]; d.member[giver].bag["슬롯가방🎒(+5)"] = 2; d.member[receiver].bag["슬롯가방🎒(+5)"] = 19; });
    const list = Array.from(c.generateBagOutput(fixture.read().member[giver].bag).sortedItemList), index = list.indexOf("슬롯가방🎒(+5)") + 1;
    assert(run("/당근 " + receiver + " " + index + " 2").includes("최대 20개")); assert(!pending());
    for (const user of ["__proto__", "constructor", "toString"]) {
        prepare(); setMember(d => { Object.defineProperty(d.member, user, { value: d.member[giver], enumerable: true }); delete d.member[giver]; });
        const list = Array.from(c.generateBagOutput(fixture.read().member[user].bag).sortedItemList), index = list.indexOf(material) + 1;
        run("/당근 " + receiver + " " + index + " 2", user); assert(pending(user)); assert(run("거래한다", user).includes("완료!")); assert(!pending(user));
    }
    prepare(); const alias = request("pendant").replace("/펜던트당근", "/펜던트당근거래"); run(alias); assert(run("거래한다").includes("완료!"));
});
test("강화가 다른 동명 개체의 확인·완료 표시와 실제 전송 대상 일치", () => {
    for (const type of ["miniPet", "furniture", "pendant"]) {
        prepare(); const file = type === "furniture" ? "home.json" : "member_pet.json", field = { miniPet: "miniPetBag", furniture: "furnitureBag", pendant: "pendantBag" }[type];
        setFile(file, d => { const other = clone(d[giver][field][0]); other.id = "same-name-other"; other.upgrade = 9; other.sortIndex = 2; if (type === "furniture") other.exp = 999; d[giver][field].push(other); });
        const command = { miniPet: "/미니펫당근", furniture: "/가구당근", pendant: "/펜던트당근" }[type] + " " + receiver + " " + (type === "furniture" ? 1 : 2);
        const first = run(command), expected = type === "miniPet" ? "강화+9" : type === "furniture" ? "999💕" : "(+9)";
        assert(first.includes(expected)); const done = run("거래한다"); assert(done.includes(expected));
        const item = fixture.get(root + file)[receiver][field][0]; assert.strictEqual(item.id, "same-name-other"); assert.strictEqual(item.upgrade, 9);
    }
});
console.log("당근거래 확인·저장·예외 " + groups + "개 그룹 통과");
}
module.exports = { c, fixture, block, main, root, devRoot, carrot, material, giver, receiver, room, types, costs, prepare, request, run, pending, snapshot, setMember, setFile, tick, clone, runTests };
if (require.main === module) runTests();
