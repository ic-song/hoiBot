const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const h = require('./test_guild_marble'), fixture = h.createHarness();
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), 'Rhino jar required');
fixture.seed();
const config = JSON.parse(JSON.stringify(fixture.c.GLOBAL_CONFIG));
const seed = fixture.f.read(), guild = fixture.f.get(fixture.c.guildPath);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoibot-marble-rhino-'));
const root = path.join(temp, 'prod').replace(/\\/g, '/') + '/', devRoot = path.join(temp, 'dev').replace(/\\/g, '/') + '/';
for (const folder of [root, devRoot]) {
    fs.mkdirSync(folder); fs.writeFileSync(folder + 'member.json', JSON.stringify(seed));
    fs.writeFileSync(folder + 'member_pet.json', '{}'); fs.writeFileSync(folder + 'guild.json', JSON.stringify(guild));
}
const names = ['createCommandContext', 'getCurrentContext', 'enterCommandContext', 'exitCommandContext', 'getDataFileName', 'resolveActiveDataPath',
    'parseJsonContent', 'ensureParentFolder', 'loadJsonFile', 'saveJsonFile', 'getDataSaveTransaction', 'beginDataSaveTransaction', 'endDataSaveTransaction',
    'prepareManagedJsonTransactionEntry', 'rollbackDataSaveTransaction', 'getManagedJsonBackupPath', 'getManagedJsonSecondaryBackupPath', 'getManagedJsonBackupCandidates',
    'restoreManagedJsonFromBackup', 'isProtectedManagedJsonPath', 'parseManagedJsonContent', 'getProtectedJsonSaveLock', 'writeVerifiedJsonFile', 'writeMemberSplitSlot',
    'isDevCommandMessage', 'stripDevCommandPrefix', 'createContextReplier', 'isExclusiveDataMutationCommandMessage', 'getResponseDataFlowLock',
    'getMyGuildId', 'isSafePointValue', 'roundToTwo', 'buildServerRaidAccountIndex', 'normalizeHoiServerLabel'];
