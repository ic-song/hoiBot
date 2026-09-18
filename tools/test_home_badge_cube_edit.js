const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

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

const parserContext = {};
vm.createContext(parserContext);
vm.runInContext(extractFunction("findTargetAtStart"), parserContext);

const memberMap = { "호이": {}, "호이 남": {}, "테스트 유저": {} };
const valuePattern = /^([12])\s+(\d+(?:\.\d)?)\s+(\d+(?:\.\d)?)\s+(\d+(?:\.\d)?)\s+(\d+(?:\.\d)?)$/;

[
    "/홈뱃지큐브수정 호이 남 1 10.5 8.2 7 12.3",
    "/홈뱃지큐브수정 테스트 유저 2 50 50 30 15",
    "/홈뱃지큐브수정 호이 1 0 0 0 0"
].forEach(command => {
    const content = command.substring("/홈뱃지큐브수정".length).trim();
    const parsed = parserContext.findTargetAtStart(content, memberMap);
    if (!parsed.target || !valuePattern.test(parsed.rest)) throw new Error("정상 명령 파싱 실패: " + command);
});

const longestTarget = parserContext.findTargetAtStart("호이 남 1 1 2 3 4", memberMap);
if (longestTarget.target !== "호이 남") throw new Error("공백 포함 최장 닉네임 탐색 실패");

[
    "/홈뱃지큐브수정 1 10.5 8.2 7 12.3",
    "/홈뱃지큐브수정 없는 유저 1 1 2 3 4",
    "/홈뱃지큐브수정 호이 남 3 1 2 3 4",
    "/홈뱃지큐브수정 호이 남 1 1.25 2 3 4",
    "/홈뱃지큐브수정 호이 남 1 1 2 3 4 추가",
    "/홈뱃지큐브수정 호이 남 1 -1 2 3 4"
].forEach(command => {
    const content = command.substring("/홈뱃지큐브수정".length).trim();
    const parsed = parserContext.findTargetAtStart(content, memberMap);
    if (parsed.target && valuePattern.test(parsed.rest)) throw new Error("비정상 명령이 허용됨: " + command);
});

const requiredChecks = [
    '/^\\/홈뱃지큐브수정(?:\\s+.*)?$/.test(msg) && isMaster(sender)',
    'findTargetAtStart(homeBadgeCubeEditContent, data.member || {})',
    'getPetHomeEquippedBadgeIds(homeBadgeCubeEditActivityData, homeBadgeCubeEditTarget)',
    'data.member[homeBadgeCubeEditTarget].hasOwnProperty("homeBadgeCube")',
    'getHomeBadgeCubeRecord(data, homeBadgeCubeEditTarget, homeBadgeCubeEditBadge.id, true)',
    '!petHomeStringListContains(homeBadgeCubeEditSocial.badges, homeBadgeCubeEditBadge.id)',
    'homeBadgeCubeEditValue > homeBadgeCubeEditOption.max',
    'homeBadgeCubeEditRecord[homeBadgeCubeEditConfig.key] = Math.round(homeBadgeCubeEditValues[homeBadgeCubeEditOptionIndex] * 10) / 10',
    'saveJsonFile(data, filePath)',
    'var verifiedHomeBadgeCubeEditData = loadJsonFile(filePath)',
    'getHomeBadgeCubeRecord(verifiedHomeBadgeCubeEditData, homeBadgeCubeEditTarget, homeBadgeCubeEditBadge.id, false)',
    'checkRank(data, petData, guildData, homeBadgeCubeEditTarget)',
    '※ 보조 슬롯의 펫 강화·탐험 옵션은 대표 슬롯으로 이동하면 적용됩니다.',
    '"/홈뱃지큐브수정", "/레벨수정"',
    '사용법: /홈뱃지큐브수정 [닉네임] [장착슬롯 1|2]'
];
requiredChecks.forEach(expected => {
    if (source.indexOf(expected) < 0) throw new Error("/홈뱃지큐브수정 연결 검증 실패: " + expected);
});

const commandStart = source.indexOf('if (/^\\/홈뱃지큐브수정(?:\\s+.*)?$/.test(msg) && isMaster(sender))');
const commandEnd = source.indexOf('if (/^\\/홈뱃지큐브\\s+', commandStart);
if (commandStart < 0 || commandEnd < 0) throw new Error("/홈뱃지큐브수정 명령 범위를 찾지 못했습니다.");
const commandSource = source.slice(commandStart, commandEnd);
if (commandSource.indexOf("homeBadgeCubeBag") >= 0 || commandSource.indexOf("pointRewardPerCube") >= 0 || commandSource.indexOf("noticeMsg(") >= 0) {
    throw new Error("/홈뱃지큐브수정에서 큐브·포인트·전체알림 처리가 감지되었습니다.");
}
if (commandSource.indexOf("getPetHomeEquippedBadgeIds(homeBadgeCubeEditActivityData, sender)") >= 0 || commandSource.indexOf("data.member[sender].homeBadgeCube") >= 0) {
    throw new Error("/홈뱃지큐브수정이 실행자 데이터를 수정합니다.");
}
const saveCalls = commandSource.match(/saveJsonFile\(data, filePath\)/g) || [];
if (saveCalls.length !== 2) throw new Error("정상 저장과 실패 롤백 저장 외 호출이 있습니다: " + saveCalls.length);

console.log("PASS targeted home badge cube edit command parsing, limits, persistence, and no-cost behavior");
