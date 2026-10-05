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

const configStart = main.indexOf("    referral: {");
const configEnd = main.indexOf("    adventureQuest: {", configStart);
assert(configStart >= 0 && configEnd > configStart);
const referralConfig = vm.runInNewContext("({" + main.slice(configStart, configEnd) + "})").referral;
const replies = [];
const saves = [];
const context = {
    GLOBAL_CONFIG: { referral: referralConfig },
    ACCOUNT_SUSPENSION_BLOCKED_PLAIN_MESSAGES: [],
    allsee: "<ALLSEE>",
    sender: "새싹 여",
    filePath: "synthetic-member.json",
    memberPetPath: "synthetic-pet.json",
    petData: { "새싹 여": {} },
    petSkillData: {},
    data: { member: { "새싹 여": { point: 0, bag: {}, adventureOnboarding: { stage: "WAIT_PET_NAME", receipts: {} } }, "기존 남": { point: 50, referralCount: 0 } } },
    formatDateTime: () => "2026-09-28 12:00:00",
    numberWithCommas: value => Number(value).toLocaleString("en-US"),
    checkRank: (_data, _pet, _guild, user) => user,
    createPet: () => ({ petname: "" }),
    addItem: (data, user, item, count) => { data.member[user].bag[item] = (data.member[user].bag[item] || 0) + count; },
    saveJsonFile: (_data, file) => { saves.push(file); },
    replier: { reply: message => { replies.push(message); } }
};
vm.createContext(context);
for (const name of [
    "createAdventureOnboardingMemberState", "getAdventureOnboardingMemberState", "getAdventureBlessingItemName",
    "sanitizeAdventurePetName", "isAdventurePetNameInputCandidate", "isAdventureReferralInputCandidate",
    "buildAdventureReferralPromptMessage", "getSafeReferralNumber", "skipAdventureReferral",
    "registerAdventureReferral", "getReferralCount", "buildReferralRankingMessage",
    "buildAdventurePetCreatedIntroMessage", "buildAdventureBlessingPromptMessage", "buildAdventurePetCreatedMessage",
    "buildAdventureOnboardingResumeMessage"
]) vm.runInContext(extractFunction(name), context);

const petStart = main.indexOf('if (adventureOnboarding && adventureOnboarding.stage === "WAIT_PET_NAME"');
const referralStart = main.indexOf('if (adventureOnboarding && adventureOnboarding.stage === "WAIT_REFERRAL"', petStart);
const blessingStart = main.indexOf('if (msg === "/호여!!")', referralStart);
const blessingEnd = main.indexOf("var moodSkillUsers", blessingStart);
assert(petStart >= 0 && referralStart > petStart && blessingStart > referralStart);
vm.runInContext("function runPetNameStep() {" + main.slice(petStart, referralStart) + "}", context);
vm.runInContext("function runReferralStep() {" + main.slice(referralStart, blessingStart) + "}", context);
assert(blessingEnd > blessingStart);
vm.runInContext("function runBlessingStep() {" + main.slice(blessingStart, blessingEnd) + "}", context);

// 1. 펫 생성 후 추천인 안내가 먼저 나오고 축복 명령은 노출되지 않는다.
context.adventureOnboarding = context.data.member[context.sender].adventureOnboarding;
context.msg = "꽃봇";
context.runPetNameStep();
assert.strictEqual(context.adventureOnboarding.stage, "WAIT_REFERRAL");
assert.strictEqual(context.petData[context.sender].petname, "꽃봇");
assert.strictEqual(context.data.member[context.sender].bag[context.getAdventureBlessingItemName()], 1);
assert.deepStrictEqual(saves, ["synthetic-pet.json", "synthetic-member.json"]);
assert(replies[0].includes("🤝 추천인 등록하고 1억 포인트 받으세요!"));
assert(!replies[0].includes("/호여!!"));
assert.strictEqual(context.buildAdventureOnboardingResumeMessage(context.data, context.petData, context.sender), context.buildAdventureReferralPromptMessage());
context.msg = "/호여!!";
context.runBlessingStep();
assert.strictEqual(replies[1], context.buildAdventureReferralPromptMessage());
assert.strictEqual(saves.length, 2, "추천인 선택 전 축복 사용 금지");

