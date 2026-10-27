const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm"),cp=require("child_process");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8").replace(/\r\n/g,"\n");
const info=fs.readFileSync(path.join(__dirname,"..","Info.js"),"utf8").replace(/\r\n/g,"\n");
const harness=fs.readFileSync(path.join(__dirname,"test_server_raid.js"),"utf8");
const h=new Function("require","__dirname",harness.slice(0,harness.indexOf('\ngroup("'))+`
return {c,block,reset,read,write,run,start,tick,
 put:(p,v)=>{disk[c.resolveActiveDataPath(p)]=JSON.stringify(v);},raw:p=>disk[c.resolveActiveDataPath(p)],
 get:p=>JSON.parse(disk[c.resolveActiveDataPath(p)]),fail:fn=>{failWrite=fn;},
 persist:()=>clone(disk),restore:d=>{disk=clone(d);},traces:()=>traces,
 clear:()=>{traces=[];replies=[];},replies:()=>replies};`)(require,__dirname);
const {c,block}=h, root="/sdcard/호이랜드/",devRoot="/sdcard/호이랜드_dev/";
c.boardPath=root+"board.json";
for(const name of ["isOrderLogRoomBot","isAdmin","isAdminIdentity","isMasterIdentity","isGlobalOperatorCommandAllowed","isRecordRoomCommand","prepareRecordRoomArchive","buildRecordArchiveMessage","isSearchAuthenticationCount","buildAdventureStarterCompleteMessage"])
 vm.runInContext(block(main,"function "+name+"("),c);
const commandStart=main.indexOf("                var recordCommandBoard = null;"),commandEnd=main.indexOf('\n                if (',main.indexOf('Api.replyRoom(room91, notifyMessage);',commandStart));
assert(commandStart>0&&commandEnd>commandStart);
vm.runInContext("function runRecords(){"+main.slice(commandStart,commandEnd)+"}",c);
vm.runInContext("function bootRecordArchive(){"+main.slice(main.indexOf("var startupRecordCurrentFile ="),main.indexOf("if (initData.serverRaid && serverRaidHasWork(initData.serverRaid)) {"))+"}",c);
const clone=x=>JSON.parse(JSON.stringify(x));
let groups=0;

// 개인정보 없는 합성 기록에 순서·중요 표시·추가 속성을 포함하는 함수
function records(count){return Array.from({length:count},(_,i)=>({user:"synthetic"+i,content:(i%3===0?"凸":"")+"기록"+i,date:"10/20 12:00",extra:{number:i}}));}
// 실제 명령 분기와 저장 함수를 합성 디스크에서 실행하는 함수
function command(msg,sender="master",dev=false,room=dev?"test":"room92"){
 h.clear();const ctx=c.createCommandContext(dev,room),prior=c.enterCommandContext(ctx);c.beginDataSaveTransaction();
 c.msg=msg;c.sender=sender;c.data=c.loadJsonFile(c.filePath);c.petData={};c.guildData={};c.ctx=ctx;
 try{c.runRecords();}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(prior);}
 return h.replies().join("\n");
}
// 각 시험을 독립된 합성 데이터로 시작하는 함수
function test(name,fn){h.reset();c.Admins=["admin"];h.put(c.boardPath,{record:records(3),memo:[{content:"memo"}],unrelated:{keep:true}});fn();console.log("PASS OCT20 "+(++groups)+": "+name);}

