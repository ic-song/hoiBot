const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const utility=fs.readFileSync(path.join(__dirname,"test_server_raid_io.js"),"utf8");
const {storageFixture,measure}=new Function("require","__dirname",utility.slice(0,utility.indexOf("\nlet count"))+"\nreturn {storageFixture,measure};")(require,__dirname);
let groups=0;
const clone=v=>JSON.parse(JSON.stringify(v));
const baselineSource=require("child_process").execFileSync("git",["show","91fc5ba09123a1dd4a7b30097ec502e540f00be1:main.js"],{encoding:"utf8",maxBuffer:20*1024*1024});
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
test("재시작 새 VM도 원래 공격·보상·한도를 복원하고 같은 원본 ID 무중복",()=>{
 const h=fixture();h.fixture.attack("a","survive");const saved=clone(h.fixture.disk()),next=storageFixture();next.setup();
 for(const p of Object.keys(next.fixture.disk()))delete next.fixture.disk()[p];Object.assign(next.fixture.disk(),saved);next.fixture.advance(h.fixture.now()-next.fixture.now());
 assert.equal(next.load("raid").member.a.point,1000003000);next.fixture.attack("a","survive");sameDisk(next.fixture.disk(),saved);
 next.fixture.attack("a","new");assert.equal(next.load("raid").member.a.point,1000006000);next.fixture.end();const closed=next.load("raid");assert.equal(closed.serverRaid.completed,1);assert.equal(closed.member.a.point,1300006000);
});
// 별채 추가분은 test_pet_home_village의 실제 계산 대조로 확인하고 나머지 전투 규칙의 원문은 보존한다.
test("치명타·공격권·패널티·공격 반영·정산 계산 함수는 운영 기준 원문과 동일",()=>{
 const h=fixture();for(const name of ["calculateCriticalDamage","getServerRaidAttackCheck","getServerRaidAttackAvailability","getServerRaidRoundPolicy","calculateServerRaidAttackReward","applyServerRaidAttack","applyServerRaidExcessAttempt","settleServerRaidParticipant","finishServerRaidSettlement"])
 assert.equal(h.fixture.block(h.fixture.main,"function "+name+"("),h.fixture.block(baselineSource,"function "+name+"("),name);
});
test("회원 분리·직렬화·저장 진입 함수는 검증한 운영 기준 유지",()=>{
 const h=fixture(),validated=require("child_process").execFileSync("git",["show","c12e97358731619280a4b70a7b9cbb0770c8807d:main.js"],{encoding:"utf8",maxBuffer:20*1024*1024});
 // 공통 검증 쓰기의 후속 중복 제거는 test_command_save_reuse에서 전체 함수·예외·전후 결과를 대조한다.
 for(const name of ["readMemberSplitStore","buildMemberSplitSavePlan","preserveMemberSplitBackupStores","saveJsonFile","stringifyMemberSplitStore"])assert.equal(h.fixture.block(h.fixture.main,"function "+name+"("),h.fixture.block(validated,"function "+name+"("),name);
});
test("같은 합성 공격의 최종 파일·쓰기량·fsync는 동일하고 중복 읽기만 감소",()=>{
 function run(source){const h=storageFixture(source);h.setup();const d=h.fixture.read();d.syntheticPadding="m".repeat(1000000);d.serverRaid.history=[{id:"synthetic-past",note:"r".repeat(1000000)}];h.fixture.write(d);h.migrate();h.fixture.start();const io=measure(h,f=>f.attack("a","storage-compare"));return {h,io};}
 const before=run(baselineSource),after=run();sameDisk(after.h.fixture.disk(),before.h.fixture.disk());
 assert.equal(after.io.writeBytes,before.io.writeBytes);assert.equal(after.io.writes,before.io.writes);assert.equal(after.io.syncs,before.io.syncs);assert(after.io.readBytes<before.io.readBytes);assert(after.io.reads<before.io.reads);
 console.log("IO "+JSON.stringify({before:before.io,after:after.io}));
});
test("DEV 저장 원문 재사용도 운영 파일과 분리되고 저장 실패 뒤 복구 결과 동일",()=>{
 const old=fixture(baselineSource),h=fixture();old.migrate(true);h.migrate(true);old.fixture.start(true);h.fixture.start(true);
 const prod=Object.fromEntries(Object.entries(h.fixture.disk()).filter(([p])=>!p.includes("_dev/")));
 old.fixture.attack("a","dev-attack",true);h.fixture.attack("a","dev-attack",true);sameDisk(h.fixture.disk(),old.fixture.disk());
 old.fixture.fail((_d,p)=>p.endsWith("_dev/member.json"));h.fixture.fail((_d,p)=>p.endsWith("_dev/member.json"));
 assert.throws(()=>old.fixture.attack("a","dev-retry",true));assert.throws(()=>h.fixture.attack("a","dev-retry",true));sameDisk(h.fixture.disk(),old.fixture.disk());
 old.fixture.attack("a","dev-retry",true);h.fixture.attack("a","dev-retry",true);sameDisk(h.fixture.disk(),old.fixture.disk());assert.equal(h.load("raid",true).member.a.point,1000006000);
 assert.deepStrictEqual(Object.fromEntries(Object.entries(h.fixture.disk()).filter(([p])=>!p.includes("_dev/"))),prod);
});
console.log("PASS storage IO reuse: "+groups+" groups (synthetic only, latest production baseline)");
