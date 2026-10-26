const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const gm = require('./test_gm_education'), spirit = require('./test_spirit_retirement'), lock = require('./test_territory_command_lock');
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), 'Rhino jar required');
const fixture = gm.createHarness(), config = JSON.parse(JSON.stringify(fixture.c.GLOBAL_CONFIG));
const names = lock.names.concat(['createCommandContext', 'getCurrentContext', 'enterCommandContext', 'exitCommandContext', 'getDataFileName', 'resolveActiveDataPath', 'isDevCommandMessage', 'stripDevCommandPrefix', 'createContextReplier', 'formatNicknameRankMessage', 'getDataSaveTransaction', 'beginDataSaveTransaction', 'endDataSaveTransaction']);
let script = 'var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(' + JSON.stringify(gm.main) + ',"main.js",1,null);cx.compileString(' + JSON.stringify(gm.info) + ',"Info.js",1,null);\n';
script += 'var GLOBAL_CONFIG=' + JSON.stringify(config) + ';\n' + names.map(n => spirit.block(gm.main, 'function ' + n + '(')).join('\n') + '\n' + lock.probe;
script += `
var DATA_ROOT_PATH='/synthetic/prod/',DEV_DATA_ROOT_PATH='/synthetic/dev/',COMMON_DATA_FILE_MAP={},guildPath=DATA_ROOT_PATH+'guild.json',testRoom='test';
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal();
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),flow=new java.util.concurrent.locks.ReentrantReadWriteLock(true);
var acceptedCommands=[],prodActive=true,devActive=true,messages=[];
function getResponseDataFlowLock(){return flow.writeLock();}function isServerRaidMutationCommand(){return false;}
function getMiniGameObservedVaultId(){return null;}function getAutoDailyBatchContext(){return null;}
function loadJsonFile(){return {territoryWar:{active:getCurrentContext().isDev?devActive:prodActive}};}
function check(value,label){if(!value)throw Error(label);}
var replier={reply:function(text){messages.push(String(text));}};
var forbidden=${JSON.stringify(lock.forbidden)},allowed=${JSON.stringify(lock.allowed)},count=0;
for(var d=0;d<2;d++){
 for(var u=0;u<4;u++)for(var i=0;i<forbidden.length;i++){
  acceptedCommands=[];var msg=d?'dev/'+forbidden[i].replace(/^\\//,''):forbidden[i];
  territoryEntryProbe('test',msg,['a','master','admin','오픈채팅봇'][u],true,replier,null,'test');
  check(acceptedCommands.length===0,'forbidden '+msg);check(!dataTransactionLock.isLocked()&&!flow.isWriteLocked(),'locks released');check(getDataSaveTransaction()===null,'transaction released');count++;
 }
 for(var j=0;j<allowed.length;j++){acceptedCommands=[];territoryEntryProbe('test',d?'dev/'+allowed[j].substring(1):allowed[j],'master',true,replier,null,'test');check(acceptedCommands.length===1&&acceptedCommands[0]===allowed[j],'allowed '+allowed[j]);count++;}
}
prodActive=false;devActive=false;for(var d=0;d<2;d++){acceptedCommands=[];territoryEntryProbe('test',d?'dev/ㅊㅊ':'ㅊㅊ','a',true,replier,null,'test');check(acceptedCommands.length===1,'inactive returns normal flow');}
print('PASS Rhino territory lock: '+count+' role/environment/command cases; real Java locks; Main/Info compile; inactive flow restored');
`;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hoibot-territory-lock-')), file = path.join(folder, 'test.js'); fs.writeFileSync(file, script, 'utf8');
const result = cp.spawnSync('java', ['-Dfile.encoding=UTF-8', '-cp', path.resolve(jar), 'org.mozilla.javascript.tools.shell.Main', '-opt', '-1', '-version', '200', '-encoding', 'UTF-8', '-f', file], { encoding: 'utf8', timeout: 60000 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); assert.equal(result.status, 0);
