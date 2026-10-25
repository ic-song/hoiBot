// 운영 기준과 실제 계산·명령·인형 난수 결과를 합성 입력으로 대조한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const common=require('./test_castle_raid_common'),io=require('./test_command_data_loading'),ranking=require('./test_ranking_calculation');
const root=common.root,baselineRef='bf0903239c388cba732bf2409d341c11174fef83',block=common.block;
const before={},after={};for(const kind of ['main','info']){const file=kind==='main'?'main.js':'Info.js';before[kind]=cp.execFileSync('git',['show',baselineRef+':'+file],{cwd:root,encoding:'utf8',maxBuffer:8e6}).replace(/\r\n/g,'\n');after[kind]=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');}
const changed=['calculateCastleExp','calculateRaidExp','getEquippedNonTierPetSkillExp','getEquippedTierPetSkillExp','getPetHomeFurnitureCharm'];
// 공통 장비·집·스킬 함수는 실제 원문을 실행하며 계측은 별도 실행에만 삽입한다.
function runtime(source,kind,instrument=true){
 let text=common.runtime(source,kind,instrument),names=['getEquippedNonTierPetSkillExp','getEquippedTierPetSkillExp','getMiniPetSkillCharmRate','isElite'];
 if(kind==='main'){names.push('getPetSkillData','getTierPetSkillSearchName','isPetSkillCharmConditionActive');text+='\nvar PET_SKILL_LIST='+source.match(/const PET_SKILL_LIST = (\[[\s\S]*?\n\]);/)[1]+';\n';}
 else {names.push('isInfoPetSkillCharmConditionActive','getMemberRank');text+='\n'+block(source,'const TIER_PET_SKILL_EXP = {').replace('const ','var ')+';\n';}
 text+='\n'+names.map(n=>block(source,'function '+n+'(')).join('\n');
 text+='\nvar prepareCount=0;';
 if(instrument)text+='\nvar prepareOriginal=getEquippedPetSkillNames;getEquippedPetSkillNames=function(s,u){prepareCount++;return prepareOriginal(s,u);};';
 return text;
}
function scope(source,kind,instrument=true){const c={optimized:true};vm.createContext(c);vm.runInContext(runtime(source,kind,instrument),c);return c;}
function json(c,code){return JSON.parse(vm.runInContext('JSON.stringify('+code+')',c));}
function same(a,b,label){assert.strictEqual(JSON.stringify(a),JSON.stringify(b),label);}
// 기존 인형 검증의 실제 함수 목록을 사용하며 고정 카탈로그 외 계정은 합성한다.
function dollRuntime(source){
 const listSource=fs.readFileSync(path.join(__dirname,'test_doll_rhino.js'),'utf8');
 const names=JSON.parse(listSource.match(/const names=(\[[^;]+\]);/)[1]).filter(n=>source.includes('function '+n+'('));
 names.push('getDollCollectionRows');
 const cfg=scope(source,'main',false).GLOBAL_CONFIG;
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/dollCatalog.json'),'utf8'));
 return `var GLOBAL_CONFIG=${JSON.stringify(cfg)},dollCatalogCache=null,dollCatalogGradeCache=null;\n`+
  block(source,'const ticketTierData =').replace('const ','var ')+';\n'+names.map(n=>block(source,'function '+n+'(')).join('\n')+`
function getAutoDailyBatchContext(){return null;}function replyAutoDailyAdventureLevelUps(){}
var catalog=${JSON.stringify(catalog)};validateDollCatalog(catalog);dollCatalogCache=catalog;
function dollFixture(){return {d:{member:{u:{point:1000000000,bag:{},boostercnt:999,lv:1,exp:0,rank:{tier:'킹'}}}},p:{u:{petexp:1}},s:{schemaVersion:1,users:{}},idx:{schemaVersion:1,users:{}}};}
function dollOutcome(grade,count,seed,draw){var f=dollFixture(),calls=0,n=seed;f.d.member.u.bag[draw?GLOBAL_CONFIG.doll.ticketName:GLOBAL_CONFIG.doll.boxes.itemNames[grade]]=count;
 var random=function(){calls++;n=(n*1664525+1013904223)>>>0;return n/4294967296;};
 var result=draw?applyDollDraw(f.d,f.p,catalog,f.s,f.idx,'u','stable-id','2026.10.25',random):applyDollBoxOpen(f.d,f.p,catalog,f.s,f.idx,'u','stable-id','2026.10.25',{grade:grade,count:count},random);
 return {result:result,calls:calls,state:f};}
`;
}
const scenarios=`
var results=[];
for(var mode=0;mode<12;mode++){
 var f=fixture(4,mode%2),u='u0';
 if(mode===0)f.s={};
 if(mode===1)f.s.u0={petSkills:{equipped:'bad',bag:null}};
 if(mode===2)f.s.u0.petSkills.equipped=['로열하우스','로열 하우스','[펫스킬북]로열 하우스📙','티어상승론','티어상승론','',null,'없는 스킬'];
 if(mode===3)f.p.u0.miniPet.grade='창조';
 if(mode===4){f.p.u0.miniPet.grade='ELITE';f.p.u0.miniPetSupport.grade='창조';}
 if(mode===5)f.p.u0.pendant.promotionLevel='bad';
 if(mode===6)f.h.u0.lumiereVillage=[];
 if(mode===7)f.p.u0.dollCharm='13';
 if(mode===8)f.h.u0.placedFurniture=[null];
 if(mode===9)f.d.member.u0.spiritCharm.raidExp=-1;
 if(mode===10)delete f.p.u0;
 if(mode===11)f.s.u0.petSkills.equipped=[{},123,false];
 results.push({result:outcome(function(){return pair(f,u,mode%2,true);}),state:f});
}
var f=fixture(2),changedResults=[];
changedResults.push(calculateTotalExp('u0',f.d,f.p,f.h,f.s,f.g));
f.s.u0.petSkills.equipped=[];f.h.u0.exp=10000;f.p.u0.miniPet.battleExp=17;
changedResults.push(calculateTotalExp('u0',f.d,f.p,f.h,f.s,f.g));
f.s.u0.petSkills.equipped=['로열하우스','아르카나 하우스'];
changedResults.push(calculateTotalExp('u0',f.d,f.p,f.h,f.s,f.g));
results.push({changed:changedResults,state:f});
`;
// 앞선 공통 계산의 예외·모드 순서·데이터 보정 시험도 최신 운영 기준으로 다시 실행한다.
function commonScenarios(){return common.scenarios.replace("return {init:counts.init,village:counts.village,trace:trace.filter(function(k){return k!=='item'&&k!=='mini'&&k!=='home';}),state:f};","return {village:counts.village,trace:trace.filter(function(k){return k!=='item'&&k!=='mini'&&k!=='home'&&k!=='init';}),state:f};");}
function fullChecks(){let groups=0;function pass(label){console.log('PASS '+(++groups)+' '+label);}
 for(const kind of ['main','info']){
  const cs=[before[kind],after[kind]].map(s=>scope(s,kind));
  for(const c of cs)vm.runInContext(scenarios+commonScenarios(),c);
  same(json(cs[0],'results'),json(cs[1],'results'),kind+' actual skill result/errors/state');
  same(json(cs[0],'outcomes'),json(cs[1],'outcomes'),kind+' common regression');pass(kind+' 13 actual skill + 14 common parity scenarios');
  const counts=cs.map(c=>json(c,"(function(){var f=fixture(100);prepareCount=0;resetCounts();for(var i=0;i<100;i++)calculateTotalExp('u'+i,f.d,f.p,f.h,f.s,f.g);return {prepare:prepareCount,item:counts.item,state:f};})()"));
  same(counts[0].state,counts[1].state,kind+' normalizations');assert.strictEqual(counts[1].prepare,200);assert(counts[0].prepare>counts[1].prepare);pass(kind+' per-mode preparation '+counts[0].prepare+' → '+counts[1].prepare);
 }
 for(const tied of [false,true])for(const msg of ['/펫정보','/ㅎ','ㅁㅁㅁ','/종합순위','ㅈㅈㅈ','/서버순위','dev/펫정보','dev/종합순위']){
  const disk=ranking.fullFixture(100,tied),a=io.createInfoFixture(before.info,disk),b=io.createInfoFixture(after.info,disk),room=msg.startsWith('dev/')?'팻 테스트방':'서버관리자';
  same(a.run(msg,'u',room),b.run(msg,'u',room),msg);same(a.disk,b.disk,msg+' disk');
 }pass('16 actual seven-argument Info callbacks, ties, UI, reads, no writes, DEV');
 const rankScopes=[before.info,after.info].map(s=>scope(s,'info'));
 const ranks=rankScopes.map(c=>json(c,"(function(){var f=fixture(100);resetCounts();var rank=getMemberRank('u0',f.d,f.p,f.h,f.s,f.g,0);return {rank:rank,item:counts.item,state:f};})()"));
 same(ranks[0].rank,ranks[1].rank,'rank');same(ranks[0].state,ranks[1].state,'rank state');assert.strictEqual(ranks[0].item,198);assert.strictEqual(ranks[1].item,99);pass('personal rank equipment aggregation 198 → 99 / same result and state');
 const ds=[before.main,after.main].map(s=>{const c={};vm.createContext(c);vm.runInContext(dollRuntime(s),c);return c;});
 for(let grade=0;grade<10;grade++)for(const count of [1,100])for(const seed of [0,17,2147483647])same(...ds.map(c=>json(c,`dollOutcome(${grade},${count},${seed},false)`)),'box outcomes');
 for(let seed=0;seed<150;seed++)same(...ds.map(c=>json(c,`dollOutcome(0,1,${seed*7919},true)`)),'draw outcomes');pass('210 seeded draw/box outcomes: exact RNG calls, consumption, rewards, records');
 for(let grade=0;grade<9;grade++){
  for(const c of ds)vm.runInContext("var rec={catches:{D0001:{max:999},D0002:{max:1000}}};",c);
  same(...ds.map(c=>json(c,`getDollCollectionRows(catalog,rec,${grade})`)),'collection order');
 }pass('all 1000 catalog objects / discovered and size ordering');
 const d=ds[1];vm.runInContext("var rows=getDollGradeRows(catalog,0);rows.reverse();rows.pop();if(getDollGradeRows(catalog,0)[0].id!=='D0001'||getDollGradeRows(catalog,0).length!==300)throw Error('copy');var alternate=JSON.parse(JSON.stringify(catalog));alternate.dolls[0].name='changed';dollCatalogCache=alternate;if(getDollGradeRows(alternate,0)[0].name!=='changed')throw Error('catalog replacement');dollCatalogCache=catalog;if(getDollGradeRows(catalog,0)[0].name==='changed')throw Error('catalog isolation');if(getDollGradeRows(catalog,'0').length!==0||getDollGradeRows(catalog,NaN).length!==0)throw Error('strict grade');",d);pass('catalog identity invalidation, independent arrays, exact grade types');
 for(const kind of ['main','info']){
  let normalized=after[kind];for(const n of changed.concat(kind==='info'?['getMemberRank']:['applyDollBoxOpen','applyDollDraw','getDollCollectionRows']))normalized=normalized.replace(block(after[kind],'function '+n+'('),block(before[kind],'function '+n+'('));
  if(kind==='main')normalized=normalized.replace('var dollCatalogGradeCache = null; // 검증한 고정 목록의 등급별 원래 순서만 재사용\n','').replace('// 검증한 고정 목록만 등급별로 재사용하고 정렬 가능한 새 배열을 반환하는 함수\n'+block(after.main,'function getDollGradeRows(')+'\n\n','').replace(/^const HoiBotVersion = "[\d.]+";/m,before.main.match(/^const HoiBotVersion = "[\d.]+";/m)[0]);
  assert.strictEqual(normalized,before[kind],kind+' exact scope');
 }pass('complete source scope: all other guards, formulas, save/load, rewards, UI unchanged');
 return groups;
}
if(require.main===module)fullChecks();
module.exports={root,baselineRef,before,after,block,runtime,scope,json,same,scenarios,commonScenarios,dollRuntime,fullChecks};
