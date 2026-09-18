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

const heartContext = {
    GLOBAL_CONFIG: { supportPass: { premium: { heartBonus: 15 } } },
    getPetHomeSocialUser: (activityData, user) => activityData.petHomeSocial[user],
    getPetHomeTodayText: () => "2026-09-18",
    getActivePetHomeMutualCount: () => 2,
    isHoiPassPremiumActive: () => true,
    getPetSkillHeartBonus: () => 5
};
vm.createContext(heartContext);
vm.runInContext(extractFunction("hasUnlimitedPetHomeHeartUsage"), heartContext);
vm.runInContext(extractFunction("getPetHomeHeartUsageStatus"), heartContext);

const heartActivity = {
    petHomeSocial: {
        "호이 남": { heartUsage: { date: "2026-09-18", count: 100 } },
        "일반 남": { heartUsage: { date: "2026-09-18", count: 3 } }
    }
};
const hoiStatus = heartContext.getPetHomeHeartUsageStatus({}, {}, heartActivity, {}, "호이 남");
if (!hoiStatus.unlimited || hoiStatus.remaining !== null || hoiStatus.used !== 100) {
    throw new Error("호이 남 마음 무제한 상태 검증 실패: " + JSON.stringify(hoiStatus));
}
const normalStatus = heartContext.getPetHomeHeartUsageStatus({}, {}, heartActivity, {}, "일반 남");
if (normalStatus.unlimited || normalStatus.limit !== 23 || normalStatus.remaining !== 20) {
    throw new Error("일반 유저 마음 한도 검증 실패: " + JSON.stringify(normalStatus));
}

let permissionRoom = "서버관리자";
const operatorContext = {
    room92: "서버관리자",
    room8: "공성전",
    Admins: ["관리자 남"],
    Master: ["마스터 남"],
    getCurrentContext: () => ({ permissionRoom }),
    isMaster: sender => operatorContext.Master.indexOf(sender) !== -1 && (permissionRoom === "팻 테스트방" || permissionRoom === "서버관리자")
};
vm.createContext(operatorContext);
vm.runInContext(extractFunction("isServerAdminRoomOperator"), operatorContext);
vm.runInContext(extractFunction("isGuildTerritoryStartOperator"), operatorContext);
vm.runInContext(extractFunction("isPetMusouStartOperator"), operatorContext);

if (!operatorContext.isGuildTerritoryStartOperator("관리자 남")) throw new Error("서버관리자방 Admin 길드영지 시작 권한 실패");
if (!operatorContext.isPetMusouStartOperator("관리자 남")) throw new Error("서버관리자방 Admin 펫무쌍 시작 권한 실패");
if (!operatorContext.isGuildTerritoryStartOperator("마스터 남")) throw new Error("서버관리자방 Master 길드영지 시작 권한 실패");
permissionRoom = "일반방";
if (operatorContext.isGuildTerritoryStartOperator("관리자 남")) throw new Error("일반방 Admin에게 길드영지 시작 권한이 열림");
if (operatorContext.isPetMusouStartOperator("관리자 남")) throw new Error("일반방 Admin에게 펫무쌍 시작 권한이 열림");
if (!operatorContext.isGuildTerritoryStartOperator("호이 남")) throw new Error("기존 길드영지 지정 운영자 권한 손실");
if (!operatorContext.isPetMusouStartOperator("오픈채팅봇")) throw new Error("기존 펫무쌍 오픈채팅봇 권한 손실");

const requiredChecks = [
    "!heartUsageStatus.unlimited && heartUseCount > heartUsageStatus.remaining",
    'heartUsageStatus.unlimited ? "무제한"',
    "!hasUnlimitedPetHomeHeartUsage(senderName) && (data.member[sender].homeLikeCnt || 0) >= maxLikeCnt",
    'msg === "/길드영지시작" && isGuildTerritoryStartOperator(sender)',
    "isServerAdminRoomOperator(sender)"
];
requiredChecks.forEach(expected => {
    if (source.indexOf(expected) < 0) throw new Error("운영 특례 연결 검증 실패: " + expected);
});

console.log("PASS Hoi unlimited pet-home reactions and server-admin-room start permissions");
