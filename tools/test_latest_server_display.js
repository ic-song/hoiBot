const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 실제 명령 분기와 함수를 소스에서 읽어 합성 데이터로 실행한다.
function block(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, marker);
    const opening = source.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed: " + marker);
}

// 각 런타임의 현재 설정을 그대로 사용한다.
function context(source, names, extra) {
    const c = Object.assign({ allsee: "<ALLSEE>", numberWithCommas: n => Number(n).toLocaleString("en-US"),
        checkRank: (_d, _p, _g, u) => u, getHoiPassPremiumHeader: () => "" }, extra);
    vm.createContext(c);
    vm.runInContext(block(source, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", c);
    for (const name of names) vm.runInContext(block(source, "function " + name + "("), c);
    return c;
}

let saves = 0;
let failSave = false;
const messages = [];
const move = context(main, ["normalizeHoiServerLabel"], {
    sender: "test", msg: "", filePath: "dev-member.json", petData: {}, guildData: {},
    data: { member: { test: { server: "호이서버6[2030]", bag: {} } } },
    replier: { reply: m => messages.push(m) },
    removeItem: (d, u, item, count) => { d.member[u].bag[item] -= count; },
    addItem: (d, u, item, count) => { d.member[u].bag[item] = (d.member[u].bag[item] || 0) + count; },
    saveJsonFile: (_data, file) => { assert.strictEqual(file, "dev-member.json"); if (failSave) throw Error("save failed"); saves++; }
});
const item = move.GLOBAL_CONFIG.serverTransfer.itemName;
move.data.member.test.bag[item] = 2;
vm.runInContext("function runMove(){" + block(main, 'if (msg === "/서버변경" ||') + "}", move);
for (const command of ["/서버변경", "/서버변경 호이월드", "/서버변경 호이월드 커뮤니티 해봐", "/서버변경 호이서버6"]) {
    move.msg = command; move.runMove();
    assert.strictEqual(move.data.member.test.bag[item], 2);
}
assert.strictEqual(saves, 0, "기존 서버6 별칭도 같은 서버로 판단");
assert(messages[0].includes("호이서버7 · 호이월드 커뮤니티"));
move.msg = "/서버변경 호이월드 커뮤니티"; move.runMove();
assert.strictEqual(move.data.member.test.server, "호이월드 커뮤니티");
assert.strictEqual(move.data.member.test.bag[item], 1);
move.runMove(); assert.strictEqual(move.data.member.test.bag[item], 1);
move.msg = "/서버변경 호이서버6"; failSave = true; move.runMove();
assert.strictEqual(move.data.member.test.server, "호이월드 커뮤니티");
assert.strictEqual(move.data.member.test.bag[item], 1);
failSave = false; move.runMove();
assert.strictEqual(move.data.member.test.server, "호이서버6[30]");
assert.strictEqual(move.data.member.test.bag[item], 0);
move.msg = "/서버변경 호이월드 커뮤니티"; move.runMove();
assert.strictEqual(move.data.member.test.server, "호이서버6[30]");
console.log("1/5 커뮤니티 이동·공백·별칭·중복·실패 복구 PASS");

const admin = context(main, ["normalizeHoiServerLabel"], {
    msg: "/서버이동 대상 호이월드 커뮤니티", sender: "admin", isAdmin: u => u === "admin",
    roomToServer: { r6: "호이서버6[30]", r1: "호이서버1[30]" },
    data: { member: { 대상: { server: "이전" } } }, replier: { reply: m => messages.push(m) }
});
vm.runInContext("function runAdmin(){" + block(main, "if (/^\\/서버이동\\s+") + "}", admin);
admin.runAdmin(); assert.strictEqual(admin.data.member.대상.server, "호이월드 커뮤니티");
admin.msg = "/서버이동 대상 호이서버6[30]"; admin.runAdmin();
assert.strictEqual(admin.data.member.대상.server, "호이서버6[30]");
admin.sender = "ordinary"; admin.msg = "/서버이동 대상 호이서버1[30]"; admin.runAdmin();
assert.strictEqual(admin.data.member.대상.server, "호이서버6[30]");
admin.sender = "admin"; admin.msg = "/서버이동 대상 호이서버1[30] 해봐"; admin.runAdmin();
assert.strictEqual(admin.data.member.대상.server, "호이서버6[30]");
assert(main.includes('roomToServer[room10] = "호이서버6[30]"'));
console.log("2/5 관리자 이동·서버6·권한·후행 안내문 차단 PASS");

const rank = context(info, ["generateRanking", "normalizeInfoServerLabel", "normalizeRankServerName", "buildServerRankingRows", "formatOverallRankPosition", "formatOverallUserRow", "formatOverallServerRow", "buildWorldOverallRankingMessage", "buildCombinedServerRankingMessage", "buildStandaloneServerRankingMessage", "getServerMemberGroups", "buildServerMemberListMessage"], {
    calculateCastleExp: (u, d) => d.member[u].score || 0, calculateRaidExp: () => 0, calculatePetUpgradeCharm: () => 0,
    getRankEmoji: () => ""
});
const data = { member: { legacy: { server: "호이서버6[2030]", score: 25 }, current: { server: "호이서버6[30]", score: 75 }, unknown: {} } };
const pets = { legacy: {}, current: {} };
for (let i = 1; i <= 12; i++) { data.member["u" + i] = { server: "호이월드 커뮤니티", score: i * 100 }; pets["u" + i] = {}; }
const before = JSON.stringify(data);
const rows = rank.generateRanking(data, pets, {}, {}, {}).rows;
assert.strictEqual(rows.length, 15);
const servers = rank.buildServerRankingRows(rows, data);
assert.strictEqual(servers.length, 10);
assert.strictEqual(servers[0].name, "호이월드 커뮤니티");
assert.strictEqual(servers[0].totalExp, 7800, "TOP10 밖의 회원까지 합산");
const six = servers.find(s => s.name === "호이서버6[30]");
assert.strictEqual(six.totalExp, 100); assert.strictEqual(six.users.length, 2);
const combined = rank.buildCombinedServerRankingMessage(servers, "u1", data, pets, {});
assert(combined.includes("전체 10개 서버 /서버순위"));
assert(combined.includes("소속 서버: 호이월드 커뮤니티"));
assert(combined.includes("서버 내 순위: 12위"));
assert(!combined.includes("u2 ·"), "서버 개인 목록은 상위10명");
const standalone = rank.buildStandaloneServerRankingMessage(servers, "u1", data);
assert(standalone.includes("전체 10개 서버"));
assert.strictEqual((standalone.match(/└ 👑 /g) || []).length, 10);
assert.strictEqual((standalone.match(/<ALLSEE>/g) || []).length, 1);
assert(standalone.indexOf("<ALLSEE>") > standalone.indexOf("🥉"));
const groups = rank.getServerMemberGroups(data.member);
assert.strictEqual(groups.usersByServer["호이서버6[30]"].length, 2);
assert.strictEqual(rank.buildServerMemberListMessage("호이서버6[2030]", groups), rank.buildServerMemberListMessage("호이서버6[30]", groups));
assert(rank.buildServerMemberListMessage("호이월드 커뮤니티", groups).includes("12. "));
assert.strictEqual(JSON.stringify(data), before);
console.log("3/5 10개 서버·전체 합산·TOP10·인원 조회·별칭·무변경 PASS");

const shopMessages = [];
const shop = context(info, [], {
    msg: "/상점", data: { shop: { [item]: 100000000000 } },
    numberWithCommas: n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    replier: { reply: m => shopMessages.push(m) }
});
vm.runInContext(block(info, 'if (msg === "/상점")'), shop);
assert(shopMessages[0].includes("호이서버1~7 및 호이월드 커뮤니티로 변경할 수 있습니다."));
assert(shopMessages[0].includes(item), "기존 아이템 이름 유지");
assert(shopMessages[0].includes("🅟100,000,000,000"));

for (const source of [main, info]) {
    const c = context(source, ["getTierEmojiForMember", "getCheckRankTierEmoji", "getVisibleRankEmoji", "getMemberRankEmojiForDisplay", "checkRank"], {
        ticketTierData: { 킹: { emoji: "👑" }, 벛꽃: { emoji: "🌸" } },
        getMyGuildInfo: () => ({ guild: { rank: 1 } }), getGuildMasterRankEmoji: () => "길드"
    });
    const d = { star: "test", member: { test: { rank: { tier: "킹", emoji: "옛표기" }, displaySettings: { hideRankEmoji: true, hideAdminTitle: true } } } };
    const snapshot = JSON.stringify(d);
    assert.strictEqual(c.checkRank(d, {}, {}, "test"), "👑test_길드");
    assert.strictEqual(c.getMemberRankEmojiForDisplay(d.member.test), "👑");
    assert.strictEqual(JSON.stringify(d), snapshot);
    d.member.test.displaySettings.hideRankEmoji = false;
    assert.strictEqual(c.checkRank(d, {}, {}, "test"), "💞test_길드");
    assert.strictEqual(c.getMemberRankEmojiForDisplay(d.member.test), "옛표기");
    d.member.test.rank.tier = "벚꽃";
    assert.strictEqual(c.getCheckRankTierEmoji(d, "test"), "🌸");
    assert.strictEqual(c.getTierEmojiForMember({}), "");
}
console.log("4/5 Main·Info 티어 대체·복원·길드 표시·벚꽃 호환 PASS");

const bag = context(main, ["buildMiniPetBagRenewedMessage"], {
    refreshMiniPetSortIndex: (p, u) => p[u].miniPetBag.forEach((pet, i) => { pet.sortIndex = i + 1; }),
    getMiniPetCollectionData: () => null, getMiniPetCollectionRanking: () => [],
    getMiniPetBagLimit: () => 15, getMiniPetUpgradeDisplay: () => "+1"
});
for (const count of [0, 5, 6]) {
    const p = { test: { miniPetBag: Array.from({ length: count }, () => ({ name: "펫", emoji: "🐹", grade: "일반", battleExp: 100 })) } };
    const output = bag.buildMiniPetBagRenewedMessage("test", { member: {} }, p, {}, {}, { gradeTable: [] });
    assert(output.includes("※ 대표장착: /미니펫장착 [미니펫가방번호]"));
    assert(output.includes("※ 보조장착: /미니펫보조장착 [미니펫가방번호]"));
    assert(output.indexOf("※ 대표장착") < output.indexOf("※ 구간 판매"));
    assert.strictEqual((output.match(/<ALLSEE>/g) || []).length, count > 5 ? 1 : 0);
    if (count === 6) assert(output.indexOf("5. 펫") < output.indexOf("<ALLSEE>") && output.indexOf("<ALLSEE>") < output.indexOf("6. 펫"));
}
console.log("5/5 가방 장착 안내·빈 가방·5/6마리 전체보기 PASS");
