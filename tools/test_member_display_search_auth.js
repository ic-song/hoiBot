const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");

// 기존 메모리 파일·실제 저장 트랜잭션 검증 하네스만 재사용하고 레이드 테스트는 실행하지 않는다.
const raidHarness = fs.readFileSync(path.join(__dirname, "test_server_raid.js"), "utf8");
const prefix = raidHarness.slice(0, raidHarness.indexOf('\ngroup("'));
const fixture = new Function("require", "__dirname", prefix + `
return { c, reset, read, write, block,
  traces: () => traces, replies: () => replies,
  clear: () => { traces = []; replies = []; },
  fail: () => { failWrite = () => true; },
  replyFail: v => { replyFailure = v; }
};`)(require, __dirname);
const c = fixture.c;
const block = fixture.block;
let groups = 0;
function pass(name, test) { fixture.reset(); test(); console.log("PASS " + (++groups) + ": " + name); }
for (const name of ["isAdmin", "isAdminIdentity", "formatDateTime", "normalizeSearchAuthenticationKeyword",
    "countSearchAuthenticationCharacters", "isSearchAuthenticationTarget", "isSearchAuthenticationCount",
    "applySearchAuthentication", "buildSearchAuthenticationManagementMessage", "buildSearchAuthenticationRankingMessage"]) {
    vm.runInContext(block(main, "function " + name + "("), c);
}
const authBranch = block(main, 'if (msg === "/검색인증" ||');
const legacyBranch = block(main, 'if (msg === "/인증" ||');
const managementBranch = block(main, 'if (msg === "/검색인증관리" ||');
const rankingBranch = block(main, 'if (msg === "/검색인증순위" ||');
vm.runInContext("function runAuthBranch(){" + authBranch + legacyBranch + managementBranch + rankingBranch + "}", c);

