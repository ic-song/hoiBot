// 로컬 Rhino의 실제 Java 파일·스레드로 전체등록의 동시 소비·롤백·재시작을 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),h=require('./test_mini_pet_collection_all');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const fixture=h.createHarness();fixture.seed();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-minicollection-rhino-')),root=path.join(dir,'prod').replace(/\\/g,'/')+'/',dev=path.join(dir,'dev').replace(/\\/g,'/')+'/';
for(const folder of [root,dev])fs.mkdirSync(folder);
const names=[...new Set(h.helperNames.concat(['createCommandContext','getCurrentContext','enterCommandContext','exitCommandContext','getDataFileName','resolveActiveDataPath',
    'getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction','getProtectedJsonSaveLock',
    'writeVerifiedJsonFile','loadJsonFile','saveJsonFile','parseJsonContent','parseManagedJsonContent','isProtectedManagedJsonPath','getManagedJsonBackupPath','getManagedJsonSecondaryBackupPath','getManagedJsonBackupCandidates','restoreManagedJsonFromBackup','ensureParentFolder','isDevCommandMessage','stripDevCommandPrefix']))];
const runtime='var GLOBAL_CONFIG='+JSON.stringify(fixture.c.GLOBAL_CONFIG)+';\n'+names.map(n=>h.block(h.main,'function '+n+'(')).join('\n')+'\n'+h.gradesSource+'\n'+h.tableSetup+`
var DATA_ROOT_PATH=${JSON.stringify(root)},DEV_DATA_ROOT_PATH=${JSON.stringify(dev)},COMMON_DATA_FILE_MAP={},filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json',miniPetCollectionPath=DATA_ROOT_PATH+'miniPet_collection.json',miniPetTitlePath=DATA_ROOT_PATH+'miniPet_title.json';
var dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),commandDataFlowLock=new java.util.concurrent.locks.ReentrantReadWriteLock(true),commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),protectedJsonSaveLocks={},MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;
var userState={},miniPetCollectionAllPending={},messages=new java.util.concurrent.ConcurrentLinkedQueue(),errors=new java.util.concurrent.ConcurrentLinkedQueue(),miniPetData={gradeTable:[]},castleSiegeFlag=false,allsee='<ALLSEE>';
var miniPetCollectionInfo=${JSON.stringify(fixture.c.miniPetCollectionInfo)};
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(String(t)).getBytes('UTF-8'));}};
function getAutoDailyBatchContext(){return null;}function debuggerLog(){}function notifyManagedJsonRecovery(){}function notifyManagedJsonRecoveryFailure(){}
function hasPetSkill(){return false;}function checkRank(d,p,g,u){return u;}function numberWithCommas(n){return String(n);}function getMiniPetBagLimit(){return 15;}
function check(v,s){if(!v)throw Error(s);}function put(p,v){FileStream.write(p,JSON.stringify(v));}function member(dev){return loadJsonFile((dev?DEV_DATA_ROOT_PATH:DATA_ROOT_PATH)+'member.json');}
function seed(count,stage,upgrade){
 userState={};miniPetCollectionAllPending={};messages.clear();errors.clear();var bag=[],registered={};for(var i=0;i<count;i++)bag.push({name:'합성'+i,grade:MINI_PET_COLLECTION_ALLOWED_GRADES[i%8],battleExp:count-i,castleExp:count-i,raidExp:count-i,upgrade:upgrade});
 for(var j=0;j<MINI_PET_COLLECTION_ALLOWED_GRADES.length;j++)registered[MINI_PET_COLLECTION_ALLOWED_GRADES[j]]=false;
 for each(var folder in [DATA_ROOT_PATH,DEV_DATA_ROOT_PATH]){put(folder+'member.json',{member:{a:{point:1000000000000,bag:{'미니펫 강화석💫':1000000}}}});put(folder+'member_pet.json',{a:{miniPetBag:bag,miniPet:{name:'장착펫',grade:'창조',battleExp:1}}});put(folder+'miniPet_collection.json',{member:{a:{collection:{stage:stage,completedStage:stage-1,registered:registered}}}});put(folder+'miniPet_title.json',{});}
}
function snapshot(dev){var folder=dev?DEV_DATA_ROOT_PATH:DATA_ROOT_PATH,rows=[];for each(var name in ['member.json','member_pet.json','miniPet_collection.json','miniPet_title.json'])rows.push(FileStream.read(folder+name));return JSON.stringify(rows);}
function run(message,dev,where){var flow=commandDataFlowLock.writeLock();flow.lock();dataTransactionLock.lock();var ctx=createCommandContext(!!dev,where||'test'),previous=enterCommandContext(ctx);beginDataSaveTransaction();
var sender='a',room=where||'test',isGroupChat=true,msg=isDevCommandMessage(message)?stripDevCommandPrefix(message):message,replier={reply:function(t){messages.add(String(t));}};
try{var data=loadJsonFile(filePath),petData=loadJsonFile(memberPetPath),petSkillData={},guildData={};${h.commands}}
catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(previous);dataTransactionLock.unlock();flow.unlock();}}
function parallel(message){var ready=new java.util.concurrent.CountDownLatch(4),start=new java.util.concurrent.CountDownLatch(1),threads=[];
 for(var i=0;i<4;i++){var worker=new java.lang.Thread(new java.lang.Runnable({run:function(){try{ready.countDown();start.await();run(message,false,'test');}catch(e){errors.add(String(e));}}}));threads.push(worker);worker.start();}
check(ready.await(5,java.util.concurrent.TimeUnit.SECONDS),'workers ready');start.countDown();for(var j=0;j<threads.length;j++){threads[j].join(10000);check(!threads[j].isAlive(),'worker ended');}check(errors.isEmpty(),String(errors));}
`;
let script='var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString('+JSON.stringify(h.main)+',"main.js",1,null);cx.compileString('+JSON.stringify(fs.readFileSync(path.join(__dirname,'..','Info.js'),'utf8'))+',"Info.js",1,null);print("PASS Rhino Main/Info full compile");\nvar runtime='+JSON.stringify(runtime)+';function fresh(){var scope=new org.mozilla.javascript.ImporterTopLevel(cx);cx.evaluateString(scope,runtime,"runtime",1,null);return scope;}function step(code){cx.evaluateString(s,code,"scenario",1,null);}var s=fresh();\n';
function step(code){script+='step('+JSON.stringify(code)+');\n';}
step(`seed(3000,1,1);var before=snapshot(false);run('/미니펫컬렉션전체등록');check(snapshot(false)===before,'preview no writes');check(miniPetCollectionAllPending['PROD:a'].selectedList.length===8,'eight grades');
for(var i=0;i<8;i++)check(miniPetCollectionAllPending['PROD:a'].selectedList[i].battleExp<=8,'lowest charm in 3000');parallel('등록');
var pets=loadJsonFile(memberPetPath).a,progress=loadJsonFile(miniPetCollectionPath).member.a.collection;check(pets.miniPetBag.length===2992&&pets.miniPet.name==='장착펫','eight bag pets once, equipped intact');check(progress.stage===2&&progress.completedStage===1,'one stage only');check(member(false).member.a.bag['등급보상']===8&&member(false).member.a.bag['단계보상']===1,'one grade/stage reward');var saved=snapshot(false);run('등록');check(snapshot(false)===saved,'duplicate no writes');`);
script+='print("PASS Rhino 3000 scan; four concurrent confirmations consume eight once, current stage only, rewards once");\n';
script+='s=fresh();\n';
step("var saved=snapshot(false);run('등록');check(snapshot(false)===saved,'fresh global cannot consume again');seed(1,3,0);Math.random=function(){return 0;};run('/미니펫컬렉션전체등록');run('등록');check(member(false).member.a.point===1000000000000-30000000&&member(false).member.a.bag['미니펫 강화석💫']===999994,'real upgrade costs');");
script+='print("PASS Rhino fresh global retains registration; real auto-upgrade costs and consumption match existing rules");\n';
step(`var originalWriter=writeVerifiedJsonFile;
for each(var filename in ['miniPet_collection.json','miniPet_title.json','member.json','member_pet.json'])for(var phase=0;phase<2;phase++){
 seed(1,1,0);run('/미니펫컬렉션전체등록');var before=snapshot(false),target=DATA_ROOT_PATH+filename;
 writeVerifiedJsonFile=function(p,t){if(String(p)===target){writeVerifiedJsonFile=originalWriter;if(phase===1)originalWriter.apply(this,arguments);throw Error('injected publish failure');}return originalWriter.apply(this,arguments);};
 var failed=false;try{run('등록');}catch(e){failed=true;}finally{writeVerifiedJsonFile=originalWriter;}
 check(failed&&snapshot(false)===before,'four-store rollback '+filename+' '+phase);run('등록');check(snapshot(false)===before,'failure requires reselect');
}
check(!dataTransactionLock.isLocked()&&dataSaveTransactionThreadLocal.get()===null&&commandContextThreadLocal.get()===null,'locks and contexts released');`);
script+='print("PASS Rhino before/after publication failures at all four stores restore original UTF-8 files; no duplicate retry and locks released");\n';
step("seed(1,1,1);run('/미니펫컬렉션전체등록');run('dev/미니펫컬렉션전체등록',true);var prod=snapshot(false);run('dev/등록',true);check(snapshot(false)===prod&&loadJsonFile(DEV_DATA_ROOT_PATH+'member_pet.json').a.miniPetBag.length===0,'DEV isolation');run('등록',false,'other');check(snapshot(false)===prod,'other room no consumption');var p=loadJsonFile(memberPetPath);p.a.miniPetBag[0].name='교체';put(memberPetPath,p);var changed=snapshot(false);run('등록');check(snapshot(false)===changed,'changed bag cancels');run('/미니펫컬렉션전체등록');miniPetCollectionAllPending['PROD:a'].expiresAt=0;run('등록');check(snapshot(false)===changed,'expired no consumption');");
script+='print("PASS Rhino independent DEV/PROD pending and files, changed bag, other room and expiry are safe");\n';
const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');
const result=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:60000,maxBuffer:2e6});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,'Rhino failed: '+dir);console.log('Synthetic evidence: '+dir);
