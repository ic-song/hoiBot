const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 현재 소스의 함수를 합성 데이터로 실행하기 위해 추출한다.
function fn(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}

// 실제 강화 비용·확률·상승량을 유지하고 외부 출력과 저장만 대체한다.
function setup() {
    const c = {
        sender: "test", msg: "", castleSiegeFlag: false,
        filePath: "/sdcard/호이랜드_dev/member.json", memberPetPath: "/sdcard/호이랜드_dev/member_pet.json",
        data: { member: { test: { point: 2000000000, bag: { "미니펫 강화석💫": 100000, "미니펫귀속해제권🐰(/귀속해제)": 2 } } } },
        petData: { test: {
            miniPet: { name: "대표", emoji: "🐹", grade: "일반", upgrade: 0, battleExp: 100, bound: true },
            miniPetSupport: { name: "보조", emoji: "🛡️", grade: "일반", upgrade: 0, battleExp: 1632351, bound: true },
            miniPetBag: [{ name: "가방", emoji: "🐭", grade: "일반", upgrade: 0, battleExp: 300, sortIndex: 1 }]
        } }, guildData: {}, petSkillData: {}, replies: [], saves: [], questAttempts: 0,
        numberWithCommas: n => Number(n).toLocaleString("en-US"), allsee: "<ALLSEE>",
        checkRank: (_d, _p, _g, user) => user,
        getMiniPetUpgradeDisplay: mini => mini.upgrade || 0,
        hasPetSkill: () => false, noticeMsg: () => {},
        getHoiPassPremiumHeader: () => "", getMiniPetBattleRank: () => "순위없음",
        GLOBAL_CONFIG: { daily: { miniPetBattleMax: 15, miniPetBattleFree: 1 } }
    };
    c.Math = Object.create(Math); c.Math.random = () => 0;
    c.addPoint = (d, user, delta) => { d.member[user].point += delta; };
    c.removeItem = (d, user, item, amount) => { d.member[user].bag[item] -= amount; };
    c.recordAdventureQuestAction = () => { c.questAttempts++; };
    c.replier = { reply: message => c.replies.push(message) };
    c.saveJsonFile = (value, file) => c.saves.push({ file, json: JSON.stringify(value) });
    vm.createContext(c);
    for (const name of ["buildMiniUpgradeProbabilityTable", "buildMiniUpgradeCostTable", "buildMiniUpgradeCharmTable",
        "isElite", "isMasterMiniPet", "getCharmGainFor", "findBestMiniBoostItem", "getMiniUpgradeTargetInfo",
        "getMiniUpgradeStateText", "runMiniPetUpgradeOnce", "runRepeatMiniPetUpgrade", "getMiniPetModeCharm",
        "buildMiniPetInfoRenewedMessage", "getMiniPetDisplayTitle"]) vm.runInContext(fn(main, name), c);
    const globals = main.indexOf("var MINIPET_MAX_LV =");
    vm.runInContext(main.slice(globals, main.indexOf("// 미니펫강화", globals)), c);
    const start = main.indexOf('if (msg === "/미니펫강화" ||');
    const end = main.indexOf("var parts = msg.trim().split", start);
    assert(start >= 0 && end > start);
    vm.runInContext("function runCommand() { " + main.slice(start, end) + " } }", c);
    return c;
}

