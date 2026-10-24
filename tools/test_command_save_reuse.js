// 실제 저장 함수를 같은 합성 입력으로 비교하며 원본 운영 파일은 읽거나 쓰지 않는다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const root = path.resolve(__dirname, '..'), baselineRef = '9a55db03cf85dabb955f79469e3aabe8971a95a7';
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.js'), before = cp.execFileSync('git', ['show', baselineRef + ':main.js'], {cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g, '\n');
const {block} = require('./test_pet_skill_preflight');
const names = ['createCommandContext','getCurrentContext','enterCommandContext','exitCommandContext','getDataFileName','resolveActiveDataPath',
    'getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction',
    'getManagedJsonBackupPath','getManagedJsonSecondaryBackupPath','getManagedJsonBackupCandidates','getProtectedJsonSaveLock',
    'isProtectedManagedJsonPath','parseJsonContent','parseManagedJsonContent','requirePetHomeActivityData','restoreManagedJsonFromBackup','loadJsonFile','writeVerifiedJsonFile','saveJsonFile'];

// 실제 파일 교체·fsync는 유지하고 시험용 계측과 장애 주입만 추가한다.
function runtime(source, folder) {
    let definitions = names.map(n => block(source, 'function ' + n + '(')).join('\n');
    definitions = definitions.replace('writer.write(jsonText);', 'writer.write(jsonText); recordWrite(path,jsonText);')
        .replace('outputStream.getFD().sync();', 'outputStream.getFD().sync();io.syncs++;');
    return `
var DATA_ROOT_PATH=${JSON.stringify(folder)},DEV_DATA_ROOT_PATH=DATA_ROOT_PATH+'dev/',COMMON_DATA_FILE_MAP={};
var filePath=DATA_ROOT_PATH+'member.json',memberPetPath=DATA_ROOT_PATH+'member_pet.json',petSkillDataPath=DATA_ROOT_PATH+'petSkillData.json';
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),protectedJsonSaveLocks={};
var MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000,serverRaidNoticeMemberRevisions={},failurePath=null,readFailurePath=null,io,failReply=false;
var testRoom='synthetic';function formatDateTime(){return 'synthetic';}
function resetIo(){io={writes:0,syncs:0,writeBytes:0,targets:{},reads:0};}
function recordWrite(p,t){io.writes++;io.writeBytes+=new java.lang.String(t).getBytes('UTF-8').length;io.targets[p]=(io.targets[p]||0)+1;if(p===failurePath){failurePath=null;throw Error('injected write failure');}}
function getAutoDailyBatchContext(){return null;}function ensureParentFolder(p){new java.io.File(p).getParentFile().mkdirs();}
function debuggerLog(){}function notifyManagedJsonRecovery(){}function notifyManagedJsonRecoveryFailure(){}
${definitions}
function check(v,label){if(!v)throw Error(label);}function same(a,b,label){check(JSON.stringify(a)===JSON.stringify(b),label);}
function expectFailure(fn,label){var failed=false;try{fn();}catch(e){failed=true;}check(failed,label);}
function writeRaw(p,t){ensureParentFolder(p);FileStream.write(p,String(t),'utf-8');}
function fixture(){endDataSaveTransaction();commandContextThreadLocal.remove();failurePath=null;readFailurePath=null;failReply=false;for(var i=0;i<2;i++){var r=i?DEV_DATA_ROOT_PATH:DATA_ROOT_PATH;writeRaw(r+'member.json',JSON.stringify({member:{synthetic:{point:23,bag:{keep:7,'태초야키토리 10세트🥩(/이랏싸이마쎄)':1}}}}));writeRaw(r+'member_pet.json',JSON.stringify({synthetic:{miniPetBag:[],petexp:17,note:'한글🎲'}}));writeRaw(r+'petSkillData.json',JSON.stringify({synthetic:{bag:{skill:1}}}));}resetIo();}
function transaction(fn,dev){var previous=enterCommandContext(createCommandContext(!!dev,'synthetic'));beginDataSaveTransaction();try{return fn();}catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(previous);}}
function texts(){return [FileStream.read(filePath),FileStream.read(memberPetPath),FileStream.read(petSkillDataPath)];}
function targetWrites(p){return io.targets[p]||0;}
var sender='synthetic',castleSiegeFlag=false,guildData={},data,petData,msg,replies=[];
function checkRank(d,p,g,u){return u;}function hasItem(d,u,k,n){return (d.member[u].bag[k]||0)>=n;}
function removeItem(d,u,k,n){d.member[u].bag[k]-=n;}function addItem(d,u,k,n){d.member[u].bag[k]=(d.member[u].bag[k]||0)+n;}
var replier={reply:function(t){if(failReply)throw Error('injected reply failure');replies.push(t);}};
function packageCommand(command,dev){msg=command;transaction(function(){data=loadJsonFile(filePath);petData=loadJsonFile(memberPetPath);${block(source,'if (msg === "/이랏싸이마쎄") {')}
${source.slice(source.indexOf('// 마지막@'),source.indexOf('// 마지막@')+125).split('\n').slice(1,3).join('\n')}
},dev);}
resetIo();
`;
}

