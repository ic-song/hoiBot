const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), child = require("child_process");
const { createFixture } = require("./test_server_raid_delivery.js");
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), "Rhino jar required");
const h = createFixture(), { main, info, block } = h;
const domain = main.slice(main.indexOf("function serverRaidHeader("), main.indexOf("// 길드 영지전 관련 함수들"));
const functions = ["createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "normalizeHoiServerLabel", "formatNicknameRankMessage", "noticeMsg"];
const atomicFunctions = ["parseJsonContent", "getProtectedJsonSaveLock", "isProtectedManagedJsonPath", "parseManagedJsonContent", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "writeVerifiedJsonFile", "writeMemberSplitSlot", "saveJsonFile"];
const atomicTest = atomicFunctions.map(name => block(main, "function " + name + "(")).join("\n") + `
var protectedJsonSaveLocks={};
function getAutoDailyBatchContext(){return null;}function ensureParentFolder(p){new java.io.File(p).getParentFile().mkdirs();}
function getManagedJsonBackupPath(){return null;}function getManagedJsonSecondaryBackupPath(){return null;}
var p=DATA_ROOT_PATH+GLOBAL_CONFIG.serverRaid.delivery.receiptFileName;
var receipt={version:1,generation:'atomic',sent:{}};
beginDataSaveTransaction();try{writeMemberSplitSlot(p,JSON.stringify(receipt));}finally{endDataSaveTransaction();}
var before=FileStream.read(p);receipt.sent[getServerRaidNoticeReceiptKey('공지','한글방')]=true;
beginDataSaveTransaction();try{saveJsonFile(receipt,p,false,before);}finally{endDataSaveTransaction();}
var confirmed=FileStream.read(p);check(requireServerRaidNoticeReceipts(JSON.parse(confirmed)).sent[getServerRaidNoticeReceiptKey('공지','한글방')]===true,'actual atomic Java UTF-8 receipt saved');
receipt.version=99;var rejected=false;beginDataSaveTransaction();try{saveJsonFile(receipt,p,false,confirmed);}catch(e){rejected=true;}finally{endDataSaveTransaction();}
check(rejected&&FileStream.read(p)===confirmed,'bad receipt rejected before publish, original kept');
receipt.version=1;receipt.sent[getServerRaidNoticeReceiptKey('next','한글방')]=true;beginDataSaveTransaction();try{saveJsonFile(receipt,p,false,confirmed);rollbackDataSaveTransaction();}finally{endDataSaveTransaction();}
check(FileStream.read(p)===confirmed,'actual protected receipt transaction rollback restores previous ACKs');
check(!dataTransactionLock.isLocked()&&dataSaveTransactionThreadLocal.get()===null,'actual receipt save locks/transaction released');
`;
let runtime = "var GLOBAL_CONFIG=" + JSON.stringify(h.c.GLOBAL_CONFIG) + ";\n";
runtime += functions.map(name => block(main, "function " + name + "(")).join("\n") + "\n" + domain;
runtime += `
var DATA_ROOT_PATH=String(java.nio.file.Files.createTempDirectory("raid-delivery-").toString()).replace(/\\\\/g,"/")+"/",DEV_DATA_ROOT_PATH=DATA_ROOT_PATH+"dev/",filePath=DATA_ROOT_PATH+"member.json",isDebuggerFlag=false,testRoom="test",allsee="<ALLSEE>";
for(var roomIndex=1;roomIndex<=100;roomIndex++)this["room"+roomIndex]="room"+roomIndex;
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock();
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal();
var serverRaidWorkTimers={},serverRaidNoticeWorkers={},serverRaidNoticeMemberRevisions={},timers={},nextTimer=0,disk="",clock=0,attempts=[],failRooms=[],throwTransport=false,throwLog=false,logs=[];
Date.now=function(){return clock;};
function setTimeout(fn,delay){var id=++nextTimer;timers[id]={fn:fn,at:clock+delay};return id;}
function clearTimeout(id){delete timers[id];}
function loadJsonFile(){return JSON.parse(disk);}
function resolveActiveDataPath(p){return p;}
function parseJsonContent(text){return JSON.parse(String(text));}
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),"UTF-8"));}};
function writeMemberSplitSlot(p,text){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(text).getBytes("UTF-8"));}
function saveJsonFile(d,p){if(p===filePath){disk=JSON.stringify(d);serverRaidNoticeMemberRevisions[p]=(serverRaidNoticeMemberRevisions[p]||0)+1;}else writeMemberSplitSlot(p,JSON.stringify(d));}
function debuggerLog(text){logs.push(String(text));if(throwLog)throw new Error("log unavailable");}
function checkRank(d,p,g,user){return user;}
function numberWithCommas(v){return String(v);}
var Api={replyRoom:function(room,text){attempts.push({room:room,text:String(text)});if(failRooms.indexOf(room)!==-1){if(throwTransport)throw new Error("session unavailable");return false;}return true;}};
function check(value,label){if(!value)throw new Error(label);}
function waitNotices(){for(var n=0;n<1000;n++){dataTransactionLock.lock();var running;try{running=Object.keys(serverRaidNoticeWorkers).some(function(k){return serverRaidNoticeWorkers[k].running;});}finally{dataTransactionLock.unlock();}if(!running)return;java.lang.Thread.sleep(5);}throw new Error("sender timeout: "+logs.join("|"));}
function tick(ms){clock+=ms;for(var pass=0;pass<100;pass++){var ids=Object.keys(timers),chosen=null;for(var i=0;i<ids.length;i++)if(timers[ids[i]].at<=clock&&(chosen===null||timers[ids[i]].at<timers[chosen].at))chosen=ids[i];if(chosen===null)return;var timer=timers[chosen];delete timers[chosen];timer.fn();waitNotices();}throw new Error("timer loop");}
function pending(){var s=JSON.parse(disk).serverRaid,rows=[];for(var i=0;i<s.outbox.length;i++)for(var j=0;j<s.outbox[i].deliveries.length;j++){var d=s.outbox[i].deliveries[j];if(!d.sent&&!d.cancelled)rows.push(d.room);}return rows;}
function paid(){var d=JSON.parse(disk);check(d.serverRaid.current===null&&d.serverRaid.completed===1,"completed once: "+logs.join(" | "));check(d.member.a.point===1300003000&&d.member.b.point===1270001500,"points once");check(d.member.b.bag[GLOBAL_CONFIG.serverRaid.items.attackTicket]===1,"handicap once");check(!dataTransactionLock.isLocked()&&commandContextThreadLocal.get()===null&&dataSaveTransactionThreadLocal.get()===null,"Java lock/context released");}
function boot(){var initData=loadJsonFile(filePath);
` + block(main, "if (initData.serverRaid && serverRaidHasWork(initData.serverRaid)) {") + "\n}\n";

const notices = h.read(); notices.serverRaid = h.c.createServerRaidState("synthetic");
notices.serverRaid.outbox = ["first", "second", "third"].map(kind => ({ id: "synthetic:" + kind, generation: "synthetic", text: kind,
    deliveries: ["room1", "room2", "room3"].map(room => ({ room, sent: false })) }));
const prep = createFixture(); prep.run("/서버대전시작", "master");
const active = createFixture(); active.start(); let d = active.read(); d.member.b.server = active.c.GLOBAL_CONFIG.serverRaid.servers[1]; d.member.b.R = 50000; active.write(d);
active.attack("a", "a"); active.attack("b", "b"); const activeData = active.read();
active.run("/서버대전종료", "master"); d = active.read();
active.c.settleServerRaidParticipant(d, active.c.buildServerRaidAccountIndex(d), Object.keys(d.serverRaid.current.accounts)[0]);

let script = "var context=org.mozilla.javascript.Context.getCurrentContext();\n";
script += "context.compileString(" + JSON.stringify(main) + ",'main.js',1,null);\n";
script += "context.compileString(" + JSON.stringify(info) + ",'Info.js',1,null);\n";
script += "var runtime=" + JSON.stringify(runtime) + ";\n";
script += `
function run(scope,code){return context.evaluateString(scope,code,"scenario",1,null);}
function fresh(data,now,receipts){var scope=new org.mozilla.javascript.ImporterTopLevel(context);run(scope,runtime);run(scope,"disk="+JSON.stringify(JSON.stringify(data))+";clock="+now+";");if(data.serverRaid.noticeReceiptsVersion===1)run(scope,"writeMemberSplitSlot(DATA_ROOT_PATH+GLOBAL_CONFIG.serverRaid.delivery.receiptFileName,"+JSON.stringify(receipts||JSON.stringify({version:1,generation:data.serverRaid.generation,sent:{}}))+");");return scope;}
function restart(scope){var receipts=String(run(scope,"FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.serverRaid.delivery.receiptFileName)"));return fresh(JSON.parse(String(run(scope,"disk"))),Number(run(scope,"clock")),receipts);}
var scope=fresh(${JSON.stringify(notices)},${h.now()});
run(scope,"failRooms=['room2'];boot();tick(1);check(pending().length===3,'only failed room pending');check(attempts.filter(function(a){return a.room==='room2';}).length===1,'one failure attempt per pass');check(attempts.filter(function(a){return a.room==='room3';}).length===3,'other room all notices');");
scope=restart(scope);run(scope,"boot();tick(1);check(pending().length===0,'restart recovered');check(attempts.length===3&&attempts.every(function(a){return a.room==='room2';}),'restart skips persisted success rooms');");
print("PASS Rhino delivery: false failure isolation, per-room order, fresh global-scope restart, persisted acknowledgements");
scope=fresh(${JSON.stringify(notices)},${h.now()});run(scope,"failRooms=['room2'];throwTransport=true;throwLog=true;boot();tick(1);check(pending().length===3,'transport and log failure isolation');check(attempts.filter(function(a){return a.room==='room3';}).length===3,'later rooms sent despite exceptions');");
print("PASS Rhino delivery exceptions: transport and logging throw, later rooms continue, failed room remains pending");
scope=fresh(${JSON.stringify(prep.read())},${prep.now() + 3600000});run(scope,"boot();tick(1);var round=JSON.parse(disk).serverRaid.current;check(round.state==='ACTIVE'&&round.autoEndAt===clock+1800000,'late PREP activation basis');check(!attempts.some(function(a){return a.text.indexOf('60초 뒤')!==-1;}),'stale prepare cancelled');");
print("PASS Rhino PREP restart: saved preparation resumes, late activation gets 30 minutes, no old preparation notice");
scope=fresh(${JSON.stringify(activeData)},${activeData.serverRaid.current.autoEndAt + 1000});run(scope,"failRooms=['room2'];boot();tick(1);paid();check(pending().length>0&&pending().every(function(room){return room==='room2';}),'auto end/results isolate failed room');");
scope=restart(scope);run(scope,"boot();tick(1);paid();check(pending().length===0,'completed restart drains only pending');check(attempts.every(function(a){return a.room==='room2';}),'no resend to successful room');");
print("PASS Rhino ACTIVE/completed restart: overdue auto settlement, point/handicap once, real Java lock/context release, pending-only delivery");
scope=fresh(${JSON.stringify(d)},${active.now()});run(scope,"failRooms=['room2'];boot();tick(1);paid();check(pending().every(function(room){return room==='room2';}),'partial settlement delivery isolation');");
print("PASS Rhino SETTLING restart: partially paid accounts resume without duplicate rewards");
scope=fresh(${JSON.stringify(notices)},${h.now()});run(scope,${JSON.stringify(atomicTest)});
print("PASS Rhino receipt atomic storage: actual Java UTF-8 files, fsync/verified replace, invalid write rejection, snapshot rollback and lock release");
for(var mode=0;mode<3;mode++){
scope=fresh(${JSON.stringify(activeData)},${active.now()});
run(scope,"var d=JSON.parse(disk);d.serverRaid.outbox.push({id:'paused',generation:d.serverRaid.generation,text:'paused',deliveries:[{room:'room1',sent:false}]});saveJsonFile(d,filePath);var entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1),attackDone=new java.util.concurrent.CountDownLatch(1),queryDone=new java.util.concurrent.CountDownLatch(1),errors=new java.util.concurrent.ConcurrentLinkedQueue(),throwPaused="+(mode===1)+",successPaused="+(mode===2)+";var commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true);Api.replyRoom=function(){check(!dataTransactionLock.isHeldByCurrentThread(),'API holds no data lock');entered.countDown();check(release.await(8,java.util.concurrent.TimeUnit.SECONDS),'test release timeout');if(throwPaused)throw Error('transport');return successPaused;};var ctx=createCommandContext(false,'room8');scheduleServerRaidNoticeWork(ctx,0);var id=Object.keys(timers)[0],t=timers[id];delete timers[id];t.fn();check(entered.await(5,java.util.concurrent.TimeUnit.SECONDS),'native API paused');");
run(scope,"var attack=new java.lang.Thread(new java.lang.Runnable({run:function(){commandDataFlowLock.writeLock().lock();dataTransactionLock.lock();beginDataSaveTransaction();try{var d=loadJsonFile(filePath,'raid');var e=createServerRaidAttackEvent(null);var a=applyServerRaidAttack(d,'a','unused',e,100000,100000,false);check(a.attack.P===3000,'actual attack reward');saveJsonFile(d,filePath);attackDone.countDown();}catch(e){errors.add(String(e));}finally{endDataSaveTransaction();dataTransactionLock.unlock();commandDataFlowLock.writeLock().unlock();}}}));attack.start();check(attackDone.await(3,java.util.concurrent.TimeUnit.SECONDS),'attack persisted BEFORE native send release: '+errors);attack.join(3000);var query=new java.lang.Thread(new java.lang.Runnable({run:function(){commandDataFlowLock.readLock().lock();try{check(JSON.parse(disk).member.a.point===1000006000,'query sees new attack');queryDone.countDown();}finally{commandDataFlowLock.readLock().unlock();}}}));query.start();check(queryDone.await(3,java.util.concurrent.TimeUnit.SECONDS),'query also proceeds before release');query.join(3000);clock=JSON.parse(disk).serverRaid.current.autoEndAt;scheduleServerRaidWork(ctx,JSON.parse(disk).serverRaid.generation,0,JSON.parse(disk).serverRaid.sequence);var id=serverRaidWorkTimers[ctx.key()],t=timers[id];delete timers[id];t.fn();check(JSON.parse(disk).serverRaid.current===null,'auto settlement BEFORE native send release');check(JSON.parse(disk).member.a.point===1300006000,'settlement keeps concurrent attack');check(!dataTransactionLock.isLocked(),'data lock free while native API waits');release.countDown();waitNotices();check(errors.isEmpty(),'thread errors '+errors);check(JSON.parse(disk).member.a.point===1300006000,'late sender does not overwrite battle');check(commandContextThreadLocal.get()===null&&dataSaveTransactionThreadLocal.get()===null,'caller contexts released');");
print("PASS Rhino real Java concurrency: API blocked, actual attack reward+save, following read, auto-close+payout proceed BEFORE API "+(mode===1?'throw':mode===2?'success':'false')+"; late ACK cannot overwrite latest state");
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-raid-delivery-rhino-")), file = path.join(dir, "test.js");
fs.writeFileSync(file, script, "utf8");
const result = child.spawnSync("java", ["-Dfile.encoding=UTF-8", "-cp", path.resolve(jar), "org.mozilla.javascript.tools.shell.Main", "-opt", "-1", "-version", "200", "-encoding", "UTF-8", "-f", file], { encoding: "utf8", timeout: 60000 });
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); assert.strictEqual(result.status, 0);
