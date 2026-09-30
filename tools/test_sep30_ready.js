const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, "missing function: " + name);
    const opening = source.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed function: " + name);
}

function extractIfBlock(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, "missing command: " + marker);
    const opening = source.indexOf("{", start);
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unclosed command: " + marker);
}

function context(source, names, extras) {
    const sandbox = Object.assign({
        allsee: "<ALLSEE>",
        numberWithCommas: value => Number(value).toLocaleString("en-US"),
        checkRank: (_data, _pet, _guild, user) => user,
        getHoiPassPremiumHeader: () => "",
        getMiniPetBattleRank: () => "1등",
        getMiniPetBagLimit: () => 10,
        getMiniPetCollectionData: () => ({ completedStage: 2, registeredCount: 6, maxCount: 8 }),
        getMiniPetCollectionRanking: () => [{ userName: "나" }],
        refreshMiniPetSortIndex: (pets, user) => pets[user].miniPetBag.forEach((pet, i) => { pet.sortIndex = i + 1; }),
        getMiniPetUpgradeDisplay: pet => "+" + pet.upgrade,
        GLOBAL_CONFIG: {
            daily: { miniPetBattleMax: 15, miniPetBattleFree: 1 },
            serverRanking: { labels: ["호이서버1[30]", "호이서버2[2030]", "호이서버3[3040]", "호이서버4[3040]", "호이서버5[2030]", "호이서버6[30]", "호이서버7[2030]", "벨라서버1[2030]", "벨라서버2[30]", "호이월드 커뮤니티"] }
        }
    }, extras || {});
    vm.createContext(sandbox);
    for (const name of names) vm.runInContext(extractFunction(source, name), sandbox);
    return sandbox;
}

const mini = context(main, ["normalizeHoiServerLabel", "getMiniPetModeCharm", "getTotalMinipetExp", "getMiniPetDisplayTitle", "buildMiniPetInfoRenewedMessage", "buildMiniPetBagRenewedMessage", "buildMiniPetRobberyHistoryMessage"]);
const petData = {
    "나": {
        miniPet: { name: "대표", emoji: "🐹", grade: "신화", battleExp: 375250, upgrade: 10 },
        miniPetSupport: { name: "보조", emoji: "📝", grade: "일반", battleExp: 1622350 },
        miniPetBag: Array.from({ length: 6 }, (_, i) => ({ name: "가방" + i, emoji: "🐹", grade: "일반", battleExp: 100 - i })),
        miniPetBattle: { win: 3, lose: 1, count: 0 },
        miniPetRobberyHistory: [{ id: "1", target: "상대", amount: 10000000, at: "09/30 12:00" }]
    },
    "홀수": { miniPetSupport: { battleExp: 5 } }
};
const members = { member: { "나": { server: "호이서버1-2[30]" } } };
assert.strictEqual(mini.getMiniPetModeCharm("나", petData), 1186425);
assert.strictEqual(mini.getTotalMinipetExp("나", petData), 2372850);
assert.strictEqual(mini.getMiniPetModeCharm("홀수", petData), 2);
assert.strictEqual(mini.normalizeHoiServerLabel("호이서버1-2[30]"), "호이서버1[30]");
assert.strictEqual(mini.normalizeHoiServerLabel("호이서버6[2030]"), "호이서버6[30]");
const miniInfo = mini.buildMiniPetInfoRenewedMessage("나", members, petData, {}, {}, true);
assert(miniInfo.includes("💞 종합매력 반영: +2,372,850"));
assert(miniInfo.includes("└ 매력 811,175💞"));
assert(miniInfo.indexOf("※ 미니펫가방: /미니펫가방") < miniInfo.indexOf("<ALLSEE>"));
const miniBag = mini.buildMiniPetBagRenewedMessage("나", members, petData, {}, {}, { gradeTable: [] });
assert(miniBag.indexOf("5. 가방4") < miniBag.indexOf("<ALLSEE>"));
assert(miniBag.indexOf("<ALLSEE>") < miniBag.indexOf("6. 가방5"));
assert.strictEqual((miniBag.match(/<ALLSEE>/g) || []).length, 1);
const robbery = mini.buildMiniPetRobberyHistoryMessage("나", members, petData, {});
assert(robbery.includes("최근 약탈 기록: 1건"));
assert(robbery.indexOf("<ALLSEE>") < robbery.indexOf("1. [상대]"));

const rank = context(info, ["generateRanking", "normalizeInfoServerLabel", "normalizeRankServerName", "buildServerRankingRows", "formatOverallRankPosition", "formatOverallUserRow", "formatOverallServerRow", "buildWorldOverallRankingMessage", "buildCombinedServerRankingMessage", "buildStandaloneServerRankingMessage"], {
    calculateCastleExp: user => user === "나" ? 120 : 0,
    calculateRaidExp: user => user === "나" ? 80 : 0,
    calculatePetUpgradeCharm: () => 0,
    getRankEmoji: () => "🥇 "
});
const rankingData = { member: { "나": { server: "호이서버1-2[30]" }, "다른": { server: "호이서버6[2030]" }, "미등록": {} } };
const rows = rank.generateRanking(rankingData, { "나": {} }, {}, {}, {}).rows;
assert.strictEqual(rows.length, 3);
assert.strictEqual(rows[0].totalExp, 200);
const servers = rank.buildServerRankingRows(rows, rankingData);
assert.strictEqual(servers.length, 10);
assert.strictEqual(servers.find(row => row.name === "호이서버1[30]").totalExp, 200);
assert.strictEqual(servers.find(row => row.name === "호이서버6[30]").users.length, 1);
const world = rank.buildWorldOverallRankingMessage(rows, "나", rankingData, {}, {});
const combined = rank.buildCombinedServerRankingMessage(servers, "나", rankingData, {}, {});
const standalone = rank.buildStandaloneServerRankingMessage(servers, "나", rankingData);
assert(world.includes("👑 월드 종합순위"));
assert(combined.includes("🏠 소속 서버: 호이서버1[30]"));
assert.strictEqual((standalone.match(/<ALLSEE>/g) || []).length, 1);
assert.strictEqual((standalone.match(/└ 👑 /g) || []).length, 10);

