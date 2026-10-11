const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
// 기존 실제 명령·저장/복구 하네스를 새 기획의 정책 검증에 재사용한다.
const harness = fs.readFileSync(path.join(__dirname, "test_member_display_search_auth.js"), "utf8");
const f = new Function("require", "__dirname", harness.slice(0, harness.indexOf('\npass("')) + `
return {c,fixture,runAuth,seed,pass,lightPath,devLightPath,block};`)(require, __dirname);
const { c, fixture, runAuth, seed, pass, lightPath, devLightPath, block } = f;
let groups = 0;
function test(name, fn) { pass(name, () => { fn(); groups++; }); }
function putLight(users, dev = false) { fixture.put(dev ? devLightPath : lightPath, { users }); }
function withRoom(room, fn) { const prev = c.enterCommandContext(c.createCommandContext(false, room)); try { return fn(); } finally { c.exitCommandContext(prev); } }
for (const name of ["isServerAdminRoomOperator", "isPetMusouOperator", "isPetMusouAllowedDuringTournamentCommand", "isPetMusouBlockedDuringTournamentCommand", "isGuildTerritoryAllowedDuringWarCommand", "isGuildTerritoryBlockedDuringWarCommand"]) vm.runInContext(block(main, "function " + name + "("), c);
c.isGuildTerritoryRiftControlCommandMessage = () => false;

test("새 명령 실제 분기·모든 방의 관리자·MASTER 기존 역할 분리", () => {
    seed();
    for (const room of ["room1", "room8", "room90", "test", "private"]) {
        assert(runAuth("/검색인증", "admin", room).includes("미인증목록"));
        assert(runAuth("/인증순위", "master", room).includes("검색 순위"));
        assert(runAuth("/관리자순위", "master", room).includes("관리자 순위"));
    }
    const before = fixture.read();
    for (const [msg,user] of [["/인증 신규 남 수다","a"],["/검색인증","a"],["/인증 신규 남 수다","master"],["/관리자순위초기화","admin"],["/인증초기화","admin"]]) {
        assert(runAuth(msg,user,"room1").includes("만 사용할")); assert.deepStrictEqual(fixture.read(),before);
    }
    assert(runAuth("/인증 신규 남 수다", "admin", "room1").includes("호월신의 가호✨(/호여 숫자) 30개"));
});

test("과거 다이아 실적·보유 재화 보존·가호30 신규 누계·중복 인증 무지급", () => {
    seed(); let d = fixture.read();
    d.member.admin.searchAuthentication = { id: "stable-admin", count: 8, diamonds: 8 }; fixture.write(d);
    runAuth("/인증 신규 남 수다"); d = fixture.read();
    assert.strictEqual(d.member.admin.diamond,738); assert.strictEqual(d.member.admin.point,123456);
    assert.strictEqual(d.member.admin.boostercnt,768);
    assert.deepStrictEqual(d.member.admin.searchAuthentication,{id:"stable-admin",count:9,diamonds:8,boosters:30});
    const before=fixture.read(); runAuth("/인증 신규 남 수다"); assert.deepStrictEqual(fixture.read(),before);
    const out=runAuth("/관리자순위"); assert(out.includes("이전 다이아 보상: 💎8개")); assert(out.includes("누적 가호 보상: ✨30개"));
});

function seedBulk(dev=false) {
    seed(["신규 남", "중복 여", "완료 남"],dev);
    let d=fixture.read(dev); d.member["완료 남"].voicecheck=1;
    d.member["완료 남"].searchAuthenticationRecord={keyword:"지인소개",operator:"old"};
    d.member.admin.searchAuthentication={id:"old-admin",count:7,diamonds:7,boosters:60};
    d.member["신규 남"].checkCnt=99; fixture.write(d,dev);
    putLight({"미가입 여":{cnt:0,recent:"",today:0},"중복 여":{cnt:1,recent:"20261011",today:0},"완료 여":{cnt:1,recent:"20261011",today:0,voicecheck:1,searchAuthenticationRecord:{keyword:"보룸"}}},dev);
}

