const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const infoSource = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(name) {
    const start = source.indexOf("function " + name + "(");
    if (start < 0) throw new Error("함수를 찾을 수 없습니다: " + name);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error("함수 범위를 찾을 수 없습니다: " + name);
}

const context = {
    PET_SKILL_RETIREMENT_COMPENSATION_VERSION: "2026-09-17-v1",
    PET_SKILL_LIST: [
        { name: "초월성장", retired: true },
        { name: "나 혼자만 레벨업", retired: true },
        { name: "헌터" }
    ],
    getTierPetSkillSearchName: skillData => skillData.name,
    formatDateTime: () => "2026-09-17 12:00:00",
    numberWithCommas: value => String(value)
};
vm.createContext(context);
[
    "normalizePetSkillName",
    "getPetSkillData",
    "isRetiredPetSkill",
    "initPetSkillUser",
    "ensurePetSkillRetirementCompensationLedger",
    "countRetiredPetSkillHoldings",
    "createPetSkillRetirementCompensationRecord",
    "removeRetiredPetSkillHoldings",
    "buildPetSkillRetirementCompensationResultMessage"
].forEach(name => vm.runInContext(extractFunction(name), context));

vm.runInContext(`
var testData = { member: { "테스터": { bag: {} } } };
var testSkills = {
    "테스터": {
        petSkills: {
            equipped: ["초월성장", "헌터"],
            lockedPremium: ["나혼자만레벨업"],
            bag: { "초월성장": 2, "나 혼자만 레벨업": 3, "헌터": 4 }
        }
    }
};
var testCounts = countRetiredPetSkillHoldings(testSkills, "테스터");
var testRecord = createPetSkillRetirementCompensationRecord(testCounts);
var testLedger = ensurePetSkillRetirementCompensationLedger(testData);
testLedger.users["테스터"] = testRecord;
removeRetiredPetSkillHoldings(testSkills, "테스터");
`, context);

const counts = context.testCounts;
if (counts.transcendence !== 3 || counts.soloLeveling !== 4 || counts.total !== 7) {
    throw new Error("폐지 펫스킬 보유량 계산 실패: " + JSON.stringify(counts));
}
if (context.testRecord.rewardCount !== 7 || context.testRecord.status !== "PENDING") {
    throw new Error("보상 처리 기록 생성 실패: " + JSON.stringify(context.testRecord));
}
const remaining = JSON.parse(vm.runInContext("JSON.stringify(testSkills['테스터'].petSkills)", context));
if (remaining.equipped.join(",") !== "헌터" || remaining.lockedPremium.length !== 0 || remaining.bag["헌터"] !== 4 || remaining.bag["초월성장"] || remaining.bag["나 혼자만 레벨업"]) {
    throw new Error("폐지 펫스킬 회수 실패: " + JSON.stringify(remaining));
}

const mainChecks = [
    'name: "나 혼자만 레벨업", grade: "B", rate: 2.3, openable: false',
    'name: "초월성장", grade: "C", rate: 4.5, openable: false',
    'targetSkillData.retired === true',
    'skillData.collectionEligible === false',
    'command === "/펫스킬북보상"',
    'isGlobalOperatorCommandAllowed(sender, msg)',
    '!data.member[sender].agree && !isGlobalOperatorCommandAllowed(sender, msg)',
    'if (msg === "/기록실") return isAdminIdentity(sender) || isMasterIdentity(sender)',
    'if (msg === "/기록" || /^\\/기록\\s+',
    'msg === "/인증필요" && isAdminIdentity(sender)',
    'isMasterIdentity(sender) || isAdminIdentity(sender)'
];
for (const expected of mainChecks) {
    if (source.indexOf(expected) < 0) throw new Error("main.js 연결 검증 실패: " + expected);
}

const infoChecks = [
    'function isGlobalInfoCommandAllowed(sender, msg)',
    '!isGlobalInfoCommand && !isGroupChat',
    'isAdminIdentity(sender) || isMasterIdentity(sender)'
];
for (const expected of infoChecks) {
    if (infoSource.indexOf(expected) < 0) throw new Error("Info.js 연결 검증 실패: " + expected);
}

const compensationCommandStart = source.indexOf('if (msg === "/펫스킬북보상")');
const compensationCommandEnd = source.indexOf('var shouldCleanupAllPremiumUsers', compensationCommandStart);
const compensationCommandSource = source.slice(compensationCommandStart, compensationCommandEnd);
const compensationSaveCalls = compensationCommandSource.match(/saveJsonFile\(/g) || [];
if (compensationSaveCalls.length !== 2) {
    throw new Error("/펫스킬북보상 저장 횟수 검증 실패: " + compensationSaveCalls.length);
}
const compensationLoopEnd = compensationCommandSource.indexOf('saveJsonFile(petSkillData, petSkillDataPath)');
const compensationLoopSource = compensationCommandSource.slice(0, compensationLoopEnd);
if (compensationLoopSource.indexOf('saveJsonFile(') >= 0) {
    throw new Error("/펫스킬북보상 계정 반복 구간에 파일 저장이 남아 있습니다.");
}

if (source.indexOf('if (msg === "/기록" || /^\\/기록\\s+') < 0 || source.indexOf('if (!(isMasterIdentity(sender) || isAdminIdentity(sender)))') < 0) {
    throw new Error("기록 명령 전역 권한·정확한 패턴 연결 검증 실패");
}

console.log("PASS pet skill retirement compensation and global operator lookup commands");
