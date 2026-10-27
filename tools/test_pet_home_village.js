const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const info = fs.readFileSync(path.join(__dirname, '..', 'Info.js'), 'utf8').replace(/\r\n/g, '\n');
const harness = fs.readFileSync(path.join(__dirname, 'test_server_raid.js'), 'utf8');
const f = new Function('require', '__dirname', harness.slice(0, harness.indexOf('\ngroup("')) + `
return {c,block,reset,read,write,put:(p,v)=>{disk[p]=JSON.stringify(v);},get:p=>JSON.parse(disk[p]),raw:p=>disk[p],
  replies:()=>replies, traces:()=>traces,clear:()=>{replies=[];traces=[];},advance:ms=>{now+=ms;},
  fail:p=>{failWrite=(_d,target)=>target===p;},corrupt:p=>{disk[p]='{';},remove:p=>{delete disk[p];}};
`)(require, __dirname);
const {c, block} = f, root = '/sdcard/호이랜드/', user = 'synthetic 남', other = 'synthetic 여';
c.petHomePlacedFurniturePath = root + 'petHomePlacedFurniture.json';
c.petHomeCommentsFile = root + 'petHomeComments.json';
c.petHomeActivityFile = root + 'petHomeActivityData.json';
c.petHomeVillagePending = {};
c.getHoiPassPremiumHeader = () => '';
c.isHoiPassPremiumActive = () => false;
c.isRegisteredHomeMember = (d, u) => !!d.member[u];
c.recordAdventureQuestAction = () => false;
c.calculateCastleItem = () => 0; c.calculateItemInfoAll = () => ({castleExp:0,raidExp:0});
c.getMiniPetModeCharm = () => 0; c.getIntimacyExpFromBag = () => 0;
c.getHomeBadgeCubeActiveOptionPercent = () => 0; c.getGuildContributionCubeMemberPercent = () => 0;
c.getAdventureLevelCharmPercent = () => 0;
c.getEquippedTierPetSkillExp = () => 0;
vm.runInContext(main.match(/const PET_SKILL_LIST = \[[\s\S]*?\n\];/)[0], c);
const functions = ['normalizePetSkillName','getTierPetSkillSearchName','getPetSkillData','initPetSkillUser','getEquippedPetSkillNames','hasPetSkill',
 'isPetSkillCharmConditionActive','getEquippedNonTierPetSkillExp','getPetHomeVillageState','getPetHomeVillageLevelLimit','getPetHomeFurnitureCharm',
 'getPlacedFurnitureCountByGrade','getOwnedFurnitureCountByGrade','getFurnitureExp','normalizePlacedFurnitureSummary','buildPlacedFurnitureSummary',
 'initSweetHomeUser','sortFurnitureList','getFurnitureMaxSlots','getFurnitureBagLimit','getHomeTotalExp','canCreatePlacedFurnitureData',
 'getPlacedFurnitureList','requirePlacedFurnitureDataMap','ensurePlacedFurnitureUser','refreshPlacedFurnitureSummary',
 'preparePetHomeVillageRegistration','buildPetHomeVillageLostSkillMessage','buildPetHomeVillageRegistrationMessage','formatPetHomeFurniture',
 'buildPetHomeVillageMessage','buildPetHomeVillageStatus','buildPetHomeFurnitureSkillMessage','buildPetHomeFurnitureInfoMessage','buildPetHomeFurnitureBagMessage',
 'trimPetHomeComments','initPetHomeCommentsData','buildPetHomeCommentsMessage','getPetHomeCommentList','getPetHomePinnedCommentList',
 'calculateCastleExp','calculateRaidExp','getPetModeCharmPercent','applyPercentWithExactFloor'];
