const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    if (start < 0) throw new Error("함수를 찾을 수 없습니다: " + name);
    const brace = source.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("함수 범위를 찾을 수 없습니다: " + name);
}

function load(context, source, names) {
    vm.createContext(context);
    names.forEach(name => vm.runInContext(extractFunction(source, name), context));
    return context;
}

function baseContext() {
    return {
        GLOBAL_CONFIG: {
            attendance: { bonusPoint: 1000000, bonusExp: 100, chatExpDailyLimit: 500, kstOffsetMs: 9 * 60 * 60 * 1000, resultLink: "https://ibb.co/jkbgrzHt" },
            level: { boosterExtraMultiplier: 2, boosterConsumptionPerBaseExp: 2 },
            privateChat: { notifyEvery: 3, messagePreviewMaxLength: 100 }
        },
        allsee: "<FOLD>",
        checkRank: (_data, _pet, _guild, user) => "💛" + user,
        numberWithCommas: value => Number(value).toLocaleString("en-US"),
        roundToTwo: value => Math.round(value * 100) / 100,
        getAutoDailyBatchContext: () => null,
        processAdventureLevelUps: () => [],
        replyAutoDailyAdventureLevelUps: () => {},
        getTierExperienceBonus: () => 30,
        hasPetSkill: () => false,
        RankBonus: () => ({ BonusM: 0.5, Bonusmsg: "추가 보너스" }),
        buildBattleExperienceRewardMessage: () => "EXP",
        buildAdventureBoosterDepletionMessage: () => "",
        buildAdventureLevelUpMessage: () => "레벨업",
        rollAndCalculateMultiplier: () => 3
    };
}

function attendanceContext() {
    const context = baseContext();
    context.today = "20260927";
    context.getAttendanceKstDateKey = () => context.today;
    return load(context, main, ["applyAdventureExperienceBooster", "addMemberExperienceWithTierBonus", "hasAttendedToday", "processAttendanceForUser", "buildAttendanceCompleteMessage"]);
}

function round1() {
    const midnightUtc = Date.parse("2026-09-26T15:00:00Z");
    const TestDate = class extends Date { static now() { return midnightUtc; } };
    const dateContext = { Date: TestDate, GLOBAL_CONFIG: baseContext().GLOBAL_CONFIG };
    load(dateContext, main, ["getAttendanceKstDateKey"]);
    assert.strictEqual(dateContext.getAttendanceKstDateKey(), "20260927", "한국시간 자정 경계");
    const infoDateContext = { Date: TestDate };
    load(infoDateContext, info, ["getInfoAttendanceKstDateKey"]);
    assert.strictEqual(infoDateContext.getInfoAttendanceKstDateKey(), "20260927", "Info 응답기와 날짜 일치");
    const c = attendanceContext();
    const data = { member: { user: { point: 0, exp: 0, boostercnt: 999, cnt: 0, today: 0, recent: "" } }, attend_list: ["old"] };
    const first = c.processAttendanceForUser(data, {}, {}, {}, "user");
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.totalPointReward, 4500000);
    assert.strictEqual(first.experienceResult.total, 390);
    assert.strictEqual(data.member.user.boostercnt, 739);
    assert.strictEqual(c.hasAttendedToday(data, "user"), true);
    assert.strictEqual(c.processAttendanceForUser(data, {}, {}, {}, "user").already, true);
    assert.strictEqual(data.member.user.point, 4500000, "중복 지급 금지");
    data.member.user.today = 0;
    data.attend_list = [];
    assert.strictEqual(c.processAttendanceForUser(data, {}, {}, {}, "user").already, true, "같은 날짜 /리셋 후 중복 지급 금지");
    c.today = "20260928";
    assert.strictEqual(c.hasAttendedToday(data, "user"), false);
    assert.strictEqual(c.processAttendanceForUser(data, {}, {}, {}, "user").ok, true, "오래된 출석 목록에도 다음 날 허용");
    assert.strictEqual(data.member.user.today, 1);
    console.log("1/5 출석·중복·날짜 변경 PASS");
}