test("가입·미가입·중복 아이디 일괄 인증·기존 완료 사유와 재화/실적 보존", () => {
    seedBulk(); const before=fixture.read(), lightBefore=fixture.get(lightPath);
    assert(runAuth("/인증초기화","master","room1").includes("처리된 유저: 3명"));
    const d=fixture.read(), light=fixture.get(lightPath);
    assert.strictEqual(d.member["신규 남"].voicecheck,1); assert.strictEqual(d.member["중복 여"].voicecheck,1);
    assert.strictEqual(light.users["미가입 여"].voicecheck,1);
    assert.strictEqual(d.member["신규 남"].searchAuthenticationRecord.keyword,"기타");
    assert.strictEqual(d.member["신규 남"].searchAuthenticationRecord.bulk,true);
    assert.deepStrictEqual(d.member["완료 남"],before.member["완료 남"]);
    assert.deepStrictEqual(light.users["완료 여"],lightBefore.users["완료 여"]);
    assert.deepStrictEqual(d.member.admin,before.member.admin); assert.deepStrictEqual(d.member.master,before.member.master);
    assert.strictEqual(d.member["신규 남"].checkCnt,99);
    assert.deepStrictEqual(d.searchAuthentication.keywords,[{keyword:"기타",count:3}]);
    assert(!runAuth("/검색인증").includes("1. ["));
    const after=fixture.read(), afterLight=fixture.get(lightPath);
    assert(runAuth("/인증초기화","master").includes("처리된 유저: 0명"));
    assert.deepStrictEqual(fixture.read(),after); assert.deepStrictEqual(fixture.get(lightPath),afterLight);
    assert(!fixture.traces().some(t=>t.type==="save"));
});

test("일괄 인증 두 파일의 첫/후속 저장 실패와 응답 실패 전액 복구·재시도", () => {
    for(const failed of [lightPath,c.filePath,"reply"]) {
        fixture.reset(); seedBulk(); const before=fixture.read(), light=fixture.get(lightPath);
        if(failed==="reply")fixture.replyFail(true);else fixture.failPath(failed);
        assert.throws(()=>runAuth("/인증초기화","master","room1")); fixture.replyFail(false);
        assert.deepStrictEqual(fixture.read(),before); assert.deepStrictEqual(fixture.get(lightPath),light);
        assert(runAuth("/인증초기화","master").includes("처리된 유저: 3명"));
        assert.strictEqual(fixture.read().searchAuthentication.keywords[0].count,3);
    }
});

test("일괄 인증 손상 파일·집계 정수 초과는 미인증 상태 유지", () => {
    seedBulk(); const before=fixture.read(); fixture.corrupt(lightPath);
    assert.throws(()=>runAuth("/인증초기화","master")); assert.deepStrictEqual(fixture.read(),before);
    for(const count of [-1,"1",0.5,9007199254740991]) {
        seedBulk(); let d=fixture.read();d.searchAuthentication={keywords:[{keyword:"기타",count}]};fixture.write(d);
        const saved=fixture.read(), light=fixture.get(lightPath);
        assert.throws(()=>runAuth("/인증초기화","master"));assert.deepStrictEqual(fixture.read(),saved);assert.deepStrictEqual(fixture.get(lightPath),light);
    }
});

test("관리자 실적 초기화는 실적만 변경·식별값/기존 인증/검색어/보유 재화 유지", () => {
    seedBulk(); let d=fixture.read(); d.searchAuthentication={keywords:[{keyword:"수다",count:8}]}; fixture.write(d);
    const before=fixture.read(); const light=fixture.get(lightPath);
    assert(runAuth("/관리자순위초기화","master","room1").includes("처리된 관리자: 1명"));
    d=fixture.read();assert.deepStrictEqual(d.member.admin.searchAuthentication,{id:"old-admin",count:0,diamonds:0,boosters:0});
    for(const key of ["diamond","boostercnt","point","checkCnt"]) assert.strictEqual(d.member.admin[key],before.member.admin[key]);
    assert.deepStrictEqual(d.member["완료 남"],before.member["완료 남"]);assert.deepStrictEqual(d.searchAuthentication,before.searchAuthentication);
    assert.deepStrictEqual(fixture.get(lightPath),light);
    assert(runAuth("/관리자순위초기화","master").includes("처리된 관리자: 0명"));
    assert(!fixture.traces().some(t=>t.type==="save"));
    runAuth("/인증 신규 남 수다","admin"); assert.strictEqual(fixture.read().member.admin.searchAuthentication.id,"old-admin");
    assert.strictEqual(fixture.read().member.admin.searchAuthentication.count,1);
});

test("실적 초기화 저장 실패·손상 실적 사전 검사로 부분 변경 없음", () => {
    seedBulk(); const before=fixture.read();fixture.failPath(c.filePath);
    assert.throws(()=>runAuth("/관리자순위초기화","master")); assert.deepStrictEqual(fixture.read(),before);
    const d=fixture.read();d.member.b.searchAuthentication={count:-1,diamonds:0};
    const saved=JSON.stringify(d);assert.throws(()=>c.resetSearchAuthenticationAdminStats(d));assert.strictEqual(JSON.stringify(d),saved);
});