// 2. 등록 성공 시 두 회원의 보상·횟수·영수증이 한 번에 변경된다.
context.msg = "기존 남";
context.runReferralStep();
assert.strictEqual(context.data.member[context.sender].point, 100000000);
assert.strictEqual(context.data.member["기존 남"].point, 500000050);
assert.strictEqual(context.data.member["기존 남"].referralCount, 1);
assert.strictEqual(context.adventureOnboarding.stage, "WAIT_BLESSING");
assert.strictEqual(context.adventureOnboarding.receipts.referral.referrer, "기존 남");
assert.strictEqual(saves.length, 3);
assert(replies[2].startsWith("✅ 추천인 등록 완료!"));
assert(replies[2].endsWith(context.buildAdventureBlessingPromptMessage()));
const afterSuccess = JSON.stringify(context.data);
assert.strictEqual(context.registerAdventureReferral(context.data, context.sender, "기존 남").ok, false);
assert.strictEqual(JSON.stringify(context.data), afterSuccess, "재입력 시 중복 보상 없음");

// 3. 없음은 보상 없이 넘어가고, 본인·미등록자·범위 초과는 변경하지 않는다.
function pendingData() {
    return { member: { "새싹 여": { point: 0, adventureOnboarding: { stage: "WAIT_REFERRAL", receipts: {} } }, "기존 남": { point: 0, referralCount: 0 } } };
}
let fixture = pendingData();
let before = JSON.stringify(fixture);
assert.strictEqual(context.registerAdventureReferral(fixture, "새싹 여", "새싹 여").ok, false);
assert.strictEqual(context.registerAdventureReferral(fixture, "새싹 여", "없는 남").ok, false);
assert.strictEqual(JSON.stringify(fixture), before);
fixture.member["기존 남"].point = 9007199254740991;
before = JSON.stringify(fixture);
assert.strictEqual(context.registerAdventureReferral(fixture, "새싹 여", "기존 남").ok, false);
assert.strictEqual(JSON.stringify(fixture), before);
fixture = pendingData();
assert.strictEqual(context.skipAdventureReferral(fixture, "새싹 여").ok, true);
assert.strictEqual(fixture.member["새싹 여"].point, 0);
assert.strictEqual(fixture.member["기존 남"].point, 0);
assert.strictEqual(fixture.member["기존 남"].referralCount, 0);
assert.strictEqual(fixture.member["새싹 여"].adventureOnboarding.stage, "WAIT_BLESSING");
assert.strictEqual(context.skipAdventureReferral(fixture, "새싹 여").ok, false);
context.data = pendingData();
context.adventureOnboarding = context.data.member[context.sender].adventureOnboarding;
context.msg = "없는 남";
context.runReferralStep();
assert.strictEqual(saves.length, 3, "잘못된 추천인 입력에는 저장하지 않음");
assert.strictEqual(context.adventureOnboarding.stage, "WAIT_REFERRAL");
context.msg = "없음";
context.runReferralStep();
assert.strictEqual(saves.length, 4, "없음 선택은 회원 데이터를 한 번 저장");
assert.strictEqual(context.adventureOnboarding.stage, "WAIT_BLESSING");
assert(replies[replies.length - 1].startsWith("✅ 추천인 없이 진행합니다."));

// 4. 기존 펫·축복 안내 원문은 두 구간을 합쳤을 때 유지된다.
const originalPetMessage = "[새싹 여]님, 새로운 동반자가 생겼습니다! 🐾\n\n" +
    "당신이 지어준 이름, 꽃봇\n이제 이 친구와 함께 세상을 여행하게 됩니다.\n\n" +
    "둘의 첫 만남을 축하하며\n호월신이 특별한 선물을 내려주었습니다.\n\n" +
    "🎁 호월신의 축복✨ 지급 완료!\n━━━━━━━━━━━━━━━\n호월신의 축복✨(/호여!!)\n\n" +
    "채팅창에 /호여!! 를 입력해 주세요.\n펫정보 기본 세팅과 모험에 필요한 재화가 지급됩니다.";
assert.strictEqual(context.buildAdventurePetCreatedMessage("새싹 여", "꽃봇"), originalPetMessage);

// 5. 순위는 본인 요약 후 정렬하고 11번째부터 접는다.
const rankData = { member: { "조회자 여": { point: 0, referralCount: 20 } } };
for (let i = 1; i <= 12; i++) rankData.member["유저" + i] = { referralCount: 13 - i };
const rank = context.buildReferralRankingMessage(rankData, {}, {}, "조회자 여");
assert(rank.includes("🤝 내가 추천한 인원: 20명\n🎁 누적 추천 보상: 100억 포인트"));
assert(rank.indexOf("🥇 [조회자 여] — 20명") < rank.indexOf("🥈 [유저1] — 12명"));
assert(rank.indexOf("10. [유저9] — 4명") < rank.indexOf("<ALLSEE>"));
assert(rank.indexOf("<ALLSEE>") < rank.indexOf("11. [유저10] — 3명"));
assert(context.buildReferralRankingMessage({ member: { "조회자 여": {} } }, {}, {}, "조회자 여").includes("🎁 누적 추천 보상: 0포인트"));

console.log("character referral: 5 scenario groups passed");
