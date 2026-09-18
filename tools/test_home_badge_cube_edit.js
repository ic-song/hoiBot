const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

const validCommand = /^\/홈뱃지큐브수정\s+[12]\s+\d+(?:\.\d)?\s+\d+(?:\.\d)?\s+\d+(?:\.\d)?\s+\d+(?:\.\d)?$/;
[
    "/홈뱃지큐브수정 1 10.5 8.2 7 12.3",
    "/홈뱃지큐브수정 2 50 50 30 15",
    "/홈뱃지큐브수정 1 0 0 0 0"
].forEach(command => {
    if (!validCommand.test(command)) throw new Error("정상 명령 패턴 실패: " + command);
});
[
    "/홈뱃지큐브수정 3 1 2 3 4",
    "/홈뱃지큐브수정 1 1.25 2 3 4",
    "/홈뱃지큐브수정 1 1 2 3 4 추가",
    "/홈뱃지큐브수정 1 -1 2 3 4"
].forEach(command => {
    if (validCommand.test(command)) throw new Error("비정상 명령이 허용됨: " + command);
});

const requiredChecks = [
    'msg === "/홈뱃지큐브수정"',
    '&& isMaster(sender)',
    'getPetHomeEquippedBadgeIds(homeBadgeCubeEditActivityData, sender)',
    '!petHomeStringListContains(homeBadgeCubeEditSocial.badges, homeBadgeCubeEditBadge.id)',
    'homeBadgeCubeEditValue > homeBadgeCubeEditOption.max',
    'homeBadgeCubeEditRecord[homeBadgeCubeEditConfig.key] = Math.round(homeBadgeCubeEditValues[homeBadgeCubeEditOptionIndex] * 10) / 10',
    'saveJsonFile(data, filePath)',
    'var verifiedHomeBadgeCubeEditData = loadJsonFile(filePath)',
    'Number(verifiedHomeBadgeCubeEditRecord[verifiedHomeBadgeCubeEditOption.key]) === homeBadgeCubeEditValues[homeBadgeCubeEditVerifyIndex]',
    '※ 보조 슬롯의 펫 강화·탐험 옵션은 대표 슬롯으로 이동하면 적용됩니다.',
    '"/홈뱃지큐브수정", "/레벨수정"',
    '/^\\/홈뱃지큐브수정\\s+[12]',
    '/^\\/홈뱃지큐브수정(?:\\s+.*)?$/.test(msg)'
];
requiredChecks.forEach(expected => {
    if (source.indexOf(expected) < 0) throw new Error("/홈뱃지큐브수정 연결 검증 실패: " + expected);
});

const commandStart = source.indexOf('if ((msg === "/홈뱃지큐브수정"');
const commandEnd = source.indexOf('if (/^\\/홈뱃지큐브\\s+', commandStart);
if (commandStart < 0 || commandEnd < 0) throw new Error("/홈뱃지큐브수정 명령 범위를 찾지 못했습니다.");
const commandSource = source.slice(commandStart, commandEnd);
if (commandSource.indexOf("homeBadgeCubeBag") >= 0 || commandSource.indexOf("pointRewardPerCube") >= 0 || commandSource.indexOf("noticeMsg(") >= 0) {
    throw new Error("/홈뱃지큐브수정에서 큐브·포인트·전체알림 처리가 감지되었습니다.");
}
const saveCalls = commandSource.match(/saveJsonFile\(data, filePath\)/g) || [];
if (saveCalls.length !== 2) throw new Error("정상 저장과 실패 롤백 저장 외 호출이 있습니다: " + saveCalls.length);

console.log("PASS home badge cube edit command guards, limits, persistence, and no-cost behavior");