function round2() {
    const c = attendanceContext();
    const data = { member: { user: { point: 0, exp: 0, boostercnt: 999, today: 0, recent: "" } }, attendanceNotice: "🐹 특별판매!\n상품 구성은 /소식" };
    const result = c.processAttendanceForUser(data, {}, {}, {}, "user");
    const message = c.buildAttendanceCompleteMessage(data, {}, {}, "user", result);
    const lines = message.split("\n");
    assert.strictEqual(lines[2], "https://ibb.co/jkbgrzHt", "완료 문구 바로 아래 링크");
    assert.strictEqual(message.split("<FOLD>").length - 1, 1, "접기 표시는 한 번");
    assert(message.indexOf("(알림)") < message.indexOf("<FOLD>"), "알림은 접기 전");
    assert(message.indexOf("💰 총 획득 포인트 🅟4,500,000") >= 0);
    assert(message.indexOf("📊 총 획득 경험치: +390exp") >= 0);
    assert(message.indexOf("총 지급: 🅟4,500,000 포인트") > message.indexOf("<FOLD>"));
    assert(message.indexOf("최종 획득: +390 EXP") > message.indexOf("<FOLD>"));
    assert(message.indexOf("호월신의 가호 적용") >= 0);
    delete data.attendanceNotice;
    assert(!c.buildAttendanceCompleteMessage(data, {}, {}, "user", result).includes("(알림)"));
    console.log("2/5 통합 출석 메시지·알림 PASS");
}

function round3() {
    const c = baseContext();
    c.today = "20260927";
    c.getAttendanceKstDateKey = () => c.today;
    load(c, main, ["awardDailyChatExperience", "buildDailyChatExperienceLimitMessage"]);
    const data = { member: { user: { exp: 0, boostercnt: 10, chatExperienceDaily: { date: c.today, experience: 497, notified: false } } } };
    const final = c.awardDailyChatExperience(data, "user");
    assert.strictEqual(final.total, 3);
    assert.strictEqual(final.reachedLimit, true);
    assert.strictEqual(data.member.user.boostercnt, 8);
    assert.strictEqual(c.awardDailyChatExperience(data, "user").total, 0);
    assert.strictEqual(data.member.user.boostercnt, 8);
    const restored = JSON.parse(JSON.stringify(data));
    assert.strictEqual(c.awardDailyChatExperience(restored, "user").reachedLimit, false, "재시작 후 안내 중복 금지");
    restored.member.user.chatExperienceDaily.experience = 499;
    restored.member.user.chatExperienceDaily.notified = false;
    const edge = c.awardDailyChatExperience(restored, "user");
    assert.strictEqual(edge.total, 1);
    assert.strictEqual(edge.boosterResult.usedBooster, 0, "지급 안 된 가호 추가분 미차감");
    assert.strictEqual(restored.member.user.boostercnt, 8);
    c.today = "20260928";
    assert.strictEqual(c.awardDailyChatExperience(restored, "user").total, 3, "다음 날 한도 재개");
    assert(c.buildDailyChatExperienceLimitMessage(data, {}, {}, "user").includes("500 / 500 EXP"));
    console.log("3/5 채팅 500 EXP 경계·가호·재시작 PASS");
}

