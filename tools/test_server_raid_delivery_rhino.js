const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), child = require("child_process");
const { createFixture } = require("./test_server_raid_delivery.js");
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), "Rhino jar required");
const h = createFixture(), { main, info, block } = h;
const domain = main.slice(main.indexOf("function serverRaidHeader("), main.indexOf("// 길드 영지전 관련 함수들"));
const functions = ["createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "normalizeHoiServerLabel", "formatNicknameRankMessage", "noticeMsg"];
let runtime = "var GLOBAL_CONFIG=" + JSON.stringify(h.c.GLOBAL_CONFIG) + ";\n";
runtime += functions.map(name => block(main, "function " + name + "(")).join("\n") + "\n" + domain;
runtime += `
var DATA_ROOT_PATH="/synthetic/",DEV_DATA_ROOT_PATH="/synthetic-dev/",filePath="member",isDebuggerFlag=false,testRoom="test",allsee="<ALLSEE>";
for(var roomIndex=1;roomIndex<=100;roomIndex++)this["room"+roomIndex]="room"+roomIndex;
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock();
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal();
var serverRaidWorkTimers={},timers={},nextTimer=0,disk="",clock=0,attempts=[],failRooms=[],throwTransport=false,throwLog=false,logs=[];
Date.now=function(){return clock;};
function setTimeout(fn,delay){var id=++nextTimer;timers[id]={fn:fn,at:clock+delay};return id;}
function clearTimeout(id){delete timers[id];}
function loadJsonFile(){return JSON.parse(disk);}
function saveJsonFile(d){disk=JSON.stringify(d);}
function debuggerLog(text){logs.push(String(text));if(throwLog)throw new Error("log unavailable");}
function checkRank(d,p,g,user){return user;}
function numberWithCommas(v){return String(v);}
var Api={replyRoom:function(room,text){attempts.push({room:room,text:String(text)});if(failRooms.indexOf(room)!==-1){if(throwTransport)throw new Error("session unavailable");return false;}return true;}};
function check(value,label){if(!value)throw new Error(label);}
function tick(ms){clock+=ms;for(var pass=0;pass<100;pass++){var ids=Object.keys(timers),chosen=null;for(var i=0;i<ids.length;i++)if(timers[ids[i]].at<=clock&&(chosen===null||timers[ids[i]].at<timers[chosen].at))chosen=ids[i];if(chosen===null)return;var timer=timers[chosen];delete timers[chosen];timer.fn();}throw new Error("timer loop");}
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
function fresh(data,now){var scope=new org.mozilla.javascript.ImporterTopLevel(context);run(scope,runtime);run(scope,"disk="+JSON.stringify(JSON.stringify(data))+";clock="+now+";");return scope;}
function restart(scope){return fresh(JSON.parse(String(run(scope,"disk"))),Number(run(scope,"clock")));}
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
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-raid-delivery-rhino-")), file = path.join(dir, "test.js");
fs.writeFileSync(file, script, "utf8");
const result = child.spawnSync("java", ["-Dfile.encoding=UTF-8", "-cp", path.resolve(jar), "org.mozilla.javascript.tools.shell.Main", "-opt", "-1", "-version", "200", "-encoding", "UTF-8", "-f", file], { encoding: "utf8", timeout: 60000 });
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); assert.strictEqual(result.status, 0);
