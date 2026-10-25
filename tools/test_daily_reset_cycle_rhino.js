// Rhino의 실제 Java 파일·새 전역·스레드로 공통 일일 리셋 회차를 검증한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const h = require('./test_mini_games'), daily = require('./test_daily_reset_cycle'), f = daily.fixture();
const jar = process.argv[2]; assert(jar && fs.existsSync(jar), 'Rhino jar required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoibot-daily-cycle-rhino-'));
const prod = path.join(temp, 'prod').replace(/\\/g, '/') + '/', dev = path.join(temp, 'dev').replace(/\\/g, '/') + '/';
for (const [target, source] of [[prod, '/sdcard/호이랜드/'], [dev, '/sdcard/호이랜드_dev/']]) {
    fs.mkdirSync(target);
    for (const name of ['member.json', 'member_pet.json', 'skills.json', 'guild.json', 'petHomeActivityData.json', 'attendanceLight.json', f.c.GLOBAL_CONFIG.guildMarble.fileName]) {
        fs.writeFileSync(target + name, f.disk()[source + name] || '{}');
    }
}
const names = [...new Set(daily.helperNames.concat(['createCommandContext', 'getCurrentContext', 'enterCommandContext', 'exitCommandContext',
    'getDataFileName', 'resolveActiveDataPath', 'parseJsonContent', 'ensureParentFolder', 'loadJsonFile', 'saveJsonFile',
    'getDataSaveTransaction', 'beginDataSaveTransaction', 'endDataSaveTransaction', 'prepareManagedJsonTransactionEntry', 'rollbackDataSaveTransaction',
    'getManagedJsonBackupPath', 'getManagedJsonSecondaryBackupPath', 'getManagedJsonBackupCandidates', 'restoreManagedJsonFromBackup',
    'isProtectedManagedJsonPath', 'parseManagedJsonContent', 'getProtectedJsonSaveLock', 'writeVerifiedJsonFile', 'writeMemberSplitSlot',
    'isDevCommandMessage', 'stripDevCommandPrefix', 'createContextReplier', 'roundToTwo', 'getPetHomeTodayText']))];
