const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const old=fs.readFileSync(path.join(__dirname,'test_member_storage_split.js'),'utf8');
const {c,fixture,main,block,root,devRoot,load,raw,migrate,prepareCleanupBody,native,group,save}=new Function('require','__dirname',old+'\nreturn {c,fixture,main,block,root,devRoot,load,raw,migrate,prepareCleanupBody,native,group,save};')(require,__dirname);
vm.runInContext(block(main,'function buildMiniPetRobberyHistoryMessage('),c);
const cfg=c.GLOBAL_CONFIG.miniPet.robberyHistory,historyPath=root+cfg.fileName,pendingPath=root+cfg.pendingName;
const row=i=>({id:'20261014:'+i,target:'synthetic-target',amount:10000000,at:'2026.10.14 12:00'});
function seed(){migrate();prepareCleanupBody();const pets=c.loadJsonFile(c.memberPetPath);pets.a.miniPetRobberyHistory=Array.from({length:65},(_,i)=>row(i));pets.a.miniPetBattle={count:65};fixture.disk()[c.memberPetPath]=JSON.stringify(pets);return pets;}
function cleanup(pets){c.sender='admin';c.msg='/데이터정리';c.runCleanupBody(c.loadJsonFile(c.filePath),pets||c.loadJsonFile(c.memberPetPath),native({}),native({}),native({}),native({changed:false}));}
function transact(fn){c.beginDataSaveTransaction();try{return fn();}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();}}
function recover(){const start=main.indexOf('// 강탈 기록·회원·펫 저장 중 중단된 요청'),end=main.indexOf('var memberStorageCleanupAllowed',start);vm.runInContext(main.slice(start,end),c);}
group('전체 65건 이전·원본 별도 백업·펫 경량화·최근50건 표시·재실행',()=>{
 const pets=seed(),before=JSON.stringify(pets.a.miniPetRobberyHistory);transact(()=>cleanup(pets));
 const store=c.loadJsonFile(historyPath);assert.strictEqual(JSON.stringify(store.users.a),before);assert(!Object.hasOwn(c.loadJsonFile(c.memberPetPath).a,'miniPetRobberyHistory'));assert.strictEqual(raw().migrations[cfg.markerKey],true);
 assert.strictEqual(JSON.stringify(c.loadJsonFile(root+cfg.backupName).users.a),before);assert.strictEqual(c.loadJsonFile(pendingPath).pending,null);
 const ui=c.buildMiniPetRobberyHistoryMessage('a',load(),c.loadJsonFile(c.memberPetPath),{},store);assert(ui.includes('최근 약탈 기록: 50건'));assert(ui.includes('1. [synthetic-target]'));const beforeStore=fixture.disk()[historyPath];transact(()=>cleanup());assert.strictEqual(fixture.disk()[historyPath],beforeStore);
});
group('동일 ID의 다른 내용·기존 중복 개수 보존·백업 복원 잔류는 중복 추가 없음',()=>{
 seed();const pets=c.loadJsonFile(c.memberPetPath);pets.a.miniPetRobberyHistory=[row(1),row(1),{...row(1),amount:20000000}];fixture.disk()[c.memberPetPath]=JSON.stringify(pets);transact(()=>cleanup(pets));assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,3);
 fixture.disk()[c.memberPetPath]=JSON.stringify(pets);transact(()=>cleanup());assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,3);
});
group('첫 이전의 pending/이력/회원/펫/이후 파일/완료 표시 실패 원복·재시도',()=>{
 for(const file of [cfg.backupName,cfg.pendingName,cfg.fileName,'member.json','member_pet.json']){
  fixture.reset();c.memberSplitBackupCache={};const pets=seed(),before=fixture.disk()[c.memberPetPath];fixture.fail((_d,p)=>p===root+file);
  assert.throws(()=>transact(()=>cleanup(pets)),undefined,file);fixture.fail(()=>false);assert.strictEqual(fixture.disk()[c.memberPetPath],before);assert(!raw().migrations[cfg.markerKey]);assert(!Object.hasOwn(fixture.disk(),historyPath));transact(()=>cleanup());assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,65);
 }
 fixture.reset();c.memberSplitBackupCache={};seed();let writes=0;fixture.fail((_d,p)=>p===pendingPath&&++writes===2);assert.throws(()=>transact(()=>cleanup()));fixture.fail(()=>false);assert(!raw().migrations[cfg.markerKey]);transact(()=>cleanup());assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,65);
});
group('강제 중단된 첫 이전은 세 파일 복구·검증 실패는 복구 쓰기 없음',()=>{
 const pets=seed(),memberText=fixture.disk()[root+'member.json'],petText=fixture.disk()[c.memberPetPath];
 const snapshots=[{name:'member.json',text:memberText},{name:'member_pet.json',text:petText},{name:cfg.fileName,text:null}];
 fixture.disk()[pendingPath]=JSON.stringify({pending:snapshots});fixture.disk()[historyPath]=JSON.stringify({schemaVersion:1,users:{a:[row(1)]}});delete pets.a.miniPetRobberyHistory;fixture.disk()[c.memberPetPath]=JSON.stringify(pets);recover();assert.strictEqual(fixture.disk()[c.memberPetPath],petText);assert(!Object.hasOwn(fixture.disk(),historyPath));assert.strictEqual(c.loadJsonFile(pendingPath).pending,null);
 const before=JSON.stringify(fixture.disk());snapshots[2].name='../outside.json';assert.throws(()=>c.validateMiniPetRobberyPending({pending:snapshots}));assert.strictEqual(JSON.stringify(fixture.disk()),before);
});
group('손상 기록·충돌 파일·분리 뒤 누락/손상은 빈 기록으로 대체하지 않음',()=>{
 for(const bad of [null,{},[null],[{...row(1),amount:'1'}]]){fixture.reset();c.memberSplitBackupCache={};const pets=seed();pets.a.miniPetRobberyHistory=bad;assert.throws(()=>transact(()=>cleanup(pets)));assert(!raw().migrations[cfg.markerKey]);}
 fixture.reset();c.memberSplitBackupCache={};seed();fixture.disk()[historyPath]='{}';assert.throws(()=>cleanup());delete fixture.disk()[historyPath];transact(()=>cleanup());const text=fixture.disk()[historyPath];delete fixture.disk()[historyPath];assert.throws(()=>cleanup());fixture.disk()[historyPath]='{';assert.throws(()=>cleanup());fixture.disk()[historyPath]=text;
});
group('DEV 이전은 PROD 기록/표시와 분리',()=>{
 seed();const before=JSON.stringify(fixture.disk());migrate(true);for(const [p,text]of Object.entries(fixture.disk()))if(p.startsWith(root)&&!Object.hasOwn(fixture.disk(),devRoot+p.slice(root.length)))fixture.disk()[devRoot+p.slice(root.length)]=text;
 const prev=c.enterCommandContext(c.createCommandContext(true,'test'));
 try{const pets=c.loadJsonFile(c.memberPetPath);pets.a.miniPetRobberyHistory=[row(2)];fixture.disk()[devRoot+'member_pet.json']=JSON.stringify(pets);transact(()=>cleanup(pets));assert.strictEqual(JSON.parse(fixture.disk()[devRoot+cfg.fileName]).users.a.length,1);assert(!raw().migrations[cfg.markerKey]);assert(!Object.hasOwn(fixture.disk(),historyPath));}finally{c.exitCommandContext(prev);}
});
// 실제 약탈 성공 분기와 저장 꼬리를 실행한다. 대전 상대·기존 경험치 계산은 이 테스트 범위 밖이다.
const start=main.indexOf('var separatedRobbery ='),headEnd=main.indexOf('let rewards =',start);
const robberyStart=main.indexOf('if (hasPetSkill(petSkillData, sender, "약탈자"))',headEnd),tail=main.indexOf('recordAdventureQuestAction(data, sender, 3, "miniBattle", 1);',robberyStart),tailEnd=main.indexOf('return;',tail);
vm.runInContext('function runStorageRobbery(data,petData,targetName){Math.random=function(){return 0;};var sender="a",petSkillData={},guildData={},userRank="a";'+main.slice(start,headEnd)+'petData.a.miniPetBattle.count++;'+block(main.slice(robberyStart),'if (hasPetSkill(petSkillData, sender, "약탈자"))')+main.slice(tail,tailEnd)+'}',c);
c.hasPetSkill=()=>true;c.addPoint=(d,u,n)=>d.member[u].point+=n;c.getAttendanceKstDateKey=()=> '20261014';c.getMiniPetRobberyDateTime=()=> '2026.10.14 12:00';c.recordAdventureQuestAction=()=>{};c.checkRank=(_d,_p,_g,u)=>u;
c.Math=vm.runInContext('Math',c);c.Math.random=()=>0;
group('분리 이후 실제 강탈은 별도 파일만 누적·포인트/카운트와 함께 저장',()=>{
 seed();transact(()=>cleanup());const d=load();d.member.a.point=100000000;d.member.admin.point=100000000;save(d);transact(()=>c.runStorageRobbery(load(),c.loadJsonFile(c.memberPetPath),'admin'));
 assert.strictEqual(raw().member.a.point,110000000);assert.strictEqual(raw().member.admin.point,90000000);assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,66);assert(!Object.hasOwn(c.loadJsonFile(c.memberPetPath).a,'miniPetRobberyHistory'));assert.strictEqual(c.loadJsonFile(pendingPath).pending,null);
});
group('강탈 저장 각 단계 실패는 포인트/카운트/이력 원복·재시도 1회',()=>{
 for(const file of [cfg.pendingName,'member_pet.json','member.json',cfg.fileName]){
  fixture.reset();c.memberSplitBackupCache={};seed();transact(()=>cleanup());const d=load();d.member.a.point=100000000;d.member.admin.point=100000000;save(d);const before=[fixture.disk()[root+'member.json'],fixture.disk()[c.memberPetPath],fixture.disk()[historyPath]];
  fixture.fail((_d,p)=>p===root+file);assert.throws(()=>transact(()=>c.runStorageRobbery(load(),c.loadJsonFile(c.memberPetPath),'admin')));fixture.fail(()=>false);assert.deepStrictEqual([fixture.disk()[root+'member.json'],fixture.disk()[c.memberPetPath],fixture.disk()[historyPath]],before);transact(()=>c.runStorageRobbery(load(),c.loadJsonFile(c.memberPetPath),'admin'));assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,66);assert.strictEqual(raw().member.a.point,110000000);
 }
});
group('자동일퀘 여러 강탈의 복구 표시 유지·일괄 저장/실패 시 세 파일 일치',()=>{
 vm.runInContext(block(main,'function commitAutoDailyBatch('),c);
 for(const failure of [false,true]){
  fixture.reset();c.memberSplitBackupCache={};seed();transact(()=>cleanup());const d=load();d.member.a.point=100000000;d.member.admin.point=100000000;save(d);const pets=c.loadJsonFile(c.memberPetPath);
  for(const name of ['trialTowerPath','castleBattlePath','memberTitlePath','petExplorePath','petSkillDataPath','guildPath'])if(!c[name])c[name]=root+name+'.json';
  const member=root+'member.json',pet=c.memberPetPath,before=[fixture.disk()[member],fixture.disk()[pet],fixture.disk()[historyPath]];
  const batch={files:{[member]:d,[pet]:pets},managedPaths:{[member]:true,[pet]:true},dirtyPaths:{},committing:false},original=c.getAutoDailyBatchContext;c.getAutoDailyBatchContext=()=>batch;
  try{transact(()=>{
   c.runStorageRobbery(d,pets,'admin');c.runStorageRobbery(d,pets,'admin');assert.strictEqual(fixture.disk()[member],before[0]);assert.strictEqual(fixture.disk()[pet],before[1]);assert.notStrictEqual(c.loadJsonFile(pendingPath).pending,null);recover();assert.notStrictEqual(c.loadJsonFile(pendingPath).pending,null);
   if(failure)fixture.fail((_d,p)=>p===member);
   if(failure)assert.throws(()=>c.commitAutoDailyBatch());else c.commitAutoDailyBatch();
  });}finally{c.getAutoDailyBatchContext=original;fixture.fail(()=>false);}
  if(failure)assert.deepStrictEqual([fixture.disk()[member],fixture.disk()[pet],fixture.disk()[historyPath]],before);
  else {assert.strictEqual(raw().member.a.point,120000000);assert.strictEqual(c.loadJsonFile(historyPath).users.a.length,67);assert.strictEqual(c.loadJsonFile(pendingPath).pending,null);}
 }
});
group('분리 후 강제 중단·컴파일 전 복구·Info 부분 표시 차단',()=>{
 seed();transact(()=>cleanup());const d=load();d.member.a.point=100000000;d.member.admin.point=100000000;save(d);
 const names=['member.json','member_pet.json',cfg.fileName],rows=names.map(name=>({name,text:fixture.disk()[root+name]}));fixture.disk()[pendingPath]=JSON.stringify({pending:rows});const changed=raw();changed.member.a.point+=10000000;fixture.disk()[root+'member.json']=JSON.stringify(changed);const hist=JSON.parse(fixture.disk()[historyPath]);hist.users.a.push(row(99));fixture.disk()[historyPath]=JSON.stringify(hist);
 const start=main.indexOf('// 운영 타이머가 시작되기 전에 중단된 강탈 저장'),end=main.indexOf('// 재컴파일 시에도 이미 보관한 기록',start);assert(end>start);vm.runInContext(main.slice(start,end),c);for(const row of rows)assert.strictEqual(fixture.disk()[root+row.name],row.text);assert.strictEqual(c.loadJsonFile(pendingPath).pending,null);
 const info=fs.readFileSync(path.join(__dirname,'..','Info.js'),'utf8'),begin=info.indexOf('// 강탈 저장 복구가 끝나기 전에는'),finish=info.indexOf('let data = loadJsonFile(filePath);',begin);vm.runInContext('function infoRobberyProbe(){'+info.slice(begin,finish)+'return "allowed";}',c);assert.strictEqual(c.infoRobberyProbe(),'allowed');fixture.disk()[pendingPath]=JSON.stringify({pending:rows});assert.strictEqual(c.infoRobberyProbe(),undefined);
});
group('일반 명령은 이력 파일 미로드·잔류 기록은 명시적 정리 안내',()=>{
 seed();transact(()=>cleanup());fixture.clear();fixture.reload();fixture.clear();const reads=[],read=c.FileStream.read;c.FileStream.read=p=>{reads.push(p);return read(p);};
 try{fixture.clear();c.response('test','/레이드턴','a',true,c.replier,null,'com.kakao.talk');assert(!reads.includes(historyPath));}finally{c.FileStream.read=read;}
 const pets=c.loadJsonFile(c.memberPetPath);pets.a.miniPetRobberyHistory=[row(1)];assert.throws(()=>c.buildMiniPetRobberyHistoryMessage('a',load(),pets,{},c.loadJsonFile(historyPath)),/데이터정리/);
});
group('강탈 완료 표시 실패·후속 정리 파일 실패·손상 복구 원문은 기록 보존',()=>{
 seed();transact(()=>cleanup());const d=load();d.member.a.point=100000000;d.member.admin.point=100000000;save(d);const names=['member.json','member_pet.json',cfg.fileName],before=names.map(n=>fixture.disk()[root+n]);let writes=0;fixture.fail((_d,p)=>p===pendingPath&&++writes===2);assert.throws(()=>transact(()=>c.runStorageRobbery(load(),c.loadJsonFile(c.memberPetPath),'admin')));fixture.fail(()=>false);assert.deepStrictEqual(names.map(n=>fixture.disk()[root+n]),before);
 fixture.reset();c.memberSplitBackupCache={};seed();const petBefore=fixture.disk()[c.memberPetPath],write=c.FileStream.write;c.FileStream.write=(p,t)=>{if(p===c.packageLogPath)throw Error('synthetic late failure');return write(p,t);};try{assert.throws(()=>transact(()=>cleanup()));}finally{c.FileStream.write=write;}assert.strictEqual(fixture.disk()[c.memberPetPath],petBefore);assert(!raw().migrations[cfg.markerKey]);assert(!Object.hasOwn(fixture.disk(),historyPath));
 const snapshots=[{name:'member.json',text:fixture.disk()[root+'member.json']},{name:'member_pet.json',text:'{'},{name:cfg.fileName,text:null}];const diskBefore=JSON.stringify(fixture.disk());assert.throws(()=>c.validateMiniPetRobberyPending({pending:snapshots}));assert.strictEqual(JSON.stringify(fixture.disk()),diskBefore);
});
console.log('Robbery history split 12 scenarios passed');
