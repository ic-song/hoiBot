const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, "함수 없음: " + name);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("함수 닫힘 없음: " + name);
}

const randomValues = [];
const fakeMath = { floor: Math.floor, random: () => {
    assert(randomValues.length > 0, "예상 밖의 재추첨");
    return randomValues.shift();
} };
const context = {
    Math: fakeMath,
    applyStarterPet: pet => { pet.upgrade = 90; return pet; },
    getPendantGradeInfo: () => ({ name: "최하급" }),
    createPendantByGradeInfo: grade => ({ name: grade.name })
};
vm.createContext(context);
const typesStart = source.indexOf("const petTypes2 = [");
const typesEnd = source.indexOf("const itemInfoData =", typesStart);
assert(typesStart >= 0 && typesEnd > typesStart);
vm.runInContext(source.slice(typesStart, typesEnd), context);
for (const name of ["getRandomEmojiFromType", "assignAdventureStarterPetAppearance", "applyAdventureStarterPetSettings"]) {
    vm.runInContext(extractFunction(name), context);
}

randomValues.push(0, 0.5, 0);
const skyPet = { petname: "하늘이", pettype: "알", petimg: "🪺" };
assert.strictEqual(context.assignAdventureStarterPetAppearance(skyPet), true);
assert.strictEqual(skyPet.pettype, "하늘");
assert.strictEqual(skyPet.petimg, "🦃");
assert.strictEqual(randomValues.length, 0);

randomValues.push(0.99, 0.01, 0);
const landPet = { petname: "땅이", pettype: "알", petimg: "🪺" };
assert.strictEqual(context.assignAdventureStarterPetAppearance(landPet), true);
assert.strictEqual(landPet.pettype, "땅");
assert.strictEqual(landPet.petimg, "🧟‍♂️");
assert.strictEqual(randomValues.length, 0);

const savedLand = JSON.stringify(landPet);
assert.strictEqual(context.assignAdventureStarterPetAppearance(landPet), false);
assert.strictEqual(JSON.stringify(landPet), savedLand, "재조회 시 외형 재추첨 금지");

randomValues.push(0.4, 0.5, 0);
const starterData = { member: { petname: "새 친구", pettype: "알", petimg: "🪺" } };
assert.strictEqual(context.applyAdventureStarterPetSettings(starterData, "member"), true);
assert.strictEqual(starterData.member.petname, "새 친구");
assert.strictEqual(starterData.member.pettype, "하늘");
assert.strictEqual(starterData.member.starterBlessingApplied, true);
assert.strictEqual(context.applyAdventureStarterPetSettings(starterData, "member"), false);
assert.strictEqual(randomValues.length, 0, "중복 적용 시 재추첨 금지");

const repairStart = source.indexOf("petData && petData[sender] && petData[sender].starterBlessingApplied === true");
const repairSave = source.indexOf("saveJsonFile(petData, memberPetPath)", repairStart);
assert(repairStart >= 0 && repairSave > repairStart, "완료 후 알 상태의 1회 보정·저장 연결");
console.log("신규 펫 땅·하늘 외형 확정과 기존 알 상태 1회 보정 PASS");
