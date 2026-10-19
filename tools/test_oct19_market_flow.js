const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const base = fs.readFileSync(path.join(__dirname, "test_member_display_search_auth.js"), "utf8");
const { c, fixture, block } = new Function("require", "__dirname", base.slice(0, base.indexOf('\npass("')) + "\nreturn {c,fixture,block};")(require, __dirname);
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/", carrot = c.GLOBAL_CONFIG.items.carrotName, material = "합성재료";
c.freeMarketPath = root + "freeMarket.json"; c.petSkillDataPath = root + "petSkillData.json"; c.PET_SKILL_BAG_MAX_COUNT = 100;
c.hasPetSkill = () => false; c.isRetiredPetSkill = () => false; c.normalizePetSkillName = name => name;
c.formatPetSkillName = name => name; c.formatPendantDisplay = pendant => pendant.name;
c.isTradableItem = () => true; c.isHoiPassPremiumActive = () => false; c.getFurnitureBagLimit = () => 100;
c.checkRank = (_d, _p, _g, user) => user; c.userState = {};
c.miniPetData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "miniPetData.json"), "utf8"));
vm.runInContext(block(main, "const ticketTierData ="), c);
vm.runInContext(main.match(/(?:const|var|let) FREE_MARKET_MAX_COMPLETED_LOGS\s*=\s*\d+;/)[0], c);
const helpers = ["hasItem", "removeItem", "addItem", "normalizePendantTransitionItemName", "normalizePendantTransitionBagItem", "normalizeUniversalCollectionKeyBagItems", "normalizeItemName", "generateBagOutput", "roundToTwo", "isTierKing", "isMemberTierKing", "canRegisterFreeMarketByTier", "isFreeMarketRegisterCommand", "parseJsonContent", "ensureFreeMarketData", "getFreeMarketActiveListings", "getFreeMarketListingByDisplayNo", "getFreeMarketListingById", "countFreeMarketActiveListingsBySeller", "getFreeMarketRegisterLimit", "getFreeMarketCarrotFee", "getFreeMarketMemberTicketCount", "normalizeFreeMarketMemberTicketName", "hasFreeMarketMemberTicket", "getFreeMarketTradeFeeRate", "formatTransferFeeRate", "buildFreeMarketTradeFeeNotice", "buildFreeMarketRegisterConfirmMessage", "buildFreeMarketBuyConfirmMessage", "setFreeMarketConfirmState", "clearFreeMarketConfirmState", "addFreeMarketListing", "cloneFreeMarketObject", "removeFreeMarketListing", "addFreeMarketCompletedLog", "getFreeMarketItemText", "formatFreeMarketPoint", "formatFreeMarketUnitPriceText", "formatDateTime", "formatFreeMarketMiniPetDetail", "getFreeMarketMiniPetDisplayName", "getFreeMarketMiniPetNumber", "isSameFreeMarketMiniPet", "getFreeMarketFurnitureDisplayName", "formatFreeMarketFurnitureDetail", "isSameFreeMarketFurniture", "sortMiniPetBag", "refreshMiniPetSortIndex", "getMiniPetBagLimit", "sortFurnitureList", "initSweetHomeUser", "buildPlacedFurnitureSummary", "initPetSkillUser", "normalizePetSkillStoredNames", "getPetSkillBagList", "getPetSkillBagTotalCount", "getPetSkillBagRemainCount", "addPetSkillToBag", "removePetSkillFromBag", "ensurePendantUser", "getPendantBag", "getPendantBagLimit", "sortPendantBagByGrade", "registerPendantFreeMarket", "returnFreeMarketItemToOwner", "refundFreeMarketCancelCarrotFee", "buildFreeMarketCancelCarrotFeeNotice", "ensureHappyFoundationData", "addHappyFoundationLedgerAmount"];
for (const name of helpers) vm.runInContext(block(main, "function " + name + "("), c);
vm.runInContext(block(main, "function formatKoreanShort("), c);
const branches = ["가방거래등록", "미니펫거래등록", "가구거래등록", "스킬거래등록", "펜던트거래등록", "자유시장취소", "거래소강제취소", "자유시장구매"].map(command => block(main, "if (/^\\/" + command + "\\s+"));
const snapshotEntry = main.slice(main.indexOf("                var freeMarketRollbackText = null;"), main.indexOf('                if (msg === "/자유시장생성")'));
vm.runInContext("function marketBranch(){" + snapshotEntry + branches.join("\n") + "}", c);
const keys = ["member.json", "member_pet.json", "home.json", "petSkillData.json", "freeMarket.json"];
let directWriteFailure = null;
const directWrite = c.FileStream.write;
c.FileStream.write = (file, text) => {
    if (file === directWriteFailure) { directWriteFailure = null; throw Error("synthetic market direct write failure"); }
    return directWrite(file, text);
};
const snapshot = (dev = false) => keys.map(name => fixture.raw((dev ? devRoot : root) + name));
const readMarket = () => fixture.get(c.freeMarketPath);
const clone = value => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(name, fn) { fixture.reset(); fn(); console.log("PASS MARKET " + (++groups) + ": " + name); }
function prepare(member = false, stock = 5000) {
    fixture.reset(); c.userState = {};
    const d = fixture.read();
    d.member.seller = { point: 1000, bag: { [carrot]: stock, [material]: 5 }, rank: { tier: "킹" } };
    d.member.buyer = { point: 100000, bag: {}, rank: { tier: "킹" } };
    if (member) d.member.seller.bag[c.GLOBAL_CONFIG.freeMarket.memberTicketItemName] = 1;
    fixture.write(d);
    const mini = { name: "합성펫", emoji: "🐹", grade: "일반", battleExp: 100, castleExp: 100, raidExp: 100, upgrade: 0, sortIndex: 1 };
    fixture.put(root + "member_pet.json", { seller: { miniPetBag: [clone(mini), clone(mini)], pendantBag: [{ name: "합성펜던트", grade: "일반", durability: 5, maxDurability: 5, upgrade: 0 }] }, buyer: { miniPetBag: [], pendantBag: [] } });
    const furniture = { name: "합성가구", emoji: "🪑", exp: 100, grade: "일반" };
    fixture.put(root + "home.json", { seller: { floor: 200, furnitureBag: [clone(furniture), clone(furniture)] }, buyer: { floor: 200, furnitureBag: [] } });
    fixture.put(root + "petSkillData.json", { seller: { petSkills: { equipped: [], lockedPremium: [], bag: { "기도": 4 } } }, buyer: { petSkills: { equipped: [], lockedPremium: [], bag: {} } } });
    fixture.put(c.freeMarketPath, { nextId: 1, listings: [], completedLogs: [] });
}
function run(command, user = "seller", confirmed = true, dev = false) {
    fixture.clear(); const ctx = c.createCommandContext(dev, "test"), previous = c.enterCommandContext(ctx);
    c.beginDataSaveTransaction(); c.ctx = ctx; c.msg = command; c.sender = user; c.isFreeMarketConfirmed = confirmed; c.freeMarketConfirmState = null;
    try { c.data = c.loadJsonFile(c.filePath); c.petData = c.loadJsonFile(c.memberPetPath); c.petSkillData = c.loadJsonFile(c.petSkillDataPath); c.guildData = {}; c.marketBranch(); }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return fixture.replies().join("\n");
}
function registration(type, quantity = 2, price = 10000) {
    if (type === "bag") {
        const list = c.generateBagOutput(fixture.read().member.seller.bag).sortedItemList;
        return "/가방거래등록 " + (Array.from(list).indexOf(material) + 1) + " " + quantity + " " + price;
    }
    return { miniPet: "/미니펫거래등록 1 " + quantity + " " + price, furniture: "/가구거래등록 1 " + quantity + " " + price, skill: "/스킬거래등록 1 " + quantity + " " + price, pendant: "/펜던트거래등록 1 " + price }[type];
}
const types = ["bag", "miniPet", "furniture", "skill", "pendant"];