test("호여 완료 문구가 기획 원문과 일치하고 입력별 상세 내역이 노출되지 않음",()=>{
 const expected="[대상 여]님에게 호월신의 축복✨이 깃듭니다!\n━━━━━━━━━━━━━━━\n🐾 먼저, 함께할 펫을 만나보세요!\n\n채팅창에 /펫정보 를 입력하면\n능력과 장착 정보를 확인할 수 있어요.\n━━━━━━━━━━━━━━━\n🎒 /가방 → 지급받은 재화와 아이템 확인\n🌟 /레벨 → 모험가 레벨 확인\n\n💡 게임 방법이 궁금하다면?\n채팅창에 ‘가이드’를 입력해 주세요.\n\n펫과 함께하는 당신만의 여정이 시작됩니다. 🌱";
 for(const grant of [false,true])assert.strictEqual(c.buildAdventureStarterCompleteMessage("대상 여","펫이름",grant,grant),expected);
});
test("초기 부팅에서 기존 기록 전체·추가 속성 보존하고 현재 기록만 비움",()=>{
 const old=h.get(c.boardPath);c.bootRecordArchive();const d=h.get(c.boardPath);
 assert.deepStrictEqual(d.recordArchive1.records,old.record);assert.deepStrictEqual(d.record,[]);assert.deepStrictEqual(d.memo,old.memo);assert.deepStrictEqual(d.unrelated,old.unrelated);
});
test("부팅·명령 반복 실행은 보관소를 덮거나 새 기록을 초기화하지 않음",()=>{
 c.bootRecordArchive();const archive=clone(h.get(c.boardPath).recordArchive1);command("/기록 fresh");const state=h.get(c.boardPath);
 assert.strictEqual(state.record[0].content,"fresh");c.bootRecordArchive();command("/기록실");assert.deepStrictEqual(h.get(c.boardPath),state);assert.deepStrictEqual(state.recordArchive1,archive);
});
test("3752건을 페이지별 누락 없이 조회하며 원본·중요 표시·순서를 보존",()=>{
 h.put(c.boardPath,{record:records(3752),memo:[]});c.bootRecordArchive();const before=h.raw(c.boardPath),seen=[];
 for(let page=1;page<=188;page++){const text=command("/기록보관소1 "+page);for(const match of text.matchAll(/^(?:凸)?(\d+)\. \[/gm))seen.push(Number(match[1]));}
 assert.deepStrictEqual(seen,Array.from({length:3752},(_,i)=>i+1));assert(command("/기록보관소1").includes("凸1. ["));assert.strictEqual(h.raw(c.boardPath),before);
});
test("기록 추가·중요 토글·삭제는 현재 기록에만 반영",()=>{
 c.bootRecordArchive();const archive=clone(h.get(c.boardPath).recordArchive1);command("/기록 fresh");command("/빌런 1");assert.strictEqual(h.get(c.boardPath).record[0].content,"凸fresh");command("/기록삭제 1");assert.deepStrictEqual(h.get(c.boardPath).record,[]);assert.deepStrictEqual(h.get(c.boardPath).recordArchive1,archive);
});
test("이관 중 파일 교체 실패 시 원본 유지·새 실행 환경으로 재시도",()=>{
 const before=h.raw(c.boardPath);h.fail((_d,p)=>p===c.boardPath);assert.throws(()=>c.bootRecordArchive());assert.strictEqual(h.raw(c.boardPath),before);
 const persisted=h.persist();h.reset();h.restore(persisted);c.bootRecordArchive();assert.strictEqual(h.get(c.boardPath).recordArchive1.records.length,3);assert.strictEqual(h.get(c.boardPath).record.length,0);
});
test("DEV 첫 기록 요청의 이관과 저장 실패는 원본·기존 보관소·신규 기록 보호",()=>{
 h.put(devRoot+"board.json",{record:records(4),memo:[]});const prod=h.raw(c.boardPath),before=h.raw(devRoot+"board.json");h.fail((_d,p)=>p===devRoot+"board.json");
 assert.throws(()=>command("/기록 new","master",true));assert.strictEqual(h.raw(devRoot+"board.json"),before);assert.strictEqual(h.raw(c.boardPath),prod);
 command("/기록 new","master",true);const d=h.get(devRoot+"board.json");assert.strictEqual(d.recordArchive1.records.length,4);assert.strictEqual(d.record[0].content,"new");assert.strictEqual(h.raw(c.boardPath),prod);
});
test("이름 교체 사이 강제 종료는 검증된 rollback 원문을 복구하고 신규 기록 보존",()=>{
 c.bootRecordArchive();command("/기록 fresh");const d=h.get(c.boardPath),disk=h.persist();
 disk[c.boardPath+".rollback"]=disk[c.boardPath];delete disk[c.boardPath];h.reset();h.restore(disk);c.bootRecordArchive();assert.deepStrictEqual(h.get(c.boardPath),d);
 const devDisk=h.persist();devDisk[devRoot+"board.json.rollback"]=JSON.stringify(d);delete devDisk[devRoot+"board.json"];h.restore(devDisk);
 command("/기록실","master",true);assert.deepStrictEqual(h.get(devRoot+"board.json"),d);
});
test("유효 원본이 존재하면 잔류 rollback을 읽어 덮지 않으며 손상 복구 자료는 거부",()=>{
 c.bootRecordArchive();command("/기록 fresh");const d=h.get(c.boardPath),disk=h.persist();disk[c.boardPath+".rollback"]=JSON.stringify({record:records(9)});h.restore(disk);c.bootRecordArchive();assert.deepStrictEqual(h.get(c.boardPath),d);
 const bad=h.persist();delete bad[c.boardPath];bad[c.boardPath+".rollback"]=JSON.stringify({record:{}});h.restore(bad);assert.throws(()=>c.bootRecordArchive());assert.strictEqual(h.raw(c.boardPath),undefined);
 const corrupt=h.persist();corrupt[c.boardPath]="{";corrupt[c.boardPath+".rollback"]=JSON.stringify(d);h.restore(corrupt);assert.throws(()=>c.bootRecordArchive());assert.strictEqual(h.raw(c.boardPath),"{");
});
test("손상된 목록·기존 보관소는 덮지 않고 오류, 빈 목록은 정상 이관",()=>{
 for(const d of [{record:{}},{record:[],recordArchive1:{}},{record:[],recordArchive1:{version:2,records:[]}}]){h.put(c.boardPath,d);const old=h.raw(c.boardPath);assert.throws(()=>c.bootRecordArchive());assert.strictEqual(h.raw(c.boardPath),old);}
 h.put(c.boardPath,{record:[],memo:[]});c.bootRecordArchive();assert(command("/기록보관소1").includes("등록된 기록이 없습니다"));
});
test("권한 없는 사용자는 이관·조회·수정 불가, 숫자 뒤 안내 문구는 실행하지 않음",()=>{
 const old=h.raw(c.boardPath);for(const msg of ["/기록실","/기록보관소1","/기록 invalid","/빌런 1","/기록삭제 1"]){assert.strictEqual(command(msg,"a"),"");assert.strictEqual(h.raw(c.boardPath),old);}
 for(const msg of ["/기록보관소1 1 해봐","/기록삭제 1 해봐","/빌런 1 해봐"]){assert.strictEqual(command(msg),"");assert.strictEqual(h.raw(c.boardPath),old);}
 c.bootRecordArchive();for(const n of [0,999,9007199254740992])assert(command("/기록보관소1 "+n).includes("유효한 보관소 페이지"));
});
test("보관소 조회의 전역 운영·레이드 예외는 기존 기록실과 같은 역할 제한",()=>{
 const prev=c.enterCommandContext(c.createCommandContext(false,"room1"));try{assert(c.isGlobalOperatorCommandAllowed("admin","/기록보관소1 2"));assert(!c.isGlobalOperatorCommandAllowed("a","/기록보관소1 2"));assert(c.isServerRaidAdditionalCommand("/기록보관소1 2"));assert(!c.isServerRaidAdditionalCommand("/기록보관소1 2 해봐"));}finally{c.exitCommandContext(prev);}
});

// Main·Info의 실제 권한 함수를 서로 다른 방과 사용자로 실행한다.
function permissions(source){
 let room="서버관리자";const x={Master:["master","호이 남"],Admins:["admin"],room90:"GM",room91:"staff",room92:"서버관리자",testRoom:"test",room8:"battle",getCurrentContext:()=>({permissionRoom:room}),isHoiPassPremiumAdminCommandMessage:()=>true};
 for(let i=1;i<=100;i++)if(!x["room"+i])x["room"+i]="room"+i;
 vm.createContext(x);vm.runInContext(block(source,"const GLOBAL_CONFIG = {")+";this.GLOBAL_CONFIG=GLOBAL_CONFIG;",x);
 for(const name of ["isOrderLogRoomBot","isAdmin","isMaster","isAdminIdentity","isMasterIdentity"])vm.runInContext(block(source,"function "+name+"("),x);
 if(source===main)for(const name of ["isServerAdminRoomOperator","isGlobalOperatorCommandAllowed"])vm.runInContext(block(source,"function "+name+"("),x);
 return {x,room:v=>{room=v;}};
}
test("Main·Info 일반/관리자/MASTER는 두 방의 권한이 같고 다른 방은 기존대로",()=>{
 for(const source of [main,info]){const p=permissions(source),x=p.x;for(const user of ["a","admin","master","호이 남"]){p.room("서버관리자");const old=[x.isAdmin(user),x.isMaster(user),x.isAdminIdentity(user),x.isMasterIdentity(user)];p.room("주문기록방");assert.deepStrictEqual([x.isAdmin(user),x.isMaster(user),x.isAdminIdentity(user),x.isMasterIdentity(user)],old);}
 p.room("일반방");assert(!x.isAdmin("admin"));assert(!x.isMaster("master"));assert(!x.isOrderLogRoomBot("오픈채팅봇"));}
});
test("Main·Info 주문기록방 봇만 관리자·MASTER·신원 권한을 받음",()=>{
 for(const source of [main,info]){const p=permissions(source),x=p.x;p.room("주문기록방");for(const name of ["isAdmin","isMaster","isAdminIdentity","isMasterIdentity"])assert(x[name]("오픈채팅봇"));assert(!x.isMaster("a"));assert(!x.isOrderLogRoomBot("오픈채팅봇 "));
 for(const room of ["서버관리자","일반방","주문기록방 ","test"]){p.room(room);assert(!x.isMaster("오픈채팅봇"));assert(!x.isAdminIdentity("오픈채팅봇"));}}
});
test("주문 봇 권한은 게임·이벤트의 전역 명령 제한을 통째로 우회하지 않음",()=>{
 const p=permissions(main);p.room("주문기록방");assert(!p.x.isGlobalOperatorCommandAllowed("오픈채팅봇","/가방"));assert(!p.x.isGlobalOperatorCommandAllowed("오픈채팅봇","/임의명령"));assert(p.x.isGlobalOperatorCommandAllowed("오픈채팅봇","/기록실"));
});
test("실제 Main·Info 공통 약관 분기는 주문기록방 봇의 관리 명령만 접수",()=>{
 for(const source of [main,info]){const p=permissions(source),x=p.x;x.data={member:{"오픈채팅봇":{agree:false},a:{agree:false}}};x.msg="/레벨수정";x.isGlobalInfoCommand=false;x.filePath="synthetic";x.saveJsonFile=()=>{};
 const marker=source===main?'if (!data.member[sender].agree && !isGlobalOperatorCommandAllowed(sender, msg)':'if (!isGlobalInfoCommand && !isOrderLogRoomBot(sender)';vm.runInContext('function probeAgreement(){'+block(source,marker)+'return "allowed";}',x);
 p.room("주문기록방");x.sender="오픈채팅봇";assert.strictEqual(x.probeAgreement(),"allowed");x.sender="a";assert.strictEqual(x.probeAgreement(),undefined);p.room("일반방");x.sender="오픈채팅봇";assert.strictEqual(x.probeAgreement(),undefined);}
});
test("닉네임 직접 비교 관리 조건 133개가 기존 주체·방은 보존하고 주문 봇에만 확장",()=>{
 let checked=0;
 for(const file of ["main.js","Info.js"]){const source=file==="main.js"?main:info,p=permissions(source),x=p.x;
 const old=cp.execFileSync("git",["show","d34e3a78:"+file],{encoding:"utf8",maxBuffer:16*1024*1024}).replace(/\r\n/g,"\n");
 for(const line of source.split("\n").filter(l=>l.includes('"호이 남"')&&l.includes("isOrderLogRoomBot(sender)")&&/\bif \(/.test(l))){
   const prior=line.replace(/\((sender\s*(?:===|==)\s*"호이 남") \|\| isOrderLogRoomBot\(sender\)\)/g,"$1").replace(/\((sender\s*!==\s*"호이 남") && !isOrderLogRoomBot\(sender\)\)/g,"$1");assert(old.includes(prior),"unmatched original guard: "+line);
   const expression=l=>{const a=l.indexOf("if (")+4,tail=l.slice(a),m=/\)\s*(?:\{|replier\.|return)/.exec(tail);assert(m,"condition end: "+l);return tail.slice(0,m.index);};
   const evalGuard=(text,sender,msg)=>new Function("sender","msg","isOrderLogRoomBot","isMaster","isAdmin","isHoiPassPremiumAdminCommandMessage","return ("+expression(text)+");")(sender,msg,x.isOrderLogRoomBot,x.isMaster,x.isAdmin,x.isHoiPassPremiumAdminCommandMessage);
   const samples=["/임의명령",...Array.from(line.matchAll(/"(\/[^"\n]+)"/g),m=>m[1]).flatMap(m=>[m,m+"target 1 2 3",m+" target 1 2 3"])];
   for(const msg of samples){for(const room of ["일반방","서버관리자","주문기록방"]){p.room(room);for(const user of ["a","admin","master","호이 남"]){assert.strictEqual(evalGuard(line,user,msg),evalGuard(prior,user,msg));}if(room!=="주문기록방")assert.strictEqual(evalGuard(line,"오픈채팅봇",msg),evalGuard(prior,"오픈채팅봇",msg));}
    p.room("주문기록방");assert.strictEqual(evalGuard(line,"오픈채팅봇",msg),evalGuard(prior,"호이 남",msg));}
   checked++;
 }}assert.strictEqual(checked,133);
});
test("주문 봇의 실제 관리 분기와 기록 실행에서 발신자 데이터가 바뀌지 않음",()=>{
 const p=permissions(main);p.room("주문기록방");const x=p.x;let replies=[];x.replier={reply:t=>replies.push(t)};x.sender="오픈채팅봇";x.msg="/레벨수정";
 vm.runInContext("function runManagement(){"+block(main,'if (msg === "/레벨수정" &&')+"}runManagement();",x);assert(replies.length>0);assert.strictEqual(x.sender,"오픈채팅봇");
 command("/기록 bot record","오픈채팅봇",false,"주문기록방");assert.strictEqual(h.get(c.boardPath).record[0].user,"오픈채팅봇");
});
console.log("OCT20 READY "+groups+"개 검증 그룹 통과");
module.exports={h,c,main,info,block};