let runtime = 'var GLOBAL_CONFIG=' + JSON.stringify(config) + ';\n' + names.map(n => fixture.f.block(h.main, 'function ' + n + '(')).join('\n') + '\n' + h.model;
runtime += `
var DATA_ROOT_PATH=${JSON.stringify(root)},DEV_DATA_ROOT_PATH=${JSON.stringify(devRoot)},COMMON_DATA_FILE_MAP={},filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json',guildPath=DATA_ROOT_PATH+'guild.json';
var testRoom='table',allsee='<ALLSEE>',protectedJsonSaveLocks={},MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true);
var messages=new java.util.concurrent.ConcurrentLinkedQueue(),errors=new java.util.concurrent.ConcurrentLinkedQueue(),writes=new java.util.concurrent.ConcurrentLinkedQueue();
var failTarget=null,crashAfterMember=false,crashAfterMarble=false,simulateCrash=false,failReply=false;
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));}};
function getAutoDailyBatchContext(){return null;}function debuggerLog(){}function numberWithCommas(n){return String(n);}function checkRank(d,p,g,u){return u;}
function formatDateTime(){return 'synthetic';}function notifyManagedJsonRecovery(){}function notifyManagedJsonRecoveryFailure(){}
function isAutoDailyEntryCommandMessage(){return false;}function getAttendanceKstDateKey(){return '20261023';}function hasAttendedToday(){return true;}function isAttendanceFreeCommand(){return false;}
function isGuildTerritoryWarCommandLockActive(){return false;}function isGuildTerritoryBlockedDuringWarCommand(){return false;}function isGlobalOperatorCommandAllowed(){return false;}
var parseOriginal=parseManagedJsonContent;parseManagedJsonContent=function(t,p){if(failTarget&&String(p)===failTarget){failTarget=null;throw Error('injected file validation failure');}return parseOriginal(t,p);};
var publishOriginal=writeVerifiedJsonFile;writeVerifiedJsonFile=function(p,t,skip,verified){publishOriginal(p,t,skip,verified);writes.add(String(p));if(crashAfterMember&&String(p)===filePath){crashAfterMember=false;simulateCrash=true;throw Error('process stopped after member publication');}if(crashAfterMarble&&String(p)===DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName){crashAfterMarble=false;simulateCrash=true;throw Error('process stopped after game publication');}};
function check(value,label){if(!value)throw Error(label);}
function run(message,sender,where){var msg=message,room=where||'table',isGroupChat=true,lock=getResponseDataFlowLock(msg);lock.lock();dataTransactionLock.lock();var ctx=createCommandContext(isDevCommandMessage(msg),room),previous=enterCommandContext(ctx);beginDataSaveTransaction();var replier=createContextReplier({reply:function(t){if(failReply)throw Error('transport failure');messages.add(String(t));}},ctx);try{if(ctx.isDev)msg=stripDevCommandPrefix(msg);
` + h.recovery + `var data=loadJsonFile(filePath);
` + h.entry + `
}catch(error){if(!simulateCrash)rollbackDataSaveTransaction();simulateCrash=false;throw error;}finally{endDataSaveTransaction();exitCommandContext(previous);dataTransactionLock.unlock();lock.unlock();}}
function read(p,dev){var previous=enterCommandContext(createCommandContext(!!dev,'table'));try{return loadJsonFile(DATA_ROOT_PATH+p);}finally{exitCommandContext(previous);}}
function current(){return read(GLOBAL_CONFIG.guildMarble.fileName).guilds.$g.current;}
function put(p,d){writeVerifiedJsonFile(DATA_ROOT_PATH+p,JSON.stringify(d),true);}
function readyThree(){run('/마블시작','master');run('/마블준비','a');run('/마블준비','b');run('/마블준비','c');}
// 실제 참가비 차감 이후 일부 지급을 완료한 정산 대기를 준비하는 함수
function settlementFixture(kind){var store=read(GLOBAL_CONFIG.guildMarble.fileName);store.guilds.$g.current=null;store.guilds.$g.usage.count=0;put(GLOBAL_CONFIG.guildMarble.fileName,store);readyThree();run('/마블준비','d');store=read(GLOBAL_CONFIG.guildMarble.fileName);var g=store.guilds.$g.current;prepareGuildMarbleSettlement(g,kind);var result=g.results[0],player=g.players[result.index],data=read('member.json');player.paid=true;data.member[player.user].point+=result.amount;put('member.json',data);put(GLOBAL_CONFIG.guildMarble.fileName,store);}
function worker(message,user,ready,start){return new java.lang.Thread(new java.lang.Runnable({run:function(){try{ready.countDown();start.await();run(message,user);}catch(e){errors.add(String(e));}}}));}
function parallel(messages,users){var ready=new java.util.concurrent.CountDownLatch(users.length),start=new java.util.concurrent.CountDownLatch(1),threads=[];for(var i=0;i<users.length;i++){var t=worker(messages[i],users[i],ready,start);threads.push(t);t.start();}check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'workers ready');start.countDown();for(var j=0;j<threads.length;j++){threads[j].join(10000);check(!threads[j].isAlive(),'worker finished');}check(errors.isEmpty(),'workers '+errors);}
`;
// 재시작한 독립 Rhino 전역에서 실제 파일을 이어 읽는 시나리오를 구성하는 함수
function scenario(code) { return 'run(s,' + JSON.stringify(code) + ');\n'; }
let script = `var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.info)},'Info.js',1,null);
var runtime=${JSON.stringify(runtime)};function fresh(){var s=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(s,runtime,'runtime',1,null);return s;}function run(s,code){return cx.evaluateString(s,code,'scenario',1,null);}var s=fresh();
print('PASS Rhino: complete main.js and Info.js compilation');
`;
script += scenario("Math.random=function(){return 0.999;};readyThree();parallel(['/마블준비','/마블준비','/마블준비','/마블준비'],['d','d','e','e']);var g=current(),d=read('member.json');check(g.state==='PLAYING'&&g.players.length===4,'exactly four');var total=0;for(var u in d.member)total+=d.member[u].point;check(total===9*20000000000-400000000,'charge exactly four');check(read(GLOBAL_CONFIG.guildMarble.fileName).guilds.$g.usage.count===1,'one start');");
script += "print('PASS Rhino: four actual concurrent Java threads, exactly four players and one fee charge');\n";
script += scenario("Math.random=function(){return 0.4;};parallel(['/마블굴리기','/마블굴리기'],['a','a']);check(current().action==='BUY'&&current().move.die===3&&current().players[0].position===3,'one roll');");
script += 's=fresh();\n';
script += scenario("Math.random=function(){throw Error('must keep die');};var before=FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName);writes.clear();run('/마블판','a');run('/마블굴리기 1 해봐','a');check(writes.isEmpty()&&FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName)===before,'read/error no writes');parallel(['/마블구매','/마블구매'],['a','a']);check(current().lands[3].level===1&&current().players[0].gold===800&&current().slot===1,'one purchase');");
script += "print('PASS Rhino: concurrent rolls/buys once, saved die and phase survive fresh scope, queries/errors write nothing');\n";
script += scenario("var store=read(GLOBAL_CONFIG.guildMarble.fileName);store.guilds.$g.current=null;put(GLOBAL_CONFIG.guildMarble.fileName,store);readyThree();var before=FileStream.read(filePath);failTarget=DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName;var failed=false;try{run('/마블준비','d');}catch(e){failed=true;}check(failed&&FileStream.read(filePath)===before,'actual rollback restores member');");
script += 's=fresh();\n';
script += scenario("Math.random=function(){return 0.999;};run('/마블준비','d');check(current().state==='PLAYING','restart retry');var store=read(GLOBAL_CONFIG.guildMarble.fileName);store.guilds.$g.current=null;store.guilds.$g.usage.count=0;put(GLOBAL_CONFIG.guildMarble.fileName,store);readyThree();crashAfterMember=true;var failed=false;try{run('/마블준비','d');}catch(e){failed=true;}check(failed&&read(GLOBAL_CONFIG.guildMarble.pendingName).pending!==null,'durable journal remains');check(current().state==='RECRUITING','game not yet published');");
script += 's=fresh();\n';
script += scenario("var before=JSON.parse(read(GLOBAL_CONFIG.guildMarble.pendingName).pending.memberText);run('/마블판','a');check(read('member.json').member.a.point===before.member.a.point&&read(GLOBAL_CONFIG.guildMarble.pendingName).pending===null,'journal restores both');Math.random=function(){return 0.999;};run('/마블준비','d');check(read('member.json').member.a.point===before.member.a.point-100000000,'one retry fee');");
script += "print('PASS Rhino: actual fsync/rename save failure rollback and process-stop journal recovery before next command');\n";
script += scenario("var store=read(GLOBAL_CONFIG.guildMarble.fileName);store.guilds.$g.current=null;store.guilds.$g.usage.count=0;put(GLOBAL_CONFIG.guildMarble.fileName,store);readyThree();crashAfterMarble=true;var failed=false;try{run('/마블준비','d');}catch(e){failed=true;}check(failed&&current().state==='PLAYING'&&read(GLOBAL_CONFIG.guildMarble.pendingName).pending!==null,'both files published before journal clear');");
script += 's=fresh();\n';
script += scenario("var snapshot=JSON.parse(read(GLOBAL_CONFIG.guildMarble.pendingName).pending.memberText);run('/마블판','a');check(current().state==='RECRUITING'&&current().players.length===3&&read('member.json').member.a.point===snapshot.member.a.point,'both publications recovered together');Math.random=function(){return 0.999;};run('/마블준비','d');check(current().state==='PLAYING'&&read('member.json').member.a.point===snapshot.member.a.point-100000000,'single charge after both-publication crash');");
script += "print('PASS Rhino: crash after both file publications before journal clear restores the pair and retries once');\n";
script += scenario("var store=read(GLOBAL_CONFIG.guildMarble.fileName),g=store.guilds.$g.current;g.slot=39;g.players[0].position=4;put(GLOBAL_CONFIG.guildMarble.fileName,store);Math.random=function(){return 0;};crashAfterMember=true;var failed=false;try{run('/마블굴리기','a');}catch(e){failed=true;}check(failed,'payout crash');var fixed=JSON.stringify(current().results);check(current().state==='SETTLING'&&read(GLOBAL_CONFIG.guildMarble.pendingName).pending!==null,'fixed ranks before payout');");
script += 's=fresh();\n';
script += scenario("Math.random=function(){throw Error('no second lottery');};var fixed=JSON.stringify(current().results);run('/마블판','a');check(JSON.stringify(current().results)===fixed,'fixed ranks restored');var before=read('member.json');writes.clear();run('/마블중단','master');check(current().state==='SETTLING'&&JSON.stringify(read('member.json'))===JSON.stringify(before)&&writes.isEmpty(),'stop does not trigger payout');run('/마블굴리기','a');var row=read(GLOBAL_CONFIG.guildMarble.fileName).guilds.$g;check(row.current===null&&row.last.kind==='PAYOUT','no refund/payout mixing');for(var i=0;i<row.last.payments.length;i++){var payment=row.last.payments[i],index=buildServerRaidAccountIndex(read('member.json'))[payment.id];check(index.member.point===before.member[index.user].point+payment.amount,'payout once');}var after=FileStream.read(filePath);run('/마블굴리기','a');check(FileStream.read(filePath)===after,'no duplicate payout');");
script += "print('PASS Rhino: settlement ranks survive payout crash, restart pays once, refund cannot replace payout');\n";
script += scenario("var prod=FileStream.read(filePath),gameText=FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName);Math.random=function(){return 0.999;};run('dev/마블시작','master');for(var i=0;i<4;i++)run('dev/마블준비',['a','b','c','d'][i]);check(read(GLOBAL_CONFIG.guildMarble.fileName,true).guilds.$g.current.state==='PLAYING','DEV started');check(FileStream.read(filePath)===prod&&FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName)===gameText,'PROD unchanged');check(dataSaveTransactionThreadLocal.get()===null&&commandContextThreadLocal.get()===null&&!dataTransactionLock.isLocked()&&!commandDataFlowLock.isWriteLocked(),'released contexts and locks');");
script += "print('PASS Rhino: actual DEV/PROD files and journals isolated, all locks/context released');\n";
for(const kind of ['PAYOUT','REFUND']) {
    script += scenario("Math.random=function(){return 0.999;};settlementFixture('"+kind+"');");
    script += 's=fresh();\n';
    script += scenario("var beforeText=FileStream.read(filePath),gameText=FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName),fixed=current(),before=read('member.json');writes.clear();Math.random=function(){throw Error('no retry lottery');};var inputs=[['/마블참가비 0','master'],['/마블참가비 11','master'],['/마블참가비 3','master'],['/마블참가비 3','e'],['/마블시작','e'],['/마블모집취소','master'],['/마블중단','master'],['/마블굴리기','master'],['/마블구매','a'],['/마블중단확인','a']];for(var i=0;i<inputs.length;i++)run(inputs[i][0],inputs[i][1]);run('/마블굴리기','a','other-room');check(writes.isEmpty()&&FileStream.read(filePath)===beforeText&&FileStream.read(DATA_ROOT_PATH+GLOBAL_CONFIG.guildMarble.fileName)===gameText,'denied retry has no writes');parallel(['/마블참가비 0','/마블굴리기','/마블참가비 3'],['master','a','e']);var row=read(GLOBAL_CONFIG.guildMarble.fileName).guilds.$g,after=read('member.json');check(row.current===null&&row.last.kind==='"+kind+"','one valid retry preserves kind');for(var j=0;j<fixed.results.length;j++){var result=fixed.results[j],player=fixed.players[result.index];check(after.member[player.user].point===before.member[player.user].point+(player.paid?0:result.amount),'skip paid, pay remaining once');}var once=FileStream.read(filePath);run('/마블굴리기','a');check(FileStream.read(filePath)===once,'repeated retry unchanged');");
    script += "print('PASS Rhino settlement "+kind+": fresh scope, denied inputs zero file writes, concurrent valid/invalid retries skip paid and settle once');\n";
}
const file = path.join(temp, 'test.js'); fs.writeFileSync(file, script, 'utf8');
const result = cp.spawnSync('java', ['-Xmx1024m', '-Dfile.encoding=UTF-8', '-cp', path.resolve(jar), 'org.mozilla.javascript.tools.shell.Main', '-opt', '-1', '-version', '200', '-encoding', 'UTF-8', '-f', file], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); assert.equal(result.status, 0);
