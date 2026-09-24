const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("Info.js", "utf8");
const start = source.indexOf("function generateCastleRanking(");
const end = source.indexOf("// 시련의탑 생성 함수", start);
assert(start >= 0 && end > start, "ranking helpers not found");

const calls = [];
const context = {
    calculateCastleExp: (user, data, pets, home, skills, exclude, guild) => {
        calls.push(["castle", user, data, pets, home, skills, exclude, guild]);
        return user === "A" ? 100 : 200;
    },
    calculateRaidExp: (user, data, pets, home, skills, exclude, guild) => {
        calls.push(["raid", user, data, pets, home, skills, exclude, guild]);
        return user === "A" ? 300 : 150;
    },
    getRankEmoji: rank => String(rank),
    numberWithCommas: value => String(value)
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const pets = { A: { petimg: "", pettitle: "", petname: "A" }, B: { petimg: "", pettitle: "", petname: "B" } };
const data = {}, home = {}, skills = {}, guild = {};
const castle = context.generateCastleRanking(pets, data, home, skills, guild);
const raid = context.generateRaidRanking(pets, data, home, skills, guild);

assert(castle.rankingMsg1.indexOf("B ⚔ 200") < castle.rankingMsg1.indexOf("A ⚔ 100"));
assert(raid.rankingMsg1.indexOf("A 👾 300") < raid.rankingMsg1.indexOf("B 👾 150"));
assert.strictEqual(calls.length, 4);
calls.forEach(call => {
    assert.strictEqual(call[2], data);
    assert.strictEqual(call[3], pets);
    assert.strictEqual(call[4], home);
    assert.strictEqual(call[5], skills);
    assert.strictEqual(call[6], false);
    assert.strictEqual(call[7], guild);
});

console.log("PASS charm rankings use shared pet-info formulas");