// 저장 위치와 권한은 실제 컨텍스트·저장 함수를 사용한다.
function runAuth(command, sender = "admin", room = "room90", dev = false) {
    fixture.clear();
    const ctx = c.createCommandContext(dev, room);
    const previous = c.enterCommandContext(ctx);
    c.beginDataSaveTransaction();
    const replier = c.replier;
    c.data = c.loadJsonFile(c.filePath); c.petData = {}; c.guildData = {};
    c.msg = command; c.sender = sender;
    c.replier = c.createContextReplier(replier, ctx);
    try { c.runAuthBranch(); }
    catch (e) { c.rollbackDataSaveTransaction(); throw e; }
    finally { c.replier = replier; c.endDataSaveTransaction(); c.exitCommandContext(previous); }
    return fixture.replies().join("\n");
}
function seed(names = ["신규 남"], dev = false) {
    const d = fixture.read(dev);
    d.member.admin.diamond = 738; d.member.admin.point = 123456; d.member.admin.moon = 9;
    d.member.admin.checkCnt = 99;
    for (const name of names) d.member[name] = { join: "20261009", agree: true, server: "호이서버6[2030]", point: 50, bag: {} };
    fixture.write(d, dev);
}
pass("공백 제거·성공 시 다이아만 +1·누적 기록·실제 단일 파일 저장", () => {
    seed(); const before = fixture.read();
    assert(runAuth("/검색인증 신규 남 30대 수다").includes("검색어: 30대수다"));
    const d = fixture.read();
    assert.strictEqual(d.member["신규 남"].voicecheck, 1);
    assert.strictEqual(d.member.admin.diamond, 739);
    assert.strictEqual(d.member.admin.point, before.member.admin.point);
    assert.strictEqual(d.member.admin.moon, 9);
    assert.strictEqual(d.member.admin.checkCnt, 99);
    assert.strictEqual(d.member.admin.searchAuthentication.count, 1);
    assert.strictEqual(d.member.admin.searchAuthentication.diamonds, 1);
    assert.strictEqual(d.member["신규 남"].searchAuthenticationRecord.operatorId, d.member.admin.searchAuthentication.id);
    assert.deepStrictEqual(d.searchAuthentication.keywords, [{ keyword: "30대수다", count: 1 }]);
    assert.strictEqual(fixture.traces().filter(t => t.type === "save" && t.path === c.filePath).length, 1);
    assert(fixture.traces().findIndex(t => t.type === "save") < fixture.traces().findIndex(t => t.type === "reply"));
});
pass("중복 인증·과거 완료·존재하지 않는 대상은 보상·집계 무변경", () => {
    seed(["신규 남", "과거 여"]); let d = fixture.read(); d.member["과거 여"].voicecheck = 1; fixture.write(d);
    runAuth("/검색인증 신규 남 수다");
    for (const cmd of ["/검색인증 신규 남 다른검색", "/검색인증 과거 여 지인소개", "/검색인증 미존재 남 수다"]) {
        const before = fixture.read(); assert(runAuth(cmd).includes("유저"));
        assert.deepStrictEqual(fixture.read(), before);
        assert(!fixture.traces().some(t => t.type === "save"));
    }
});
pass("공백만·누락·10/11글자·이모지 10/11글자 경계·미가입 대상 차단", () => {
    seed(["신규 남", "이모지 여", "미동의 남"]);
    let d = fixture.read(); d.member["미동의 남"].agree = false; fixture.write(d);
    for (const cmd of ["/검색인증", "/검색인증 신규 남", "/검색인증 신규 남 \t\n", "/검색인증 신규 남 12345678901",
        "/검색인증 이모지 여 " + "😀".repeat(11), "/검색인증 미동의 남 수다"]) {
        const before = fixture.read(); runAuth(cmd); assert.deepStrictEqual(fixture.read(), before);
    }
    assert(runAuth("/검색인증 신규 남 1 2 3 4 5 6 7 8 9 0").includes("1234567890"));
    assert(runAuth("/검색인증 이모지 여 " + "😀".repeat(10)).includes("완료"));
});
pass("같은 공백 제거값만 합산·지인소개 포함·동의어 별도 집계·특수 키 안전", () => {
    seed(["첫째 남", "둘째 여", "셋째 남", "넷째 여", "다섯 남", "여섯 여", "일곱 남"]);
    const keywords = ["지인소개", "지인 소개", "지 인 소 개", "보룸", "보이스 룸", "__proto__", "수다"];
    ["첫째 남", "둘째 여", "셋째 남", "넷째 여", "다섯 남", "여섯 여", "일곱 남"].forEach((name, i) => runAuth("/검색인증 " + name + " " + keywords[i]));
    const d = fixture.read(); assert.strictEqual(d.searchAuthentication.keywords.find(r => r.keyword === "지인소개").count, 3);
    assert.strictEqual(d.searchAuthentication.keywords.length, 5);
    assert.strictEqual(d.member.admin.diamond, 745);
});
pass("기존 관리자 방 권한 재사용·일반 사용자 및 다른 방 관리자 무변경", () => {
    seed();
    for (const [user, room] of [["a", "room90"], ["admin", "room1"], ["master", "room90"]]) {
        const before = fixture.read(); assert(runAuth("/검색인증 신규 남 수다", user, room).includes("관리자"));
        assert.deepStrictEqual(fixture.read(), before);
    }
    assert(runAuth("/검색인증 신규 남 수다", "admin", "test").includes("완료"));
});
pass("구 명령은 안내/조회 연결·구 포인트/샵 보상 경로 제거·접미 미실행", () => {
    seed();
    for (const cmd of ["/인증 신규 남", "/보룸인증 신규 남", "/가입 신규 남"]) {
        const before = fixture.read(); assert(runAuth(cmd).includes("/검색인증")); assert.deepStrictEqual(fixture.read(), before);
    }
    for (const cmd of ["/검색인증순위 1", "/검색인증관리 해봐", "/검색인증관리순위 대상"]) {
        const before = fixture.read(); assert.strictEqual(runAuth(cmd), ""); assert.deepStrictEqual(fixture.read(), before);
    }
    assert.strictEqual(runAuth("/가입인증"), runAuth("/검색인증관리"));
    assert.strictEqual(runAuth("/인증순위"), runAuth("/검색인증관리순위"));
    assert(runAuth("/인증필요", "admin", "room1").includes("미인증목록"));
    assert(!authBranch.includes("5000000") && !authBranch.includes("checkCnt"));
});
pass("관리 안내 유지·빈 목록 ALLSEE 없음·목록 시작부터 ALLSEE", () => {
    seed(); let output = runAuth("/검색인증관리");
    assert(output.indexOf("<ALLSEE>") < output.indexOf("📋 미인증목록 펼쳐보기"));
    assert(output.indexOf("/검색인증 마치 남") < output.indexOf("<ALLSEE>"));
    assert(output.includes("호이서버6[30]"));
    runAuth("/검색인증 신규 남 수다"); output = runAuth("/검색인증관리");
    assert(output.includes("검색 미인증 유저가 없습니다.")); assert(!output.includes("<ALLSEE>"));
});
pass("검색어 5/6개·관리자 3/4명 접기·기존 실적 제외·설명 위치", () => {
    seed(); assert(runAuth("/검색인증순위").includes("아직 등록된"));
    assert(runAuth("/검색인증관리순위").includes("아직 검색인증 처리 기록"));
    let d = fixture.read(); d.searchAuthentication = { keywords: Array.from({ length: 6 }, (_, i) => ({ keyword: "검색" + i, count: 10 - i })) };
    for (let i = 0; i < 4; i++) d.member["담당" + i + " 남"] = { server: "호이서버6[30]", searchAuthentication: { count: 10 - i, diamonds: 10 - i } };
    fixture.write(d);
    let out = runAuth("/검색인증순위"); assert(out.indexOf("<ALLSEE>") > out.indexOf("5등") && out.indexOf("<ALLSEE>") < out.indexOf("6등"));
    out = runAuth("/검색인증관리순위"); assert(out.indexOf("<ALLSEE>") > out.indexOf("3등") && out.indexOf("<ALLSEE>") < out.indexOf("4등"));
    assert(out.indexOf("누적 검색인증") < out.indexOf("1등")); assert(!out.includes("99명"));
    d.searchAuthentication.keywords.pop(); delete d.member["담당3 남"]; fixture.write(d);
    assert(!runAuth("/검색인증순위").includes("<ALLSEE>")); assert(!runAuth("/검색인증관리순위").includes("<ALLSEE>"));
});
pass("다이아 사용·관리자/대상 닉변·재시작 후 누적과 중복 방지 유지", () => {
    seed(["신규 남", "신규 여"]); runAuth("/검색인증 신규 남 수다");
    let d = fixture.read(); const id = d.member.admin.searchAuthentication.id;
    d.member.admin.diamond -= 10; d.member.renamed = d.member.admin; delete d.member.admin;
    d.member["변경 남"] = d.member["신규 남"]; delete d.member["신규 남"]; fixture.write(d);
    c.Admins = ["renamed"];
    assert(runAuth("/검색인증 변경 남 수다", "renamed").includes("이미"));
    runAuth("/검색인증 신규 여 수다", "renamed");
    d = fixture.read(); assert.strictEqual(d.member.renamed.searchAuthentication.id, id);
    assert.strictEqual(d.member.renamed.searchAuthentication.diamonds, 2); assert.strictEqual(d.member.renamed.diamond, 730);
    assert(runAuth("/검색인증관리순위", "renamed").includes("renamed · 2명"));
    c.Admins = ["admin"];
});
pass("저장 교체 실패 후 전액 미반영·재시도 한 번·DEV 운영 분리", () => {
    seed(); const before = fixture.read(); fixture.fail();
    assert.throws(() => runAuth("/검색인증 신규 남 수다")); assert.deepStrictEqual(fixture.read(), before);
    runAuth("/검색인증 신규 남 수다"); assert.strictEqual(fixture.read().member.admin.diamond, 739);
    seed(["개발 남"], true); const prod = fixture.read();
    assert(runAuth("/검색인증 개발 남 지인 소개", "admin", "test", true).startsWith("[DEV 테스트환경]"));
    assert.deepStrictEqual(fixture.read(), prod); assert.strictEqual(fixture.read(true).member.admin.diamond, 739);
});
pass("손상 재화·안전정수 초과·응답 실패 시 트랜잭션 복구", () => {
    for (const value of ["738", -1, 0.5, 9007199254740991]) {
        seed(); let d = fixture.read(); d.member.admin.diamond = value; fixture.write(d);
        assert.throws(() => runAuth("/검색인증 신규 남 수다")); assert.strictEqual(fixture.read().member["신규 남"].voicecheck, undefined);
    }
    seed(); const before = fixture.read(); fixture.replyFail(true);
    assert.throws(() => runAuth("/검색인증 신규 남 수다")); fixture.replyFail(false);
    assert.deepStrictEqual(fixture.read(), before);
});

