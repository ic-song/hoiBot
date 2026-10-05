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

const context = {};
vm.createContext(context);
vm.runInContext(extractFunction("buildManualPetExploreSettlementMessage"), context);

const expected = "✅ 펫탐험 정산을 완료했습니다.\n⏱️ 다음 자동 정산까지: 60분";
if (context.buildManualPetExploreSettlementMessage(60) !== expected) {
    throw new Error("수동 정산 완료 안내 문구가 다릅니다.");
}

const autoStartSource = source.slice(
    source.indexOf('if (msg == "/자동탐험시작"'),
    source.indexOf('var isManualPetExploreSettlement = msg == "/펫탐험정산"')
);
if (autoStartSource.indexOf("✅ 자동탐험을 시작합니다.") < 0 || autoStartSource.indexOf("첫 자동 정산은 60분 후 실행됩니다.") < 0) {
    throw new Error("자동탐험 시작 안내 문구가 유지되지 않았습니다.");
}
if (autoStartSource.indexOf("펫탐험 정산을 완료했습니다.") >= 0) {
    throw new Error("자동탐험 시작 안내에 수동 정산 완료 문구가 섞였습니다.");
}

const settlementStart = source.indexOf('var isManualPetExploreSettlement = msg == "/펫탐험정산"');
const settlementEnd = source.indexOf('if (msg.startsWith("/럭키오픈"))', settlementStart);
if (settlementStart < 0 || settlementEnd < 0) throw new Error("펫탐험 정산 범위를 찾지 못했습니다.");
const settlementSource = source.slice(settlementStart, settlementEnd);

[
    "var out = doPetExploreInterval",
    "stopAllIntervals(data)",
    "startInterval(data, room, replier, setint, ctx.isDev)",
    "saveJsonFile(data, filePath)",
    "manualPetExploreSettlementMessage = buildManualPetExploreSettlementMessage(setint)"
].forEach(expectedSource => {
    if (settlementSource.indexOf(expectedSource) < 0) throw new Error("수동 정산 완료 안내 연결 누락: " + expectedSource);
});

const replyCount = (settlementSource.match(/if \(manualPetExploreSettlementMessage\) replier\.reply\(manualPetExploreSettlementMessage\)/g) || []).length;
if (replyCount !== 2) throw new Error("참가자 유무 두 경로의 정산 완료 안내 연결 수가 다릅니다: " + replyCount);
if (settlementSource.indexOf("자동탐험을 시작합니다") >= 0) throw new Error("수동 정산 경로에 자동탐험 시작 문구가 섞였습니다.");

console.log("PASS automatic start and manual settlement messages stay separate");
