const assert = require("assert");
const { c, fixture, giver, receiver, room, carrot, material, prepare, request, run, pending, snapshot, setMember } = require("./test_carrot_confirmation.js");
const types = ["bag", "miniPet", "furniture", "skill"];
for (const where of ["호이서버1[30]", "서버관리자", "팻 테스트방", "호이월드 커뮤니티", room + " 사칭", room]) {
    for (const group of [true, false]) {
        if (where === room && group) continue;
        for (const type of types) {
            prepare(); const before = snapshot(), text = run(request(type), giver, where, false, group);
            assert.deepStrictEqual(snapshot(), before); assert(!pending());
            assert(text.startsWith("[" + giver + "] 님\n")); assert(text.includes(c.GLOBAL_CONFIG.carrotTrade.communityLink));
        }
    }
}
console.log("PASS 1: 네 거래의 실제 커뮤니티 단체방 제한·일대일/다른방 무소모");
for (const type of types) {
    prepare(); const before = snapshot(); run(request(type)); assert.deepStrictEqual(snapshot(), before); assert(pending());
    assert(run("거래한다").includes("완료!"));
    assert.strictEqual(fixture.read().member[giver].bag[carrot], 5000 - { bag: 2, miniPet: 100, furniture: 100, skill: 600 }[type]);
}
console.log("PASS 2: 네 거래의 확인 전 무차감·확정 후 기존 개당 비용과 이전 유지");
for (const type of types) for (const user of [giver, receiver]) {
    prepare(); setMember(d => { d.member[user].rank.tier = "새싹"; }); const before = snapshot();
    assert(run(request(type)).includes("킹 이상")); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
}
console.log("PASS 3: 보내는/받는 계정 티어 제한과 실패 무차감");
for (const type of types) {
    prepare(); const command = request(type).replace(/\d+(?: \d+)?$/, type === "bag" || type === "skill" ? "999 1" : "999"), before = snapshot();
    run(command); assert(!pending()); assert.deepStrictEqual(snapshot(), before);
}
console.log("PASS 4: 존재하지 않는 가방 번호는 확인 대기/이전 없음");
prepare(); assert.strictEqual(c.isCarrotTradeCommand(request("pendant")), false);
const before = snapshot(); assert(run(request("pendant"), giver, "기존 펜던트 허용방").includes("확인!")); assert.deepStrictEqual(snapshot(), before);
assert(run("거래한다", giver, "기존 펜던트 허용방").includes("완료!"));
console.log("PASS 5: 펜던트 기존 장소 규칙과 300개 비용을 다른 네 거래로 확대하지 않음");