// 1. 실제 명령어에서 대표·보조·가방 대상과 원본 저장 결과를 대조한다.
for (const [input, field] of [["0", "miniPet"], ["00", "miniPetSupport"], ["1", "miniPetBag"]]) {
    const c = setup();
    const before = JSON.parse(JSON.stringify(c.petData.test));
    c.msg = "/미니펫강화 " + input + " 10"; c.runCommand();
    for (const key of ["miniPet", "miniPetSupport", "miniPetBag"]) {
        if (key !== field) assert.deepStrictEqual(c.petData.test[key], before[key]);
    }
    const target = field === "miniPetBag" ? c.petData.test[field][0] : c.petData.test[field];
    assert.strictEqual(target.upgrade, 10);
    assert.strictEqual(c.data.member.test.point, 1900000000);
    assert.strictEqual(c.data.member.test.bag["미니펫 강화석💫"], 99945);
    assert.strictEqual(c.data.member.test.bag["미니펫귀속해제권🐰(/귀속해제)"], 2);
    assert.strictEqual(c.questAttempts, 1);
    assert.deepStrictEqual(c.saves.map(s => s.file), [c.filePath, c.memberPetPath]);
    assert.deepStrictEqual(JSON.parse(c.saves[1].json), c.petData);
    assert(c.replies[0].includes(target.name));
    if (field === "miniPetSupport") {
        assert.strictEqual(target.bound, true);
        assert.strictEqual(c.getMiniPetModeCharm("test", c.petData), 100 + Math.floor((1632351 + 100000) / 2));
    }
}
console.log("1/5 대표·보조·가방 분리, 비용·귀속 유지, 저장·50% 매력 PASS");

// 2. 미장착·잘못된 횟수·후행 문구에서 비용과 강화 대상을 변경하지 않는다.
for (const msg of ["/미니펫강화 00 0", "/미니펫강화 00 10 해봐", "/미니펫강화 00 -1", "/미니펫강화속성 00 10"]) {
    const c = setup(), before = JSON.stringify([c.data, c.petData]);
    c.msg = msg; c.runCommand();
    assert.strictEqual(JSON.stringify([c.data, c.petData]), before);
    assert.strictEqual(c.saves.length, 0);
    if (msg.endsWith(" 0")) assert(c.replies[0].includes("/미니펫강화 00 [강화횟수]"));
}
for (const missing of [false, true]) {
    const c = setup();
    if (missing) delete c.petData.test; else delete c.petData.test.miniPetSupport;
    const before = JSON.stringify([c.data, c.petData]);
    c.msg = "/미니펫강화 00 10"; c.runCommand();
    assert.strictEqual(JSON.stringify([c.data, c.petData]), before);
    assert(c.replies[0].includes("보조로 장착된 미니펫이 없습니다."));
    assert.strictEqual(c.questAttempts, 0);
}
for (const msg of ["/미니펫강화", "/미니펫강화 0", "/미니펫강화 00", "/미니펫강화 1"]) {
    const c = setup(); c.msg = msg; c.runCommand();
    assert.strictEqual(c.data.member.test.point, 1990000000);
}
const capped = setup(); capped.msg = "/미니펫강화 00 101"; capped.runCommand();
assert.strictEqual(capped.petData.test.miniPetSupport.upgrade, 100);
assert(capped.replies[0].includes("최대 100회"));
console.log("2/5 미장착·오입력 무소모, 횟수 생략·100회 제한 PASS");

// 3. 실패·확률UP·등급별 상승량·MAX 제한은 기존 강화 규칙을 따른다.
const failed = setup(); failed.Math.random = () => 0.9;
failed.msg = "/미니펫강화 00 1"; failed.runCommand();
assert.strictEqual(failed.petData.test.miniPetSupport.upgrade, 0);
assert.strictEqual(failed.data.member.test.point, 1990000000);
assert(failed.replies[0].includes("강화실패"));
const boosted = setup(); boosted.Math.random = () => 0.9;
boosted.data.member.test.bag["미니펫강화확률UP🐷(30%)"] = 1;
boosted.msg = "/미니펫강화 00 1"; boosted.runCommand();
assert.strictEqual(boosted.petData.test.miniPetSupport.upgrade, 1);
assert.strictEqual(boosted.data.member.test.bag["미니펫강화확률UP🐷(30%)"], 0);
for (const [grade, gain] of [["일반", 10000], ["엘리트", 12000], ["마스터", 15000]]) {
    const c = setup(); c.petData.test.miniPetSupport.grade = grade;
    c.msg = "/미니펫강화 00 1"; c.runCommand();
    assert.strictEqual(c.petData.test.miniPetSupport.battleExp, 1632351 + gain);
    c.petData.test.miniPetSupport.upgrade = 300;
    const before = JSON.stringify([c.data, c.petData]);
    c.runCommand(); assert.strictEqual(JSON.stringify([c.data, c.petData]), before);
    assert(c.replies[c.replies.length - 1].includes("최대 강화"));
}
console.log("3/5 실패 비용·확률UP·일반/엘리트/마스터·MAX PASS");

