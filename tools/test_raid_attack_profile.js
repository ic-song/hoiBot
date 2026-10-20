const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const utility=fs.readFileSync(path.join(__dirname,"test_server_raid_io.js"),"utf8");
const {storageFixture,measure}=new Function("require","__dirname",utility.slice(0,utility.indexOf("\nlet count"))+"\nreturn {storageFixture,measure};")(require,__dirname);
let groups=0;
const clone=v=>JSON.parse(JSON.stringify(v));
const baselineSource=require("child_process").execFileSync("git",["show","96633c05dd0c6eb66e24f6fb786bcae7a4c3fc62:main.js"],{encoding:"utf8",maxBuffer:20*1024*1024});
// 실제 분리 저장 준비와 실제 전체 콜백을 합성 파일시스템에서 실행한다.
function fixture(source){const h=storageFixture(source);h.setup();h.migrate();h.fixture.start();return h;}
// 기존 실패 경로도 정상 백업을 갱신할 수 있으므로 실패 뒤 전체 파일은 구 기준과 대조한다.
function sameDisk(a,b){assert.deepStrictEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const p of Object.keys(a))assert(a[p]===b[p],"disk mismatch: "+p);}
function test(name,fn){fn();console.log("PASS "+(++groups)+": "+name);}
test("분리 저장 JSON은 한글·따옴표·개행·배열·수치의 기존 직렬화 결과와 동일",()=>{
 const h=fixture();for(const data of [{text:'한글🧸"\n',list:[1,0,-1,1.5,null,true],nested:{a:"\\"}},{history:[],outbox:[],generation:"synthetic"}]){
 const store={version:1,id:'id"\n',revision:7,data};assert.equal(h.c.stringifyMemberSplitStore(store,JSON.stringify(data)),JSON.stringify(store));}
});
test("분리 파일 원문은 저장되지 않는 속성으로만 보관하고 백업에서 그대로 보존",()=>{
 const h=fixture(),d=h.load("raid"),marker=h.c.getMemberSplitMarker(d),p=h.c.getMemberSplitStorePath("raid",marker.raidRevision);
 const text=JSON.stringify(JSON.parse(h.fixture.disk()[p]),null,2);h.fixture.disk()[p]=text;
 const store=h.c.readMemberSplitStore(p,"raid");assert.equal(store.__memberSplitSourceText,text);assert(!Object.keys(store).includes("__memberSplitSourceText"));assert(!JSON.stringify(store).includes("__memberSplitSourceText"));
 const latest=h.load("raid");latest.serverRaid.eventReceipts.new={roundId:"synthetic",accountId:"synthetic"};h.save(latest);
 assert.equal(h.fixture.disk()[h.c.getMemberSplitBackupPath("raid",1)],text);assert(h.load("raid").serverRaid.eventReceipts.new);
});
for(const kind of ["missing","invalid"])test("저장 직전 회원 "+kind+"는 검증 원문 재사용으로 숨기지 않음",()=>{
 const h=fixture(),d=h.load("raid");d.member.a.point++;if(kind==="missing")delete h.fixture.disk()[h.c.filePath];else h.fixture.disk()[h.c.filePath]="{broken";const before=clone(h.fixture.disk());
 assert.throws(()=>h.save(d));assert.deepStrictEqual(h.fixture.disk(),before);
});
for(const kind of ["raid","logs"])test("로드 후 "+kind+" 원본이 손상되면 백업 단계에서 중단·새 슬롯 롤백",()=>{
 const h=fixture(),d=h.load("raid"),marker=h.c.getMemberSplitMarker(d),p=h.c.getMemberSplitStorePath(kind,kind==="raid"?marker.raidRevision:marker.logsRevision);
 d.member.a.point++;d.serverRaid.completed++;if(kind==="logs")d.petMusouAutomationLogs.push({synthetic:true});
 h.fixture.disk()[p]="{broken";h.c.memberSplitBackupCache={};const before=clone(h.fixture.disk());
 assert.throws(()=>h.save(d));assert.deepStrictEqual(h.fixture.disk(),before);
});
for(const target of ["raidSlot","member","raidBackup","memberBackup"])test(target+" 교체 실패는 파일/포인트/공격 원복·같은 이벤트 재시도 한 번 지급",()=>{
 const h=fixture(),m=h.c.getMemberSplitMarker(h.load("raid"));const paths={raidSlot:h.c.getMemberSplitStorePath("raid",m.raidRevision+1),member:h.c.filePath,raidBackup:h.c.getMemberSplitBackupPath("raid",1),memberBackup:h.c.getManagedJsonBackupPath(h.c.filePath)};
 const old=fixture(baselineSource),om=old.c.getMemberSplitMarker(old.load("raid")),oldPaths={raidSlot:old.c.getMemberSplitStorePath("raid",om.raidRevision+1),member:old.c.filePath,raidBackup:old.c.getMemberSplitBackupPath("raid",1),memberBackup:old.c.getManagedJsonBackupPath(old.c.filePath)};
 old.fixture.fail((_d,p)=>p===oldPaths[target]);assert.throws(()=>old.fixture.attack("a","failure"));
 h.fixture.fail((_d,p)=>p===paths[target]);assert.throws(()=>h.fixture.attack("a","failure"));sameDisk(h.fixture.disk(),old.fixture.disk());
 h.fixture.attack("a","failure");assert.equal(h.load("raid").member.a.point,1000003000);h.fixture.attack("a","failure");assert.equal(h.load("raid").member.a.point,1000003000);
});
for(let failAt=1;failAt<=4;failAt++)test("fsync "+failAt+"번째 실패는 동일 원문 복원·다음 공격 정상",()=>{
 const old=fixture(baselineSource),OS=old.c.java.io.FileOutputStream;let oldSyncs=0;old.c.java.io.FileOutputStream=function(...args){const stream=new OS(...args),fd=stream.getFD();stream.getFD=()=>({sync(){if(++oldSyncs===failAt)throw Error("fsync");fd.sync();}});return stream;};assert.throws(()=>old.fixture.attack("a","sync"));
 const h=fixture(),Stream=h.c.java.io.FileOutputStream;let syncs=0;
 h.c.java.io.FileOutputStream=function(...args){const stream=new Stream(...args),fd=stream.getFD();stream.getFD=()=>({sync(){if(++syncs===failAt)throw Error("fsync");fd.sync();}});return stream;};
 try{assert.throws(()=>h.fixture.attack("a","sync"));sameDisk(h.fixture.disk(),old.fixture.disk());}finally{h.c.java.io.FileOutputStream=Stream;}
 h.fixture.attack("a","sync");assert.equal(h.load("raid").member.a.point,1000003000);
});
test("같은 객체 연속 저장·명령 롤백·백업 결과가 구 기준과 동일",()=>{
 const old=fixture(baselineSource),od=old.load("raid");old.c.beginDataSaveTransaction();try{od.member.a.point+=10;od.serverRaid.completed++;old.save(od);od.member.a.point+=20;od.serverRaid.completed++;old.save(od);old.c.rollbackDataSaveTransaction();}finally{old.c.endDataSaveTransaction();}
 const h=fixture(),d=h.load("raid");h.c.beginDataSaveTransaction();
 try{d.member.a.point+=10;d.serverRaid.completed++;h.save(d);d.member.a.point+=20;d.serverRaid.completed++;h.save(d);h.c.rollbackDataSaveTransaction();}
 finally{h.c.endDataSaveTransaction();}sameDisk(h.fixture.disk(),old.fixture.disk());h.fixture.attack("a","after-rollback");assert.equal(h.load("raid").member.a.point,1000003000);
});
test("구 스냅샷은 현재 공개 버전 검증에서 거부",()=>{
 const h=fixture(),stale=h.load("raid");h.fixture.attack("a","fresh");const before=clone(h.fixture.disk());stale.member.a.point++;stale.serverRaid.completed++;assert.throws(()=>h.save(stale),/오래된/);assert.deepStrictEqual(h.fixture.disk(),before);
});
// 잠금 소유와 트랜잭션 깊이를 관찰하되 기존 callback 본문은 그대로 사용한다.
function installCallback(h){
 const lock=()=>({depth:0,lock(){this.depth++;},tryLock(){this.lock();return true;},unlock(){assert(this.depth>0);this.depth--;}});
 const locks={data:lock(),read:lock(),write:lock()};h.c.dataTransactionLock=locks.data;h.c.commandDataFlowLock={readLock:()=>locks.read,writeLock:()=>locks.write};
 h.c.autoDailyQuestInternalDepth=0;h.c.errorLogPath="/synthetic/error.json";
 function callback(msg,sender,replier,room="room8",event){
 h.c.response(room,msg,sender,true,replier,{},"com.kakao.talk",event);for(const lock of Object.values(locks))assert.equal(lock.depth,0);assert.equal(h.c.getDataSaveTransaction(),null);}
 return {locks,callback};
}
test("운영 실제 콜백 응답은 저장·양쪽 잠금 해제 뒤 전송·원본 ID 재입력 무중복",()=>{
 const h=fixture(),{locks,callback}=installCallback(h);let messages=[];
 const r={reply(text){for(const lock of Object.values(locks))assert.equal(lock.depth,0);assert.equal(h.c.getDataSaveTransaction(),null);assert.equal(h.load("raid").member.a.point,1000003000);messages.push(text);}};
 callback("/레이드공격","a",r,"room8",{id:"same"});const before=clone(h.fixture.disk());callback("/레이드공격","a",r,"room8",{id:"same"});assert.equal(messages.length,2);assert.equal(messages[0],messages[1]);assert.deepStrictEqual(h.fixture.disk(),before);
});
test("DEV 원래 응답 헤더·실행 문맥 보존과 운영 파일 격리",()=>{
 const h=fixture();h.migrate(true);h.fixture.start(true);const prod=Object.fromEntries(Object.entries(h.fixture.disk()).filter(([p])=>!p.includes("_dev/")));const {locks,callback}=installCallback(h);
 const parent=h.c.createCommandContext(false,"parent");h.c.enterCommandContext(parent);let message;
 callback("dev/레이드공격","a",{reply(text){for(const lock of Object.values(locks))assert.equal(lock.depth,0);assert(h.c.getCurrentContext().isDev);message=text;}},"test");
 assert(message.startsWith("[DEV 테스트환경]\n"));assert.strictEqual(h.c.getCurrentContext(),parent);h.c.exitCommandContext(null);
 assert.equal(h.load("raid",true).member.a.point,1000003000);assert.deepStrictEqual(Object.fromEntries(Object.entries(h.fixture.disk()).filter(([p])=>!p.includes("_dev/"))),prod);
});
test("저장 실패 때 거짓 성공 응답 없음·응답/로그 동시 실패도 확정 공격 보존",()=>{
 const old=fixture(baselineSource),oc=installCallback(old);old.fixture.fail((_d,p)=>p===old.c.filePath);oc.callback("/레이드공격","a",{reply(){throw Error("unexpected success");}});
 const h=fixture(),{callback}=installCallback(h);let messages=[];
 h.fixture.fail((_d,p)=>p===h.c.filePath);callback("/레이드공격","a",{reply:t=>messages.push(t)});assert.equal(messages.length,0);
 sameDisk(h.fixture.disk(),old.fixture.disk());
 h.c.debuggerLog=()=>{throw Error("log failed");};callback("/레이드공격","a",{reply(){throw Error("reply failed");}});assert.equal(h.load("raid").member.a.point,1000003000);
});
test("진행 안 함·방 제한 안내도 잠금 밖에서 전송하며 데이터 미변경",()=>{
 const h=fixture(),{locks,callback}=installCallback(h);h.fixture.end();let messages=[];const before=clone(h.fixture.disk());
 const r={reply(text){for(const lock of Object.values(locks))assert.equal(lock.depth,0);messages.push(text);}};
 callback("/레이드공격","a",r);callback("/레이드공격","a",r,"wrong-room");assert.equal(messages.length,2);assert.deepStrictEqual(h.fixture.disk(),before);
});
test("재시작 새 VM도 원래 공격·보상·한도를 복원하고 같은 원본 ID 무중복",()=>{
 const h=fixture();h.fixture.attack("a","survive");const saved=clone(h.fixture.disk()),next=storageFixture();next.setup();
 for(const p of Object.keys(next.fixture.disk()))delete next.fixture.disk()[p];Object.assign(next.fixture.disk(),saved);next.fixture.advance(h.fixture.now()-next.fixture.now());
 assert.equal(next.load("raid").member.a.point,1000003000);next.fixture.attack("a","survive");sameDisk(next.fixture.disk(),saved);
 next.fixture.attack("a","new");assert.equal(next.load("raid").member.a.point,1000006000);next.fixture.end();const closed=next.load("raid");assert.equal(closed.serverRaid.completed,1);assert.equal(closed.member.a.point,1300006000);
});
test("매력·치명타·공격권·패널티·공격 반영·정산 계산 함수는 운영 기준 원문과 동일",()=>{
 const h=fixture();for(const name of ["calculateRaidExp","calculateCriticalDamage","getServerRaidAttackCheck","getServerRaidAttackAvailability","getServerRaidRoundPolicy","calculateServerRaidAttackReward","applyServerRaidAttack","applyServerRaidExcessAttempt","settleServerRaidParticipant","finishServerRaidSettlement"])
 assert.equal(h.fixture.block(h.fixture.main,"function "+name+"("),h.fixture.block(baselineSource,"function "+name+"("),name);
});
test("공격 UI는 개인 정렬 생략 호출만 변경하고 출력식은 동일",()=>{
 const h=fixture(),current=h.fixture.block(h.fixture.main,"function buildServerRaidAttackMessage("),old=h.fixture.block(baselineSource,"function buildServerRaidAttackMessage(");
 assert.equal(current.replace("buildServerRaidResults(round, false, true)","buildServerRaidResults(round)"),old);
});
test("다수 참가자·공동 순위·큰 정수에서도 서버 집계와 메시지 동일·정산은 개인 정렬 유지",()=>{
 const h=fixture(),old=fixture(baselineSource),round=h.load("raid").serverRaid.current;
 round.accounts={};const servers=h.c.GLOBAL_CONFIG.serverRaid.servers;
 for(let i=0;i<1500;i++)round.accounts["id"+i]={id:"id"+i,server:servers[i%servers.length],damage:i%5===0?"90071992547409912345":String(i%7),attacks:i%19===0?[]:[{id:"event"+i,R:10,D:10,P:0,remaining:4,critical:false}],attackReward:0};
 const original=JSON.stringify(round),expected=old.c.buildServerRaidResults(clone(round)),actual=h.c.buildServerRaidResults(round,false,true);
 assert.deepStrictEqual(clone(actual).map(({id,damage,rank})=>({id,damage,rank})),clone(expected).map(({id,damage,rank})=>({id,damage,rank})));
 let sortCalls=0;const rank=h.c.rankServerRaidRows;h.c.rankServerRaidRows=rows=>{sortCalls++;return rank(rows);};
 const d={serverRaid:{current:round,wins:{}}},participant=round.accounts.id1;
 assert.equal(h.c.buildServerRaidAttackMessage(d,participant,participant.attacks[0],"synthetic"),old.c.buildServerRaidAttackMessage(clone(d),clone(participant),clone(participant.attacks[0]),"synthetic"));assert.equal(sortCalls,1);assert.equal(JSON.stringify(round),original);
 assert.deepStrictEqual(clone(h.c.buildServerRaidResults(round)),clone(expected));assert(sortCalls>1);
 const freeze=clone(round),expectedFreeze=clone(round);assert.deepStrictEqual(clone(h.c.buildServerRaidResults(freeze,true,true)),clone(old.c.buildServerRaidResults(expectedFreeze,true)));assert.deepStrictEqual(freeze,expectedFreeze);
 const tie={accounts:{a:{id:"a",server:servers[0],damage:"100",attacks:[{}]},b:{id:"b",server:servers[1],damage:"100",attacks:[{}]},empty:{id:"empty",server:servers[2],damage:"999",attacks:[]}}};
 assert.deepStrictEqual(clone(h.c.buildServerRaidResults(tie,false,true)).map(r=>r.rank),[1,1]);assert.equal(h.c.buildServerRaidResults({accounts:{}},false,true).length,0);
});
console.log("PASS raid attack optimization: "+groups+" groups (synthetic only, actual callback/save)");
