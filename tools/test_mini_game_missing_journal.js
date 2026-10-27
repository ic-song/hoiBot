// 누락 복구 기록만 초기화하며 진행·포인트·미확정 지급을 보존하는지 확인한다.
const assert=require('assert'),vm=require('vm'),h=require('./test_mini_games');
const root='/sdcard/호이랜드/',dev='/sdcard/호이랜드_dev/';
let groups=0;function test(name,fn){fn();console.log('PASS RECOVERY '+(++groups)+' '+name);}
function fixture(){const f=h.fixture();f.seed();f.c.debuggerLog=()=>{};const rename=f.c.java.io.File.prototype.renameTo;f.c.java.io.File.prototype.renameTo=function(target){if(String(target.path).endsWith('.missing')){if(!(this.path in f.disk()))return false;f.disk()[target.path]=f.disk()[this.path];delete f.disk()[this.path];return true;}return rename.call(this,target);};return f;}
function recover(f,isDev=false,allow=false){const c=f.c,ctx=c.createCommandContext(isDev,'test'),prev=c.enterCommandContext(ctx);c.beginDataSaveTransaction();try{return c.runMiniGameEntry('recover',{ctx,allowRecoveryReview:allow});}finally{c.endDataSaveTransaction();c.exitCommandContext(prev);}}
function removeJournal(f,base=root){delete f.disk()[base+'miniGamePending.json'];delete f.disk()[base+'miniGamePending.json.rollback'];}
function makeUncertain(f,credited){assert(!f.run('/금고').error);const points=f.read().member.a.point;
 f.crashAfter((p,v)=>p.endsWith('/miniGameState.json')&&Object.values(v.ledger).some(r=>r.status==='PENDING'));
 assert(f.run('/금고 '+f.state().vault.current.answer).error);assert(Object.values(f.state().ledger).some(r=>r.status==='PENDING'));
 if(credited){const d=f.read();d.member.a.point=points+500000000;f.disk()[root+'member.json']=JSON.stringify(d);}
 removeJournal(f);return points;
}
function startup(f){const start=h.main.indexOf('var startupMiniContexts ='),end=h.main.indexOf('var startupRobberyPendingPath',start);assert(start>0&&end>start);vm.runInContext(h.main.slice(start,end)+'\nthis.initializationContinued=true;',f.c);}
function callback(f,msg,user='a'){
 const c=f.c;for(const n of ['isCarrotTradeCommand','isAccountSuspensionBlockedMessage','getChatExperienceQueryTarget','isPassFreeHomeBadgeCommand','getMyGuildId','getSpiritCharmOpenRequest','isExcludedRequestMonitoring','syncStoneBoxShopItems','getAttendanceNoticeCommandPrefix','handleDailyChatExperienceQuery','disableInvalidGuildTerritoryAutoAttacks','isMutableGuildTerritoryCommand','isGuildTerritoryRiftControlCommandMessage','ensureHappyFoundationData','ensurePetSkillSystemData','initPetSkillUser','normalizePetSkillStoredNames','formatDateTime','getExpiredHoiPassPremiumUsers','restoreHoiPassPremiumLockedSkills','processWorldNewsCommand','ensureWorldNewsData','ensureMatzangFieldData','ensurePetMusouData','recoverPetMusouTurnIfNeeded','ensurePetMusouScheduleTimer','runPetMusouScheduleTick','getPetMusouScheduleTimeText','getPetMusouKstDateTime','isHoiPassPremiumAutomationCommand','isPetMusouTicketEventAdminCommand','isPetMusouLightningRateCommand','isPetMusouBlockedDuringTournamentCommand','isCastleSiegeRoomOperatorCommand','getAdventureOnboardingMemberState','parsePetSkillBagGrantRequest','parseDirectGrantPetSkillRequest','isFreeMarketRegisterCommand','awardDailyChatExperience','getAttendanceKstDateKey','processAdventureLevelUps','getLevelRequiredExperience','buildAdventureBoosterDepletionMessage','buildHoiBotChangeLogMessage','isMatzangOperatorCommandMessage','processAttendanceForUser'])vm.runInContext(h.block(h.main,'function '+n+'('),c);const lock=()=>({lock(){},unlock(){},tryLock(){return true;}});c.commandDataFlowLock={readLock:lock,writeLock:lock};c.dataTransactionLock=lock();c.hoiBotChangeLogPath=root+'hoiBotChangeLog.json';c.isAdmin=u=>u==='a';c.setInterval=()=>1;c.clearInterval=()=>{};c.PET_SKILL_SYSTEM_VERSION=2;c.petMusouScheduleTimers={};c.autoDailyQuestInternalDepth=0;c.requestMonitorConfig={excludedCommands:['/개발자노트','ㅊㅊ']};c.getCachedMessageFilterWords=()=>[];
 c.java.io.File.prototype.lastModified=()=>1;c.java.io.File.prototype.length=function(){return String(f.disk()[this.path]||'').length;};
 c.isGuildTerritoryWarCommandLockActive=()=>false;c.isGuildTerritoryBlockedDuringWarCommand=()=>false;c.isGlobalOperatorCommandAllowed=()=>false;c.errorLogPath='/synthetic/recovery-error.json';let error;c.FileStream.write=(p,t)=>{if(p===c.errorLogPath)error=JSON.parse(t);else throw Error('unexpected direct write '+p);};
 f.clear();f.clock(f.now()+5000);c.response('table',msg,user,true,c.replier,null,'com.kakao.talk');return {text:f.replies().join('\n'),error};
}
test('normal state seeds only an empty journal; repeated recovery is read-only',()=>{
 const f=fixture();assert(!f.run('/금고').error);removeJournal(f);const state=f.disk()[root+'miniGameState.json'],member=f.disk()[root+'member.json'];
 assert.strictEqual(recover(f),false);assert.deepEqual(JSON.parse(f.disk()[root+'miniGamePending.json']),{version:1,pending:null});
 assert.equal(f.disk()[root+'miniGameState.json'],state);assert.equal(f.disk()[root+'member.json'],member);const all={...f.disk()};recover(f);assert.deepEqual(f.disk(),all);assert(!f.run('/금고').error);
});
test('already paid vault reward keeps exact points, record and remaining attempts',()=>{
 const f=fixture();assert(!f.run('/금고').error);assert(!f.run('/금고 '+f.state().vault.current.answer).error);const points=f.read().member.a.point,state=f.disk()[root+'miniGameState.json'];removeJournal(f);recover(f);assert.equal(f.disk()[root+'miniGameState.json'],state);assert(!f.run('/금고').error);assert.equal(f.read().member.a.point,points);
});
test('pending award with unknown or already credited member balance initializes a review journal without repayment',()=>{
 for(const credited of [false,true]){const f=fixture();makeUncertain(f,credited);const state=f.disk()[root+'miniGameState.json'],member=f.disk()[root+'member.json'];assert.throws(()=>recover(f),/복구 확인 필요/);const journal=JSON.parse(f.disk()[root+'miniGamePending.json']);assert(journal.recovery.required);assert.strictEqual(journal.pending,null);recover(f,false,true);assert(f.run('/금고').error);assert.equal(f.disk()[root+'miniGameState.json'],state);assert.equal(f.disk()[root+'member.json'],member);}
});
test('pending temporary bytes survive initialization and require review',()=>{
 const f=fixture();assert(!f.run('/금고').error);removeJournal(f);f.disk()[root+'miniGamePending.json.tmp']='{incomplete original';assert.throws(()=>recover(f),/복구 확인 필요/);assert.equal(f.disk()[root+'miniGamePending.json.missing'],'{incomplete original');assert(JSON.parse(f.disk()[root+'miniGamePending.json']).recovery.required);
});
test('existing evidence collision and corrupt state/journal are not overwritten',()=>{
 for(const bad of ['state','journal','evidence']){const f=fixture();assert(!f.run('/금고').error);if(bad==='journal')f.disk()[root+'miniGamePending.json']='{';else {removeJournal(f);if(bad==='state')f.disk()[root+'miniGameState.json']='{';else {f.disk()[root+'miniGamePending.json.tmp']='new bytes';f.disk()[root+'miniGamePending.json.missing']='original bytes';}}const before={...f.disk()};assert.throws(()=>recover(f));assert.deepEqual(f.disk(),before);}
});
test('journal creation failure preserves all game/member files and retry succeeds',()=>{
 const f=fixture();assert(!f.run('/금고').error);removeJournal(f);const before={...f.disk()},write=f.c.writeVerifiedJsonFile;f.c.writeVerifiedJsonFile=()=>{throw Error('synthetic journal seed failure');};assert.throws(()=>recover(f),/seed failure/);assert.deepEqual(f.disk(),before);f.c.writeVerifiedJsonFile=write;recover(f);assert(JSON.parse(f.disk()[root+'miniGamePending.json']).pending===null);
});
test('DEV recovery creates only DEV journal and preserves production bytes',()=>{
 const f=fixture();f.seed(true);assert(!f.run('/금고','a',true).error);removeJournal(f,dev);const prod=Object.fromEntries(Object.entries(f.disk()).filter(([p])=>p.startsWith(root)));recover(f,true);assert(f.disk()[dev+'miniGamePending.json']);assert.deepEqual(Object.fromEntries(Object.entries(f.disk()).filter(([p])=>p.startsWith(root))),prod);
});
test('cold initialization continues after recovery hold and after corrupt game state',()=>{
 const f=fixture();makeUncertain(f,true);startup(f);assert(f.c.initializationContinued);assert(JSON.parse(f.disk()[root+'miniGamePending.json']).recovery.required);assert.strictEqual(f.c.getCurrentContext().isDev,false);
 const bad=fixture();assert(!bad.run('/금고').error);removeJournal(bad);bad.disk()[root+'miniGameState.json']='{';startup(bad);assert(bad.c.initializationContinued);assert.equal(bad.disk()[root+'miniGameState.json'],'{');
});
test('actual callback returns menu or short vault hold while developer notes and attendance still respond',()=>{
 const f=fixture();makeUncertain(f,true);startup(f);f.disk()[root+'hoiBotChangeLog.json']=JSON.stringify({entries:[{version:'test',date:'2026-10-26',changes:['test note']}]});
 const menu=callback(f,'/미니게임');assert(!menu.error,JSON.stringify(menu.error));assert(menu.text.includes('미니게임')&&menu.text.includes('확인 중'));
 const vault=callback(f,'/금고');assert(!vault.error,JSON.stringify(vault.error));assert(vault.text.includes('중복 지급')&&!vault.text.includes('Error:'));
 const notes=callback(f,'/개발자노트');assert(!notes.error,JSON.stringify(notes.error));assert(notes.text.includes('test note'),notes.text);
 const attended=f.read();attended.member.a.today=1;f.disk()[root+'member.json']=JSON.stringify(attended);const attendance=callback(f,'ㅊㅊ');assert(!attendance.error,JSON.stringify(attendance.error));assert(attendance.text.length,attendance.text);
});
test('automatic recovery hold stops repeated retry timer and releases context',()=>{
 const f=fixture();makeUncertain(f,true);f.dropTimers();f.c.scheduleMiniGameWork(f.c.createCommandContext(false,'test'),1);f.auto(30000);assert.strictEqual(f.timers().size,0);assert.strictEqual(Object.keys(f.c.miniGameTimers).length,0);assert.strictEqual(f.c.getCurrentContext().isDev,false);
});
test('review metadata must be explicit, nonempty and cannot hide an active payout journal',()=>{
 const c=fixture().c;for(const recovery of [null,{}, {required:false,reason:'x'}, {required:true,reason:''}])assert.throws(()=>c.requireMiniGameJournal({version:1,pending:null,recovery}));assert.throws(()=>c.requireMiniGameJournal({version:1,pending:[],recovery:{required:true,reason:'x'}}));
});
console.log('PASS missing journal '+groups+' recovery/exception groups');
