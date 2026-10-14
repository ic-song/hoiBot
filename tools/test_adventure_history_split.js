const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'test_member_storage_split.js'),'utf8');
const h=new Function('require','__dirname',source.slice(0,source.indexOf('\ngroup("'))+'\nreturn {c,fixture,main,block,root,devRoot,load,raw,save,native,setup,migrate};')(require,__dirname);
for(const name of ['roundToTwo','getAdventureQuestState','getAdventureQuestStageConfig','completeAdventureQuestStage','prepareAdventureQuestStage','buildAdventureQuestHistoryMessage','buildAdventureQuestTitleMessage','formatAdventureQuestPercent'])vm.runInContext(h.block(h.main,'function '+name+'('),h.c);
h.c.processAdventureLevelUps=()=>[];h.c.formatDateTime=()=> '2026-10-14 23:00';h.c.getAdventureQuestCompletionCheck=()=>({complete:true});
h.c.buildAdventureQuestCompleteMessage=()=> 'completed';h.c.buildAdventureQuestMessage=()=> 'quest';h.c.buildAdventureQuestIncompleteMessage=()=> 'incomplete';h.c.buildAdventureLevelUpMessage=()=> 'level';
const migrationBlock=h.block(h.main,'if (memberStorageCleanupAllowed) {');
vm.runInContext('function runHistoryMigration(data,allowed){var memberStorageCleanupAllowed=allowed;var replier={reply:function(){}};'+migrationBlock+'}',h.c);
const commandBlock=h.block(h.main,'if (msg === "/모험가퀘스트" ||');
vm.runInContext('function runQuestCommand(data,msg,sender){var petData={a:{petname:"synthetic"},fresh:{petname:"new"}},petSkillData={},guildData={},replier={reply:function(){}};'+commandBlock+'}',h.c);
const cfg=h.c.GLOBAL_CONFIG.adventureQuest.history,p=h.root+cfg.fileName,j=h.root+cfg.pendingName;
const clone=v=>JSON.parse(JSON.stringify(v));let count=0;
function transact(fn){h.c.beginDataSaveTransaction();try{return fn();}catch(e){h.c.rollbackDataSaveTransaction();throw e;}finally{h.c.endDataSaveTransaction();}}
function seed(dev=false){h.setup();h.migrate(dev);const d=h.load(undefined,dev);delete d.migrations[cfg.markerKey];for(const name of [cfg.fileName,cfg.pendingName,cfg.backupName])delete h.fixture.disk()[(dev?h.devRoot:h.root)+name];d.member.a.adventureQuest={version:1,currentStage:3,completedStages:[1,2],equippedTitle:1,records:[{stage:2,title:'old two',summary:'preserved text two',completedAt:'old2'},{stage:1,title:'old one',summary:'preserved text one',completedAt:'old1'}],titles:[{number:1,title:'old one',obtainedAt:'old1'},{number:2,title:'old two',obtainedAt:'old2'}],receipts:{stage1Prepared:true,stage2Prepared:true},totals:{castlePercent:.01,raidPercent:.01,diamondBoxes:15,experience:2000},progress:{miniBattle:5},startedAt:'old',stageStartedAt:'old'};h.save(d,dev);return h.raw(dev);}
function migrate(dev=false){const previous=h.c.enterCommandContext(h.c.createCommandContext(dev,dev?'test':'room8'));try{return transact(()=>h.c.runHistoryMigration(h.load(),true));}finally{h.c.exitCommandContext(previous);}}
function command(msg='/퀘스트완료'){return transact(()=>h.c.runQuestCommand(h.load(),msg,'a'));}
function group(name,fn){fn();console.log('PASS '+(++count)+': '+name);}
group('Migration preserves all original records, titles, receipts, rewards and stage; replay is no-op',()=>{
 const before=seed();migrate();const after=h.raw(),rows=JSON.parse(h.fixture.disk()[p]).users.a;
 assert.deepStrictEqual(rows.records,before.member.a.adventureQuest.records);assert.deepStrictEqual(rows.titles,before.member.a.adventureQuest.titles);
 const expected=clone(before.member);delete expected.a.adventureQuest.records;delete expected.a.adventureQuest.titles;expected.a.adventureQuest.equippedTitleName='old one';assert.deepStrictEqual(after.member,expected);
 assert.equal(after.migrations[cfg.markerKey],true);assert.equal(JSON.parse(h.fixture.disk()[j]).pending,null);
 const files=clone(h.fixture.disk());migrate();assert.deepStrictEqual(clone(h.fixture.disk()),files);
 assert.deepStrictEqual(JSON.parse(h.fixture.disk()[h.root+cfg.backupName]).users.a,rows);
});
group('Actual completion command pays once, appends history once and keeps member arrays absent',()=>{
 seed();migrate();const before=h.raw();command();const after=h.raw(),store=JSON.parse(h.fixture.disk()[p]);
 assert.equal(after.member.a.exp,(before.member.a.exp||0)+1000);assert.equal(after.member.a.bag[h.c.GLOBAL_CONFIG.items.diamondBoxName],15);
 assert.equal(after.member.a.adventureQuest.currentStage,4);assert.equal(store.users.a.records.length,3);assert.equal(store.users.a.titles.length,3);
 assert(!Object.hasOwn(after.member.a.adventureQuest,'records'));assert(!Object.hasOwn(after.member.a.adventureQuest,'titles'));
 h.c.getAdventureQuestCompletionCheck=()=>({complete:false});const text=h.fixture.disk()[p];command();assert.equal(h.fixture.disk()[p],text);assert.equal(h.raw().member.a.exp,after.member.a.exp);h.c.getAdventureQuestCompletionCheck=()=>({complete:true});
});
group('History, title queries and equip/remove preserve UI and avoid history rewrites',()=>{
 seed();migrate();const text=h.fixture.disk()[p];command('/퀘스트기록');command('/퀘스트타이틀');command('/퀘스트타이틀장착 2');
 assert.equal(h.raw().member.a.adventureQuest.equippedTitle,2);assert.equal(h.fixture.disk()[p],text);command('/퀘스트타이틀제거');assert(!h.raw().member.a.adventureQuest.equippedTitleName);
 const data=h.load(),store=h.c.requireAdventureRecordStore(h.c.loadJsonFile(p));h.c.attachAdventureRecordStore(data,store,'a',text);
 assert(h.c.buildAdventureQuestHistoryMessage(data,{},{},'a').includes('preserved text one'));assert(h.c.buildAdventureQuestTitleMessage(data,{},{},'a').includes('old two'));
});
group('Every migration write failure restores member and complete split store set',()=>{
 for(const target of [cfg.backupName,cfg.pendingName,cfg.fileName,'member.json','memberOperationLogs_back.json']){
  seed();h.c.memberSplitBackupCache={};const before=clone(h.fixture.disk());h.fixture.fail((_d,f)=>f===h.root+target);assert.throws(()=>migrate(),undefined,target);h.fixture.fail(()=>false);
  assert.equal(h.fixture.disk()[h.root+'member.json'],before[h.root+'member.json']);assert(!Object.hasOwn(h.fixture.disk(),p));assert(!h.raw().migrations[cfg.markerKey]);migrate();
 }
});
group('Completion member/history/pending failure leaves no payout or history increment',()=>{
 for(const target of [cfg.fileName,'member.json',cfg.pendingName]){
  seed();migrate();const before=clone(h.fixture.disk());let seen=0;h.fixture.fail((_d,f)=>f===h.root+target&&(target!==cfg.pendingName||++seen===2));assert.throws(()=>command());h.fixture.fail(()=>false);
  assert.deepStrictEqual(h.raw(),JSON.parse(before[h.root+'member.json']));assert.equal(h.fixture.disk()[p],before[p]);command();assert.equal(JSON.parse(h.fixture.disk()[p]).users.a.records.length,3);
 }
});
group('Restart restores member, history and all member split slots/backups before further load',()=>{
 seed();migrate();const before=clone(h.fixture.disk()),pending={pending:h.c.getAdventureRecordRecoveryNames().map(n=>({name:n,text:before[h.root+n]??null}))};
 h.fixture.disk()[j]=JSON.stringify(pending);const changed=h.raw();changed.member.a.point+=123;changed.migrations[h.c.MEMBER_STORAGE_SPLIT_CONFIG.key].raidRevision=99;h.fixture.write(changed);
 h.fixture.disk()[h.root+'serverRaidData.json']=JSON.stringify({...JSON.parse(before[h.root+'serverRaidData.json']),revision:98});h.fixture.disk()[p]=JSON.stringify({schemaVersion:1,users:{}});
 assert.equal(h.c.recoverAdventureRecordPending(),true);for(const row of pending.pending)if(row.text!==null)assert.equal(h.fixture.disk()[h.root+row.name],row.text);assert.doesNotThrow(()=>h.load('raid'));assert.equal(h.c.recoverAdventureRecordPending(),false);
});
group('Missing/corrupt history and member-backup mismatch refuse completion with no reward',()=>{
 for(const bad of [undefined,'{bad',JSON.stringify({schemaVersion:1,users:{}})]){
  seed();migrate();if(bad===undefined)delete h.fixture.disk()[p];else h.fixture.disk()[p]=bad;const before=h.raw();assert.throws(()=>command());assert.deepStrictEqual(h.raw(),before);
 }
 seed();migrate();command();const before=h.raw();const old=JSON.parse(h.fixture.disk()[h.root+'member_back.json']);h.fixture.write(old);assert.throws(()=>command(),/회원 백업보다 새로운/);assert.equal(h.raw().member.a.exp,old.member.a.exp);
});
group('Malformed pending and forbidden path fail before any recovery writes',()=>{
 seed();migrate();const pending={pending:h.c.getAdventureRecordRecoveryNames().map(n=>({name:n,text:h.fixture.disk()[h.root+n]??null}))};pending.pending[1].name='../evil.json';h.fixture.disk()[j]=JSON.stringify(pending);const before=clone(h.fixture.disk());assert.throws(()=>h.c.recoverAdventureRecordPending());assert.deepStrictEqual(clone(h.fixture.disk()),before);
});
group('Ordinary saves never load or recreate historical arrays',()=>{
 seed();migrate();h.fixture.clear();const data=h.load();h.c.getAdventureQuestState(data,'a',false);data.member.a.point++;h.save(data);assert(!Object.hasOwn(h.raw().member.a.adventureQuest,'records'));assert(!h.fixture.traces().some(t=>t.type==='save'&&t.path===p));
});
group('DEV migration and recovery leave PROD files unchanged',()=>{
 seed(true);const before=clone(h.fixture.disk());migrate(true);for(const name of Object.keys(before))if(name.startsWith(h.root))assert.equal(h.fixture.disk()[name],before[name]);assert.equal(h.raw(true).migrations[cfg.markerKey],true);
});
group('Unauthorized migration and suffix command never modify files',()=>{
 seed();const before=clone(h.fixture.disk());transact(()=>h.c.runHistoryMigration(h.load(),false));assert.deepStrictEqual(clone(h.fixture.disk()),before);migrate();const after=clone(h.fixture.disk());command('/퀘스트완료 1 해봐');assert.deepStrictEqual(clone(h.fixture.disk()),after);
});
group('New participant after split creates empty history and preserves first reward eligibility',()=>{
 seed();migrate();const data=h.load();data.member.fresh=h.native({point:100,bag:{}});h.save(data);transact(()=>h.c.runQuestCommand(h.load(),'/모험가퀘스트','fresh'));
 const state=h.raw().member.fresh.adventureQuest,rows=JSON.parse(h.fixture.disk()[p]).users.fresh;
 assert.equal(state.currentStage,1);assert.equal(state.completedStages.length,0);assert.deepStrictEqual(rows,{records:[],titles:[]});assert(!state.records);assert(!state.titles);
});
group('Automatic stage 9 and consecutive 8-to-9 completion persist all rewards and records once',()=>{
 seed();migrate();const data=h.load();data.member.a.adventureQuest.currentStage=8;h.save(data);
 h.c.homeInfoFile=h.root+'synthetic-home-info.json';h.c.homeDataFile=h.root+'synthetic-home.json';h.fixture.disk()[h.c.homeInfoFile]='{}';h.fixture.disk()[h.c.homeDataFile]='{"a":{"floor":99}}';h.c.initSweetHomeUser=v=>v;h.c.isAdventureQuestHomeAtMaximum=()=>true;
 command();const after=h.raw(),rows=JSON.parse(h.fixture.disk()[p]).users.a;assert.equal(after.member.a.adventureQuest.currentStage,10);assert.deepStrictEqual(rows.records.map(r=>r.stage),[9,8,2,1]);assert.equal(after.member.a.exp,2000);assert.equal(after.member.a.bag[h.c.GLOBAL_CONFIG.items.diamondBoxName],85);
 h.c.getAdventureQuestCompletionCheck=()=>({complete:false});command('/퀘스트타이틀');assert.equal(h.raw().member.a.exp,2000);h.c.getAdventureQuestCompletionCheck=()=>({complete:true});
});
group('Explicit deleted member loses external history without touching other members; failure rolls back',()=>{
 seed();migrate();const data=h.load();Object.defineProperty(data,'__adventureRecordContext',{value:{store:h.c.loadJsonFile(p),text:h.fixture.disk()[p],deletion:true},enumerable:false});delete data.member.a;h.save(data);assert(!Object.hasOwn(JSON.parse(h.fixture.disk()[p]).users,'a'));
 seed();migrate();const before=clone(h.fixture.disk()),d=h.load();Object.defineProperty(d,'__adventureRecordContext',{value:{store:h.c.loadJsonFile(p),text:h.fixture.disk()[p],deletion:true},enumerable:false});delete d.member.a;h.fixture.fail((_d,f)=>f===h.root+'member.json');assert.throws(()=>h.save(d));assert.equal(h.fixture.disk()[p],before[p]);assert(Object.hasOwn(h.raw().member,'a'));
});
group('Info title label stays visible without external arrays and pending recovery hides partial output',()=>{
 const info=fs.readFileSync(path.join(__dirname,'..','Info.js'),'utf8');vm.runInContext(h.block(info,'function buildInfoLevelMessage('),h.c);h.c.getInfoLevelRequiredExperience=()=>1000;h.c.getInfoAdventureLevelSummary=()=>({charmPercent:.1});h.c.getInfoAdventureLevelTitle=()=> 'title';h.c.formatInfoAdventureExperience=String;h.c.formatInfoAdventureLevelPercent=String;
 h.c.formatInfoAdventureQuestPercent=String;
 seed();migrate();assert(h.c.buildInfoLevelMessage(h.load(),{},{},'a').includes('old one'));assert(!Object.hasOwn(h.raw().member.a.adventureQuest,'titles'));
 const start=info.indexOf('var infoAdventurePendingPath'),end=info.indexOf('let data = loadJsonFile(filePath);',start);h.c.GLOBAL_CONFIG.adventureQuest.historyPendingName=cfg.pendingName;vm.runInContext('function infoGuard(){'+info.slice(start,end)+'return "allowed";}',h.c);
 assert.equal(h.c.infoGuard(),'allowed');h.fixture.disk()[j]=JSON.stringify({pending:h.c.getAdventureRecordRecoveryNames().map(n=>({name:n,text:h.fixture.disk()[h.root+n]??null}))});assert.equal(h.c.infoGuard(),undefined);
});
group('Retired cleanup routines are absent and numeric zero cleanup remains',()=>{
 const cleanup=h.block(h.main,'if (msg === "/데이터정리" && (isAdmin(sender) || isMaster(sender)))');
 for(const name of ['legacyPassListKeys','invalidAutoAttackItemName','petSkillMoveCount','guildRingDeleteGuildCount','itemChangeMap'])assert(!cleanup.includes(name));assert(cleanup.includes('member.bag[itemName] !== 0'));
});
console.log('PASS: '+count+' adventure history split groups (synthetic data only)');
