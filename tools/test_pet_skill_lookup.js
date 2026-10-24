// 운영 스냅샷 없이 실제 정의·조회·정렬·명령을 기준 소스와 대조한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),baselineRef='e17ae2dc58c0e20ccc30f6b03195586941e030ef';
const main=fs.readFileSync(path.join(root,'main.js'),'utf8').replace(/\r\n/g,'\n');
const before=cp.execFileSync('git',['show',baselineRef+':main.js'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
const {block}=require('./test_pet_skill_preflight');
const functions=['normalizePetSkillName','getTierPetSkillSearchName','getPetSkillData','initPetSkillUser','getPetSkillBagList','getPetSkillBagTotalCount','formatPetSkillName','formatSkillBagMessage','formatPetSkillStatusMessage'];
// 함수 원문에는 계측만 삽입하고 실제 스킬 정의와 정렬 비교식을 실행한다.
function runtime(source,instrument=true){
 let definitions=functions.map(n=>block(source,'function '+n+'(')).join('\n');
 if(instrument)definitions=definitions.replace('function getPetSkillData(skillName) {','function getPetSkillData(skillName) { metrics.lookups++;')
  .replace('var skillData = PET_SKILL_LIST[i];','var skillData = PET_SKILL_LIST[i]; metrics.scans++;')
  .replace(/PET_SKILL_LIST\.indexOf\(([^)]+)\)/g,'countIndexOf($1)');
 const list=source.match(/const PET_SKILL_LIST = (\[[\s\S]*?\n\]);/)[1];
 return `
var PET_SKILL_LIST=${list},originalDefinitions=JSON.stringify(PET_SKILL_LIST),PET_SKILL_BAG_MAX_COUNT=100,allsee='<ALLSEE>',metrics;
function resetMetrics(){metrics={lookups:0,scans:0,indexSearches:0};}resetMetrics();
function countIndexOf(s){metrics.indexSearches++;return PET_SKILL_LIST.indexOf(s);}
function getHoiPassPremiumHeader(){return '';}function checkRank(d,p,g,u){return u;}function numberWithCommas(n){return String(n);}function getPetSkillSlotCount(){return 30;}
${definitions}
function check(v,label){if(!v)throw Error(label);}function same(a,b,label){check(JSON.stringify(a)===JSON.stringify(b),label);}
function resetDefinitions(list){PET_SKILL_LIST=list===undefined?JSON.parse(originalDefinitions):list;getPetSkillData.definitionLookup=null;resetMetrics();}
function result(fn){try{return {ok:true,value:fn()};}catch(e){return {ok:false,error:String(e)};}}
function lookupPosition(n){var d=getPetSkillData(n);return d===null?-1:PET_SKILL_LIST.indexOf(d);}
function fixture(size,unknown){var skills={test:{petSkills:{equipped:['장미칼'],lockedPremium:['베란다 확장'],bag:{}}}},bag=skills.test.petSkills.bag;for(var i=0;i<size;i++){var index=(i*17+3)%PET_SKILL_LIST.length,name=unknown?'가상 스킬 '+i:PET_SKILL_LIST[index].name;bag[name]=(i%3)+1;}return skills;}
`;
}
const scenarios=`
var groups=0,outcomes=[];function test(label,fn){resetDefinitions();outcomes.push({label:label,value:fn()});groups++;}
test('all exact names aliases wrappers and repeated calls preserve first object reference',function(){var result=[];for(var i=0;i<PET_SKILL_LIST.length;i++){var n=PET_SKILL_LIST[i].name,alias=getTierPetSkillSearchName(PET_SKILL_LIST[i]),queries=[n,'[펫스킬북]'+n+'📙','  '+n+'✨  ',alias];for(var j=0;j<queries.length;j++){var a=getPetSkillData(queries[j]),b=getPetSkillData(queries[j]);check(a===b,'same reference');result.push(a===null?-1:PET_SKILL_LIST.indexOf(a));}}return result;});
test('empty falsy unknown numbers objects and legacy spellings',function(){var queries=['',null,undefined,false,0,17,{},[],['장미칼'],'미등록 스킬','__proto__','constructor','toString','하느님위에갓물주','야수의본능','종의본능','펫스킬학개론','로열하우스','전설의소매채기','광산 탐험가'];var rows=[];for(var i=0;i<queries.length;i++)rows.push(lookupPosition(queries[i]));return rows;});
test('throwing input conversion retains error and does not publish data',function(){return result(function(){return getPetSkillData({toString:function(){throw Error('synthetic conversion failure');}});});});
test('alias collision and duplicate definition use first matching definition',function(){resetDefinitions([{name:'🔮 겹침',tierExclusive:true},{name:'겹침'},{name:'겹침'},{name:'보통'}]);return [lookupPosition('겹침'),lookupPosition('🔮 겹침'),lookupPosition(''),lookupPosition('없는 스킬')];});
test('prototype-like names and empty alias remain ordinary keys',function(){resetDefinitions([{name:'constructor'},{name:'__proto__'},{name:'toString'},{name:'$x'},{name:'hasOwnProperty'}]);var q=['constructor','__proto__','toString','$x','hasOwnProperty',''];return q.map(lookupPosition);});
test('empty definitions and malformed late definition preserve early match and errors',function(){resetDefinitions([]);var empty=lookupPosition('none');resetDefinitions([{name:'먼저'},null]);var match=lookupPosition('먼저'),failure=result(function(){return lookupPosition('none');});return {empty:empty,match:match,failure:failure};});
test('definition list replacement length changes and effect references',function(){var a=getPetSkillData('장미칼');a.syntheticEffect=7;check(getPetSkillData('장미칼')===a&&getPetSkillData('장미칼').syntheticEffect===7,'live definition object reference');PET_SKILL_LIST=[{name:'새 정의'}];var q=[lookupPosition('장미칼'),lookupPosition('새 정의')];PET_SKILL_LIST.push({name:'추가 정의'});q.push(lookupPosition('추가 정의'));return q;});
test('unknown input is not retained and positive lookup storage is bounded',function(){for(var i=0;i<PET_SKILL_LIST.length;i++)getPetSkillData(PET_SKILL_LIST[i].name);var cache=getPetSkillData.definitionLookup,count=cache?Object.keys(cache.byName).length:0;for(var i=0;i<200;i++)check(getPetSkillData('없는 스킬 '+i)===null,'unknown remains null');if(cache)check(Object.keys(cache.byName).length===count&&count<=PET_SKILL_LIST.length*2+1,'no negative cache or personal data');return true;});
test('empty single missing and malformed user state retain initialization and errors',function(){var cases=[{}, {test:{}},{test:{petSkills:{equipped:'bad',bag:{}}}},{test:{petSkills:{bag:{'장미칼':1}}}},{test:{petSkills:{bag:['장미칼',0]}}},null];var rows=[];for(var i=0;i<cases.length;i++){var s=cases[i];rows.push({result:result(function(){return getPetSkillBagList(s,'test');}),state:s});}return rows;});
test('positive filtering fractional and textual counts match existing bag ordering',function(){var s={test:{petSkills:{bag:{'장미칼':1,'로열하우스':'2','로열 하우스':0.5,'가상':1,'0':1,'constructor':1,'음수':-1,'영':0,'문자':'no','문자영':'0','양수문자':'3'}}}};Object.defineProperty(s.test.petSkills.bag,'__proto__',{value:1,enumerable:true,writable:true});var list=getPetSkillBagList(s,'test');return {list:list,state:s};});
test('large known and unknown bags preserve exact native sort and state',function(){var rows=[];for(var i=0;i<2;i++){var s=fixture(PET_SKILL_LIST.length,!!i),before=JSON.stringify(s);var list=getPetSkillBagList(s,'test');check(JSON.stringify(s)===before,'normalized fixture state unchanged');rows.push(list);}return rows;});
test('alias ties unknown ties numeric names and deterministic shuffled bags',function(){var names=['로열하우스','로열 하우스','[펫스킬북]로열 하우스📙','전설의 소매치기','전설의소매채기','0','1','10','가상','unknown','toString','__proto__'],rows=[],seed=17;for(var r=0;r<30;r++){var pool=names.slice(0),s={test:{petSkills:{bag:{}}}};while(pool.length){seed=(seed*16807)%2147483647;var k=seed%pool.length;s.test.petSkills.bag[pool.splice(k,1)[0]]=1;}rows.push(getPetSkillBagList(s,'test'));}return rows;});
test('bag count changes after lookup are reflected without personal caching',function(){var s=fixture(20,false),first=getPetSkillBagList(s,'test');s.test.petSkills.bag[first[0]]=0;s.test.petSkills.bag['새 미등록 스킬']=3;var second=getPetSkillBagList(s,'test');check(second.indexOf(first[0])===-1&&second.indexOf('새 미등록 스킬')!==-1,'updated bag');return second;});
test('actual bag and equipped status UI numbering allsee and initialization match',function(){var rows=[];for(var size=0;size<3;size++){var s=fixture([0,1,80][size],false);s.test.petSkills.bag['로열하우스']=2;s.test.petSkills.bag['가상']=1;rows.push({bag:formatSkillBagMessage({}, {},s,{},'test'),status:formatPetSkillStatusMessage({}, {},s,{},'test'),state:s});}return rows;});
test('positive cache never mutates source definitions',function(){var initial=JSON.stringify(PET_SKILL_LIST);for(var i=0;i<PET_SKILL_LIST.length;i++){getPetSkillData(PET_SKILL_LIST[i].name);getPetSkillData(getTierPetSkillSearchName(PET_SKILL_LIST[i]));}same(JSON.parse(initial),PET_SKILL_LIST,'definition content unchanged');return true;});
`;
// 기존 합성 명령 하니스에 기준 또는 개선 소스를 주입해 실제 지급·장착·해제·복구를 비교한다.
function commandFixture(source){
 const file=path.join(__dirname,'test_raid_pet_skills.js'),text=fs.readFileSync(file,'utf8'),boundary=text.indexOf('\ngroup("');assert(boundary>0);
 const localRequire=name=>name==='fs'?Object.assign({},fs,{readFileSync(p,...args){return String(p).replace(/\\/g,'/').endsWith('/main.js')?source:fs.readFileSync(p,...args);}}):require(name);
 return new Function('require','__dirname',text.slice(0,boundary)+'\nreturn {c:context,reset,run,read,files,user,seed:(key,value)=>disk[key]=JSON.stringify(value),fail:p=>{failOnceAt=p;},snapshot:()=>JSON.parse(JSON.stringify({disk,backups,replies,saveCount}))};')(localRequire,__dirname);
}
function checks(){
 const contexts=[before,main].map(source=>{const c={};vm.createContext(c);vm.runInContext(runtime(source)+scenarios,c);return c;});assert.equal(JSON.stringify(contexts[0].outcomes),JSON.stringify(contexts[1].outcomes));console.log('PASS Node '+contexts[1].groups+' before/after lookup, exception, bag/UI parity groups');
 const fixtures=[before,main].map(commandFixture);for(const h of fixtures){h.reset();h.run('/호월토벌대오픈');}
 assert.deepStrictEqual(fixtures[1].snapshot(),fixtures[0].snapshot());
 for(const stage of ['equip','unequip','badSuffix','retry']){
  for(const h of fixtures){const s=h.c.loadJsonFile(h.files.skills);if(stage==='retry'){s[h.user].petSkills.bag['호월토벌대']=1;h.seed(h.files.skills,s);}const list=h.c.getPetSkillBagList(s,h.user),index=list.indexOf('호월토벌대')+1;
   if(stage==='equip')h.run('/펫스킬장착 '+index);
   if(stage==='unequip')h.run('/펫스킬소멸 1');
   if(stage==='badSuffix')h.run('/펫스킬장착 '+index+' 해봐');
   if(stage==='retry'){h.fail(h.files.skills);assert.throws(()=>h.run('/펫스킬장착 '+index));h.run('/펫스킬장착 '+index);}
  }assert.deepStrictEqual(fixtures[1].snapshot(),fixtures[0].snapshot(),stage);
 }console.log('PASS actual grant/equip/unequip, command suffix guard and save failure/retry: identical replies, inventory, disk and backups');
 // 후속 공통 계산 변경은 test_castle_raid_common의 전체 소스 동등성 검사로 검증한다.
 let normalized=main;for(const n of ['getPetSkillData','getPetSkillBagList','calculateCastleExp','calculateRaidExp','calculateTotalExp'])normalized=normalized.replace(block(main,'function '+n+'('),block(before,'function '+n+'('));normalized=normalized.replace(/^const HoiBotVersion = "[\d.]+";/m,before.match(/^const HoiBotVersion = "[\d.]+";/m)[0]);assert.equal(normalized,before,'complete Main source identical except separately verified helpers and version');
 console.log('PASS complete-source scope guard: commands, formulas, rewards, probabilities, save/load and UI functions unchanged');
}
if(require.main===module)checks();
module.exports={root,baselineRef,main,before,block,runtime,scenarios,commandFixture,checks};