// 실제 닉네임 함수는 전체 매력 계산·홈 IO 없이 기존 표시만 구성해야 한다.
function rankContext(source) {
    const state = {};
    const r = { allsee: "<ALLSEE>", getCurrentContext: () => state, numberWithCommas: n => String(n),
        getMyGuildInfo: () => null, getGuildMasterRankEmoji: () => "", getCheckRankTierEmoji: () => "🌱",
        getVisibleRankEmoji: (_d, _u, e) => e, getRankEmoji: n => String(n), getHoiPassPremiumHeader: () => "",
        loadJsonFile: () => { throw Error("닉네임 표시에서 파일 IO 금지"); },
        calculateCastleExp: (u, d) => { r.calls++; return d.member[u].score || 0; },
        calculateRaidExp: () => 0, calculatePetUpgradeCharm: () => 0, calls: 0 };
    for (let i = 1; i <= 100; i++) r["room" + i] = "room" + i;
    r.testRoom = "test";
    vm.createContext(r);
    vm.runInContext(block(source, "const GLOBAL_CONFIG = {") + ";this.GLOBAL_CONFIG=GLOBAL_CONFIG;", r);
    for (const name of ["checkRank", "formatNicknameRankMessage"]) vm.runInContext(block(source, "function " + name + "("), r);
    return { r, state };
}
for (const [label, source] of [["Main", main], ["Info", info]]) pass(label + " 닉네임 자동 순위 제거·반복 출력 전체계산0회·기존 무쌍/숨김 데이터 유지", () => {
    const { r, state } = rankContext(source); const d = { member: {} }, pets = {}, guild = {};
    for (let i = 1; i <= 101; i++) { const u = "계정" + i + " 남"; d.member[u] = { score: 102 - i, displaySettings:{hideWorldRank:i%2===0} }; pets[u] = {}; }
    state.nicknameRanks = { load: () => { throw Error("제거한 표시 전용 순위 계산 실행"); } };
    const display = u => r.formatNicknameRankMessage("[" + r.checkRank(d, pets, guild, u) + "]");
    const before=JSON.stringify(d);
    for(let pass=0;pass<5;pass++)for(const u of Object.keys(d.member)) assert.strictEqual(display(u),"[🌱"+u+"]");
    assert.strictEqual(r.calls,0);assert.strictEqual(JSON.stringify(d),before);
    d.petMusou = { currentChampion: { user: "계정1 남", expiresAt: Date.now() + 100000 } };
    assert.strictEqual(display("계정1 남"), "[무쌍⚔️][🌱계정1 남]");
    d.petMusou.currentChampion.expiresAt=0;assert.strictEqual(display("계정1 남"),"[🌱계정1 남]");
    d.member["변경 남"]=d.member["계정1 남"];delete d.member["계정1 남"];
    assert.strictEqual(display("변경 남"),"[🌱변경 남]");assert.strictEqual(r.calls,0);
});
pass("실제 월드·서버 순위와 매력·동률·무쌍 및 기존 목록 생성 유지", () => {
    const { r } = rankContext(info);
    for (const name of ["buildNicknameWorldRanks", "generateRanking", "formatOverallRankPosition", "formatOverallUserRow", "formatRankNickname", "buildWorldOverallRankingMessage"])
        vm.runInContext(block(info, "function " + name + "("), r);
    const d={member:{"첫째 남":{score:100},"둘째 여":{score:90,displaySettings:{hideWorldRank:true}},"셋째 남":{score:90},"펫없는 여":{score:999}}},pets={"첫째 남":{},"둘째 여":{},"셋째 남":{}},guild={};
    const orig=r.checkRank;let formats=0;r.checkRank=(...args)=>{formats++;return orig(...args);};
    const rankResult=r.generateRanking(d,pets,{}, {},guild),rows=rankResult.rows;
    assert.strictEqual(formats,4);assert.strictEqual(r.calls,3);
    assert(rankResult.rankingMsg1.includes("첫째 남")&&typeof rankResult.rankingMsg2==="string");
    assert.deepStrictEqual(Array.from(rows,x=>[x.key,x.totalExp]),[["첫째 남",100],["둘째 여",90],["셋째 남",90],["펫없는 여",0]]);
    d.petMusou={currentChampion:{user:"첫째 남",expiresAt:Date.now()+100000}};
    const out=r.formatNicknameRankMessage(r.buildWorldOverallRankingMessage(rows,"둘째 여",d,pets,guild));
    assert(out.includes("월드 순위: 2위")&&out.includes("종합매력: 90"));
    assert(out.includes("종합매력💞 +11 필요해요!")&&out.includes("[무쌍⚔️][🌱첫째 남]"));
    assert(!out.includes("/순위감추기")&&!/\[\d+등\]/.test(out));assert.strictEqual(r.calls,3);
    assert(out.indexOf("🎯 한 단계")<out.indexOf("🥇"));assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);
});
pass("100·1000·5000명 기존 순위 집계·전체 목록 보존·닉네임 출력 중 재집계0회", () => {
    for(const count of [100,1000,5000]){
        const {r}=rankContext(info);for(const name of ["buildNicknameWorldRanks","generateRanking","formatOverallRankPosition","formatOverallUserRow","formatRankNickname","buildWorldOverallRankingMessage"]) vm.runInContext(block(info,"function "+name+"("),r);
        const d={member:{}},pets={},guild={};for(let i=1;i<=count;i++){const u="계정"+i;d.member[u]={score:count-i+1};pets[u]={};}
        let formats=0;const original=r.checkRank;r.checkRank=(...args)=>{formats++;return original(...args);};
        const rows=r.generateRanking(d,pets,{}, {},guild).rows;assert.strictEqual(r.calls,count);assert.strictEqual(formats,count);
        const out=r.buildWorldOverallRankingMessage(rows,"계정"+count,d,pets,guild);
        assert.strictEqual(r.calls,count);assert.strictEqual(formats,count*2+2);assert(out.includes("월드 순위: "+count+"위"));
    }
});
pass("실제 정보 분기에서 기존 인증 상태 보존·완료/미완료 명칭 출력", () => {
    const output = [], r = { msg: "/정보 신규 남", sender: "호이 남", data: { member: { "신규 남": { join: "20261009", lv: 1, exp: 0, like: 0, diamond: 0, point: 0, bag: {} } } },
        petData: {}, guildData: {}, titleData: { member: {} }, isAdminIdentity: () => true, isMasterIdentity: () => false,
        getInfoLevelRequiredExperience: () => 100, getTitle: () => "", generateBagOutput: () => ({ bagOutput: "" }), getMyGuildInfo: () => null,
        checkRank: (_d, _p, _g, u) => u, getInfoAdventureLevelTitle: () => "", formatDate: s => s, numberWithCommas: n => String(n),
        formatInfoAdventureExperience: n => String(n), formatInfoServerRaidServer: () => "", allsee: "<ALLSEE>", replier: { reply: s => output.push(s) } };
    vm.createContext(r); vm.runInContext("function runInfo(){" + block(info, 'if (msg.startsWith("/정보") &&') + "}", r);
    r.runInfo(); assert(output.pop().includes("• 검색인증: 미완료"));
    r.data.member["신규 남"].voicecheck = 1; r.runInfo(); assert(output.pop().includes("• 검색인증: 완료"));
    assert(!info.includes("• 보룸인증:"));
});
pass("표시 전용 명령·로더 제거 및 DEV/운영 저장 분리 유지", () => {
    for(const source of [main,info]){
        assert(!source.includes("nicknameRanks")&&!source.includes("getNicknameWorldRank")&&!source.includes("hideWorldRank"));
        assert(!source.includes("/순위감추기"));
    }
    const prev=c.enterCommandContext(c.createCommandContext(true,"test"));
    try{const before=fixture.read();const d=c.loadJsonFile(c.filePath);d.member.admin.point+=1;c.saveJsonFile(d,c.filePath);assert.deepStrictEqual(fixture.read(),before);assert.strictEqual(fixture.read(true).member.admin.point,d.member.admin.point);}
    finally{c.exitCommandContext(prev);}
});
console.log("검색인증·닉네임 순위 표시 제거 " + groups + "개 검증 그룹 통과 (합성 데이터·실제 명령 분기·실제 저장/복구 함수)");