let runtime = 'var GLOBAL_CONFIG=' + JSON.stringify(f.c.GLOBAL_CONFIG) + ';\n' + names.map(n => h.block(h.main, 'function ' + n + '(')).join('\n');
runtime += `
var DATA_ROOT_PATH=${JSON.stringify(prod)},DEV_DATA_ROOT_PATH=${JSON.stringify(dev)},COMMON_DATA_FILE_MAP={};
var filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json',petSkillDataPath=DATA_ROOT_PATH+'skills.json',guildPath=DATA_ROOT_PATH+'guild.json',carrotBoardPath=DATA_ROOT_PATH+'carrotBoard.json';
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),protectedJsonSaveLocks={},MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;
var testRoom='test',roomToServer={},allsee='<ALLSEE>',messages=new java.util.concurrent.ConcurrentLinkedQueue(),errors=new java.util.concurrent.ConcurrentLinkedQueue();for(var i=1;i<=100;i++)this['room'+i]='room'+i;
var clockTime=Date.parse('2026-10-26T14:59:59Z');Date.now=function(){return clockTime;};
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));}};
var Api={replyRoom:function(){}},replier={reply:function(t){messages.add(String(t));}};
function print(t){java.lang.System.out.println(String(t));}function getAutoDailyBatchContext(){return null;}function debuggerLog(){}function notifyManagedJsonRecovery(){}function notifyManagedJsonRecoveryFailure(){}
function stopAllIntervals(){}function runHoiPassPremiumAutoAttendance(){return {message:'synthetic auto attendance',noticeMessage:''};}function runMiniGameEntry(){return [];}function scheduleMiniGameWork(){}
function getActivePetHomeMutualCount(){return 0;}function getPetSkillHeartBonus(){return 0;}function isHoiPassPremiumActive(){return true;}
function processAdventureLevelUps(){return [];}function formatDateTime(){return 'synthetic';}function numberWithCommas(n){return String(n);}function migrateLightSearchAuthenticationToMember(){return false;}
function check(v,label){if(!v)throw Error(label);}function raw(n){return FileStream.read(resolveActiveDataPath(DATA_ROOT_PATH+n));}
function read(n){return JSON.parse(raw(n));}function put(n,d){writeVerifiedJsonFile(resolveActiveDataPath(DATA_ROOT_PATH+n),JSON.stringify(d),true);}
function reset(message,sender,dev){dataTransactionLock.lock();var ctx=createCommandContext(!!dev,'test'),previous=enterCommandContext(ctx),msg=message||'/리셋',sender=sender||'호이 남';beginDataSaveTransaction();try{var data=loadJsonFile(filePath),petData=loadJsonFile(memberPetPath),petSkillData=loadJsonFile(petSkillDataPath),guildData=loadJsonFile(guildPath);
` + h.block(h.main, 'if (msg === "/리셋" && (sender == "오픈채팅봇"') + `
}catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(previous);dataTransactionLock.unlock();}}
function usage(dev,consume){var previous=enterCommandContext(createCommandContext(!!dev,'test'));try{var d=read('member.json'),cycle=getDailyResetCycle(d),marble=read(GLOBAL_CONFIG.guildMarble.fileName),activity=read('petHomeActivityData.json'),light=read('attendanceLight.json');var r={cycle:cycle,diamond:getDiamondTycoonDailyData(d,'a').usedCount,marble:getGuildMarbleDailyCount(marble,cycle),heart:getPetHomeHeartUsageStatus(d,{},activity,{},'a').used,lightAlready:recordLightAttendanceOnly(light,'light','test',d).already,chat:awardDailyChatExperience(d,'a').total};if(consume){d.member.a.diamondTycoon.usedCount=10;d.member.a.chatExperienceDaily.experience=1000;marble.usage.dailyResetCycle=cycle;marble.usage.count=7;activity.petHomeSocial.a.heartUsage.count=16;put('member.json',d);put(GLOBAL_CONFIG.guildMarble.fileName,marble);put('petHomeActivityData.json',activity);put('attendanceLight.json',light);}return r;}finally{exitCommandContext(previous);}}
`;
// 합성 활동 파일은 저장 검증 중에도 실제 도메인 검증기를 사용한다.
runtime += ['requirePetHomeActivityData', 'validatePetHomeSocialUser', 'normalizePetHomeEquippedBadgeIds'].map(n => h.block(h.main, 'function ' + n + '(')).join('\n');
// 픽스처의 알림도 실제 검증 구조로 맞춘다.
for (const root of [prod, dev]) { const p = root + 'petHomeActivityData.json', d = JSON.parse(fs.readFileSync(p)); d.alerts = {}; d.recentVisitors = {}; fs.writeFileSync(p, JSON.stringify(d)); }
let script = 'var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(' + JSON.stringify(h.main) + ',"main.js",1,null);cx.compileString(' + JSON.stringify(fs.readFileSync(path.join(h.root, 'Info.js'), 'utf8')) + ',"Info.js",1,null);print("PASS Rhino full Main/Info compilation");\nvar runtime=' + JSON.stringify(runtime) + ';function fresh(){var s=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(s,runtime,"runtime",1,null);return s;}var s=fresh();function step(t){cx.evaluateString(s,t,"scenario",1,null);}\n';
const step = text => { script += 'step(' + JSON.stringify(text) + ');\n'; };
step("var used=JSON.stringify(usage());clockTime+=2000;check(JSON.stringify(usage())===used,'midnight preserves all quotas');clockTime+=5*86400000;check(JSON.stringify(usage())===used,'days offline preserve all quotas');print('PASS Rhino legacy quota survives midnight and days offline');");
step("var game=raw(GLOBAL_CONFIG.guildMarble.fileName),activity=raw('petHomeActivityData.json'),light=raw('attendanceLight.json');reset();var u=usage();check(u.cycle===1&&u.diamond===0&&u.marble===0&&u.heart===0&&!u.lightAlready&&u.chat===1,'all quotas follow actual reset');check(raw(GLOBAL_CONFIG.guildMarble.fileName)===game&&raw('petHomeActivityData.json')===activity&&raw('attendanceLight.json')===light,'reset preserves existing game and external originals');usage(false,true);print('PASS Rhino actual reset branch publishes one shared cycle and preserves game originals');");
script += 's=fresh();\n';
step("clockTime+=20*86400000;var u=usage();check(u.cycle===1&&u.diamond===10&&u.marble===7&&u.heart===16&&u.lightAlready&&u.chat===0,'restart does not grant quota');print('PASS Rhino fresh global restores spent quotas without clock reset');");
step("var original=raw('member.json');reset('/리셋','a');reset('/리셋 해봐','호이 남');check(raw('member.json')===original,'authorization and suffix preserve cycle');var writer=writeVerifiedJsonFile;writeVerifiedJsonFile=function(p,t,skip,v){if(String(p)===filePath)throw Error('synthetic member save failure');return writer(p,t,skip,v);};var failed=false;try{reset();}catch(e){failed=true;}writeVerifiedJsonFile=writer;check(failed&&raw('member.json')===original&&usage().cycle===1&&usage().marble===7,'failed reset keeps all quotas');reset();check(usage().cycle===2&&usage().marble===0,'retry publishes one new cycle');print('PASS Rhino reset permission, file failure rollback and retry');");
step("var prodMember=raw('member.json');reset('/리셋','호이 남',true);check(raw('member.json')===prodMember&&usage(true).cycle===1,'DEV reset isolated');usage(false,true);var jobs=[];for(var i=0;i<2;i++){jobs.push(new java.lang.Thread(new java.lang.Runnable({run:function(){var localCx=org.mozilla.javascript.Context.enter();localCx.setOptimizationLevel(-1);localCx.setLanguageVersion(200);try{reset();}catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}}})));}for(var i=0;i<jobs.length;i++)jobs[i].start();for(var i=0;i<jobs.length;i++)jobs[i].join();check(errors.isEmpty()&&usage().cycle===4,'concurrent authorized resets serialize without a lost cycle');print('PASS Rhino DEV isolation and two serialized Java reset threads');");
const file = path.join(temp, 'test.js'); fs.writeFileSync(file, script, 'utf8');
const result = cp.spawnSync('java', ['-Dfile.encoding=UTF-8', '-Duser.timezone=Asia/Seoul', '-cp', jar, 'org.mozilla.javascript.tools.shell.Main', '-encoding', 'UTF-8', '-version', '200', '-opt', '-1', file], { encoding: 'utf8', timeout: 60000, maxBuffer: 2e6 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); assert.equal(result.status, 0, 'Rhino evidence: ' + temp);
console.log('Synthetic evidence: ' + temp);
