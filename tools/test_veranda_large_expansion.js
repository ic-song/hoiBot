const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name + " 함수 누락");
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name + " 함수 범위 누락");
}

const context = {
    GLOBAL_CONFIG: {
        petSkill: {
            verandaFurnitureSlotBonus: 3,
            largeVerandaSkillName: "베란다 대확장",
            largeVerandaFurnitureSlotBonus: 6,
            largeVerandaItemName: "베란다 대확장📙(/베란다오픈)"
        },
        supportPass: { premium: { furnitureSlotBonusCount: 0 } }
    },
    PET_SKILL_BAG_MAX_COUNT: 100,
    isHoiPassPremiumActive: () => false,
    initSweetHomeUser: (homeData, user) => homeData,
    ensurePlacedFurnitureUser: (placedData, user) => placedData[user],
    refreshPlacedFurnitureSummary: () => {},
    getPlacedFurnitureList: (homeData, unused, user) => homeData[user].placedFurniture
};
vm.createContext(context);
[
    "normalizePetSkillName", "initPetSkillUser", "getEquippedPetSkillNames", "hasPetSkill",
    "getPetSkillBagTotalCount", "getPetSkillBagRemainCount", "addPetSkillToBag",
    "getVerandaFurnitureSlotBonus", "getFurnitureMaxSlots", "sortFurnitureList",
    "releaseVerandaExpansionFurniture"
].forEach(name => vm.runInContext(extractFunction(name), context));

const user = "테스터";
const data = { member: { [user]: { bag: { [context.GLOBAL_CONFIG.petSkill.largeVerandaItemName]: 1 } } } };
const skills = {};
const petData = { [user]: {} };
const equipped = context.initPetSkillUser(skills, user).equipped;
const slots = () => context.getFurnitureMaxSlots(data, petData, user, 0, skills);
assert.strictEqual(slots(), 1);
equipped.push("베란다 확장");
assert.strictEqual(slots(), 4);
equipped.push("베란다 대확장");
assert.strictEqual(slots(), 10);
equipped.shift();
assert.strictEqual(slots(), 7);
assert.strictEqual(context.getVerandaFurnitureSlotBonus("베란다 대확장📙"), 6);
assert.strictEqual(context.getVerandaFurnitureSlotBonus("베란다 확장"), 3);

const home = { [user]: { furnitureBag: [], placedFurniture: [] } };
const placed = { [user]: [] };
for (let i = 0; i < 10; i++) placed[user].push({ id: String(i), name: "가구" + i, exp: 10 - i, placedAt: i });
const recovered = context.releaseVerandaExpansionFurniture(home, placed, user, 3);
assert.strictEqual(recovered.length, 3);
assert.deepStrictEqual(Array.from(recovered, item => item.exp), [1, 2, 3]);
assert.strictEqual(placed[user].length + home[user].furnitureBag.length, 10);
assert(recovered.every(item => item.placedAt === undefined));

const openStart = source.indexOf('if (msg === "/베란다오픈") {');
const openEnd = source.indexOf('if (\n                    msg === "/펫스킬오픈"', openStart);
assert(openStart >= 0 && openEnd > openStart, "/베란다오픈 명령 위치 누락");
const openBlock = source.slice(openStart, openEnd);
assert(openBlock.includes("getPetSkillBagRemainCount") && openBlock.includes("removeItem(data, sender, GLOBAL_CONFIG.petSkill.largeVerandaItemName, 1)"));
assert(openBlock.includes("saveJsonFile(data, filePath)") && openBlock.includes("saveJsonFile(petSkillData, petSkillDataPath)"));
assert(openBlock.indexOf("getPetSkillBagRemainCount") < openBlock.indexOf("removeItem(data, sender"), "가방 검사 전에 아이템 소비");
assert(source.includes('{ name: "베란다 대확장", grade: "한정판", limitedEdition: true, openable: false'));
assert(!source.includes('msg.startsWith("/베란다오픈")'));

const command = '(function () { ' + openBlock + ' })()';
const replies = [];
const saves = [];
Object.assign(context, {
    sender: user,
    msg: "/베란다오픈",
    data,
    petData: { [user]: { petname: "호호이" } },
    petSkillData: {},
    filePath: "member.json",
    petSkillDataPath: "petSkill.json",
    replier: { reply: text => replies.push(text) },
    hasItem: (target, owner, item, count) => (target.member[owner].bag[item] || 0) >= count,
    removeItem: (target, owner, item, count) => { target.member[owner].bag[item] -= count; },
    saveJsonFile: (target, location) => { saves.push(location); }
});
vm.runInContext(command, context);
assert.strictEqual(data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName], 0);
assert.strictEqual(context.petSkillData[user].petSkills.bag["베란다 대확장"], 1);
assert.deepStrictEqual(saves, ["member.json", "petSkill.json"]);

context.data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName] = 1;
context.petSkillData[user].petSkills.bag["베란다 대확장"] = 100;
saves.length = 0;
vm.runInContext(command, context);
assert.strictEqual(context.data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName], 1, "스킬가방 만석 시 아이템 보존");
assert.strictEqual(context.petSkillData[user].petSkills.bag["베란다 대확장"], 100);
assert.strictEqual(saves.length, 0);

context.petSkillData[user].petSkills.bag["베란다 대확장"] = 0;
context.data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName] = 0;
vm.runInContext(command, context);
assert.strictEqual(context.petSkillData[user].petSkills.bag["베란다 대확장"], 0, "아이템 부재 시 스킬 미지급");
assert.strictEqual(saves.length, 0);

context.msg = "/베란다오픈 해봐";
context.data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName] = 1;
vm.runInContext(command, context);
assert.strictEqual(context.data.member[user].bag[context.GLOBAL_CONFIG.petSkill.largeVerandaItemName], 1, "접미 텍스트 입력 시 명령 무시");
assert.strictEqual(saves.length, 0);

console.log("베란다 대확장 모의 검증 통과");
