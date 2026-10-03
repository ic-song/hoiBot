const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
const infoSource = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 실제 명령과 계산·저장 함수를 추출하며 운영 데이터는 사용하지 않는다.
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
const start = source.indexOf('if (msg === "/구매" ||');
const end = source.indexOf('if (msg.startsWith("/좋아요 "))', start);
assert(start >= 0 && end > start);
const command = "(function () {" + source.slice(start, end) + "})()";
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/";
const files = ["member.json", "member_pet.json", "guildData.json"].map(n => root + n);
const user = "합성 사용자", ticket = "티어 승급티켓🎟", normalItem = "합성 일반상품", max = 9007199254740991;
let disk, failure, events, replies;
function lock() { return { lock() {}, unlock() {} }; }
function threadLocal() { return { value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } }; }

// Java IO만 합성 파일시스템으로 대체하고 실제 파일 교체 함수를 실행한다.
function FakeFile(file) { this.path = String(file); }
FakeFile.prototype.exists = function () { return Object.hasOwn(disk, this.path); };
FakeFile.prototype.getPath = function () { return this.path; };
FakeFile.prototype.delete = function () { delete disk[this.path]; return true; };
FakeFile.prototype.renameTo = function (to) {
    if (this.path.endsWith(".tmp") && failure === to.path) { failure = null; return false; }
    if (!this.exists()) return false;
    disk[to.path] = disk[this.path]; delete disk[this.path];
    if (this.path.endsWith(".tmp")) events.push("save:" + to.path);
    return true;
};
const c = {
    sender: user, castleSiegeFlag: false, filePath: files[0], memberPetPath: files[1], guildPath: files[2],
    allsee: "<ALLSEE>", DATA_ROOT_PATH: root, DEV_DATA_ROOT_PATH: devRoot, COMMON_DATA_FILE_MAP: {},
    commandContextThreadLocal: threadLocal(), dataSaveTransactionThreadLocal: threadLocal(),
    dataTransactionLock: lock(), getProtectedJsonSaveLock: () => lock(),
    isProtectedManagedJsonPath: p => files.includes(p) || files.map(f => f.replace(root, devRoot)).includes(p),
    getManagedJsonBackupPath: p => p + ".bak", getManagedJsonSecondaryBackupPath: () => null,
    getAutoDailyBatchContext: () => null, ensureParentFolder() {}, debuggerLog() {},
    parseManagedJsonContent: text => JSON.parse(text),
    restoreManagedJsonFromBackup(p) { assert(disk[p + ".bak"]); disk[p] = disk[p + ".bak"]; return { data: JSON.parse(disk[p]) }; },
    hasPetSkill: (_d, _u, name) => c.skills.includes(name),
    normalizePendantTransitionBagItem: (_bag, name) => name,
    getMyGuildInfo: (_d, g) => ({ guild: g.guild }), ensureGuildWarehouseObj: g => g.warehouse,
    numberWithCommas: n => Number(n).toLocaleString("en-US"), checkRank: () => c.sender,
    buildPetSkillMsg: (_d, _p, _g, _u, n) => n,
    roundToTwo: n => Math.round(n * 100) / 100,
    getRandomCharacter: () => "합성성격", getRandomPetType: () => "땅",
    petTypes1: [{ name: "하늘" }], petTypes2: [{ name: "하늘" }], petTypes3: [],
    updateEmoji: (p, replier) => { p.petimg = "🦊"; replier.reply("펫 외형 변경 완료"); },
    replier: { reply(message) { events.push("reply"); replies.push(message); } },
    FileStream: { read: p => disk[p], write() { throw Error("Unexpected direct write"); } },
    java: { io: {
        File: FakeFile,
        FileOutputStream: function (file) { this.path = file.path; disk[this.path] = ""; this.getFD = () => ({ sync() {} }); this.close = () => {}; },
        OutputStreamWriter: function (stream) { this.write = text => { disk[stream.path] = text; }; this.flush = () => {}; this.close = () => {}; }
    } },
    GLOBAL_CONFIG: { pointShop: {}, petMusou: {}, petSkill: {}, items: { carrotName: "🥕당근이세요?" }, pet: { evolutionRequiredExp: 600 }, happyFoundation: { transferFeeMin: 0, transferFeeMax: 100 } }
};
vm.createContext(c);
vm.runInContext("GLOBAL_CONFIG.pointShop = " + source.match(/pointShop: (\{[\s\S]*?\n    \}),\n    guaranteedPackage/)[1], c);
vm.runInContext("GLOBAL_CONFIG.petSkill.shopDiscounts = " + source.match(/shopDiscounts: (\{[\s\S]*?\n        \})/)[1], c);
vm.runInContext("GLOBAL_CONFIG.petMusou.ticketEvent = { coupons: " + source.match(/ticketEvent: \{\s*coupons: (\[[\s\S]*?\n            \])/)[1] + " };", c);
for (const name of ["isPointShopSafeAmount", "isPointShopSafeCount", "isPointShopTaxSettlementSafe", "buildTicketEventCouponPurchasePlan", "buildPointShopPurchaseQuote",
    "getPointShopTierTicketBonusCount", "getPointShopTierTicketPurchaseQuantity", "consumeTicketEventCouponPlan", "buildTicketEventCouponUsageMessage", "buildPointShopBuyMessage",
    "hasPoint", "addPoint", "addItem", "applyTax", "ensureHappyFoundationData", "addHappyFoundationLedgerAmount",
    "isDevCommandMessage", "stripDevCommandPrefix", "createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataFileName", "resolveActiveDataPath",
    "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "writeVerifiedJsonFile", "saveJsonFile"])
    vm.runInContext(fn(name), c);
const coupons = Array.from(c.GLOBAL_CONFIG.petMusou.ticketEvent.coupons);
const coupon50 = coupons.find(x => x.rate === 50).name, coupon10 = coupons.find(x => x.rate === 10).name;

// 저장을 포함한 정상·실패 시나리오를 같은 합성 회원에서 시작한다.
function reset(item = ticket, price = 7000000) {
    const member = { shop: { [item]: price }, HoiCastle: { taxRate: 5, lord: "합성 성주", earnings: 100 }, hoiHappyFoundation: { totalAmount: 200, feeRate: 1.5, captain: "" },
        member: { [user]: { point: 500000000000, bag: {} }, "호이 남": { point: 500000000000, bag: {} } } };
    const pets = { [user]: { petname: "합성펫", petexp: 100, pettype: "하늘", petimg: "🐹" } };
    const guild = { guild: { warehouse: { fund: 300 } } };
    disk = {};
    for (const [i, data] of [member, pets, guild].entries()) { disk[files[i]] = JSON.stringify(data); disk[files[i].replace(root, devRoot)] = JSON.stringify(data); }
    c.sender = user; c.skills = []; c.castleSiegeFlag = false;
    c.commandContextThreadLocal.remove(); c.dataSaveTransactionThreadLocal.remove();
    failure = null; replies = []; events = [];
}
function edit(mutator) { const d = JSON.parse(disk[files[0]]); mutator(d); disk[files[0]] = JSON.stringify(d); }
function read(i = 0, dev = false) { return JSON.parse(disk[dev ? files[i].replace(root, devRoot) : files[i]]); }
function originalFiles() { return files.map(f => disk[f]); }
function run(msg = "/구매 1 1") {
    replies = []; events = [];
    const isDev = c.isDevCommandMessage(msg);
    const previous = c.enterCommandContext(c.createCommandContext(isDev));
    c.msg = isDev ? c.stripDevCommandPrefix(msg) : msg;
    c.data = JSON.parse(disk[c.resolveActiveDataPath(files[0])]);
    c.petData = JSON.parse(disk[c.resolveActiveDataPath(files[1])]);
    c.guildData = JSON.parse(disk[c.resolveActiveDataPath(files[2])]); c.petSkillData = {};
    c.beginDataSaveTransaction();
    try { vm.runInContext(command, c); }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return replies.join("\n");
}

// 1. 경계와 생략 시 기본 수량을 실제 결제·지급 값으로 검증한다.
for (const [msg, quantity] of [["/구매 1", 1], ["/구매 1 1", 1], ["/구매 1 9999", 9999], ["/구매 1 0002", 2]]) {
    reset(); assert(run(msg).includes("구매 완료"));
    const d = read(); assert.strictEqual(d.member[user].bag[ticket], quantity);
    assert.strictEqual(500000000000 - d.member[user].point, quantity * 7350000);
    assert(events.indexOf("reply") > events.lastIndexOf("save:" + files[1]));
}
console.log("PASS 1: 1~9999개·생략 1개·가격과 지급 수량 일치·저장 후 성공");

// 2. 스크린샷 수량·무한대·잘못된 입력은 관리자에게도 지급하지 않는다.
for (const sender of [user, "호이 남"]) for (const raw of ["10000", "1" + "0".repeat(21), "9".repeat(80), "110191919191919191919919229" + "7".repeat(110), "9".repeat(400), "0", "-1", "1.5", "1e3", "NaN", "Infinity", "2 해봐"]) {
    reset(); c.sender = sender; const before = originalFiles(); const output = run("/구매 1 " + raw);
    assert.deepStrictEqual(originalFiles(), before, "invalid quantity changed persisted state");
    assert(!output.includes("구매 완료"));
    if (/^\d+$/.test(raw) && Number(raw) > 9999) assert(output.includes("9,999"));
}
console.log("PASS 2: 10000 이상·캡처 큰 정수·Infinity·0·접미 입력·관리자 예외 없음");

// 3. 쿠폰→스킬 할인→세금과 티어 보너스의 기존 순서를 유지한다.
reset(); edit(d => { d.member[user].bag[coupon50] = 2; d.member[user].bag[coupon10] = 5; }); c.skills = ["VIP블랙카드", "탈세자", "티어 상승론"];
let output = run("/구매 1 100"); let d = read();
const expectedPrice = 482650000; // 7억 - 50% 쿠폰 2장 - 10% 쿠폰 5장, 그 뒤 VIP 30% 할인
assert.strictEqual(d.member[user].bag[ticket], 101);
assert.strictEqual(500000000000 - d.member[user].point, expectedPrice + Math.round(expectedPrice * 0.015));
assert(!d.member[user].bag[coupon50] && !d.member[user].bag[coupon10]); assert(output.includes("추가로 획득"));
assert.strictEqual(read(2).guild.warehouse.fund, 300 + Math.round(Math.round(expectedPrice * 0.015) * 0.15));
reset(); edit(d => { d.member[user].bag[coupon50] = 1; }); c.skills = ["VIP블랙카드", "탈세자"];
run(); assert.strictEqual(500000000000 - read().member[user].point, 2486750);
reset(); c.skills = ["쇼핑광"]; run("/구매 1 2"); assert.strictEqual(500000000000 - read().member[user].point, 11760000);
console.log("PASS 3: 쿠폰 여러 할인율·VIP/쇼핑광·탈세자·티어 보너스·세금 배분 유지");

// 4. 일반 상품도 제한을 적용하며 무료 상품의 기존 정책을 유지한다.
reset(normalItem, 100); run("/구매 1 9999"); assert.strictEqual(read().member[user].bag[normalItem], 9999);
reset(normalItem, 0); run("/구매 1 9999"); assert.strictEqual(read().member[user].point, 500000000000); assert.strictEqual(read().member[user].bag[normalItem], 9999);
reset(normalItem); const beforeNormal = originalFiles(); run("/구매 1 " + "9".repeat(80)); assert.deepStrictEqual(originalFiles(), beforeNormal);
console.log("PASS 4: 일반·티켓·0원 상품 동일 9999개 제한");

// 5. 숫자 캐스팅·정밀도 손상 상태는 자동 초기화 없이 차단한다.
for (const value of [1e80, -1, "10", null]) for (const field of ["point", "bag", "coupon", "tax", "ledger", "earnings"]) {
    reset(); edit(d => {
        if (field === "point") d.member[user].point = value;
        if (field === "bag") d.member[user].bag[ticket] = value;
        if (field === "coupon") d.member[user].bag[coupon50] = value;
        if (field === "tax") d.HoiCastle.taxRate = value;
        if (field === "ledger") d.hoiHappyFoundation.totalAmount = value;
        if (field === "earnings") d.HoiCastle.earnings = value;
    });
    const before = originalFiles(); output = run();
    // 세율은 기존 숫자 문자열을 허용하며 null은 기존 세금 없음으로 처리한다.
    if (field === "tax" && (value === "10" || value === null)) continue;
    assert.deepStrictEqual(originalFiles(), before, field + " corrupt state was changed"); assert(!output.includes("구매 완료"));
}
for (const price of [-1, 1e80, Infinity, null, "", true, "10", max]) { reset(ticket, price); const before = originalFiles(); run("/구매 1 2"); assert.deepStrictEqual(originalFiles(), before); }
for (const field of ["ledger", "earnings", "guildFund"]) {
    reset();
    if (field === "ledger") edit(d => { d.hoiHappyFoundation.totalAmount = max; });
    if (field === "earnings") edit(d => { d.HoiCastle.earnings = max; });
    if (field === "guildFund") { const g = read(2); g.guild.warehouse.fund = max; disk[files[2]] = JSON.stringify(g); }
    const before = originalFiles(); run(); assert.deepStrictEqual(originalFiles(), before, field + " settlement overflow");
}
reset(); edit(d => { d.member[user].bag[ticket] = max; }); let before = originalFiles(); run(); assert.deepStrictEqual(originalFiles(), before);
reset(); c.skills = ["티어 상승론"]; edit(d => { d.member[user].bag[ticket] = max - 100; }); before = originalFiles(); run("/구매 1 100"); assert.deepStrictEqual(originalFiles(), before);
console.log("PASS 5: 손상된 보유량·포인트·쿠폰·가격·세금·적립액·보너스 합산 초과 차단");

// 6. 견적의 캐스팅은 지수 표기 값을 작은 수로 재해석하지 않는다.
reset(); run("/구매");
for (const quantity of [1e21, 1e80, Infinity, NaN, 0, -1, 1.5, "9999", true, null]) assert.strictEqual(c.buildPointShopPurchaseQuote(c.data, {}, user, ticket, quantity, 7000000).available, false);
assert.strictEqual(c.buildPointShopPurchaseQuote(c.data, {}, user, ticket, 10000, 7000000).quantity, 10000);
assert.strictEqual(c.getPointShopTierTicketBonusCount({}, user, ticket, 1e80), 0);
assert.strictEqual(c.buildTicketEventCouponPurchasePlan(c.data, user, ticket, 1e80, 7000000), null);
console.log("PASS 6: 공용 견적·쿠폰·보너스 숫자 재파싱 제거·조회용 큰 수량 유지");

// 7. 기존 일일 제한과 상품별 다량 구매 제한은 유지한다.
reset("다이아상자💎", 100); run("/구매 1 100"); assert.strictEqual(read().member[user].diamondBoxBuyCount, 100);
before = originalFiles(); run(); assert.deepStrictEqual(originalFiles(), before);
reset(c.GLOBAL_CONFIG.items.carrotName, 100); run("/구매 1 1000"); assert.strictEqual(read().member[user].carrotBuyCount, 1000);
before = originalFiles(); run(); assert.deepStrictEqual(originalFiles(), before);
for (const item of ["자동배팅😝🤖(1일)", "펫 성격 변경하기😣", "펫 속성리롤🔄"]) { reset(item, 100); before = originalFiles(); run("/구매 1 2"); assert.deepStrictEqual(originalFiles(), before); }
console.log("PASS 7: 다이아 100개·당근 1000개 일일 제한·다량 불가 상품 유지");

// 8. 길드·회원·펫 저장 지점 실패는 원본을 복구하고 완료 안내를 보내지 않는다.
for (const file of files) {
    reset(); edit(d => { d.member[user].bag[coupon50] = 1; }); c.skills = ["VIP블랙카드", "탈세자"];
    const before = originalFiles(); failure = file;
    assert.throws(() => run(), /replace failed/); assert.deepStrictEqual(originalFiles(), before);
    assert(!replies.some(s => s.includes("구매 완료") || s.includes("할인 적용") || s.includes("세금의 70%")));
    assert(run().includes("구매 완료")); assert.strictEqual(read().member[user].bag[ticket], 1);
}
reset("펫 외형 변경하기🌟", 100); failure = files[1];
assert.throws(() => run(), /replace failed/); assert(!replies.some(s => s.includes("구매하셨습니다") || s.includes("외형 변경 완료")));
console.log("PASS 8: 세 저장 지점 롤백·쿠폰/차감/세금 복구·재시도·펫 메시지 지연");

// 9. DEV 컨텍스트에서는 운영 데이터가 바뀌지 않는다.
reset(); const prodBefore = originalFiles(); assert(run("dev/구매 1 9999").includes("구매 완료"));
assert.deepStrictEqual(originalFiles(), prodBefore); assert.strictEqual(read(0, true).member[user].bag[ticket], 9999);
console.log("PASS 9: DEV 경로 분리·운영 원본 미변경");

// 10. 티어 견적은 총 부족량을 유지하고 나눠 구매할 한도를 안내한다.
vm.runInContext(fn("buildTierQuoteStatusText") + "\n" + fn("buildTierProgressMessage"), c);
c.formatTicketTierLabel = n => n;
reset(); run("/구매"); c.skills = ["티어 상승론"];
const quantity = c.getPointShopTierTicketPurchaseQuantity({}, user, 100000);
assert(quantity + Math.floor(quantity * 0.01) >= 100000 && quantity - 1 + Math.floor((quantity - 1) * 0.01) < 100000);
const quote = c.buildPointShopPurchaseQuote(c.data, {}, user, ticket, quantity, 7000000); assert(quote.available);
output = c.buildTierProgressMessage({ user, currentTierName: "일반", targetTierName: "다음", targetTier: {}, additionalRegular: 100000, additionalLegendStone: 0, additionalPetStone: 0, tierTicketPurchaseQuantity: quantity, tierTicketPurchaseBonus: Math.floor(quantity * 0.01), quote, couponHoldings: [] }, false);
assert(output.includes("9,999개씩 나눠 구매"));
assert.strictEqual(Number(infoSource.match(/pointShop: \{ limits: \{ maxPurchaseQuantity: (\d+)/)[1]), c.GLOBAL_CONFIG.pointShop.limits.maxPurchaseQuantity);
assert(infoSource.includes('"※ 1회 최대 " + numberWithCommas(GLOBAL_CONFIG.pointShop.limits.maxPurchaseQuantity)'));
console.log("PASS 10: 티어 최소 구매 견적·나눠 구매 안내·Main/Info 한도 일치");