function round4() {
    const c = baseContext();
    c.isAdminIdentity = user => user === "admin";
    c.isMasterIdentity = user => user === "master";
    c.isAdmin = user => user === "admin";
    c.isMaster = user => user === "master";
    c.isGlobalOperatorCommandAllowed = (user, msg) => user === "admin" && msg === "/정보";
    c.isMatzangOperatorCommandMessage = msg => msg === "/데이터상태" || msg === "/호여";
    load(c, main, ["isAttendanceFreeCommand", "isAttendanceGameCommand", "buildAttendanceRequiredMessage"]);
    assert(c.isAttendanceGameCommand("/펀치 1"));
    assert(c.isAttendanceGameCommand("ㅁㅁ"));
    assert(c.isAttendanceGameCommand("ㅍㅍㅍ"));
    assert(!c.isAttendanceGameCommand("안녕하세요"));
    assert(c.isAttendanceFreeCommand("ㅊㅊ", "user"));
    assert(c.isAttendanceFreeCommand("/소식", "user"));
    assert(!c.isAttendanceFreeCommand("/펀치 1", "user"));
    assert(c.isAttendanceFreeCommand("/출석알림 공지", "master"));
    assert(c.isAttendanceFreeCommand("/스타터중복확인", "master"));
    assert(!c.isAttendanceFreeCommand("/펀치 1", "admin"), "관리자 게임 명령도 출석 필요");
    assert(!c.isAttendanceFreeCommand("/호여", "admin"), "운영 명령 목록의 게임 명령 제외");
    assert(c.isAttendanceFreeCommand("/데이터상태", "admin"), "권한 있는 관리 명령 허용");
    assert(c.isAttendanceFreeCommand("/정보", "admin"), "전역 관리 명령 허용");
    assert(c.isAttendanceGameCommand("자유시장거래"));
    assert(c.isAttendanceGameCommand("이쁘다"));
    assert(c.buildAttendanceRequiredMessage({}, {}, {}, "user").includes("채팅창에 ㅊㅊ을 입력해주세요."));
    const infoContext = { isAdminIdentity: c.isAdminIdentity, isMasterIdentity: c.isMasterIdentity, isAdmin: c.isAdmin, isMaster: c.isMaster, isGlobalInfoCommandAllowed: (_user, msg) => msg === "/정보", isMatzangInfoOperatorCommandMessage: msg => msg === "/미출석" };
    load(infoContext, info, ["isInfoAttendanceFreeCommand"]);
    assert(!infoContext.isInfoAttendanceFreeCommand("/포인트", "user"));
    assert(infoContext.isInfoAttendanceFreeCommand("/소식", "user"));
    assert(!infoContext.isInfoAttendanceFreeCommand("/포인트", "admin"));
    assert(infoContext.isInfoAttendanceFreeCommand("/미출석", "admin"));
    assert(main.includes("!hasAttendedToday(data, sender) && isAttendanceGameCommand(msg)"));
    assert(info.includes("String(attendanceMember.recent || \"\") !== getInfoAttendanceKstDateKey()"));
    const attendanceEntry = main.search(/if \(msg === "ㅊㅊ"\) \{\s*var attendanceResult/);
    assert(attendanceEntry > 0 && attendanceEntry < main.indexOf('if (matzangField.active && !matzangField.resting'), "출석은 맞짱필드 제한보다 먼저 처리");
    assert(attendanceEntry < main.indexOf('if (msg.length > 3)'), "출석은 채팅 경험치보다 먼저 처리");
    let draws = 0;
    const newsContext = {
        ensureWorldNewsData: () => ({ posts: [] }), isAdmin: () => false, isMaster: () => false,
        getWorldNewsDraftKey: () => "draft", worldNewsDraftState: {}, sanitizeWorldNewsPickIds: () => false,
        drawWorldNewsReward: () => { draws++; return { point: 5, label: "5포인트", broadcast: false }; },
        buildWorldNewsUserMessage: (_data, _pet, _guild, _sender, lottery) => lottery.attendanceRequired ? "출석 후 참여" : "추첨 완료",
        markWorldNewsPostsRead: () => false
    };
    load(newsContext, main, ["processWorldNewsCommand"]);
    const newsData = { member: { user: { point: 0 } } };
    assert.strictEqual(newsContext.processWorldNewsCommand(newsData, {}, {}, "user", "room", "/소식", false).message, "출석 후 참여");
    assert.strictEqual(newsData.member.user.point, 0, "미출석 소식 열람 시 포인트 지급 금지");
    assert.strictEqual(draws, 0, "미출석 소식 열람 시 추첨 금지");
    newsContext.processWorldNewsCommand(newsData, {}, {}, "user", "room", "/소식", true);
    assert.strictEqual(newsData.member.user.point, 5, "출석 후 기존 소식복권 지급");
    console.log("4/5 출석 전 명령 차단·Info 응답 차단 PASS");
}

function round5() {
    const c = baseContext();
    const sent = [];
    c.privateChatBlockedTracker = {};
    c.Api = { replyRoom: (room, message) => sent.push({ room, message }) };
    c.room90 = "admin-room";
    c.getSupportPassDateValue = value => Number(value);
    c.getTodaySupportPassDateValue = () => 20260927;
    load(c, main, ["hasExpiredHoiPassForPrivateChat", "buildExpiredHoiPassPrivateChatMessage", "recordBlockedPrivateChatAttempt"]);
    const data = { member: { user: { pass: { hoi: { enabled: true, endDate: "20260926" } } } } };
    assert(c.hasExpiredHoiPassForPrivateChat(data, "user"));
    assert.strictEqual(c.recordBlockedPrivateChatAttempt("user-room", "user", "첫 시도"), false);
    assert.strictEqual(c.recordBlockedPrivateChatAttempt("user-room", "user", "두 번째"), false);
    assert.strictEqual(c.recordBlockedPrivateChatAttempt("user-room", "user", "세 번째"), true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].room, "admin-room");
    const userMessage = c.buildExpiredHoiPassPrivateChatMessage(data, {}, "user");
    assert(userMessage.includes("https://hoiland123.tistory.com/647"));
    assert(userMessage.includes("https://hoiland123.tistory.com/648"));
    assert(!userMessage.includes("누적 횟수"));
    assert(!c.hasExpiredHoiPassForPrivateChat({ member: { user: { pass: {} } } }, "user"));
    assert(main.includes("privateChatDetectionSent && hasExpiredHoiPassForPrivateChat(data, sender)"));
    console.log("5/5 호월톡 1:1 감지·만료 안내 PASS");
}

const rounds = { "1": round1, "2": round2, "3": round3, "4": round4, "5": round5 };
if (!rounds[process.argv[2]]) throw new Error("사용법: node tools/test_attendance_chat_pass.js [1-5]");
rounds[process.argv[2]]();