test("다섯 실제 등록 명령의 확정 전 무차감·개당 비용·저장 영수증 일치", () => {
    for (const type of types) {
        prepare(); const command = registration(type), before = snapshot();
        run(command, "seller", false); assert.deepStrictEqual(snapshot(), before); assert.strictEqual(readMarket().listings.length, 0);
        assert(run(command).includes("등록 완료")); const listing = readMarket().listings[0];
        const expected = { bag: 2, miniPet: 200, furniture: 200, skill: 600, pendant: 300 }[type];
        assert.strictEqual(listing.carrotFee, expected); assert.strictEqual(fixture.read().member.seller.bag[carrot], 5000 - expected);
        const repeatBefore = snapshot(); run(command); assert.deepStrictEqual(snapshot(), repeatBefore); // 일반 등록 1건 제한
    }
});
test("다섯 거래 구매의 실제 차감·17/10% 정산·재단·물품 이전·재구매 차단", () => {
    for (const member of [false, true]) for (const type of types) {
        prepare(member); run(registration(type));
        const before = snapshot(); run("/자유시장구매 1", "buyer", false); assert.deepStrictEqual(snapshot(), before);
        assert(run("/자유시장구매 1", "buyer").includes("구매 완료"));
        const data = fixture.read(), log = readMarket().completedLogs[0], expected = member ? 9000 : 8300;
        assert.strictEqual(data.member.buyer.point, 90000); assert.strictEqual(data.member.seller.point, 1000 + expected);
        assert.strictEqual(data.hoiHappyFoundation.totalAmount, 10000 - expected); assert.strictEqual(log.sellerReceive, expected);
        assert.strictEqual(log.feeRate, member ? 0.1 : 0.17); assert.strictEqual(readMarket().listings.length, 0);
        if (type === "bag") assert.strictEqual(data.member.buyer.bag[material], 2);
        if (type === "miniPet") assert.strictEqual(fixture.get(root + "member_pet.json").buyer.miniPetBag.length, 2);
        if (type === "furniture") assert.strictEqual(fixture.get(root + "home.json").buyer.furnitureBag.length, 2);
        if (type === "skill") assert.strictEqual(fixture.get(root + "petSkillData.json").buyer.petSkills.bag["기도"], 2);
        if (type === "pendant") assert.strictEqual(fixture.get(root + "member_pet.json").buyer.pendantBag.length, 1);
        const paid = snapshot(); run("/자유시장구매 1", "buyer"); assert.deepStrictEqual(snapshot(), paid);
    }
});
test("다섯 거래 취소·회원권 환불·과거 등록액·타인 취소 차단", () => {
    for (const member of [false, true]) for (const type of types) {
        prepare(member); run(registration(type)); const fee = readMarket().listings[0].carrotFee;
        const before = snapshot(); run("/자유시장취소 1", "buyer"); assert.deepStrictEqual(snapshot(), before);
        run("/자유시장취소 1"); assert.strictEqual(readMarket().listings.length, 0);
        assert.strictEqual(fixture.read().member.seller.bag[carrot], member ? 5000 : 5000 - fee);
    }
    prepare(true); run(registration("furniture")); const old = readMarket(); old.listings[0].carrotFee = 5; fixture.put(c.freeMarketPath, old);
    const amount = fixture.read().member.seller.bag[carrot]; run("/자유시장취소 1"); assert.strictEqual(fixture.read().member.seller.bag[carrot], amount + 5);
});
test("최소 비용 바로 아래·아이템 부족·오입력은 등록 무변경", () => {
    for (const type of types) {
        const need = { bag: 2, miniPet: 200, furniture: 200, skill: 600, pendant: 300 }[type];
        prepare(false, need - 1); let before = snapshot(); run(registration(type)); assert.deepStrictEqual(snapshot(), before);
        for (const suffix of [" 해봐", " 1"]) { prepare(); before = snapshot(); run(registration(type) + suffix); assert.deepStrictEqual(snapshot(), before); }
        prepare(); before = snapshot(); run(registration(type).replace(/\d+$/, "0")); assert.deepStrictEqual(snapshot(), before);
    }
});
test("모든 등록/구매/취소 저장 지점 실패는 모든 파일 원복", () => {
    for (const type of types) {
        const extra = { miniPet: "member_pet.json", furniture: "home.json", skill: "petSkillData.json", pendant: "member_pet.json" }[type];
        const files = ["member.json", ...(extra ? [extra] : []), "freeMarket.json"];
        for (const action of ["register", "buy", "cancel"]) for (const file of files) {
            prepare(true); if (action !== "register") run(registration(type));
            const command = action === "register" ? registration(type) : action === "buy" ? "/자유시장구매 1" : "/자유시장취소 1";
            const before = snapshot(); fixture.failPath(root + file); directWriteFailure = root + file;
            assert.throws(() => run(command, action === "buy" ? "buyer" : "seller"), undefined, type + "/" + action + "/" + file); assert.deepStrictEqual(snapshot(), before, type + "/" + action + "/" + file);
            assert(!fixture.replies().some(text => text.includes("완료")), "저장 실패 전 성공 안내: " + type + "/" + action + "/" + file);
            directWriteFailure = null;
        }
    }
});
test("DEV 거래 성공·저장 실패는 DEV 파일만 변경·복구", () => {
    prepare(true); for (const name of keys) fixture.put(devRoot + name, fixture.get(root + name));
    const prod = snapshot(); run("/가구거래등록 1 2 10000", "seller", true, true);
    assert.deepStrictEqual(snapshot(), prod); assert.strictEqual(fixture.get(devRoot + "freeMarket.json").listings.length, 1);
    const before = snapshot(true); fixture.failPath(devRoot + "freeMarket.json");
    assert.throws(() => run("/자유시장구매 1", "buyer", true, true)); assert.deepStrictEqual(snapshot(true), before); assert.deepStrictEqual(snapshot(), prod);
});
test("관리자 강제취소·비관리자 차단·회원권 반환액 보존", () => {
    prepare(true); run("/가구거래등록 1 2 10000"); const before = snapshot();
    run("/거래소강제취소 1", "buyer"); assert.deepStrictEqual(snapshot(), before);
    assert(run("/거래소강제취소 1", "master").includes("강제취소 완료"));
    assert.strictEqual(readMarket().listings.length, 0); assert.strictEqual(fixture.read().member.seller.bag[carrot], 5000);
});
test("구매 포인트 부족·수신 가방 한도·사라진 판매자·본인 구매 무변경", () => {
    for (const type of types) {
        prepare(true); run(registration(type)); let before = snapshot(); run("/자유시장구매 1"); assert.deepStrictEqual(snapshot(), before);
        const data = fixture.read(); data.member.buyer.point = 9999; fixture.write(data); before = snapshot(); run("/자유시장구매 1", "buyer"); assert.deepStrictEqual(snapshot(), before);
        data.member.buyer.point = 100000; delete data.member.seller; fixture.write(data); before = snapshot(); run("/자유시장구매 1", "buyer"); assert.deepStrictEqual(snapshot(), before);
    }
    prepare(true); run(registration("furniture")); const homes = fixture.get(root + "home.json"); homes.buyer.furnitureBag = Array.from({ length: 100 }, () => ({ name: "full", exp: 1 })); fixture.put(root + "home.json", homes);
    const before = snapshot(); run("/자유시장구매 1", "buyer"); assert.deepStrictEqual(snapshot(), before);
});
console.log("10월19일 자유시장 실제 흐름 " + groups + "개 그룹 통과");
