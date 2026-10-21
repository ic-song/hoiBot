const assert=require("assert"),fs=require("fs"),path=require("path"),os=require("os"),child=require("child_process");
const baselineRef="91fc5ba09123a1dd4a7b30097ec502e540f00be1";
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),"Rhino jar required");
const localRequire=require("module").createRequire(path.resolve(__dirname,"test_server_raid_io.js"));
const utility=fs.readFileSync(path.join(__dirname,"test_server_raid_io.js"),"utf8");
const {storageFixture}=new Function("require","__dirname",utility.slice(0,utility.indexOf("\nlet count"))+"\nreturn {storageFixture};")(localRequire,__dirname);

// 운영 데이터 대신 동일한 합성 회원·과거 회차·설정으로 두 소스의 저장/공격 구간을 비교한다.
function seed(){
 const h=storageFixture();h.setup();const f=h.fixture,d=f.read();d.syntheticPadding="m".repeat(1400000);
 d.serverRaid.history=Array.from({length:12},(_,i)=>({id:"past-"+i,accounts:{},note:"r".repeat(270000)}));
 for(const k of h.c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)d[k]=[{feature:"SYNTHETIC",detail:"l".repeat(44000)}];
 for(const user of Object.keys(d.member))d.member[user].serverRaidAccount={id:"synthetic-"+user,period:0,server:d.member[user].server,latest:null,total:null};
 f.write(d);h.migrate();f.start();
 const pets=JSON.parse(f.disk()[h.c.memberPetPath]);for(const p of Object.values(pets)){p.petexp=100000;p.dollCharm=20000;}f.disk()[h.c.memberPetPath]=JSON.stringify(pets);
 return {disk:JSON.parse(JSON.stringify(f.disk())),now:f.now(),config:JSON.parse(JSON.stringify(h.c.GLOBAL_CONFIG)),block:f.block};
}
const sample=seed(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"hoibot-raid-profile-"));
const names=["createCommandContext","getCurrentContext","enterCommandContext","exitCommandContext","getDataFileName","resolveActiveDataPath","createContextReplier",
 "getDataSaveTransaction","beginDataSaveTransaction","endDataSaveTransaction","prepareManagedJsonTransactionEntry","rollbackDataSaveTransaction",
 "getProtectedJsonSaveLock","isProtectedManagedJsonPath","parseManagedJsonContent","parseJsonContent","getManagedJsonBackupPath","getManagedJsonSecondaryBackupPath",
 "writeVerifiedJsonFile","saveJsonFile","loadJsonFile","getMemberSplitMarker","getMemberSplitStorePath","getMemberSplitBackupPath","requireMemberSplitStore","readMemberSplitStore",
 "readPublishedMemberSplitStore","attachMemberSplitStores","buildMemberSplitRaidSummary","buildMemberSplitSavePlan","stringifyMemberSplitStore","writeMemberSplitSlot","preserveMemberSplitBackupStores",
 "requireAdventureRecordStore","validateAdventureRecordPending","recoverAdventureRecordPending","getAdventureRecordRecoveryNames",
 "normalizeHoiServerLabel","formatNicknameRankMessage","noticeMsg",
 "calculateRaidExp","getPetModeCharmPercent","getAdventurePromotionCounts","getAdventureLevelCharmPercent","applyPercentWithExactFloor","calculateEffectivePetUpgradeLevel",
 "getHomeBadgeCubeStore","normalizeHomeBadgeCubeEquippedBadgeIds","getHomeBadgeCubeRecord","getHomeBadgeCubeOptionConfig","isHomeBadgeCubeTotalBuffActive",
 "isHomeBadgeCubeOptionAppliedInSlot","getHomeBadgeCubeSlotOptionPercent","getHomeBadgeCubeActiveOptionPercent",
 "calculateItemInfoAll","calculateItemInfo","calculatePendantItemInfo","calculatePendantStats","getMiniPetModeCharm","getHomeTotalExp","hasPetSkill","normalizePetSkillName","getEquippedPetSkillNames",
 "getEquippedNonTierPetSkillExp","getEquippedTierPetSkillExp","getMyGuildId","getGuildContributionCubeOptionByKey","getGuildContributionCubeData","getGuildContributionCubeMemberPercent",
 "getCappedUpgradeForCrit","getCritChance","calculateCritChance","getCritMultiplier","calculateCriticalDamage","isPointShopSafeAmount","isPointShopSafeCount"];

