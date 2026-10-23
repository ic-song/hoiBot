const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const h = require('./test_spirit_retirement');
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), 'Rhino jar required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoibot-spirit-rhino-'));
const root = path.join(temp, 'prod').replace(/\\/g, '/') + '/', devRoot = path.join(temp, 'dev').replace(/\\/g, '/') + '/';
fs.mkdirSync(root); fs.mkdirSync(devRoot);
const seed = { member: { master: { bag: {} }, synthetic: { bag: { 'keep': 3, [h.config.spiritRetirement.removedItem]: 10 }, point: 1234 }, noSpirit: { bag: { [h.config.spiritRetirement.removedItem]: 1 } } } };
const pets = { synthetic: { elemental: { grade: '정령왕', upgrade: 80, name: 'synthetic' } } };
for (const folder of [root, devRoot]) { fs.writeFileSync(folder + 'member.json', JSON.stringify(seed)); fs.writeFileSync(folder + 'member_pet.json', JSON.stringify(pets)); }
const names = h.helpers.concat(['createCommandContext', 'getCurrentContext', 'enterCommandContext', 'exitCommandContext', 'getDataFileName', 'resolveActiveDataPath',
    'parseJsonContent', 'ensureParentFolder', 'loadJsonFile', 'saveJsonFile', 'getDataSaveTransaction', 'beginDataSaveTransaction', 'endDataSaveTransaction',
    'prepareManagedJsonTransactionEntry', 'rollbackDataSaveTransaction', 'getManagedJsonBackupPath', 'getManagedJsonSecondaryBackupPath', 'isProtectedManagedJsonPath',
    'parseManagedJsonContent', 'getProtectedJsonSaveLock', 'writeVerifiedJsonFile', 'isDevCommandMessage', 'stripDevCommandPrefix']);
