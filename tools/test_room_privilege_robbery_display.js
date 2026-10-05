const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 실제 설정과 함수를 읽어 역할·방 권한을 확인한다.
function block(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, marker);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(marker);
}
for (const [source, label] of [[main, "Main"], [info, "Info"]]) {
    const c = { room90: "호이월드 GM 관리자방", room91: "통합스텝", room92: "서버관리자",
        testRoom: "팻 테스트방", room8: "명령어방", room: "", Admins: ["admin"], Master: ["master"] };
    c.getCurrentContext = () => ({ permissionRoom: c.room });
    vm.createContext(c);
    vm.runInContext(block(source, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", c);
    for (const name of ["isAdmin", "isMaster"]) vm.runInContext(block(source, "function " + name + "("), c);
    if (source === main) for (const name of ["isServerAdminRoomOperator", "isGuildTerritoryStartOperator", "isPetMusouStartOperator"]) {
        vm.runInContext(block(source, "function " + name + "("), c);
    }
    for (const room of ["서버관리자", "원탁의 호월", "호이월드 GM 관리자방"]) {
        c.room = room;
        assert.strictEqual(c.isAdmin("admin"), true);
        assert.strictEqual(c.isMaster("master"), true);
        assert.strictEqual(c.isAdmin("master"), false);
        assert.strictEqual(c.isMaster("admin"), false);
        assert.strictEqual(c.isAdmin("regular"), false);
        assert.strictEqual(c.isMaster("regular"), false);
        if (source === main) for (const role of ["admin", "master", "regular"]) {
            const expected = role !== "regular";
            assert.strictEqual(c.isServerAdminRoomOperator(role), expected);
            assert.strictEqual(c.isGuildTerritoryStartOperator(role), expected);
            assert.strictEqual(c.isPetMusouStartOperator(role), expected);
        }
    }
    for (const room of ["일반방", "원탁의 호월 안내", "호이월드 GM 관리자방2"]) {
        c.room = room;
        assert.strictEqual(c.isAdmin("admin"), false);
        assert.strictEqual(c.isMaster("master"), false);
        if (source === main) assert.strictEqual(c.isServerAdminRoomOperator("admin"), false);
    }
    c.room = "통합스텝";
    assert.strictEqual(c.isAdmin("admin"), true);
    assert.strictEqual(c.isMaster("master"), false);
    c.room = "팻 테스트방";
    assert.strictEqual(c.isAdmin("admin"), true);
    assert.strictEqual(c.isMaster("master"), true);
    console.log(label + " 역할·추가 운영방·기존방·일반 유저 차단 PASS");
}

// 빈 기록과 최대 건수에서도 닉네임 다음부터 한 번만 접는다.
const c = { allsee: "<ALLSEE>", checkRank: (_d, _p, _g, user) => user,
    numberWithCommas: n => Number(n).toLocaleString("en-US") };
vm.createContext(c);
vm.runInContext(block(main, "function buildMiniPetRobberyHistoryMessage("), c);
for (const count of [0, 1, 55]) {
    const p = { user: { miniPetRobberyHistory: Array.from({ length: count }, (_, i) => ({ target: "target" + i, amount: 10000000, at: "09/30 22:00" })) } };
    const before = JSON.stringify(p);
    const output = c.buildMiniPetRobberyHistoryMessage("user", {}, p, {});
    assert(output.startsWith("약탈자📙 [S]\n[user]님의 약탈 기록\n<ALLSEE>\n━━━━━━━━━━━━━"));
    assert.strictEqual(output.split("<ALLSEE>").length, 2);
    assert(output.includes("최근 약탈 기록: " + Math.min(count, 50) + "건"));
    if (!count) assert(output.includes("아직 약탈에 성공한 기록이 없습니다."));
    else assert(output.includes("1. [target" + (count - 1) + "]"));
    assert.strictEqual(JSON.stringify(p), before);
}
console.log("약탈 기록 0·1·55건: 접기 위치·50건·최신순·무변경 PASS");