// 실제 소스의 공격 분기에만 측정 경계를 삽입하며 실행 규칙/계산/저장은 그대로 사용한다.
function runtime(main,root,scenario){
 const block=(marker)=>sample.block(main,marker);
 const split=JSON.parse(JSON.stringify(storageFixture().c.MEMBER_STORAGE_SPLIT_CONFIG));for(const k of Object.keys(split))if(typeof split[k]==="string")split[k]=split[k].replace("/sdcard/호이랜드/",root);
 let code="var DATA_ROOT_PATH="+JSON.stringify(root)+",DEV_DATA_ROOT_PATH="+JSON.stringify(root+"dev/")+",COMMON_DATA_FILE_MAP={};\n";
 code+="var filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json',guildPath=DATA_ROOT_PATH+'guild.json',homeDataFile=DATA_ROOT_PATH+'home.json',petSkillDataPath=DATA_ROOT_PATH+'skills.json';\n";
 code+="var GLOBAL_CONFIG="+JSON.stringify(sample.config)+",MEMBER_STORAGE_SPLIT_CONFIG="+JSON.stringify(split)+";\n";
 for(const name of names){if(name==="stringifyMemberSplitStore"&&!main.includes("function "+name+"("))continue;code+=block("function "+name+"(")+"\n";}
 code+=main.slice(main.indexOf("function serverRaidHeader("),main.indexOf("// 길드 영지전 관련 함수들"))+"\n";
 code+="var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true),protectedJsonSaveLocks={},memberSplitBackupCache={},serverRaidNoticeMemberRevisions={},serverRaidWorkTimers={},serverRaidNoticeWorkers={};\n";
 code+="var MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000,isDebuggerFlag=false,testRoom='test',allsee='<ALLSEE>',BASE_CRIT_DAMAGE_MULTIPLIER=1.7,raidSpecialItem={dept2:{}},itemInfoData={},clock="+sample.now+";\n";
 code+="Date.now=function(){return clock;};Math.random=function(){return 0.99;};function isHoiPassPremiumActive(){return false;}function getAutoDailyBatchContext(){return null;}function setTimeout(){return 1;}function clearTimeout(){}function debuggerLog(s){print('ERROR '+s);}function formatDateTime(){return 'synthetic';}function ensureParentFolder(p){new java.io.File(p).getParentFile().mkdirs();}function restoreManagedJsonFromBackup(p){throw Error('unexpected recovery '+p);}function checkRank(d,p,g,u){return u;}function numberWithCommas(n){return String(n);}function check(v,s){if(!v)throw Error(s);}\n";
 code+="var io={readBytes:0,reads:0,syncs:0},rows=[],lastTick=0;function timerNow(){return Number(java.lang.System.nanoTime())/1000000;}function mark(label){var n=timerNow();rows.push({label:label,ms:n-lastTick});lastTick=n;}var FileStream={read:function(p){var bytes=java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p)));io.readBytes+=bytes.length;io.reads++;return String(new java.lang.String(bytes,'UTF-8'));}};\n";
 let branch=block('if (msg === "/레이드공격") {');
 for(const [anchor,label] of [
 ["var raidHomeData =","eligibility"],["var raidR =","homeSkillsRead"],["var raidAttack = applyServerRaidAttack","calculation"],["var raidAttackMessage =","mutation"],["saveJsonFile(data, filePath);\n                replyServerRaidSafely(replier, raidAttackMessage);","message"]
 ]){assert(branch.includes(anchor),anchor);branch=branch.replace(anchor,"mark('"+label+"');"+anchor);}
 branch=branch.replace("replyServerRaidSafely(replier, raidAttackMessage);","mark('save');replyServerRaidSafely(replier, raidAttackMessage);mark('reply');");
 const deferred=main.includes("var raidAttackReplyQueue = null;");
 if(deferred)branch=branch.replace("mark('reply');", "");
 code+="function attackProfile(index){var before=timerNow(),prev=null;rows=[];io={readBytes:0,reads:0,syncs:0};lastTick=before;commandDataFlowLock.writeLock().lock();mark('commandLockWait');dataTransactionLock.lock();mark('dataLockWait');beginDataSaveTransaction();var ctx=createCommandContext(false,'room8');prev=enterCommandContext(ctx);var msg='/레이드공격',sender=['a','b','c','master','admin'][Math.floor(index/5)%5],serverRaidEvent={id:'sample-'+index},output='',queued=[],target={reply:function(t){output=String(t);}},replier=target;try{";
 if(deferred)code+="replier={reply:function(t){queued.push(t);}};";
 code+="var data=loadJsonFile(filePath,'raid');mark('memberRead');var raidPetData=loadJsonFile(memberPetPath),raidGuildData=loadJsonFile(guildPath),raidNick='['+sender+'] 님';mark('petGuildRead');"+branch+
 "}finally{endDataSaveTransaction();dataTransactionLock.unlock();commandDataFlowLock.writeLock().unlock();";
 if(deferred)code+="lastTick=timerNow();for(var q=0;q<queued.length;q++)replyServerRaidSafely(target,queued[q]);mark('reply');";
 code+="exitCommandContext(prev);var total=timerNow()-before;lastResult={totalMs:total,rows:rows,io:io,message:output};}}\n";
 // 보호 저장의 fsync는 실제 호출을 유지하며 횟수만 추가 계측한다.
 code=code.replace("outputStream.getFD().sync();","outputStream.getFD().sync();io.syncs++;");
 code+=scenario===undefined?"var samples=[];for(var i=0;i<15;i++){clock++;attackProfile(i);if(i>=5)samples.push(lastResult);}print('RESULT '+JSON.stringify({samples:samples,member:JSON.parse(FileStream.read(filePath)).member,raid:loadJsonFile(filePath,'raid').serverRaid}));\n":scenario;
 return code;
}
function run(label,main){
 const root=path.join(dir,label).replace(/\\/g,"/")+"/";fs.mkdirSync(root,{recursive:true});
 for(const [p,text]of Object.entries(sample.disk))if(p.startsWith("/sdcard/호이랜드/"))fs.writeFileSync(root+p.slice("/sdcard/호이랜드/".length),text,"utf8");
 const file=path.join(dir,label+".js");fs.writeFileSync(file,runtime(main,root),"utf8");
 const r=child.spawnSync("java",["-Xmx1024m","-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",file],{encoding:"utf8",timeout:60000,maxBuffer:20*1024*1024});
 if(r.status!==0){process.stderr.write((r.stdout||"")+(r.stderr||""));throw Error(label+" failed "+r.status+" / "+file);}
 const result=JSON.parse(r.stdout.split(/\r?\n/).find(x=>x.startsWith("RESULT ")).slice(7));
 function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)];}
 const phases={};for(const row of result.samples[0].rows)phases[row.label]=median(result.samples.map(s=>s.rows.find(r=>r.label===row.label).ms));
 const report={totalMedianMs:median(result.samples.map(s=>s.totalMs)),phaseMedianMs:phases,io:result.samples[0].io,samples:result.samples.map(s=>({totalMs:s.totalMs,rows:s.rows}))};
 return {result,report};
}
if(require.main===module){
const beforeSource=child.execFileSync("git",["show",baselineRef+":main.js"],{encoding:"utf8",maxBuffer:20*1024*1024}),current=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8").replace(/\r\n/g,"\n");
const before=run("before",beforeSource.replace(/\r\n/g,"\n")),after=run("after",current);
assert.deepStrictEqual(after.result.member,before.result.member);assert.deepStrictEqual(after.result.raid,before.result.raid);
assert.deepStrictEqual(after.result.samples.map(s=>s.message),before.result.samples.map(s=>s.message));
const report={baseline:baselineRef,environment:"local Rhino 1.7.15 interpreter + actual Java files/fsync, synthetic input; not Android timing",samples:10,warmup:5,gameAndMessagesEqual:true,before:before.report,after:after.report};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({...report,before:{...report.before,samples:undefined},after:{...report.after,samples:undefined}},null,2));
}
module.exports={runtime,sample,dir,baselineRef};
