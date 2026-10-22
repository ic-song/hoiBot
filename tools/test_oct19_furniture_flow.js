const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const base = fs.readFileSync(path.join(__dirname, "test_member_display_search_auth.js"), "utf8");
const { c, fixture, block } = new Function("require", "__dirname", base.slice(0, base.indexOf('\npass("')) + "\nreturn {c,fixture,block};")(require, __dirname);
const root = "/sdcard/호이랜드/", user = "synthetic";
c.petHomePlacedFurniturePath = root + "petHomePlacedFurniture.json";
c.hasPetSkill = (skills, name, skill) => !!(skills[name] && skills[name].indexOf(skill) >= 0);
c.isHoiPassPremiumActive = (data, name) => !!data.member[name].premium;
c.checkRank = (_d, _p, _g, name) => name; c.getHoiPassPremiumHeader = () => "";
c.getFurnitureBagLimit = () => 100; c.recordAdventureQuestAction = () => false;
for (const name of ["buildPetHomeFurnitureBagMessage", "formatPetHomeFurniture", "getFurnitureMaxSlots", "initSweetHomeUser", "sortFurnitureList", "getPlacedFurnitureList", "requirePlacedFurnitureDataMap", "ensurePlacedFurnitureUser", "canCreatePlacedFurnitureData", "refreshPlacedFurnitureSummary", "normalizePlacedFurnitureSummary", "buildPlacedFurnitureSummary", "getFurnitureExp", "getHomeTotalExp"])
    vm.runInContext(block(main, "function " + name + "("), c);
vm.runInContext("function furnitureBranch(){" + block(main, 'if (msg === "/가구장착" ||') + block(main, 'if (msg == "/가구가방")') + "}", c);
const clone = value => JSON.parse(JSON.stringify(value));
function prepare(floor, placedCount, split = false, premium = false) {
    fixture.reset(); const d = fixture.read(); d.member[user] = { point: 1, bag: {}, premium }; fixture.write(d);
    const items = Array.from({ length: placedCount }, (_, i) => ({ id: "P" + i, name: "기존가구" + i, grade: "일반", exp: 100 }));
    const home = { floor, houseName: "합성주택", exp: 1000, furnitureBag: [{ id: "B1", name: "추가가구", exp: 200 }, { id: "B2", name: "추가가구2", exp: 150 }], placedFurnitureSummary: clone(c.buildPlacedFurnitureSummary(items)) };
    if (split) fixture.put(c.petHomePlacedFurniturePath, { [user]: items }); else home.placedFurniture = items;
    fixture.put(root + "home.json", { [user]: home }); fixture.put(root + "member_pet.json", { [user]: {} }); fixture.put(root + "skills.json", { [user]: [] });
}
function run(command) {
    fixture.clear(); const ctx = c.createCommandContext(false, "test"), previous = c.enterCommandContext(ctx);
    c.beginDataSaveTransaction(); c.ctx = ctx; c.msg = command; c.sender = user;
    try { c.data = c.loadJsonFile(c.filePath); c.petData = c.loadJsonFile(c.memberPetPath); c.petSkillData = c.loadJsonFile(c.petSkillDataPath); c.guildData = {}; c.furnitureBranch(); }
    catch (error) { c.rollbackDataSaveTransaction(); throw error; }
    finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return fixture.replies().join("\n");
}
let groups = 0;
for (const split of [false, true]) {
    for (const [floor, limit] of [[100, 21], [104, 21], [105, 22], [109, 22], [110, 23], [115, 24], [200, 41]]) {
        prepare(floor, limit - 1, split); const beforeItems = fixture.get(root + "home.json")[user].furnitureBag.length;
        assert(run("/가구장착 1").includes("현재 배치: " + limit + "/" + limit));
        const home = fixture.get(root + "home.json")[user]; assert.strictEqual(home.furnitureBag.length, beforeItems - 1); assert.strictEqual(home.placedFurnitureSummary.count, limit);
        const snapshot = fixture.raw(root + "home.json"), placedSnapshot = fixture.raw(c.petHomePlacedFurniturePath);
        assert(run("/가구장착 1").includes("초과")); assert.strictEqual(fixture.raw(root + "home.json"), snapshot); assert.strictEqual(fixture.raw(c.petHomePlacedFurniturePath), placedSnapshot);
        assert(run("/가구가방").includes("가구 가방🛌 [" + (beforeItems - 1) + "/100]"));
    }
    console.log("PASS FURNITURE " + (++groups) + ": " + (split ? "분리 상세" : "기존 목록") + " 평수 경계의 실제 장착·한도 차단·가방 표시 일치");
}
prepare(105, 10);
for (const command of ["/가구장착", "/가구장착 0", "/가구장착 999", "/가구장착 1 해봐", "/가구장착 -1", "/가구장착 1.5"]) {
    const before = fixture.raw(root + "home.json"); run(command); assert.strictEqual(fixture.raw(root + "home.json"), before);
}
console.log("PASS FURNITURE " + (++groups) + ": 번호·인수·안내 접미 오류 무변경");
prepare(105, 21); const data = fixture.read(); data.member[user].premium = true; fixture.write(data);
const skills = ["건물주", "베란다 확장", c.GLOBAL_CONFIG.petSkill.largeVerandaSkillName]; fixture.put(root + "skills.json", { [user]: skills });
const expected = 22 + 10 + c.GLOBAL_CONFIG.petSkill.verandaFurnitureSlotBonus + c.GLOBAL_CONFIG.petSkill.largeVerandaFurnitureSlotBonus + c.GLOBAL_CONFIG.supportPass.premium.furnitureSlotBonusCount;
assert(run("/가구장착 1").includes("현재 배치: 22/" + expected)); assert(run("/가구가방").includes("가구 가방🛌 [1/100]"));
console.log("PASS FURNITURE " + (++groups) + ": 기존 장착·스킬·프리미엄 유지 및 실제 화면 일치");