test("호이 남 최고/동률/0 실적 모두 하단·기타 하단·10/11행 ALLSEE", () => {
    seed();let d=fixture.read();d.member["호이 남"]={searchAuthentication:{count:100,diamonds:100},server:"호이서버1[30]"};
    for(let i=0;i<10;i++)d.member["담당"+i+" 여"]={searchAuthentication:{count:10-i,diamonds:0,boosters:30}};
    d.searchAuthentication={keywords:[{keyword:"기타",count:100},{keyword:"수다",count:1}]};fixture.write(d);
    let out=runAuth("/관리자순위");assert(out.includes("11등 호이 남 · 100명"));assert(out.indexOf("<ALLSEE>")<out.indexOf("호이 남"));
    out=runAuth("/인증순위");assert(out.indexOf("수다")<out.indexOf("기타"));
    d.member["호이 남"].searchAuthentication.count=10;fixture.write(d);
    assert(runAuth("/관리자순위").includes("11등 호이 남 · 10명"));
    d.member["호이 남"].searchAuthentication.count=0;fixture.write(d);
    assert(runAuth("/관리자순위").includes("11등 호이 남 · 0명"));
});

test("6개 명령은 대전 잠금 예외·역할 유지·변경 3종은 단독 쓰기 잠금", () => {
    const adminCommands=["/인증 신규 남 수다","/검색인증","/인증순위","/관리자순위"], masterCommands=["/관리자순위초기화","/인증초기화"];
    for(const room of ["room1","room8","test","private"]) withRoom(room,()=>{
        for(const msg of adminCommands){assert(c.isGlobalOperatorCommandAllowed("admin",msg));assert(!c.isGlobalOperatorCommandAllowed("a",msg));}
        for(const msg of masterCommands){assert(c.isGlobalOperatorCommandAllowed("master",msg));assert(!c.isGlobalOperatorCommandAllowed("admin",msg));}
        for(const msg of adminCommands.concat(masterCommands)) {
            const user=masterCommands.includes(msg)?"master":"admin";
            assert(c.isServerRaidAdditionalCommand(msg));
            assert(!c.isPetMusouBlockedDuringTournamentCommand({active:true,startReady:true},msg,user));
            assert(!(c.isGuildTerritoryBlockedDuringWarCommand(msg)&&!c.isGlobalOperatorCommandAllowed(user,msg)));
        }
    });
    for(const msg of ["/인증 신규 남 수다","/관리자순위초기화","/인증초기화"])assert(c.isExclusiveDataMutationCommandMessage(msg));
    for(const msg of ["/관리자순위초기화 확인","/인증초기화 1","/관리자순위 대상","/인증순위 1","/검색인증 목록"]) {
        const before=fixture.read();assert.strictEqual(runAuth(msg,"master"),"");assert.deepStrictEqual(fixture.read(),before);
        assert(!c.isGlobalOperatorCommandAllowed("master",msg));assert(!c.isServerRaidAdditionalCommand(msg));
    }
});

test("일괄 인증된 미가입 유저의 가입 이전은 재보상·재집계 없음", () => {
    seedBulk();runAuth("/인증초기화","master");
    const d=fixture.read(),light=fixture.get(lightPath),stats=JSON.stringify(d.member.admin.searchAuthentication),keywords=JSON.stringify(d.searchAuthentication);
    d.member["미가입 여"]={bag:{},boostercnt:0};
    assert(c.migrateLightSearchAuthenticationToMember(d,light,"미가입 여"));
    assert.strictEqual(d.member["미가입 여"].voicecheck,1);assert.strictEqual(d.member["미가입 여"].searchAuthenticationRecord.bulk,true);
    assert(!c.migrateLightSearchAuthenticationToMember(d,light,"미가입 여"));
    assert.strictEqual(JSON.stringify(d.member.admin.searchAuthentication),stats);assert.strictEqual(JSON.stringify(d.searchAuthentication),keywords);
    assert.strictEqual(d.member["미가입 여"].boostercnt,0);
});

test("DEV 일괄 인증·관리자 초기화는 DEV 두 저장소만 변경", () => {
    seedBulk(true);const before=fixture.read(),light=fixture.get(lightPath);
    assert(runAuth("/인증초기화","master","test",true).startsWith("[DEV 테스트환경]"));
    assert.strictEqual(fixture.get(devLightPath).users["미가입 여"].voicecheck,1);
    runAuth("/관리자순위초기화","master","test",true);
    assert.strictEqual(fixture.read(true).member.admin.searchAuthentication.count,0);
    assert.deepStrictEqual(fixture.read(),before);assert.deepStrictEqual(fixture.get(lightPath),light);
});

console.log("검색인증 수정요청서 신규 " + groups + "개 검증 그룹 통과");