const scenarios = `
var groups=0;function test(label,fn){fixture();fn();check(getDataSaveTransaction()===null,'transaction released '+label);check(commandContextThreadLocal.get()===null,'context released '+label);groups++;print('PASS '+label);}
test('first save is durable; identical second and third reuse only within command',function(){var p;transaction(function(){p=loadJsonFile(memberPetPath);p.synthetic.petexp++;saveJsonFile(p,memberPetPath);same(JSON.parse(FileStream.read(memberPetPath)),p,'first save visible');saveJsonFile(p,memberPetPath);saveJsonFile(JSON.parse(JSON.stringify(p)),memberPetPath);});check(targetWrites(memberPetPath)===(optimized?1:3),'duplicate target writes');check(JSON.parse(FileStream.read(getManagedJsonBackupPath(memberPetPath))).synthetic.petexp===17,'original backup preserved');});
test('changed payload A-B-A always publishes; identical final A only reuses',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);p.synthetic.petexp=99;saveJsonFile(p,memberPetPath);p.synthetic.petexp=17;saveJsonFile(p,memberPetPath);saveJsonFile(p,memberPetPath);});check(targetWrites(memberPetPath)===(optimized?3:4),'changed save count');});
test('member storage and explicit journal snapshots are never deduplicated',function(){var journal=DATA_ROOT_PATH+'journal.json';writeRaw(journal,'{}');transaction(function(){var d=loadJsonFile(filePath);saveJsonFile(d,filePath);saveJsonFile(d,filePath);saveJsonFile({pending:null},journal,false,'{}');saveJsonFile({pending:null},journal,false,'{}');});check(targetWrites(filePath)===2&&targetWrites(journal)===2,'durable boundary writes retained');});
test('direct writes without command transaction are never deduplicated',function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);saveJsonFile(p,memberPetPath);check(targetWrites(memberPetPath)===2,'no global cache');});
test('new command and nested command depth',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);beginDataSaveTransaction();try{saveJsonFile(p,memberPetPath);}finally{endDataSaveTransaction();}});transaction(function(){saveJsonFile(loadJsonFile(memberPetPath),memberPetPath);});check(targetWrites(memberPetPath)===(optimized?2:3),'cache command lifetime');});
test('disk changed after save is written again',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);writeRaw(memberPetPath,'{"foreign":true}');saveJsonFile(p,memberPetPath);same(JSON.parse(FileStream.read(memberPetPath)),p,'foreign content replaced');});check(targetWrites(memberPetPath)===2,'current disk checked');});
test('missing target after first save is recreated',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);new java.io.File(memberPetPath).delete();saveJsonFile(p,memberPetPath);same(JSON.parse(FileStream.read(memberPetPath)),p,'missing target recreated');});check(targetWrites(memberPetPath)===2,'missing never reused');});
test('invalid target after first save is rewritten without cache masking it',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);writeRaw(memberPetPath,'{invalid');saveJsonFile(p,memberPetPath);same(JSON.parse(FileStream.read(memberPetPath)),p,'invalid target replaced');});check(targetWrites(memberPetPath)===2,'corrupt target never reused');});
test('different JSON text and key order are not silently normalized',function(){transaction(function(){saveJsonFile({a:1,b:2},memberPetPath);saveJsonFile({b:2,a:1},memberPetPath);});check(targetWrites(memberPetPath)===2,'exact serialized comparison');});
test('pet skill, activity and board standalone managed files reuse verified text',function(){var paths=[petSkillDataPath,DATA_ROOT_PATH+'petHomeActivityData.json',DATA_ROOT_PATH+'board.json'];for(var i=0;i<paths.length;i++){var p=paths[i],value=i===1?{alerts:{},recentVisitors:{}}:{synthetic:{value:1}};writeRaw(p,JSON.stringify(value));transaction(function(){saveJsonFile(value,p);saveJsonFile(JSON.parse(JSON.stringify(value)),p);});check(targetWrites(p)===(optimized?1:2),'standalone file '+p);}});
test('intervening verified write with different text invalidates repeat candidate',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);writeVerifiedJsonFile(memberPetPath,'{"intervening":true}',true);saveJsonFile(p,memberPetPath);same(JSON.parse(FileStream.read(memberPetPath)),p,'original requested payload published again');});check(targetWrites(memberPetPath)===3,'different direct writer always publishes');});
test('explicit backup rotation request still writes',function(){transaction(function(){var p=loadJsonFile(memberPetPath);saveJsonFile(p,memberPetPath);writeVerifiedJsonFile(memberPetPath,JSON.stringify(p),false);});check(targetWrites(memberPetPath)===2,'explicit backup request');});
test('later file save failure rolls back earlier write even when repeat was skipped',function(){var original=texts();expectFailure(function(){transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp=88;saveJsonFile(p,memberPetPath);saveJsonFile(p,memberPetPath);failurePath=petSkillDataPath;saveJsonFile({changed:true},petSkillDataPath);});},'later failure');same(texts(),original,'all original texts restored');transaction(function(){saveJsonFile(loadJsonFile(memberPetPath),memberPetPath);});});
test('changed second write failure restores pre-command backup',function(){var original=texts();expectFailure(function(){transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp=88;saveJsonFile(p,memberPetPath);p.synthetic.petexp=89;failurePath=memberPetPath;saveJsonFile(p,memberPetPath);});},'changed second failure');same(texts(),original,'rollback original');});
test('first write failure and fresh retry',function(){var original=texts();expectFailure(function(){transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp++;failurePath=memberPetPath;saveJsonFile(p,memberPetPath);});},'first failure');same(texts(),original,'failed original');transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp++;saveJsonFile(p,memberPetPath);saveJsonFile(p,memberPetPath);});check(JSON.parse(FileStream.read(memberPetPath)).synthetic.petexp===18,'retry persisted');});
test('failed transaction cannot reuse a successful earlier write',function(){var original=texts();transaction(function(){var p=loadJsonFile(memberPetPath);p.synthetic.petexp++;saveJsonFile(p,memberPetPath);failurePath=petSkillDataPath;expectFailure(function(){saveJsonFile({changed:true},petSkillDataPath);},'failed file');expectFailure(function(){saveJsonFile(p,memberPetPath);},'failed transaction stays failed');});same(texts(),original,'no partial state');});
test('DEV and PROD are isolated even inside one outer transaction',function(){var prod=texts(),prior;transaction(function(){saveJsonFile({synthetic:{dev:true}},memberPetPath);saveJsonFile({synthetic:{dev:true}},memberPetPath);},true);same(texts(),prod,'prod byte unchanged');check(JSON.parse(FileStream.read(DEV_DATA_ROOT_PATH+'member_pet.json')).synthetic.dev,'dev saved');check(!io.targets[memberPetPath],'no prod writes');});
test('actual package command and final response saves retain items rewards and UI',function(){replies=[];packageCommand('/이랏싸이마쎄');var d=JSON.parse(FileStream.read(filePath)),p=JSON.parse(FileStream.read(memberPetPath));check(d.member.synthetic.bag['태초야키토리 10세트🥩(/이랏싸이마쎄)']===0,'one package consumed');check(d.member.synthetic.bag['미니펫뽑기🐹(/미니펫오픈)']===2500,'2500 tickets');check(d.member.synthetic.bag.keep===7&&d.member.synthetic.point===23,'unrelated assets');check(p.synthetic.miniPetBag.length===10&&replies.length===1,'10 pets and one reply');check(targetWrites(memberPetPath)===(optimized?1:2),'package duplicate reduced');});
test('actual package boundary rejects no item and full bag',function(){var d=JSON.parse(FileStream.read(filePath));d.member.synthetic.bag['태초야키토리 10세트🥩(/이랏싸이마쎄)']=0;writeRaw(filePath,JSON.stringify(d));replies=[];packageCommand('/이랏싸이마쎄');check(!io.writes&&replies[0].indexOf('아이템이 없습니다')!==-1,'missing pack');var p=JSON.parse(FileStream.read(memberPetPath));for(var i=0;i<91;i++)p.synthetic.miniPetBag.push({name:'synthetic'});writeRaw(memberPetPath,JSON.stringify(p));replies=[];packageCommand('/이랏싸이마쎄');check(!io.writes&&replies[0].indexOf('공간이 부족')!==-1,'full bag');});
test('actual package response failure restores first durable pet save',function(){var original=texts();failReply=true;expectFailure(function(){packageCommand('/이랏싸이마쎄');},'reply failure');same(texts(),original,'reply failure rollback');});
test('bad source errors and missing source null retain existing load contract',function(){new java.io.File(getManagedJsonBackupPath(petSkillDataPath)).delete();new java.io.File(getManagedJsonSecondaryBackupPath(petSkillDataPath)).delete();writeRaw(petSkillDataPath,'{bad json');expectFailure(function(){loadJsonFile(petSkillDataPath);},'invalid JSON failure remains visible');new java.io.File(petSkillDataPath).delete();check(loadJsonFile(petSkillDataPath)===null,'existing missing-file result');check(!io.writes,'no empty default saved');});
print('RESULT '+JSON.stringify({groups:groups,replies:replies}));
`;

