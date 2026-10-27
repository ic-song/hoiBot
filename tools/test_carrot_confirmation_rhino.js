const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), child = require("child_process");
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), "Rhino jar required");
const h = require("./test_carrot_confirmation.js"), main = h.main.replace(/\r\n/g, "\n");
const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
const block = marker => h.block(main, marker);
const start = main.indexOf("function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {");
const enter = main.indexOf("        ctx = createCommandContext(", start);
const cleanup = main.indexOf("    } finally {\n        if (commandContextEntered)", enter), end = main.indexOf("\n}", cleanup) + 2;
assert(start >= 0 && enter > start && cleanup > enter && end > cleanup);
const probe = main.slice(start, enter).replace("function response(", "function probeResponseLock(") + "runCriticalSection(msg);\n" + main.slice(cleanup, end);
const early = main.slice(main.indexOf("        // 확인 응답도 원래 명령의 출석·정지·대전·장소 검사를 통과하도록 연결한다."), main.indexOf("        // 방 제한은 복구·자동 저장·요청 과부하 기록보다 먼저 확인한다."));
const domain = main.slice(main.indexOf("// 당근거래 5종의 입력 범위를 식별하는 함수"), main.indexOf("// 커뮤니티 제한 대상인 당근거래 네 명령어만 식별하는 함수"));
const functions = ['getManualResetDirectOperation','getManualResetLegacyEntry','isManualResetInput', "isManualResetLegacyCommand", "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "isDevCommandMessage", "stripDevCommandPrefix", "isAutoDailyEntryCommandMessage", "isExclusiveDataMutationCommandMessage", "getResponseDataFlowLock", "isSearchAuthenticationCount", "parseJsonContent", "addItem", "removeItem"];
let script = "org.mozilla.javascript.Context.getCurrentContext().compileString(" + JSON.stringify(main) + ",'main.js',1,null);\n";
script += "org.mozilla.javascript.Context.getCurrentContext().compileString(" + JSON.stringify(info) + ",'Info.js',1,null);\nvar GLOBAL_CONFIG=" + JSON.stringify(h.c.GLOBAL_CONFIG) + ";\n";
script += functions.map(name => block("function " + name + "(")).join("\n") + "\n" + domain + "\n" + probe + `
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(), commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true), dataSaveTransactionThreadLocal=new java.lang.ThreadLocal();
var carrotTradePending={},ctx={isDev:false},sender="synthetic",room="test",isGroupChat=true,testRoom="test";
var itemListPath="items",filePath="member",memberPetPath="pets",petSkillDataPath="skills",homeDataFile="home",miniPetData={gradeTable:[]};
var disk="",timers=[],messages=[],saves=0,ids=0,errors=new java.util.concurrent.ConcurrentLinkedQueue();
function check(v,label){if(!v)throw new Error(label);}
function isServerRaidMutationCommand(){return false;} function getRaidSealCraftRequest(){return null;}
function getStoneBoxOpenRequest(){return null;} function isSealedVaultMutationCommandMessage(){return false;}
function isMasterIdentity(){return false;} function isGlobalOperatorCommandAllowed(){return false;}
function isMemberTierKing(d,u){return !!d.member[u];} function normalizePendantTransitionBagItem(b,n){return n;}
function isTradableItem(){return true;} function numberWithCommas(v){return String(v).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");}
function checkRank(d,p,g,u){return u;} function debuggerLog(){} function setTimeout(fn,delay){timers.push(fn);}
function generateBagOutput(bag){return {sortedItemList:Object.keys(bag).sort()};}
function loadJsonFile(p){if(p===itemListPath)return {untradableList:[]};throw new Error("unexpected load");}
function saveJsonFile(d,p){check(p===filePath,"member only");disk=JSON.stringify(d);saves++;}
var replier={reply:function(text){messages.push(String(text));}};
function reset(){disk=JSON.stringify({member:{synthetic:{agree:true,point:123,rank:{tier:"킹"},bag:{}},target:{agree:true,point:456,rank:{tier:"킹"},bag:{}}}});var d=JSON.parse(disk);d.member.synthetic.bag[GLOBAL_CONFIG.items.carrotName]=100;d.member.synthetic.bag.material=5;disk=JSON.stringify(d);carrotTradePending={};timers=[];messages=[];saves=0;errors.clear();}
function runCriticalSection(msg){var data=JSON.parse(disk),petData={},petSkillData={},guildData={};
` + early + block("if (isCarrotTradeEntryMessage(msg) ||") + `
}
function worker(ready,start){return new java.lang.Thread(new java.lang.Runnable({run:function(){org.mozilla.javascript.Context.enter();try{ready.countDown();start.await();probeResponseLock("test"," 거래한다 ","synthetic",true,replier,null,"test");}catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}}}));}
check(getCarrotTradeRequest("/펫스킬당근 target 1 2").cost===600,"skill cost 600");
check(getCarrotTradeRequest("/펜던트당근 target 1").count===1,"pendant remains single");
check(getCarrotTradeReply("거래한다 해봐",false)==="","exact reply");
check(getCarrotTradeFingerprint({sortIndex:1,options:{b:2,a:1}},true)===getCarrotTradeFingerprint({options:{a:1,b:2},sortIndex:7},true),"stable content excludes assigned number");
for(var i=0;i<20;i++){
 reset();var d=JSON.parse(disk),index=generateBagOutput(d.member.synthetic.bag).sortedItemList.indexOf("material")+1;
 probeResponseLock("test","/당근 target "+index+" 2","synthetic",true,replier,null,"test");check(saves===0&&Object.keys(carrotTradePending).length===1,"preview no debit");
 var ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1),a=worker(ready,start),b=worker(ready,start);
 a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),"ready");start.countDown();a.join(5000);b.join(5000);
 check(!a.isAlive()&&!b.isAlive()&&errors.isEmpty(),"threads "+errors);d=JSON.parse(disk);
 check(saves===1&&d.member.synthetic.bag.material===3&&d.member.target.bag.material===2&&d.member.synthetic.bag[GLOBAL_CONFIG.items.carrotName]===98,"once only "+i);
 check(Object.keys(carrotTradePending).length===0,"pending cleared");timers[0]();check(messages.length===2,"completed timeout ignored");
}
print("PASS Rhino carrot: full MAIN/Info compile, real domain/command execution, 20 actual Java thread pairs confirm once using real response locks (synthetic filesystem)");
reset();var d=JSON.parse(disk),index=generateBagOutput(d.member.synthetic.bag).sortedItemList.indexOf("material")+1;
probeResponseLock("test","/당근 target "+index+" 2","synthetic",true,replier,null,"test");var old=timers[0];probeResponseLock("test","안한다","synthetic",true,replier,null,"test");
probeResponseLock("test","/당근 target "+index+" 2","synthetic",true,replier,null,"test");var key=getCarrotTradePendingKey(sender,false),id=carrotTradePending[key].id;old();check(carrotTradePending[key].id===id,"old expiry preserves new trade");
carrotTradePending[key].expiresAt=0;timers[timers.length-1]();check(Object.keys(carrotTradePending).length===0&&saves===0,"expiry zero debit");
print("PASS Rhino carrot expiry: cancel/replacement old timeout, automatic expiry zero debit");
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-carrot-rhino-")), file = path.join(dir, "test.js");
fs.writeFileSync(file, script, "utf8");
const result = child.spawnSync("java", ["-Dfile.encoding=UTF-8", "-cp", path.resolve(jar), "org.mozilla.javascript.tools.shell.Main", "-opt", "-1", "-version", "200", "-encoding", "UTF-8", "-f", file], { encoding: "utf8", timeout: 60000 });
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); assert.strictEqual(result.status, 0);
