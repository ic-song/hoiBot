const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

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
vm.runInContext(extractFunction("isInfoCommandBlockedDuringGuildTerritoryWar"), context);

const activeGuildData = { territoryWar: { active: true } };
const inactiveGuildData = { territoryWar: { active: false } };

if (!context.isInfoCommandBlockedDuringGuildTerritoryWar(activeGuildData, "/레벨", false, false)) {
    throw new Error("운영 영지전 중 /레벨 차단 실패");
}
if (context.isInfoCommandBlockedDuringGuildTerritoryWar(inactiveGuildData, "/레벨", false, false)) {
    throw new Error("영지전 종료 후 /레벨이 차단됨");
}
if (context.isInfoCommandBlockedDuringGuildTerritoryWar(activeGuildData, "/레벨", true, false)) {
    throw new Error("DEV /레벨이 운영 영지전 상태로 차단됨");
}
if (context.isInfoCommandBlockedDuringGuildTerritoryWar(activeGuildData, "/정보 대상", false, true)) {
    throw new Error("전역 허용 /정보 명령이 차단됨");
}
if (context.isInfoCommandBlockedDuringGuildTerritoryWar(activeGuildData, "ㅍㅍㅍ", false, false)) {
    throw new Error("슬래시가 아닌 기존 단축 명령까지 차단됨");
}

const guardCall = "if (isInfoCommandBlockedDuringGuildTerritoryWar(guildData, msg, ctx.isDev, isGlobalInfoCommand)) return;";
const guardIndex = source.indexOf(guardCall);
const levelIndex = source.indexOf('if (msg === "/레벨")');
if (guardIndex < 0 || levelIndex < 0 || guardIndex >= levelIndex) {
    throw new Error("Info 영지전 차단이 /레벨 처리 전에 연결되지 않음");
}
if (mainSource.indexOf("🏰 길드 영지전 진행 중에는 영지전 관련 명령어만 사용할 수 있습니다.") < 0) {
    throw new Error("main.js의 기존 영지전 제한 안내를 찾을 수 없음");
}

console.log("PASS Info commands stay silent during guild territory war while main owns the notice");