let runtime = 'var GLOBAL_CONFIG=' + JSON.stringify(h.config) + ',itemInfoData=' + JSON.stringify(h.itemInfo) + ';\n' + names.map(n => h.block(h.main, 'function ' + n + '(')).join('\n');
runtime += `
var DATA_ROOT_PATH=${JSON.stringify(root)},DEV_DATA_ROOT_PATH=${JSON.stringify(devRoot)},COMMON_DATA_FILE_MAP={},filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json';
var testRoom='test',protectedJsonSaveLocks={},MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),flowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true);
var messages=new java.util.concurrent.ConcurrentLinkedQueue(),errors=new java.util.concurrent.ConcurrentLinkedQueue();
var failMember=false,failReply=false;
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));}};
function getAutoDailyBatchContext(){return null;}function debuggerLog(){}function isMaster(user){return user==='master';}function numberWithCommas(n){return String(n);}
function formatDateTime(){return 'synthetic';}function notifyManagedJsonRecovery(){}function notifyManagedJsonRecoveryFailure(){}
var parseOriginal=parseManagedJsonContent;parseManagedJsonContent=function(t,p){var parsed=parseOriginal(t,p);if(failMember&&String(p)===filePath&&parsed[GLOBAL_CONFIG.spiritRetirement.ledgerKey]){failMember=false;throw Error('injected member validation failure');}return parsed;};
function check(value,label){if(!value)throw Error(label);}
function run(msg,sender){var lock=flowLock.writeLock();lock.lock();dataTransactionLock.lock();var previous=enterCommandContext(createCommandContext(isDevCommandMessage(msg),'test'));beginDataSaveTransaction();var replier={reply:function(t){if(failReply)throw Error('transport failure');messages.add(String(t));}};try{if(isDevCommandMessage(msg))msg=stripDevCommandPrefix(msg);var data=loadJsonFile(filePath);
` + h.command + `
}catch(error){rollbackDataSaveTransaction();throw error;}finally{endDataSaveTransaction();exitCommandContext(previous);dataTransactionLock.unlock();lock.unlock();}}
function member(dev){var previous=enterCommandContext(createCommandContext(!!dev,'test'));try{return loadJsonFile(filePath);}finally{exitCommandContext(previous);}}
function backupFiles(root){var files=new java.io.File(root).listFiles(),paths=[];for(var i=0;i<files.length;i++)if(String(files[i].getName()).indexOf(GLOBAL_CONFIG.spiritRetirement.backupPrefix)===0)paths.push(String(files[i].getPath()));return paths;}
function worker(ready,start){return new java.lang.Thread(new java.lang.Runnable({run:function(){try{ready.countDown();start.await();run('/정령컨텐츠보상','master');}catch(e){errors.add(String(e));}}}));}
`;
let script = `var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(h.info)},'Info.js',1,null);
var runtime=${JSON.stringify(runtime)};
function fresh(){var s=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(s,runtime,'runtime',1,null);return s;}
function run(s,code){return cx.evaluateString(s,code,'scenario',1,null);}
var s=fresh();run(s,"run('/정령컨텐츠보상','ordinary');run('/정령컨텐츠보상','admin');run('/정령컨텐츠보상 설명','master');check(member(false).member.synthetic.bag.keep===3&&!member(false)[GLOBAL_CONFIG.spiritRetirement.ledgerKey],'role/exact guard');check(backupFiles(DATA_ROOT_PATH).length===0,'denial no backup');");
print('PASS Rhino: both complete sources compile; MASTER and exact compensation command guards');
run(s,"failMember=true;var failed=false;try{run('/정령컨텐츠보상','master');}catch(e){failed=true;}check(failed,'injected error');check(!member(false)[GLOBAL_CONFIG.spiritRetirement.ledgerKey]&&!member(false).member.synthetic.bag[GLOBAL_CONFIG.spiritRetirement.castleItem],'failure does not publish partial reward');var b=loadJsonFile(backupFiles(DATA_ROOT_PATH)[0]);check(b.memberData.member.synthetic.point===1234&&b.petData.synthetic.elemental.upgrade===80,'verified full account/pet backup before mutation');");
print('PASS Rhino: actual UTF-8 files, backup verified before rewards, actual managed save failure leaves member unchanged');
s=fresh();run(s,"var ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1),a=worker(ready,start),b=worker(ready,start);a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'ready');start.countDown();a.join(10000);b.join(10000);check(!a.isAlive()&&!b.isAlive()&&errors.isEmpty(),'workers '+errors);var d=member(false),c=GLOBAL_CONFIG.spiritRetirement;check(d.member.synthetic.bag[c.castleItem]===9200&&d.member.synthetic.bag[c.raidItem]===12000,'one compensation');check(!d.member.synthetic.bag[c.removedItem]&&!d.member.noSpirit.bag[c.removedItem],'ticket removed for all users');check(d.member.synthetic.point===1234&&d.member.synthetic.bag.keep===3,'unrelated assets unchanged');check(!d.member.synthetic.spiritCharm,'items do not auto-apply charm');");
print('PASS Rhino: two actual Java threads, exactly one global grant, ticket cleanup and unrelated assets preserved');
s=fresh();run(s,"run('/정령컨텐츠보상','master');var c=GLOBAL_CONFIG.spiritRetirement;check(member(false).member.synthetic.bag[c.raidItem]===12000,'restart no duplicate');run('/레이드매력오픈 2000','synthetic');check(member(false).member.synthetic.spiritCharm.raidExp===2000,'partial open saved');");
s=fresh();run(s,"run('/레이드매력오픈 10000','synthetic');run('/캐슬매력오픈 9200','synthetic');var m=member(false).member.synthetic;check(m.spiritCharm.raidExp===12000&&m.spiritCharm.castleExp===9200,'restart remaining open');check(!m.bag[GLOBAL_CONFIG.spiritRetirement.raidItem]&&!m.bag[GLOBAL_CONFIG.spiritRetirement.castleItem],'all consumed');check(m.point===1234,'no point compensation');");
print('PASS Rhino: fresh scopes preserve one-time ledger and partial/full item opens across restart');
run(s,"run('dev/정령컨텐츠보상','master');var c=GLOBAL_CONFIG.spiritRetirement;check(member(true).member.synthetic.bag[c.raidItem]===12000,'dev grant');run('dev/레이드매력오픈 12000','synthetic');check(member(true).member.synthetic.spiritCharm.raidExp===12000,'dev open');check(member(false).member.synthetic.spiritCharm.raidExp===12000,'prod unchanged');check(backupFiles(DEV_DATA_ROOT_PATH).length===1&&backupFiles(DATA_ROOT_PATH).length===2,'isolated backups, failed attempts never overwrite original backup');check(dataSaveTransactionThreadLocal.get()===null&&commandContextThreadLocal.get()===null&&!dataTransactionLock.isLocked(),'all thread locks/context released');");
print('PASS Rhino: actual DEV/PROD file isolation, separate backups, locks and contexts released');
`;
const file = path.join(temp, 'test.js'); fs.writeFileSync(file, script, 'utf8');
const result = cp.spawnSync('java', ['-Xmx1024m', '-Dfile.encoding=UTF-8', '-cp', path.resolve(jar), 'org.mozilla.javascript.tools.shell.Main', '-opt', '-1', '-version', '200', '-encoding', 'UTF-8', '-f', file], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); assert.equal(result.status, 0);
