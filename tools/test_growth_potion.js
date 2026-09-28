const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
    const start = main.indexOf("function " + name + "(");
    assert(start >= 0, "missing function: " + name);
    const opening = main.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < main.length; i++) {
        if (main[i] === "{") depth++;
        if (main[i] === "}" && --depth === 0) return main.slice(start, i + 1);
    }
    throw new Error("unclosed function: " + name);
}

const configStart = main.indexOf("    growthPotion: {");
const configEnd = main.indexOf("    display: {", configStart);
assert(configStart >= 0 && configEnd > configStart);
const growthPotion = vm.runInNewContext("({" + main.slice(configStart, configEnd) + "})").growthPotion;
const context = {
    GLOBAL_CONFIG: {
        growthPotion,
        level: { expBase: 1000, expPerLevel: 1000, bonusPoint: 10000000 }
    },
    roundToTwo: value => Math.round(value * 100) / 100,
    getAdventureLevelTitle: level => "Lv." + level,
    numberWithCommas: value => Number(value).toLocaleString("en-US"),
    checkRank: () => "채크랭크",
    isExactJsonSnapshot: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    buildAdventureLevelUpMessage: (_data, _pet, _guild, _user, ups) => "레벨업 " + ups.length + "회",
    petData: {},
    guildData: {},
    sender: "테스터",
    filePath: "synthetic-member.json"
};
vm.createContext(context);
for (const name of ["getGrowthPotionConfig", "prepareGrowthPotionUse", "getLevelRequiredExperience", "processAdventureLevelUps"]) {
    vm.runInContext(extractFunction(name), context);
}

const commandStart = main.indexOf("var growthPotionCommand = msg.match(");
const commandEnd = main.indexOf('if (msg === "/호여"', commandStart);
assert(commandStart >= 0 && commandEnd > commandStart);
vm.runInContext("function runGrowthPotionCommand() { " + main.slice(commandStart, commandEnd) + " }", context);

function run(message, member) {
    let saveCount = 0;
    let reply = "";
    context.data = { member: { "테스터": JSON.parse(JSON.stringify(member)) } };
    context.msg = message;
    context.replier = { reply: text => { reply = text; } };
    context.saveJsonFile = (_data, file) => {
        assert.strictEqual(file, "synthetic-member.json");
        saveCount++;
    };
    context.loadJsonFile = () => JSON.parse(JSON.stringify(context.data));
    const before = JSON.stringify(context.data);
    context.runGrowthPotionCommand();
    return { reply, saveCount, member: context.data.member["테스터"], before, after: JSON.stringify(context.data) };
}

const small = growthPotion.small.itemName;
const medium = growthPotion.medium.itemName;
const large = growthPotion.large.itemName;
const baseMember = { lv: 1, exp: 0, point: 0, boostercnt: 7, bag: { [small]: 5, [medium]: 5, [large]: 2 } };

// 1. 소형 1개로 1레벨 상승하고 기본 포인트를 받는다.
let result = run("/성장오픈소 1", baseMember);
assert.strictEqual(result.saveCount, 1);
assert.strictEqual(result.member.lv, 2);
assert.strictEqual(result.member.exp, 0);
assert.strictEqual(result.member.point, 10000000);
assert.strictEqual(result.member.bag[small], 4);
assert.strictEqual(result.member.boostercnt, 7);
assert(result.reply.startsWith("[채크랭크]님\n"));
assert(result.reply.includes(small));
result = run("/성장오픈소 1", { ...baseMember, lv: 9, exp: 8000 });
assert.strictEqual(result.member.lv, 10);
assert.strictEqual(result.member.exp, 0);

// 2. 중형 여러 개 사용 시 다중 레벨업과 잔여 EXP를 반영한다.
result = run("/성장오픈중 3", baseMember);
assert.strictEqual(result.saveCount, 1);
assert.strictEqual(result.member.lv, 8);
assert.strictEqual(result.member.exp, 2000);
assert.strictEqual(result.member.point, 70000000);
assert.strictEqual(result.member.bag[medium], 2);
assert(result.reply.includes("+30,000 EXP"));
assert(result.reply.includes("남은 수량: 2개"));
assert(result.reply.includes("레벨업 7회"));

// 3. 대형 사용으로 Lv.100 대승급을 통과하며 가호는 유지한다.
result = run("/성장오픈대 1", { ...baseMember, lv: 99, exp: 0 });
assert.strictEqual(result.member.lv, 100);
assert.strictEqual(result.member.exp, 1000);
assert.strictEqual(result.member.point, 10000000);
assert.strictEqual(result.member.boostercnt, 7);
assert.strictEqual(result.member.bag[large], 1);
assert(result.reply.includes(large));

// 4. 잘못된 입력은 안내만 출력하고 저장하지 않는다.
for (const message of ["/성장오픈중", "/성장오픈중 가", "/성장오픈중 0", "/성장오픈중 -1", "/성장오픈중 1.5", "/성장오픈중 1 해봐"]) {
    result = run(message, baseMember);
    assert.strictEqual(result.saveCount, 0, message);
    assert.strictEqual(result.after, result.before, message);
    assert(result.reply.startsWith("[채크랭크]님\n"), message);
    assert(result.reply.includes(medium), message);
}

// 5. 미보유·수량 부족·계산 범위 초과 시 일부 사용이 발생하지 않는다.
for (const [message, member, expected] of [
    ["/성장오픈중 1", { ...baseMember, bag: {} }, "사용할 성장물약이 없습니다"],
    ["/성장오픈중 6", baseMember, "수량이 부족합니다"],
    ["/성장오픈대 2", { ...baseMember, exp: 9007199254740990 }, "처리 가능한 범위를 넘었습니다"]
]) {
    result = run(message, member);
    assert.strictEqual(result.saveCount, 0, message);
    assert.strictEqual(result.after, result.before, message);
    assert(result.reply.startsWith("[채크랭크]님\n"), message);
    assert(result.reply.includes(expected), message);
}

console.log("growth potion: 5 scenario groups passed");
