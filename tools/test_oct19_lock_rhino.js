const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), child = require("child_process");
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), "Rhino jar required");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
function block(marker) {
    const start = main.indexOf(marker); assert(start >= 0, marker); let depth = 0;
    for (let i = main.indexOf("{", start); i < main.length; i++) { if (main[i] === "{") depth++; if (main[i] === "}" && --depth === 0) return main.slice(start, i + 1); }
    throw Error(marker);
}
const responseStart = main.indexOf("function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {");
const enterEnd = main.indexOf("        ctx = createCommandContext(", responseStart);
const finallyStart = main.indexOf("    } finally {\n        if (commandContextEntered)", enterEnd);
const finallyEnd = main.indexOf("\n}", finallyStart) + 2;
assert(responseStart >= 0 && enterEnd > responseStart && finallyStart > enterEnd && finallyEnd > finallyStart);
const probe = main.slice(responseStart, enterEnd).replace("function response(", "function probeResponseLock(") + "        runCriticalSection(msg);\n" + main.slice(finallyStart, finallyEnd);
const configContext = { testRoom: "test" }; for (let i = 1; i <= 100; i++) configContext["room" + i] = "room" + i;
vm.createContext(configContext); vm.runInContext(block("const GLOBAL_CONFIG = {").replace("const ", "var "), configContext);
const names = ["getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "isDevCommandMessage", "stripDevCommandPrefix", "isAutoDailyEntryCommandMessage", "isExclusiveDataMutationCommandMessage", "getResponseDataFlowLock", "getDollBoxRequest", "isSearchAuthenticationCount"];
const script = "var GLOBAL_CONFIG=" + JSON.stringify(configContext.GLOBAL_CONFIG) + ";\n" + names.map(name => block("function " + name + "(")).join("\n") + "\n" + probe + `
var testRoom="test", commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true);
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(), dataSaveTransactionThreadLocal=new java.lang.ThreadLocal();
function isServerRaidMutationCommand(){return false;} function getRaidSealCraftRequest(){return null;}
function getStoneBoxOpenRequest(){return null;} function isSealedVaultMutationCommandMessage(){return false;}
var stock=new java.util.concurrent.atomic.AtomicInteger(100), paid=new java.util.concurrent.atomic.AtomicInteger(0);
var active=new java.util.concurrent.atomic.AtomicInteger(0), maxActive=new java.util.concurrent.atomic.AtomicInteger(0), calls=new java.util.concurrent.atomic.AtomicInteger(0);
var failNext=new java.util.concurrent.atomic.AtomicBoolean(false), errors=new java.util.concurrent.ConcurrentLinkedQueue();
function check(value,label){if(!value)throw new Error(label);}
function runCriticalSection(msg){
 calls.incrementAndGet();var n=active.incrementAndGet();if(n>maxActive.get())maxActive.set(n);
 try{
  java.lang.Thread.sleep(10);
  if(failNext.compareAndSet(true,false))throw new Error("synthetic critical error");
  var request=getDollBoxRequest(msg);
  if(request&&!request.error&&stock.get()>=request.count){stock.addAndGet(-request.count);paid.addAndGet(request.count);}
 }finally{active.decrementAndGet();}
}
function worker(msg,ready,start){return new java.lang.Thread(new java.lang.Runnable({run:function(){
 org.mozilla.javascript.Context.enter();
 try{ready.countDown();start.await();probeResponseLock("test",msg,"synthetic",true,null,null,"test");check(getDataSaveTransaction()===null,"thread local cleanup");}
 catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}
}}));}
check(isExclusiveDataMutationCommandMessage("/인형상자오픈 일반 100"),"box exclusive");
check(isExclusiveDataMutationCommandMessage("dev/인형상자오픈 엘리트 1"),"DEV box exclusive");
check(!isExclusiveDataMutationCommandMessage("/인형상자오픈 일반 1 해봐"),"suffix is not an execution");
for(var round=0;round<20;round++){
 stock.set(100);paid.set(0);calls.set(0);maxActive.set(0);errors.clear();
 var ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
 var a=worker("/인형상자오픈 일반 100",ready,start),b=worker("/인형상자오픈 일반 100",ready,start);
 a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),"workers ready");start.countDown();a.join(5000);b.join(5000);
 check(!a.isAlive()&&!b.isAlive(),"no deadlock");check(errors.isEmpty(),"worker errors "+errors);
 check(stock.get()===0&&paid.get()===100&&calls.get()===2&&maxActive.get()===1,"duplicate race "+round);
}
print("PASS Rhino real Java threads: 20 simultaneous box pairs, one stock/debit, exclusive execution");
stock.set(100);paid.set(0);calls.set(0);errors.clear();failNext.set(true);
var ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1);
var a=worker("/인형상자오픈 일반 100",ready,start),b=worker("/인형상자오픈 일반 100",ready,start);
a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),"error workers ready");start.countDown();a.join(5000);b.join(5000);
check(!a.isAlive()&&!b.isAlive()&&errors.size()===1&&paid.get()===100&&stock.get()===0,"exception releases both locks");
check(String(errors.peek()).indexOf("synthetic critical error")>=0,"expected critical error");
print("PASS Rhino real Java locks: critical error releases locks and transaction state for next input");
calls.set(0);errors.clear();dataTransactionLock.lock();
try{var ready=new java.util.concurrent.CountDownLatch(1),start=new java.util.concurrent.CountDownLatch(0),t=worker("/인형도감",ready,start);t.start();t.join(5000);check(!t.isAlive()&&calls.get()===0&&errors.isEmpty(),"tryLock contention returns safely");}
finally{dataTransactionLock.unlock();}
print("PASS Rhino real Java locks: read request contention exits without processing or leaked locks");
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-oct19-lock-")), file = path.join(dir, "test.js");
fs.writeFileSync(file, script, "utf8");
const result = child.spawnSync("java", ["-Dfile.encoding=UTF-8", "-cp", path.resolve(jar), "org.mozilla.javascript.tools.shell.Main", "-opt", "-1", "-version", "200", "-encoding", "UTF-8", "-f", file], { encoding: "utf8", timeout: 60000 });
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); assert.strictEqual(result.status, 0);