const serverItem = "서버이동권🖱[호이서버 전용](/서버변경 서버이름)";
const serverMessages = [];
let serverSaves = 0;
const serverState = {
    msg: "",
    sender: "나",
    filePath: "/test/member.json",
    data: { member: { "나": { server: "호이서버1-2[30]", bag: { [serverItem]: 1 } } } },
    petData: {}, guildData: {},
    replier: { reply: message => serverMessages.push(message) },
    checkRank: (_data, _pet, _guild, user) => user,
    normalizeHoiServerLabel: mini.normalizeHoiServerLabel,
    GLOBAL_CONFIG: { serverTransfer: {
        itemName: serverItem,
        itemPrice: 100000000000,
        names: ["호이서버1", "호이서버2", "호이서버3", "호이서버4", "호이서버5", "호이서버6", "호이서버7", "호이월드 커뮤니티"],
        labels: ["호이서버1[30]", "호이서버2[2030]", "호이서버3[3040]", "호이서버4[3040]", "호이서버5[2030]", "호이서버6[30]", "호이서버7[2030]", "호이월드 커뮤니티"]
    } },
    saveJsonFile: () => { serverSaves++; },
    removeItem: (data, user, item) => { if (--data.member[user].bag[item] === 0) delete data.member[user].bag[item]; },
    addItem: (data, user, item) => { data.member[user].bag[item] = (data.member[user].bag[item] || 0) + 1; }
};
vm.createContext(serverState);
const serverBlock = extractIfBlock(main, 'if (msg === "/서버변경" ||');
vm.runInContext("function runServerChange() { " + serverBlock + " }", serverState);
for (const command of ["/서버변경", "/서버변경 호이서버8", "/서버변경 호이서버1"]) {
    serverState.msg = command;
    serverState.runServerChange();
}
assert.strictEqual(serverSaves, 0);
assert.strictEqual(serverState.data.member["나"].bag[serverItem], 1);
serverState.msg = "/서버변경 호이서버6";
serverState.runServerChange();
assert.strictEqual(serverSaves, 1);
assert.strictEqual(serverState.data.member["나"].server, "호이서버6[30]");
assert.strictEqual(serverState.data.member["나"].bag[serverItem], undefined);
assert(serverMessages[serverMessages.length - 1].includes("남은 서버이동권: 0개"));
serverState.msg = "/서버변경 호이서버2";
serverState.runServerChange();
assert.strictEqual(serverSaves, 1);
assert.strictEqual(serverState.data.member["나"].server, "호이서버6[30]");

serverState.data.member["나"].bag[serverItem] = 1;
serverState.saveJsonFile = () => { throw new Error("write failed"); };
serverState.msg = "/서버변경 호이서버2";
serverState.runServerChange();
assert.strictEqual(serverState.data.member["나"].server, "호이서버6[30]");
assert.strictEqual(serverState.data.member["나"].bag[serverItem], 1);
assert(serverMessages[serverMessages.length - 1].includes("오류가 발생했습니다"));

const adminMessages = [];
let adminSaves = 0;
const adminState = {
    msg: "", sender: "MASTER", filePath: "/test/member.json",
    data: { admin: {}, master: ["MASTER"], member: { "관리자": { bag: {} }, "MASTER": { bag: {} } } },
    petData: {}, guildData: {},
    replier: { reply: message => adminMessages.push(message) },
    isMaster: () => true,
    checkRank: (_data, _pet, _guild, user) => user,
    getAdminPayoutUsers: data => Object.keys(data.admin),
    getAuthorityTitleBadge: data => data.member["관리자"].displaySettings && data.member["관리자"].displaySettings.hideAdminTitle ? "" : "[🎖호월관리자]",
    GLOBAL_CONFIG: { serverTransfer: { itemName: serverItem } },
    addItem: (data, user, item) => { data.member[user].bag[item] = (data.member[user].bag[item] || 0) + 1; },
    saveJsonFile: () => { adminSaves++; }
};
vm.createContext(adminState);
const adminAdd = extractIfBlock(main, 'if (/^\\/관리자추가\\s+');
const adminDelete = extractIfBlock(main, 'if (/^\\/관리자삭제\\s+');
const adminHide = extractIfBlock(main, 'if (msg === "/관리자감추기")');
const emojiHide = extractIfBlock(main, 'if (msg === "/이모지감추기")');
vm.runInContext("function runAdmin() { " + adminAdd + adminDelete + adminHide + emojiHide + " }", adminState);
adminState.msg = "/관리자추가 관리자";
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].bag[serverItem], 1);
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].bag[serverItem], 1);
adminState.msg = "/관리자감추기";
adminState.sender = "관리자";
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].displaySettings.hideAdminTitle, true);
adminState.msg = "/이모지감추기";
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].displaySettings.hideRankEmoji, true);
adminState.msg = "/관리자삭제 관리자";
adminState.sender = "MASTER";
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].bag[serverItem], 2);
assert.strictEqual(Object.prototype.hasOwnProperty.call(adminState.data.admin, "관리자"), false);
adminState.runAdmin();
assert.strictEqual(adminState.data.member["관리자"].bag[serverItem], 2);
assert(adminSaves >= 4);

console.log("Sep 30 READY: mini-pet, rankings, server transfer, admin grants and display toggles passed");
