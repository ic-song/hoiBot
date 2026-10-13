const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
const harness=fs.readFileSync(path.join(__dirname,"test_doll_content.js"),"utf8");
const prefix=harness.slice(0,harness.indexOf('\ntest("'));
const {c,fixture,block}=new Function("require","__dirname",prefix+"\nreturn {c,fixture,block};")(require,__dirname);
for(const name of ["parseJsonContent","isDollTestRoomCommand","buildDollTestRoomRestrictionMessage","checkRank","getMyGuildId","getMyGuildInfo","getTierEmojiForMember","getCheckRankTierEmoji","getVisibleRankEmoji","getGuildMasterRankEmoji"])
    vm.runInContext(block(main,"function "+name+"("),c);
c.testRoom="팻 테스트방";c.GLOBAL_CONFIG.doll.allowedRoom=c.testRoom;
assert(main.includes('const testRoom = "팻 테스트방";'));
assert(main.includes("allowedRoom: testRoom"));
const start=main.indexOf("function response("),end=main.indexOf("// 서버 레이드대전 진입:",start);
assert(start>0&&end>start);
// 실제 response 진입부를 그대로 실행하고 허용 분기 뒤의 게임 처리는 기존 인형 테스트에 맡긴다.
vm.runInContext(main.slice(start,end).replace("function response(","function probeRoom(")+`return "allowed";
} finally {
 if(commandContextEntered)exitCommandContext(prevCtx);
 if(dataSaveTransactionEntered)endDataSaveTransaction();
 if(responseTransactionAcquired)dataTransactionLock.unlock();
 responseDataLock.unlock();
}}`,c);
c.getResponseDataFlowLock=()=>({lock(){},unlock(){}});
c.isRapidUserRequest=()=>{throw Error("차단 입력은 요청 기록을 갱신하면 안 됨");};
c.saveJsonFile=()=>{throw Error("차단 입력은 저장하면 안 됨");};
c.loadJsonFile=()=>{throw Error("차단 입력은 복구 가능한 로드를 하면 안 됨");};
const root="/sdcard/호이랜드/",devRoot="/sdcard/호이랜드_dev/";
const commands=["/인형뽑기","/인형도감","/인형도감 일반1","/인형도감 고급2","/인형도감 창조","/인형도감 창조1","/인형도감 오입력","/인형순위","/인형가이드","/인형전체초기화","/인형패스추가, u 영구권","/인형패스삭제, u"];
let groups=0;
function test(name,fn){fixture.reset();for(const base of [root,devRoot]){
 fixture.put(base+"member.json",{member:{u:{point:300000000,bag:{ticket:2},today:1,rank:{tier:"킹"}},admin:{},master:{}}});
 fixture.put(base+"guild.json",{guilds:{}});
}fn();console.log("PASS "+(++groups)+": "+name);}
function run(room,msg,user="u"){fixture.clear();return c.probeRoom(room,msg,user,true,c.replier,null,"com.kakao.talk");}
test("모든 인형 조회·등급·페이지·관리 입력의 다른 방 차단",()=>{
 const before=fixture.raw(root+"member.json");for(const msg of commands){assert.strictEqual(run("일반방",msg),undefined);
 assert(fixture.replies().join("").includes("팻 테스트방’에서만"));assert.strictEqual(fixture.raw(root+"member.json"),before);assert(!fixture.traces().some(t=>t.type==="save"));}
});
test("관리자·MASTER·미가입·개인톡에도 방 우회 없음",()=>{
 for(const user of ["u","admin","master","미가입"]){for(const room of ["관리자방","개인톡"]){run(room,"/인형뽑기",user);assert(fixture.replies().join("").includes(user));assert(fixture.replies().join("").includes("테스트 중"));}}
});
test("방 제목 정확 일치·공백/접미/유사명 차단",()=>{
 assert.strictEqual(run("팻 테스트방","/인형뽑기"),"allowed");assert.strictEqual(fixture.replies().length,0);
 for(const room of ["팻테스트방"," 팻 테스트방","팻 테스트방 ","팻 테스트방2","팻 테스트방\n"]){run(room,"/인형가이드");assert(fixture.replies().join("").includes("테스트 중"));}
});
test("DEV 정규화·전용 경로 조회와 문맥 복원",()=>{
 const dev=JSON.parse(fixture.raw(devRoot+"member.json"));dev.toplv="u";fixture.put(devRoot+"member.json",dev);
 run("일반방","dev/인형뽑기");assert(fixture.replies().join("").includes("🌟u"));assert(fixture.replies().join("").includes("[DEV 테스트환경]"));
 assert.strictEqual(c.commandContextThreadLocal.get(),null);
 assert.strictEqual(run("팻 테스트방","dev/인형도감 일반2"),"allowed");
});
test("차단 안내는 인형 목록·복구 파일 없는 상태에도 표시",()=>{
 for(const name of ["dollCatalog.json","dollIndex.json","dollPending.json"])fixture.remove(root+name);
 const reads=[],original=c.FileStream.read;c.FileStream.read=p=>{reads.push(p);return original(p);};
 try{run("다른방","/인형뽑기");assert.deepStrictEqual(reads,[root+"member.json",root+"guild.json"]);}finally{c.FileStream.read=original;}
 const guard=main.indexOf("if (isDollTestRoomCommand(msg)");assert(guard<main.indexOf("var dollPending = loadJsonFile",start));assert(guard<main.indexOf("isRapidUserRequest(sender)",start));
});
test("잘못된 길드·성주 길드 표시가 회원 저장을 유발하지 않음",()=>{
 const d=JSON.parse(fixture.raw(root+"member.json"));d.member.u.guild={id:"gone"};d.HoiCastle={lord:"master"};d.member.master.guild={id:"mismatch"};
 fixture.put(root+"member.json",d);fixture.put(root+"guild.json",{guilds:{mismatch:{members:{}}}});
 const before=fixture.raw(root+"member.json");run("다른방","/인형도감");assert(fixture.replies().join("").includes("👑u"));assert.strictEqual(fixture.raw(root+"member.json"),before);
});
test("정상 길드·순위 표시와 읽기전용 원본 유지",()=>{
 const d={member:{u:{guild:{id:"g"},rank:{tier:"킹"}},lord:{guild:{id:"g"}}},HoiCastle:{lord:"lord"}};
 const guilds={guilds:{g:{rank:0,members:{u:{},lord:{}}}}};const before=JSON.stringify([d,guilds]);
 assert(c.buildDollTestRoomRestrictionMessage(d,guilds,"u").includes("🏰u"));assert.strictEqual(JSON.stringify([d,guilds]),before);
});
test("다른 명령·실행형 접미는 방 제한 대상으로 오인하지 않음",()=>{
 for(const msg of ["/티어","/가방","/인형뽑기 2","/인형순위 1","/인형가이드설명","/인형전체초기화 확인"]){assert(!c.isDollTestRoomCommand(msg));assert.strictEqual(run("다른방",msg),"allowed");}
});
console.log("인형 테스트방 제한 "+groups+"개 그룹 통과");
