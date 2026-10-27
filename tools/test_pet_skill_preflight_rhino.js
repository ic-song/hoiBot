// 실제 Rhino와 Java 파일 저장에서 보정·롤백·재시작 및 동일 합성 데이터의 전후 시간을 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),child=require('child_process');
const h=require('./test_pet_skill_preflight');
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),'Rhino jar required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hoibot-skill-preflight-'));
const storageNames=['getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction','getProtectedJsonSaveLock','writeVerifiedJsonFile','saveJsonFile','loadJsonFile'];
const storage=`
var root=${JSON.stringify(dir.replace(/\\/g,'/')+'/')},activeDev=false,filePath=root+'member.json',memberPetPath=root+'member_pet.json',petSkillDataPath=root+'petSkillData.json';
new java.io.File(root+'dev').mkdirs();
var dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),protectedJsonSaveLocks={};
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),'UTF-8'));},write:function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));}};
function resolveActiveDataPath(p){return activeDev&&String(p).indexOf(root+'dev/')!==0?root+'dev/'+new java.io.File(String(p)).getName():String(p);}
function getAutoDailyBatchContext(){return null;}function getCurrentContext(){return {};}
function getManagedJsonBackupPath(p){return String(p).slice(-4)==='.bak'?null:p+'.bak';}
function getManagedJsonSecondaryBackupPath(){return null;}function isProtectedManagedJsonPath(){return true;}
function parseJsonContent(t){return JSON.parse(t);}function parseManagedJsonContent(t){return JSON.parse(t);}
function ensureParentFolder(p){new java.io.File(String(p)).getParentFile().mkdirs();}function debuggerLog(){}
function restoreManagedJsonFromBackup(p){var b=getManagedJsonBackupPath(p);if(!new java.io.File(b).exists())return null;var t=FileStream.read(b),d=JSON.parse(t);writeVerifiedJsonFile(p,t,true);return {data:d};}
${storageNames.map(n=>h.block(h.source,'function '+n+'(')).join('\n')}
var nativeWrite=writeVerifiedJsonFile,failAt=null,writes=0;
writeVerifiedJsonFile=function(p,t,skip,verified){if(p===failAt){failAt=null;throw new Error('injected save failure');}nativeWrite(p,t,skip,verified);writes++;};
var sender='u0',data,petData,petSkillData,commonStepStart=0;
function addResponseTiming(){}
function runPreflight(){beginDataSaveTransaction();try{${h.stage}}finally{endDataSaveTransaction();}}
function persist(f){writeVerifiedJsonFile(resolveActiveDataPath(filePath),JSON.stringify(f.data),true);writeVerifiedJsonFile(resolveActiveDataPath(memberPetPath),JSON.stringify(f.pets),true);writeVerifiedJsonFile(resolveActiveDataPath(petSkillDataPath),JSON.stringify(f.skills),true);}
function reload(){data=loadJsonFile(filePath);petData=loadJsonFile(memberPetPath);petSkillData=loadJsonFile(petSkillDataPath);}
function texts(){return [FileStream.read(resolveActiveDataPath(filePath)),FileStream.read(resolveActiveDataPath(memberPetPath)),FileStream.read(resolveActiveDataPath(petSkillDataPath))];}
function seedOld(){var f=fixture(2);f.data.petSkillSystem.version=1;f.skills.u1.petSkills.bag={'야수의본능':2,'야수의 본능':3};delete f.skills.u0.petSkills.lockedPremium;persist(f);reload();}
seedOld();runPreflight();reload();check(data.petSkillSystem.version===PET_SKILL_SYSTEM_VERSION,'migration persisted');check(petSkillData.u1.petSkills.bag['야수의 본능']===5,'other member migrated');
writes=0;runPreflight();check(writes===0,'normal no save');print('PASS Rhino Java files/fsync: migration + unchanged no-save');
for(var fileIndex=0;fileIndex<3;fileIndex++){
 seedOld();var original=texts();failAt=[filePath,memberPetPath,petSkillDataPath][fileIndex];var failed=false;
 try{runPreflight();}catch(e){failed=String(e).indexOf('injected save failure')!==-1;}
 check(failed,'expected file failure');equal(texts(),original,'all original texts restored '+fileIndex);check(getDataSaveTransaction()===null,'transaction released');
 reload();runPreflight();reload();check(data.petSkillSystem.version===PET_SKILL_SYSTEM_VERSION,'fresh reload retry');check(petSkillData.u0.petSkills.lockedPremium.length===0,'repaired retry');
}
print('PASS Rhino Java files/fsync: 3 failure points rollback + retry');
var prodOriginal=texts();activeDev=true;seedOld();runPreflight();reload();check(data.petSkillSystem.version===PET_SKILL_SYSTEM_VERSION,'DEV migrated');activeDev=false;equal(texts(),prodOriginal,'PROD byte unchanged');
print('PASS Rhino Java files/fsync: DEV/PROD isolation');
// 손상 JSON을 기존 오류 경로로 실패시키며 빈 데이터로 저장하지 않는다.
activeDev=true;FileStream.write(resolveActiveDataPath(petSkillDataPath),'{bad json');var corruptBefore=texts(),failed=false;
new java.io.File(getManagedJsonBackupPath(resolveActiveDataPath(petSkillDataPath))).delete();
try{reload();runPreflight();}catch(e){failed=true;}check(failed,'invalid JSON fails');equal(texts(),corruptBefore,'invalid data not overwritten');activeDev=false;
print('PASS Rhino Java files: invalid JSON not hidden or overwritten');
`;
const restart=`var f=fixture(2);delete f.skills.u0.petSkills.lockedPremium;persist(f);reload();runPreflight();`;
const storageBoot=storage.slice(0,storage.indexOf('seedOld();runPreflight();'));
const script=`
var cx=org.mozilla.javascript.Context.getCurrentContext();
cx.compileString(${JSON.stringify(h.source)},'main.js',1,null);
cx.compileString(${JSON.stringify(fs.readFileSync(path.join(h.root,'Info.js'),'utf8'))},'Info.js',1,null);print('PASS Rhino complete Main/Info compilation');
${h.common}
${h.checks}
${storage}
var fresh=cx.initStandardObjects();cx.evaluateString(fresh,${JSON.stringify(h.common+storageBoot+restart)},'fresh-restart',1,null);
reload();check(petSkillData.u0.petSkills.lockedPremium.length===0,'fresh scope repair visible');print('PASS Rhino fresh global reload repairs latest-version user without cache');
function nanoMs(){return Number(java.lang.System.nanoTime())/1000000;}
${h.benchmark}
`;
const file=path.join(dir,'test.js');fs.writeFileSync(file,script,'utf8');
const result=child.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',path.resolve(jar),'org.mozilla.javascript.tools.shell.Main','-opt','-1','-version','200','-encoding','UTF-8','-f',file],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
process.stdout.write((result.stdout||'').split(/\r?\n/).filter(l=>!l.startsWith('RESTART ')).join('\n'));process.stderr.write(result.stderr||'');assert.equal(result.status,0,'Rhino failed: '+file);
const rows=JSON.parse(result.stdout.split(/\r?\n/).find(l=>l.startsWith('BENCHMARK ')).slice(10));
for(const r of rows){assert.equal(r.beforeUserChecks,r.members);assert.equal(r.afterUserChecks,1);assert.equal(r.beforeStringifyCalls,r.members*2);assert.equal(r.afterStringifyCalls,0);}
const report={baseline:h.baselineRef,environment:'local Rhino 1.7.15 interpreter, synthetic data; preflight helper only, not total response or Android timing',warmup:5,samples:31,alternatingOrder:true,rows};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n','utf8');
console.log('PASS Rhino pet skill preflight / persistence / fresh restart / comparative benchmark');
