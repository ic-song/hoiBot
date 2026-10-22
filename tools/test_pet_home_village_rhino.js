const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),cp=require('child_process');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const text=fs.readFileSync(path.join(__dirname,'test_pet_home_village.js'),'utf8');
const h=new Function('require','__dirname',text.slice(0,text.indexOf('\nlet groups=0;'))+'\nreturn {c,block,main,info,functions,registration};')(require,__dirname);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-village-rhino-')),root=path.join(dir,'data').replace(/\\/g,'/')+'/';fs.mkdirSync(root);
const block=m=>h.block(h.main,m);
const functions=[...new Set(h.functions.concat(['createCommandContext','getCurrentContext','enterCommandContext','exitCommandContext','getDataFileName','resolveActiveDataPath',
 'getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction',
 'getProtectedJsonSaveLock','writeVerifiedJsonFile','loadJsonFile','saveJsonFile','parseJsonContent','parseManagedJsonContent','ensureParentFolder',
 'isDevCommandMessage','stripDevCommandPrefix','isManualResetInput','isManualResetLegacyCommand','isAutoDailyEntryCommandMessage','isExclusiveDataMutationCommandMessage','getResponseDataFlowLock',
 'isRegisteredHomeMember','isSamePetHomeComment','isPinnedPetHomeComment','getPetHomePassBenefitCost','hasPoint','addPoint']))];
