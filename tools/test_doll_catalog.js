const assert = require("assert");
const fs = require("fs");
const path = require("path");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "dollCatalog.json"), "utf8"));
const expectedCounts = [300, 220, 170, 120, 80, 50, 30, 20, 10];
const charms = [2500, 5000, 15000, 30000, 125000, 250000, 650000, 1250000, 2500000];
const counts = expectedCounts.map(() => 0);
const ids = new Set();
assert.strictEqual(catalog.schemaVersion, 1);
assert.strictEqual(catalog.dolls.length, 1000);
for (let i = 0; i < catalog.dolls.length; i++) {
    const doll = catalog.dolls[i];
    assert.strictEqual(doll.id, "D" + String(i + 1).padStart(4, "0"));
    assert(!ids.has(doll.id)); ids.add(doll.id);
    assert(Number.isInteger(doll.grade) && doll.grade >= 0 && doll.grade < 9);
    counts[doll.grade]++;
    assert(typeof doll.name === "string" && doll.name.trim() && !doll.name.includes("�"));
    for (const key of ["minTenths", "maxTenths", "largeTenths", "giantTenths"]) assert(Number.isSafeInteger(doll[key]) && doll[key] > 0, doll.id + " " + key);
    assert(doll.minTenths < doll.largeTenths && doll.largeTenths < doll.giantTenths && doll.giantTenths <= doll.maxTenths, doll.id);
    assert.strictEqual(doll.largeTenths, Math.ceil((20 * doll.minTenths + 80 * doll.maxTenths) / 100), doll.id);
    assert.strictEqual(doll.giantTenths, Math.ceil((5 * doll.minTenths + 95 * doll.maxTenths) / 100), doll.id);
}
assert.deepStrictEqual(counts, expectedCounts);
assert.strictEqual(counts.reduce((sum, count, grade) => sum + count * charms[grade], 0), 100000000);
assert.deepStrictEqual(catalog.dolls[0], {id:"D0001",name:"갈색 곰🧸",grade:0,minTenths:150,maxTenths:1000,largeTenths:830,giantTenths:958});
console.log("인형 1,000종 ID·9등급 종수·0.1cm 경계·최초 종매 1억 검증 통과");