// 4. 자원 부족 중단과 저장 후 재시작에서도 보조 슬롯만 이어서 강화한다.
const stopped = setup(); stopped.data.member.test.bag["미니펫 강화석💫"] = 3;
stopped.msg = "/미니펫강화 00 10"; stopped.runCommand();
assert.strictEqual(stopped.petData.test.miniPetSupport.upgrade, 2);
assert.strictEqual(stopped.data.member.test.point, 1980000000);
assert(stopped.replies[0].includes("[2/10회]"));
const restarted = setup();
restarted.data = JSON.parse(stopped.saves[0].json); restarted.petData = JSON.parse(stopped.saves[1].json);
restarted.data.member.test.bag["미니펫 강화석💫"] = 3;
restarted.msg = "/미니펫강화 00 1"; restarted.runCommand();
assert.strictEqual(restarted.petData.test.miniPetSupport.upgrade, 3);
assert.strictEqual(restarted.petData.test.miniPet.upgrade, 0);
assert.strictEqual(restarted.petData.test.miniPetSupport.bound, true);
const poor = setup(); poor.data.member.test.point = 0;
const poorBefore = JSON.stringify([poor.data, poor.petData]);
poor.msg = "/미니펫강화 00 1"; poor.runCommand();
assert.strictEqual(JSON.stringify([poor.data, poor.petData]), poorBefore);
console.log("4/5 재료·포인트 부족 중단, 저장 후 재시작 PASS");

// 5. 실제 미니펫·레벨 출력의 안내 순서와 전체보기 위치를 검증한다.
const ui = setup();
const mini = ui.buildMiniPetInfoRenewedMessage("test", ui.data, ui.petData, {}, {}, false);
const guide = ["※ 대표장착: /미니펫장착 [미니펫가방번호]", "※ 보조장착: /미니펫보조장착 [미니펫가방번호]",
    "※ 대표미니펫 강화: /미니펫강화 0 [강화횟수]", "※ 보조미니펫 강화: /미니펫강화 00 [강화횟수]",
    "※ 대표귀속해제: /귀속해제", "※ 보조귀속해제: /보조귀속해제", "└ 공통 필요: 미니펫귀속해제권🐰(/귀속해제)"];
assert(mini.includes(guide.join("\n")));
for (const line of guide) assert.strictEqual(mini.split(line).length, 2);
assert(mini.indexOf("<ALLSEE>") < mini.indexOf(guide[0]));
Object.assign(ui, { getInfoLevelRequiredExperience: lv => lv * 1000,
    getInfoAdventureLevelSummary: () => ({ charmPercent: 0 }), getInfoAdventureLevelTitle: () => "견습 모험가",
    formatInfoAdventureExperience: n => String(n), formatInfoAdventureLevelPercent: n => String(n) });
vm.runInContext(fn(info, "formatInfoAdventureQuestPercent"), ui);
vm.runInContext(fn(info, "buildInfoLevelMessage"), ui);
for (const lv of [1, 11, 100]) {
    ui.data.member.test.lv = lv;
    const before = JSON.stringify(ui.data);
    const level = ui.buildInfoLevelMessage(ui.data, ui.petData, {}, "test");
    assert(level.includes("👉 진행 안내 /모험가퀘스트\n👉 전체 기록 /퀘스트기록\n👉 타이틀 장착 /퀘스트타이틀\n"));
    assert.strictEqual(level.split("👉 타이틀 장착 /퀘스트타이틀").length, 2);
    assert(level.indexOf("👉 타이틀 장착") < level.indexOf("<ALLSEE>"));
    assert.strictEqual(JSON.stringify(ui.data), before);
}
console.log("5/5 미니펫 안내 7줄·레벨 타이틀 안내 순서·무변경 PASS");