const runtime='var GLOBAL_CONFIG='+JSON.stringify(h.c.GLOBAL_CONFIG)+';\n'+h.main.match(/const PET_SKILL_LIST = \[[\s\S]*?\n\];/)[0]+'\n'+functions.map(n=>block('function '+n+'(')).join('\n')+`
var DATA_ROOT_PATH=${JSON.stringify(root)},DEV_DATA_ROOT_PATH=DATA_ROOT_PATH+'dev/',COMMON_DATA_FILE_MAP={};
var filePath=DATA_ROOT_PATH+'member.json',homeDataFile=DATA_ROOT_PATH+'home.json',petSkillDataPath=DATA_ROOT_PATH+'skills.json',memberPetPath=DATA_ROOT_PATH+'pets.json',petHomePlacedFurniturePath=DATA_ROOT_PATH+'placed.json',petHomeCommentsFile=DATA_ROOT_PATH+'comments.json';
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true),commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),protectedJsonSaveLocks={};
var sender='synthetic',room='test',isGroupChat=true,ctx={isDev:false},testRoom='test',petHomeVillagePending={},messages=[],errors=new java.util.concurrent.ConcurrentLinkedQueue(),saveCount=0;
var replier={reply:function(s){messages.push(String(s));}},allsee='<ALLSEE>',isDebuggerFlag=false;
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));}};
function put(p,v){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(JSON.stringify(v)).getBytes('UTF-8'));}
function check(v,label){if(!v)throw new Error(label);}
function getAutoDailyBatchContext(){return null;}function getManagedJsonBackupPath(){return null;}function getManagedJsonSecondaryBackupPath(){return null;}function isProtectedManagedJsonPath(){return false;}function debuggerLog(){}
function checkRank(d,p,g,u){return u;}function numberWithCommas(n){return String(n);}function getHoiPassPremiumHeader(){return '';}function isHoiPassPremiumActive(){return false;}
function hasActiveHoiPassAccess(){return true;}
function isServerRaidMutationCommand(){return false;}function getRaidSealCraftRequest(){return null;}function getStoneBoxOpenRequest(){return null;}function isSealedVaultMutationCommandMessage(){return false;}function isCarrotTradeEntryMessage(){return false;}function getCarrotTradeReply(){return null;}
function calculateCastleItem(){return 0;}function calculateItemInfoAll(){return {castleExp:0,raidExp:0};}function getMiniPetModeCharm(){return 0;}function getIntimacyExpFromBag(){return 0;}function getEquippedTierPetSkillExp(){return 0;}function getHomeBadgeCubeActiveOptionPercent(){return 0;}function getGuildContributionCubeMemberPercent(){return 0;}function getAdventureLevelCharmPercent(){return 0;}
function reset(){
 petHomeVillagePending={};messages=[];var bag=[];for(var i=0;i<10;i++)bag.push({id:'R'+i,name:'가구'+i,grade:'로열 루미에르',exp:100});
 var home={synthetic:{floor:100,houseName:'합성집',exp:1000,furnitureBag:bag,placedFurnitureSummary:{count:1,totalExp:10000,royalLumiereCount:0,gradeCounts:{일반:1}},lumiereVillage:{royal:{level:3,progress:9},arcana:{level:0,progress:0}}}};
 put(homeDataFile,home);put(petSkillDataPath,{synthetic:{petSkills:{equipped:['인테리어 장인','느그 집 마련의 꿈'],lockedPremium:[],bag:{}}}});put(petHomePlacedFurniturePath,{synthetic:[{id:'P',name:'원래가구',grade:'일반',exp:10000}]});
}
function execute(msg){
 var flow=getResponseDataFlowLock(msg);flow.lock();dataTransactionLock.lock();var prev=enterCommandContext(createCommandContext(false,room));beginDataSaveTransaction();
 try{var data={member:{synthetic:{bag:{},point:1}}},petData={synthetic:{petname:'합성펫'}},petSkillData=loadJsonFile(petSkillDataPath),guildData={};
 ${h.registration}
 ${block('if (msg === "/댓글핀" ||')}
 ${block('if (msg === "/댓글핀삭제" ||')}
 }catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(prev);dataTransactionLock.unlock();flow.unlock();}
}
function worker(ready,start){return new java.lang.Thread(new java.lang.Runnable({run:function(){org.mozilla.javascript.Context.enter();try{ready.countDown();start.await();execute('등록한다');}catch(e){errors.add(String(e));}finally{org.mozilla.javascript.Context.exit();}}}));}
`;
let script='var context=org.mozilla.javascript.Context.getCurrentContext();\ncontext.compileString('+JSON.stringify(h.main)+',"main.js",1,null);\ncontext.compileString('+JSON.stringify(h.info)+',"Info.js",1,null);\n'+runtime+`
for(var attempt=0;attempt<20;attempt++){
 reset();execute('/별채등록 1');var ready=new java.util.concurrent.CountDownLatch(2),start=new java.util.concurrent.CountDownLatch(1),a=worker(ready,start),b=worker(ready,start);
 a.start();b.start();check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'threads ready');start.countDown();a.join(5000);b.join(5000);check(!a.isAlive()&&!b.isAlive(),'threads finished');check(errors.isEmpty(),String(errors));
 var saved=loadJsonFile(homeDataFile).synthetic;check(saved.furnitureBag.length===9&&saved.lumiereVillage.royal.level===4&&saved.lumiereVillage.royal.progress===0,'only once');check(messages.length===2,'one confirm and one completion');
}
print('PASS Rhino: MAIN/Info full compile; actual registration and Java UTF-8 verified saves; 20 concurrent confirmation pairs consume once');
var home=loadJsonFile(homeDataFile),skills=loadJsonFile(petSkillDataPath),charm=getPetHomeFurnitureCharm(home,skills,'synthetic');check(charm.interior===1100&&charm.percent===50&&charm.villageBonus===5000&&charm.total===32200,'dream adds 10 percentage points once');
var reload=JSON.parse(FileStream.read(homeDataFile));check(getPetHomeFurnitureCharm(reload,skills,'synthetic').total===charm.total,'restart no duplicate');
var bad=JSON.parse(JSON.stringify(reload));bad.synthetic.lumiereVillage.royal.progress=10;var threw=false;try{getPetHomeFurnitureCharm(bad,skills,'synthetic');}catch(e){threw=true;}check(threw,'invalid state fails');
print('PASS Rhino: separate interior/village/dream arithmetic, saved-state reload, malformed state rejected');
var original=FileStream.read(homeDataFile),before=loadJsonFile(homeDataFile);before.synthetic.lumiereVillage.royal.progress=7;
beginDataSaveTransaction();try{saveJsonFile(before,homeDataFile,false,original);rollbackDataSaveTransaction();}finally{endDataSaveTransaction();}check(FileStream.read(homeDataFile)===original,'snapshot rollback');
check(!dataTransactionLock.isLocked()&&dataSaveTransactionThreadLocal.get()===null&&commandContextThreadLocal.get()===null,'locks cleaned');
print('PASS Rhino: actual one-file snapshot rollback and all locks/contexts released');
isProtectedManagedJsonPath=function(target){return String(target)===String(filePath);};
put(filePath,{member:{synthetic:{point:1,bag:{}}}});put(petHomeCommentsFile,{comments:{synthetic:[{from:'other',text:'실제 댓글',time:'2026-10-22'}]},pinnedComments:{}});
execute('/댓글핀 1');check(loadJsonFile(petHomeCommentsFile).pinnedComments.synthetic[0].text==='실제 댓글','Rhino pin persisted');check(loadJsonFile(filePath).member.synthetic.point===1,'pass cost zero');
var pinnedBefore=FileStream.read(petHomeCommentsFile);execute('/댓글핀 1');execute('/댓글핀 0');execute('/댓글핀 1 해봐');check(FileStream.read(petHomeCommentsFile)===pinnedBefore,'invalid and duplicate pins unchanged');
execute('/댓글핀삭제 1');check(loadJsonFile(petHomeCommentsFile).pinnedComments.synthetic.length===0&&loadJsonFile(petHomeCommentsFile).comments.synthetic.length===1,'unpin preserves original');
var memberBefore=FileStream.read(filePath),commentsBefore=FileStream.read(petHomeCommentsFile),originalWrite=writeVerifiedJsonFile;
for(var failurePhase=0;failurePhase<2;failurePhase++){
 writeVerifiedJsonFile=function(target,value){if(String(target)===String(petHomeCommentsFile)){writeVerifiedJsonFile=originalWrite;if(failurePhase===1)originalWrite.apply(this,arguments);throw new Error('synthetic pin save failure');}return originalWrite.apply(this,arguments);};
 var pinFailed=false;try{execute('/댓글핀 1');}catch(e){pinFailed=true;}finally{writeVerifiedJsonFile=originalWrite;}
 check(pinFailed&&FileStream.read(filePath)===memberBefore&&FileStream.read(petHomeCommentsFile)===commentsBefore,'pin two-file failure rollback phase '+failurePhase);
}
print('PASS Rhino: real pin/unpin persistence, duplicate/invalid guards, pass cost and two-file failure rollback');
`;
const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');const result=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0);