for (const name of functions) vm.runInContext(block(main, 'function '+name+'('), c);
const registration = block(main, 'if (msg === "/별채등록" ||'), infoBranch = block(main, 'if (msg === "/가구정보" ||');
vm.runInContext('function runVillage(){'+registration+infoBranch+'}',c);
const clone = x => JSON.parse(JSON.stringify(x));
const skillData = skills => ({petSkills:{equipped:skills,lockedPremium:[],bag:{}}});
function furniture(id, grade='로열 루미에르', exp=100) { return {id,name:'가구'+id,grade,exp}; }
function seed({floor=100,royal=0,royalProgress=0,arcana=0,arcanaProgress=0,bag,placed=[],skills=[],state=true,dev=false}={}) {
 f.reset(); c.petHomeVillagePending={}; const r=dev?'/sdcard/호이랜드_dev/':root;
 const data=f.read(dev); data.member[user]={point:1,bag:{}};data.member[other]={point:1,bag:{}};f.write(data,dev);
 const home={floor,houseName:'합성집',exp:1000,furnitureBag:bag||Array.from({length:10},(_,i)=>furniture('R'+i)),placedFurnitureSummary:clone(c.buildPlacedFurnitureSummary(placed))};
 if(state)home.lumiereVillage={royal:{level:royal,progress:royalProgress},arcana:{level:arcana,progress:arcanaProgress}};
 f.put(r+'home.json',{[user]:home,[other]:{...clone(home),furnitureBag:[]}});
 f.put(r+'petHomePlacedFurniture.json',{[user]:placed,[other]:[]});
 f.put(r+'skills.json',{[user]:skillData(skills),[other]:skillData([])});
 f.put(r+'member_pet.json',{[user]:{petname:'합성펫'},[other]:{petname:'다른펫'}});
 return r;
}
function run(msg,who=user,room='room1',dev=false) {
 f.clear(); const ctx=c.createCommandContext(dev,room),prev=c.enterCommandContext(ctx);c.beginDataSaveTransaction();
 c.ctx=ctx;c.msg=msg;c.sender=who;c.room=room;c.isGroupChat=true;
 try { c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.petSkillData=c.loadJsonFile(c.petSkillDataPath);c.guildData={};c.runVillage(); }
 catch(e){c.rollbackDataSaveTransaction();throw e;}
 finally{c.endDataSaveTransaction();c.exitCommandContext(prev);}
 return f.replies().join('\n');
}
let groups=0;
function test(name,fn){fn();console.log('PASS VILLAGE '+(++groups)+': '+name);}
test('미등록 조회는 상태를 생성·저장하지 않음',()=>{
 seed({state:false});const before=f.raw(root+'home.json');assert(run('/가구정보').includes('Lv.0'));assert.equal(f.raw(root+'home.json'),before);assert.equal(f.traces().filter(t=>t.type==='save').length,0);
});
test('기획 계산·동일 등급 합산·집 면적 경계',()=>{
 const placed=[148500,90350,78800,29850,29850,29800,29750,29500,26650].map((e,i)=>furniture('P'+i,'일반',e));
 seed({royal:4,arcana:6,placed,bag:Array.from({length:5},(_,i)=>furniture('A'+i,'아르카나 루미에르')),skills:['아르카나 하우스']});
 run('/가구정보');const v=c.getPetHomeFurnitureCharm(c.loadJsonFile(c.homeDataFile),c.petSkillData,user);
 assert.equal(v.total,4568030);assert.equal(v.castle,2284015);assert.equal(v.percent,130);assert.equal(v.bonus*2,2581930);
 for(const [area,limit] of [[9,0],[99,9],[100,10],[109,10],[110,11],[300,30],[310,31]])assert.equal(c.getPetHomeVillageLevelLimit({floor:area}),limit);
});
test('실제 캐슬·레이드 계산의 별채 추가분과 Main/Info 일치',()=>{
 seed({royal:2,arcana:1,placed:[furniture('P','일반',12345)],skills:['인테리어 장인','느그 집 마련의 꿈']});run('/가구정보');
 const home=c.loadJsonFile(c.homeDataFile), before=clone(home);before[user].lumiereVillage.royal.level=0;before[user].lumiereVillage.arcana.level=0;
 const delta=c.getPetHomeFurnitureCharm(home,c.petSkillData,user).bonus-c.getPetHomeFurnitureCharm(before,c.petSkillData,user).bonus;
 for(const mode of ['Castle','Raid'])assert.equal(c['calculate'+mode+'Exp'](user,c.data,c.petData,home,c.petSkillData,false,{})-c['calculate'+mode+'Exp'](user,c.data,c.petData,before,c.petSkillData,false,{}),delta);
 const i=vm.createContext({GLOBAL_CONFIG:clone(c.GLOBAL_CONFIG),hasPetSkill:c.hasPetSkill,getEquippedPetSkillNames:c.getEquippedPetSkillNames});
 for(const name of ['getPetHomeVillageState','getPetHomeVillageLevelLimit','getPetHomeFurnitureCharm','getFurnitureExp','getPlacedFurnitureCountByGrade','getOwnedFurnitureCountByGrade','normalizePlacedFurnitureSummary'])vm.runInContext(block(info,'function '+name+'('),i);
 assert.equal(JSON.stringify(i.getPetHomeFurnitureCharm(home,c.petSkillData,user)),JSON.stringify(c.getPetHomeFurnitureCharm(home,c.petSkillData,user)));
 Object.assign(i,{calculateCastleItem:c.calculateCastleItem,calculateItemInfoAll:c.calculateItemInfoAll,getMiniPetModeCharm:c.getMiniPetModeCharm,getIntimacyExpFromBag:c.getIntimacyExpFromBag,
  getEquippedNonTierPetSkillExp:c.getEquippedNonTierPetSkillExp,getEquippedTierPetSkillExp:c.getEquippedTierPetSkillExp,getHomeBadgeCubeActiveOptionPercent:()=>0,getGuildContributionCubeMemberPercent:()=>0,getInfoAdventureLevelSummary:()=>({charmPercent:0})});
 for(const name of ['getHomeTotalExp','applyInfoPercentWithExactFloor','calculateCastleExp','calculateRaidExp'])vm.runInContext(block(info,'function '+name+'('),i);
 for(const mode of ['Castle','Raid'])assert.equal(i['calculate'+mode+'Exp'](user,c.data,c.petData,home,c.petSkillData,false,{}),c['calculate'+mode+'Exp'](user,c.data,c.petData,home,c.petSkillData,false,{}));
});
test('인테리어10% 별채대상 제외·꿈은 별채 비율에10%p 합산·해제/중복누적 없음',()=>{
 seed({royal:4,placed:[furniture('P','일반',10000)],skills:['인테리어 장인']});run('/가구정보');
 const home=c.loadJsonFile(c.homeDataFile), first=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);
 assert.equal(first.villageBonus,4000);assert.equal(first.interior,1100);
 c.petSkillData[user]=vm.runInContext('('+JSON.stringify(skillData(['인테리어 장인','느그 집 마련의 꿈']))+')',c);const dream=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);
 assert.equal(dream.percent,50);assert.equal(dream.villageBonus,5000);assert.equal(dream.total,first.total+2000);
 const detail=c.buildPetHomeFurnitureInfoMessage(c.data,c.petData,c.petSkillData,{},home,user,user,f.get(root+'petHomePlacedFurniture.json')[user]);
 assert(detail.includes('별채 합산 버프 +10%p'));assert(!detail.includes('느그 집 마련의 꿈 추가 +'));assert(detail.includes('기본 합계의 50% 추가 → +10,000💞'));
 assert.equal(c.getPetHomeFurnitureCharm(home,c.petSkillData,user).total,dream.total);
 c.petSkillData[user]=vm.runInContext('('+JSON.stringify(skillData(['인테리어 장인']))+')',c);assert.equal(c.getPetHomeFurnitureCharm(home,c.petSkillData,user).total,first.total);
});
test('꿈 스킬은 별채0%에도10%p·보유만으로 미발동·비율 합산 후 소수점 버림',()=>{
 seed({placed:[furniture('P','일반',12345)],skills:['인테리어 장인','느그 집 마련의 꿈']});run('/가구정보');
 const home=c.loadJsonFile(c.homeDataFile),before=JSON.stringify(home);
 const zero=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);assert.equal(zero.percent,10);assert.equal(zero.bonus,1234);
 home[user].lumiereVillage.arcana.level=1;
 const active=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);assert.equal(active.percent,25);assert.equal(active.villageBonus,3086);
 const owned=skillData(['인테리어 장인']);owned.petSkills.bag['느그 집 마련의 꿈']=1;
 c.petSkillData[user]=vm.runInContext('('+JSON.stringify(owned)+')',c);
 const inactive=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);assert.equal(inactive.percent,15);assert.equal(inactive.villageBonus,1851);
 assert.equal(JSON.stringify(c.loadJsonFile(c.homeDataFile)),before);
});
test('꿈10%p 확정 예시·50%에서60%·한 번의 버림·기본매력0',()=>{
 for(const [exp,royal,arcana,percent,bonus,total] of [[493050,1,0,20,98610,1183320],[10000,5,0,60,6000,32000],[19,0,1,25,4,46],[0,0,0,10,0,0]]){
  seed({royal,arcana,placed:[furniture('P','일반',exp)],skills:['느그 집 마련의 꿈','느그 집 마련의 꿈']});run('/가구정보');
  const home=c.loadJsonFile(c.homeDataFile),saved=JSON.stringify(home),value=c.getPetHomeFurnitureCharm(home,c.petSkillData,user);
  assert.equal(value.percent,percent);assert.equal(value.bonus,bonus);assert.equal(value.total,total);
  assert.equal(c.getPetHomeFurnitureCharm(home,c.petSkillData,user).total,total);assert.equal(JSON.stringify(home),saved);
  if(exp===493050){const detail=run('/가구정보');assert(detail.includes('빌리지 종매 버프 +20% 적용 중'));assert(detail.includes('기본 합계의 20% 추가 → +197,220💞'));assert(detail.includes('최종 가구 종합매력 +1,183,320'));assert(!detail.includes('느그 집 마련의 꿈 추가 +'));}
 }
});
test('혼합10개 확정 성장·한 파일 저장·중복확정 무변경·재시작 유지',()=>{
 seed({royal:3,royalProgress:9,arcana:5,arcanaProgress:3,bag:[...Array.from({length:2},(_,i)=>furniture('R'+i)),...Array.from({length:8},(_,i)=>furniture('A'+i,'아르카나 루미에르'))]});
 const before=f.raw(root+'home.json');assert(run('/별채등록 1 2 3 4 5 6 7 8 9 10').includes('별채 등록 확인'));assert.equal(f.raw(root+'home.json'),before);
 assert(run('등록한다').includes('등록 완료'));const after=f.get(root+'home.json')[user];assert.deepEqual(after.lumiereVillage,{royal:{level:4,progress:1},arcana:{level:6,progress:1}});assert.equal(after.furnitureBag.length,0);
 assert.equal(f.traces().filter(t=>t.type==='save'&&t.path===root+'home.json').length,1);const raw=f.raw(root+'home.json');assert.equal(run('등록한다'),'');assert.equal(f.raw(root+'home.json'),raw);
 c.petHomeVillagePending={};assert(run('/가구정보').includes('Lv.4'));
});
test('오류·중복번호·접미문구·타인/다른방 응답·취소는 미소모',()=>{
 seed();const before=f.raw(root+'home.json');for(const msg of ['/별채등록','/별채등록 0','/별채등록 99','/별채등록 1 1','/별채등록 1 해봐','/별채등록 -1','/별채등록 1.2','/별채등록 1 2 3 4 5 6 7 8 9 10 11']){run(msg);assert.equal(f.raw(root+'home.json'),before);}
 run('/별채등록 1');run('등록한다',other);run('등록한다',user,'room2');assert.equal(f.raw(root+'home.json'),before);assert(run('등록안한다').includes('취소'));assert.equal(f.raw(root+'home.json'),before);
});
test('면적 한도 초과 혼합요청 전체 취소와 마지막2개 성장',()=>{
 seed({royal:9,royalProgress:8,bag:[furniture('R1'),furniture('R2'),furniture('R3'),furniture('A1','아르카나 루미에르')]});const before=f.raw(root+'home.json');assert(run('/별채등록 1 2 3 4').includes('2개까지'));assert.equal(f.raw(root+'home.json'),before);
 run('/별채등록 2 3');assert(run('등록한다').includes('집 확장 필요'));assert.equal(f.get(root+'home.json')[user].lumiereVillage.royal.level,10);
});
test('보유 개체 변경은 재선택·스킬 변경은 재확인',()=>{
 seed({royalProgress:9,placed:[furniture('P','일반',10000)]});run('/별채등록 1');let h=f.get(root+'home.json');h[user].furnitureBag[0].id='replaced';f.put(root+'home.json',h);assert(run('등록한다').includes('가구가방 내용이 변경'));assert.equal(f.get(root+'home.json')[user].furnitureBag.length,10);
 run('/별채등록 1');f.put(root+'skills.json',{[user]:skillData(['느그 집 마련의 꿈'])});assert(run('등록한다').includes('예상 효과가 변경'));assert.equal(f.get(root+'home.json')[user].furnitureBag.length,10);assert(run('등록한다').includes('등록 완료'));
});
test('레벨업 없는 가구 소모로 아르카나 조건 해제·실제 감소 안내',()=>{
 seed({arcana:2,placed:[furniture('P','일반',10000)],bag:Array.from({length:5},(_,i)=>furniture('A'+i,'아르카나 루미에르')),skills:['아르카나 하우스']});
 assert(run('/별채등록 1').includes('조건이 해제'));const done=run('등록한다');assert(done.includes('이번 감소 -'));assert(done.includes('같은 등급'));assert.equal(f.get(root+'home.json')[user].lumiereVillage.arcana.progress,1);
});
test('저장 실패 원문 롤백·만료·DEV 분리',()=>{
 seed();run('/별채등록 1');const before=f.raw(root+'home.json');f.fail(root+'home.json');assert.throws(()=>run('등록한다'));assert.equal(f.raw(root+'home.json'),before);
 run('/별채등록 1');f.advance(60001);assert(run('등록한다').includes('시간이 지났'));assert.equal(f.raw(root+'home.json'),before);
 seed();const prod=f.raw(root+'home.json');const h=f.get(root+'home.json');f.put('/sdcard/호이랜드_dev/home.json',h);f.put('/sdcard/호이랜드_dev/petHomePlacedFurniture.json',{});
 const d=f.read();f.write(d,true);f.put('/sdcard/호이랜드_dev/skills.json',{[user]:skillData([])});f.put('/sdcard/호이랜드_dev/member_pet.json',{[user]:{petname:'합성펫'}});
 run('/별채등록 1',user,'test',true);run('등록한다',user,'test',true);assert.equal(f.raw(root+'home.json'),prod);assert.equal(f.get('/sdcard/호이랜드_dev/home.json')[user].furnitureBag.length,9);
});
test('최근30개 저장·오래된 핀 보존·원문과 번호 일치',()=>{
 seed();const comments=Array.from({length:50},(_,i)=>({from:user,text:'원문'+i}));const pins=[clone(comments[0])];const store={comments:{[user]:comments},pinnedComments:{[user]:pins}};c.initPetHomeCommentsData(store);
 assert.equal(store.comments[user].length,30);assert.equal(store.comments[user][0].text,'원문20');assert.equal(store.pinnedComments[user][0].text,'원문0');
 const out=c.buildPetHomeCommentsMessage(c.data,c.petData,{},user,store.comments[user],pins);assert(out.includes('댓글 30개'));assert(out.indexOf('원문0')<out.indexOf('<ALLSEE>'));assert(out.includes('1. [💛'+user+']: 원문49'));
});
test('TOP3 종류별 대표·원래 장착번호·타인실행 안내 숨김·목록 맨 아래',()=>{
 seed({placed:[{...furniture('P1','일반',100),name:'같은가구'},{...furniture('P2','일반',200),name:'같은가구'},furniture('P3','일반',150)]});run('/가구정보');
 const h=c.loadJsonFile(c.homeDataFile),placed=f.get(root+'petHomePlacedFurniture.json')[user],saved=JSON.stringify(placed);
 const top=c.buildPetHomeVillageMessage(c.data,c.petData,c.petSkillData,{},h,user,placed,21);assert.equal(top.split('같은가구').length,2);assert(top.indexOf('+200')<top.indexOf('+150'));assert.equal(JSON.stringify(placed),saved);
 const detail=c.buildPetHomeFurnitureInfoMessage(c.data,c.petData,c.petSkillData,{},h,user,other,placed);assert(!detail.includes('🎒 가구 확인'));assert(detail.indexOf('<ALLSEE>')>detail.indexOf('가구 종합매력'));assert(detail.endsWith('3. 가구P3(+150💞)[일반]'));
});
test('잘못된 별채 저장 값과 가구 파일 파싱 실패를 기본값으로 숨기지 않음',()=>{
 seed();let h=f.get(root+'home.json');h[user].lumiereVillage.royal.progress=10;f.put(root+'home.json',h);assert.throws(()=>run('/가구정보'),/별채/);
 seed();f.corrupt(root+'home.json');assert.throws(()=>run('/가구정보'));
});
test('실제 펫홈 방문 누적·방문 뱃지 획득 유지·댓글30개 영속 정리',()=>{
 vm.runInContext(main.slice(main.indexOf('// 펫홈 댓글 저장소 기본 구조'), main.indexOf('// 펫스윗홈\nfunction initSweetHomeUser')),c);
 c.formatDateTime=()=> '2026-10-22 01:30:00';c.getPetHomeTodayText=()=> '2026-10-22';
 c.getPetSkillFollowerBonus=()=>0;c.getPetSkillHeartBonus=()=>0;
 vm.runInContext('function runVillage(){'+registration+infoBranch+block(main,'if (msg === "/펫홈" ||')+block(main,'if (msg === "/홈알림" ||')+'}',c);
 seed({placed:[furniture('P','일반',100)]});
 f.put(root+'petHomeActivityData.json',{alerts:{},recentVisitors:{},petHomeSocial:{},migrations:{}});
 const comments=Array.from({length:50},(_,i)=>({from:user,text:'원문'+i}));
 f.put(root+'petHomeComments.json',{comments:{[other]:comments},pinnedComments:{[other]:[comments[0]]}});
 const out=run('/펫홈 '+other);assert(out.includes('댓글 30개'));assert(!out.includes('팔로워'));assert(!out.includes('방문자'));assert.equal(f.get(root+'home.json')[other].visitCnt,1);
 const activity=f.get(root+'petHomeActivityData.json');assert(activity.petHomeSocial[other].badges.includes('V01'));assert.equal(activity.petHomeSocial[other].badgeStats.totalVisits,1);
 assert.equal(f.get(root+'petHomeComments.json').comments[other].length,30);assert.equal(f.get(root+'petHomeComments.json').pinnedComments[other][0].text,'원문0');
});
test('홈알림 이동 정보·방문 뱃지·마음5종 합계·읽음 후 누적 보존',()=>{
 const home=f.get(root+'home.json');home[other].likeCnt=5;home[other].heartExpressions={cute:1,cheer:2,cool:3,love:4};f.put(root+'home.json',home);
 const first=run('/홈알림',other);assert(first.includes('누적 방문👣 1회'));assert(first.includes('첫 방문 [V01] · 획득'));assert(first.includes('💝 받은 마음 15회'));assert(first.includes('[💌 5]'));assert(first.includes('👣 최근 방문자 [1/100명]'));
 const second=run('/홈알림',other);assert(second.includes('누적 방문👣 1회'));assert(second.includes('💝 받은 마음 15회'));assert(second.includes('첫 방문 [V01] · 획득'));
});
test('정리 완료된 본인 펫홈은 댓글/홈 재저장 없이 가구 매력 한 번 계산',()=>{
 const before=f.raw(root+'home.json'),comments=f.raw(root+'petHomeComments.json');let count=0;const calculate=c.getPetHomeFurnitureCharm;
 c.getPetHomeFurnitureCharm=function(...args){count++;return calculate(...args);};
 try{run('/펫홈',other);assert.equal(count,1);assert.equal(f.traces().filter(t=>t.type==='save').length,0);assert.equal(f.raw(root+'home.json'),before);assert.equal(f.raw(root+'petHomeComments.json'),comments);}finally{c.getPetHomeFurnitureCharm=calculate;}
 assert.equal(c.getResponseDataFlowLock('dev/등록한다'),'write');assert.equal(c.getResponseDataFlowLock('등록한다'),'write');
});
test('꿈 스킬의 확률0.3%·합산10%p 설명·S급 오픈/도감 대상 유지',()=>{
 for(const name of ['getPrayerSkillConfig','isPrayerSkillName','formatPetSkillName','getPetSkillActualRate','getPetSkillTotalRate','getPetSkillRandomWeight','getOpenablePetSkillCountByGrade','getPetSkillFixedActualRateTotal','formatPetSkillRate','buildTierPetSkillInfoLine','buildPetSkillInfoMessage'])vm.runInContext(block(main,'function '+name+'('),c);
 vm.runInContext(main.match(/const PET_SKILL_FIXED_ACTUAL_RATES = \{[\s\S]*?\n\};/)[0],c);
 const skill=c.getPetSkillData('느그 집 마련의 꿈');assert.equal(skill.grade,'S');assert.equal(skill.openable,undefined);
 const text=c.buildPetSkillInfoMessage(skill);assert(text.includes('등급: S'));assert(text.includes('확률: 0.3%'));assert(text.includes('별채의 합산 버프가 10%p 증가'));assert(Math.abs(c.getPetSkillActualRate(skill)-0.3)<1e-9);
});
console.log('PASS '+groups+' village groups');
