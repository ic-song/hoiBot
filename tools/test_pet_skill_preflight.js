// 공통 펫스킬 보정의 범위·이전 버전 호환·저장 실패·반복 비용을 합성 데이터로 검증한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), child = require('child_process');
const root = path.resolve(__dirname, '..');
const baselineRef = '1a403e7d1f3836a8e82e56f6c6b7692b5205ed3d';
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const baseline = child.execFileSync('git', ['show', baselineRef + ':main.js'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
function block(text, marker) {
    const start = text.indexOf(marker); assert(start >= 0, marker); let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    throw Error('unclosed ' + marker);
}
const functions = ['initPetSkillUser', 'normalizePetSkillName', 'normalizePetSkillStoredNames', 'ensurePetSkillSystemData'];
const definitions = functions.map(n => block(source, 'function ' + n + '(')).join('\n') + '\n' +
    block(baseline, 'function ensurePetSkillSystemData(').replace('function ensurePetSkillSystemData(', 'function ensureBefore(');
const version = Number(source.match(/const PET_SKILL_SYSTEM_VERSION = (\d+);/)[1]);
const stageStart = source.indexOf('        var petSkillChanged = ensurePetSkillSystemData(');
const stageEnd = source.indexOf('        if (msg === "ㅊㅊ")', stageStart);
assert(stageStart >= 0 && stageEnd > stageStart);
const stage = source.slice(stageStart, stageEnd);
assert(stage.includes('ensurePetSkillSystemData(data, petData, petSkillData, sender)'));
const common = `
var PET_SKILL_SYSTEM_VERSION=${version};
function formatDateTime(){return 'synthetic-time';}
function check(v,label){if(!v)throw new Error(label);}
function equal(a,b,label){check(JSON.stringify(a)===JSON.stringify(b),label);}
function fixture(count){
 var d={member:{},petSkillSystem:{version:PET_SKILL_SYSTEM_VERSION}},p={},s={};
 for(var i=0;i<count;i++){var u='u'+i;d.member[u]={bag:{reward:7},point:123};p[u]={petexp:500};
 s[u]={petSkills:{equipped:['야수의 본능'],lockedPremium:['장미칼'],bag:{'장미칼':3}},petSkillCollection:{'장미칼':2},other:{keep:true}};}
 return {data:d,pets:p,skills:s};
}
${definitions}
var rawInit=initPetSkillUser,initCalls=0;
initPetSkillUser=function(s,u){initCalls++;return rawInit(s,u);};
function apply(f,u){return ensurePetSkillSystemData(f.data,f.pets,f.skills,u);}
`;
const checks = `
var groups=0;
function test(label,fn){fn();groups++;print('PASS '+label);}
test('최신 버전 정상 회원 1명만 검사·무변경·JSON 변환 0회',function(){
 var f=fixture(1000),before=JSON.stringify(f),rawStringify=JSON.stringify,calls=0;initCalls=0;
 JSON.stringify=function(v){calls++;return rawStringify(v);};
 try{check(apply(f,'u0')===false,'normal unchanged');}finally{JSON.stringify=rawStringify;}
 check(initCalls===1&&calls===0,'one user / zero serialization');check(JSON.stringify(f)===before,'no rewards or skills changed');
});
test('개별 구조 누락·잘못된 배열 보정 결과는 기존 전체 검사와 동일',function(){
 for(var n=0;n<8;n++){
  var f=fixture(2);if(n===0)delete f.skills.u0;else if(n===1)f.skills.u0=null;
  else if(n===2)delete f.skills.u0.petSkills;else if(n===3)f.skills.u0.petSkills='bad';
  else if(n===4)f.skills.u0.petSkills.equipped={};else if(n===5)delete f.skills.u0.petSkills.lockedPremium;
  else if(n===6)f.skills.u0.petSkills.bag=null;else f.skills.u0.petSkills.bag='bad';
  var old=JSON.parse(JSON.stringify(f));check(ensureBefore(old.data,old.pets,old.skills),'baseline repair');
  check(apply(f,'u0'),'current repair');equal(f,old,'same repaired data '+n);check(!apply(f,'u0'),'idempotent '+n);
 }
});
test('다른 회원 보정은 본인 처리 시 수행·새 가입/계정삭제 후 재가입',function(){
 var f=fixture(2);delete f.skills.u1;check(!apply(f,'u0'),'other not scanned');check(!f.skills.u1,'other remains untouched');
 check(apply(f,'u1'),'other repaired on own entry');delete f.skills.u1;check(apply(f,'u1'),'recreated user repaired');
 f.data.member.newUser={bag:{}};check(apply(f,'newUser'),'new signup');
 var before=JSON.stringify(f);check(!apply(f,'unregistered'),'no ghost account');check(JSON.stringify(f)===before,'unknown unchanged');
});
test('버전 누락/구버전/문자열 버전은 전원 초기화·이름/가방/컬렉션 병합 유지',function(){
 for(var v=0;v<4;v++){
  var f=fixture(3);if(v===0)delete f.data.petSkillSystem;else if(v===1)f.data.petSkillSystem={};
  else f.data.petSkillSystem.version=v===2?PET_SKILL_SYSTEM_VERSION-1:String(PET_SKILL_SYSTEM_VERSION);
  f.skills.u1={petSkills:{equipped:['야수의본능','야수의 본능'],lockedPremium:['나혼자만레벨업'],bag:{'야수의본능':2,'야수의 본능':3,empty:0}},petSkillCollection:{'야수의본능':2,'야수의 본능':4}};
  delete f.skills.u2;var old=JSON.parse(JSON.stringify(f));
  check(ensureBefore(old.data,old.pets,old.skills),'old migration');check(apply(f,'u0'),'new migration');equal(f,old,'migration parity '+v);
  check(f.skills.u1.petSkills.bag['야수의 본능']===5,'bag counts');check(f.skills.u1.petSkillCollection['야수의 본능']===6,'collection counts');
  initCalls=0;check(!apply(f,'u0'),'migration committed');check(initCalls===1,'next entry bounded');
 }
});
test('명시적 3인수 전체 보정 호환',function(){var f=fixture(2);delete f.skills.u1;check(apply(f),'full repair');check(f.skills.u1.petSkills.lockedPremium.length===0,'full shape');check(!apply(f),'full idempotent');});
test('재로드·DEV/PROD 데이터 간 캐시 없음',function(){
 var prod=fixture(2),dev=fixture(2);delete dev.skills.u0.petSkills.lockedPremium;
 var before=JSON.stringify(prod);check(apply(dev,'u0'),'DEV repair');check(JSON.stringify(prod)===before,'PROD isolated');
 var fresh=JSON.parse(JSON.stringify(prod));delete fresh.skills.u0.petSkills.bag;check(apply(fresh,'u0'),'fresh reload rechecked');check(JSON.stringify(prod)===before,'old object untouched');
});
test('누락 루트·잘못된 회원값은 기존 실패/반환 방식 유지',function(){
 check(!ensurePetSkillSystemData(null,{}, {},'u0'),'null data');check(!ensurePetSkillSystemData({},{},{},'u0'),'missing members');
 check(!ensurePetSkillSystemData({member:{}},null,{},'u0'),'missing pets');check(!ensurePetSkillSystemData({member:{}},{},null,'u0'),'missing skills');
 var f=fixture(2);f.skills.u0=42;var failed=false;try{apply(f,'u0');}catch(e){failed=true;}check(failed,'bad user still errors');
 for(var n=0;n<3;n++){var f=fixture(2);if(n===0)f.skills.u0=[];else if(n===1)f.skills.u0.petSkills=[];else f.skills.u0.petSkills.bag=[];
  var old=JSON.parse(JSON.stringify(f)),expected=ensureBefore(old.data,old.pets,old.skills);check(apply(f,'u0')===expected,'array change flag preserved '+n);equal(f,old,'array serialization parity '+n);}
});
print('PASS core groups '+groups);
`;
function coreContext() {
    const c = { print: console.log }; vm.createContext(c); vm.runInContext(common, c); return c;
}
function nodeChecks() {
    const c = coreContext(); vm.runInContext(checks, c);
    const txNames = ['getDataSaveTransaction','beginDataSaveTransaction','endDataSaveTransaction','prepareManagedJsonTransactionEntry','rollbackDataSaveTransaction','saveJsonFile'];
    Object.assign(c, { filePath:'prod/member',memberPetPath:'prod/pets',petSkillDataPath:'prod/skills',sender:'u0',commonStepStart:0,
        dataSaveTransactionThreadLocal:{value:null,get(){return this.value;},set(v){this.value=v;},remove(){this.value=null;}},
        dataTransactionLock:{lock(){},unlock(){}},getAutoDailyBatchContext:()=>null,getCurrentContext:()=>({}),resolveActiveDataPath:p=>p,
        getManagedJsonBackupPath:p=>p+'.bak',isProtectedManagedJsonPath:()=>true,ensureParentFolder(){},debuggerLog(){},addResponseTiming(){} });
    txNames.forEach(n=>vm.runInContext(block(source,'function '+n+'('),c));
    let disk, backups, writes, failure;
    c.writeVerifiedJsonFile=(p,t,skip)=>{JSON.parse(t);if(p===failure){failure=null;throw Error('injected save failure');}if(!skip)backups[p]=disk[p];disk[p]=t;writes.push(p);};
    c.restoreManagedJsonFromBackup=p=>{assert(backups[p]);disk[p]=backups[p];return {data:JSON.parse(disk[p])};};
    function setup(migrate=false) {
        vm.runInContext('var f=fixture(2);delete f.skills.u0.petSkills.lockedPremium;'+(migrate?'f.data.petSkillSystem.version=1;':'')+'var data=f.data,petData=f.pets,petSkillData=f.skills;',c);
        disk={};backups={};writes=[];failure=null;
        for(const [p,key] of [[c.filePath,'data'],[c.memberPetPath,'petData'],[c.petSkillDataPath,'petSkillData']])disk[p]=JSON.stringify(c[key]);
        return JSON.parse(JSON.stringify(disk));
    }
    function entry() { c.beginDataSaveTransaction();try { vm.runInContext(stage,c); } finally { c.endDataSaveTransaction(); } }
    setup();entry();assert.deepEqual(writes,[c.filePath,c.memberPetPath,c.petSkillDataPath]);assert.deepEqual(JSON.parse(disk[c.filePath]).member.u0.bag,{reward:7});
    writes=[];entry();assert.equal(writes.length,0);console.log('PASS actual preflight save order / retry unchanged / no reward');
    for(const p of [c.filePath,c.memberPetPath,c.petSkillDataPath]) {
        const original=setup(true);failure=p;assert.throws(entry,/injected save failure/);assert.deepEqual(disk,original);assert.equal(c.getDataSaveTransaction(),null);
        for(const [file,key] of [[c.filePath,'data'],[c.memberPetPath,'petData'],[c.petSkillDataPath,'petSkillData']])c[key]=vm.runInContext('JSON.parse('+JSON.stringify(disk[file])+')',c);
        writes=[];entry();assert.equal(JSON.parse(disk[c.filePath]).petSkillSystem.version,version);assert.equal(JSON.parse(disk[c.petSkillDataPath]).u0.petSkills.lockedPremium.length,0);
    }
    console.log('PASS actual save transaction: each of 3 file failures restores originals / fresh reload retry');
    setup();c.filePath='dev/member';c.memberPetPath='dev/pets';c.petSkillDataPath='dev/skills';const prod=JSON.parse(JSON.stringify(disk));
    for(const [p,key] of [[c.filePath,'data'],[c.memberPetPath,'petData'],[c.petSkillDataPath,'petSkillData']])disk[p]=JSON.stringify(c[key]);
    entry();assert(writes.every(p=>p.startsWith('dev/')));for(const p in prod)assert.equal(disk[p],prod[p]);console.log('PASS actual DEV saves isolated');
    console.log('PASS pet skill preflight: 10 scenario groups, including 3 save-failure points');
}
const benchmark = `
function median(values){values.sort(function(a,b){return a-b;});return values[Math.floor(values.length/2)];}
function profile(count){
 var f=fixture(count),before=[],after=[];
 for(var i=0;i<36;i++){
  var start;if(i%2===0){start=nanoMs();ensureBefore(f.data,f.pets,f.skills);var b=nanoMs()-start;start=nanoMs();apply(f,'u0');var a=nanoMs()-start;}
  else{start=nanoMs();apply(f,'u0');var a=nanoMs()-start;start=nanoMs();ensureBefore(f.data,f.pets,f.skills);var b=nanoMs()-start;}
  if(i>=5){before.push(b);after.push(a);}
 }
 initCalls=0;ensureBefore(f.data,f.pets,f.skills);var beforeVisits=initCalls;initCalls=0;apply(f,'u0');var afterVisits=initCalls;
 var serializedBefore=JSON.stringify(f),oldStringify=JSON.stringify,calls=0;
 JSON.stringify=function(v){calls++;return oldStringify(v);};try{ensureBefore(f.data,f.pets,f.skills);}finally{JSON.stringify=oldStringify;}var beforeSerializations=calls;calls=0;
 JSON.stringify=function(v){calls++;return oldStringify(v);};try{apply(f,'u0');}finally{JSON.stringify=oldStringify;}
 check(JSON.stringify(f)===serializedBefore,'benchmark must not mutate');
 return {members:count,beforeMedianMs:median(before),afterMedianMs:median(after),beforeUserChecks:beforeVisits,afterUserChecks:afterVisits,beforeStringifyCalls:beforeSerializations,afterStringifyCalls:calls};
}
var reports=[];for(var sizeIndex=0;sizeIndex<3;sizeIndex++)reports.push(profile([100,1000,5000][sizeIndex]));print('BENCHMARK '+JSON.stringify(reports));
`;
if (require.main === module) nodeChecks();
module.exports={root,source,baseline,baselineRef,block,common,checks,benchmark,stage,nodeChecks};