// Node 메모리 파일시스템은 Java 파일 API만 대체하며 저장/복구 함수는 원문을 실행한다.
function createFixture(source=main) {
    const disk={}, locks=[];
    function Lock(){this.depth=0;locks.push(this);}Lock.prototype.lock=function(){this.depth++;};Lock.prototype.unlock=function(){assert(this.depth>0);this.depth--;};
    function Local(){this.v=null;}Local.prototype.get=function(){return this.v;};Local.prototype.set=function(v){this.v=v;};Local.prototype.remove=function(){this.v=null;};
    function File(p,name){this.path=(p instanceof File?p.path:String(p))+(name===undefined?'':'/'+name);}
    Object.assign(File.prototype,{getPath(){return this.path;},getName(){return this.path.split('/').pop();},getParentFile(){return new File(this.path.slice(0,this.path.lastIndexOf('/')));},exists(){return Object.hasOwn(disk,this.path);},mkdirs(){return true;},lastModified(){return Date.now();},delete(){delete disk[this.path];return true;},renameTo(to){if(!this.exists())return false;disk[to.path]=disk[this.path];delete disk[this.path];return true;}});
    const c={print:()=>{},java:{lang:{ThreadLocal:Local,String:function(t){this.getBytes=()=>Buffer.from(String(t),'utf8');}},util:{concurrent:{locks:{ReentrantLock:Lock}}},io:{File,FileOutputStream:function(f){this.path=f.path;disk[f.path]='';this.getFD=()=>({sync(){}});this.close=()=>{};},OutputStreamWriter:function(s){this.write=t=>{disk[s.path]=String(t);};this.flush=()=>{};this.close=()=>{};}}}};
    c.FileStream={read(p){c.io.reads++;if(p===c.readFailurePath){c.readFailurePath=null;throw Error('injected read failure');}return disk[p];},write(p,t){disk[p]=String(t);}};
    vm.createContext(c);vm.runInContext(runtime(source,'/synthetic/'),c);
    return {c,disk,locks,run:s=>vm.runInContext(s,c)};
}
function checks(){
    for(const [source,optimized] of [[before,false],[main,true]]){const h=createFixture(source);h.c.optimized=optimized;h.run(scenarios);assert(h.locks.every(l=>l.depth===0));console.log('PASS '+(optimized?'after':'before')+' '+h.c.groups+' storage/command exception groups, all locks released');}
    const a=createFixture(before),b=createFixture(main);for(const h of [a,b])h.run("fixture();replies=[];packageCommand('/이랏싸이마쎄');");assert.deepStrictEqual(b.disk,a.disk);assert.equal(JSON.stringify(b.c.replies),JSON.stringify(a.c.replies));
    // 후속 스킬 조회·정렬은 test_pet_skill_lookup의 전체 소스 동등성 검사로 검증한다.
    let storageScope=main;for(const n of ['getPetSkillData','getPetSkillBagList'])storageScope=storageScope.replace(block(main,'function '+n+'('),block(before,'function '+n+'('));
    assert.equal(storageScope.replace(block(main,'function writeVerifiedJsonFile('),block(before,'function writeVerifiedJsonFile(')).replace(/^const HoiBotVersion = "[\d.]+";/m,before.match(/^const HoiBotVersion = "[\d.]+";/m)[0]),before,'all gameplay, commands, guards, formulas, rewards, load and save entry code unchanged');
    console.log('PASS complete-source scope guard; actual package UI/disk/backups byte-identical');
}
if(require.main===module)checks();
module.exports={root,main,before,baselineRef,runtime,scenarios,createFixture,checks};
