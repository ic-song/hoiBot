// 실제 /리셋 분기와 저장 함수를 사용해 수동 일일 회차·실패·DEV를 검증한다.
const assert=require('assert'),vm=require('vm'),h=require('./test_mini_games'),marble=require('./test_guild_marble');
const base='/sdcard/호이랜드/',devBase='/sdcard/호이랜드_dev/';let groups=0;
function test(name,fn){fn();console.log('PASS DAILY '+(++groups)+' '+name);}
function ok(r){assert(!r.error,r.error);return r.text;}
function fixture(){const f=h.fixture(),seed=f.seed;f.seed=(dev=false)=>{seed(dev);const d=f.read(dev);d.attend_list=[];for(const m of Object.values(d.member)){m.battle=m.battle||{ticket:0,count:0};m.bag=m.bag||{};}f.write(d,dev);};f.seed();const c=f.c;c.carrotBoardPath=base+'carrotBoard.json';
 vm.runInContext(h.block(h.main,'function resetAttendance('),c);
 c.stopAllIntervals=()=>{};c.runHoiPassPremiumAutoAttendance=()=>({message:'synthetic auto attendance',noticeMessage:''});
 vm.runInContext(marble.model,c);
 vm.runInContext('function executeDailyReset(){'+marble.recovery+'var data=loadJsonFile(filePath),petData=loadJsonFile(memberPetPath),petSkillData=loadJsonFile(petSkillDataPath),guildData=loadJsonFile(guildPath),ctx=getCurrentContext();runMiniGameEntry("recover",{ctx:ctx,allowRecoveryReview:true});data=loadJsonFile(filePath);'+h.block(h.main,'if (msg === "/리셋" && (sender == "오픈채팅봇"')+'}',c);
 f.resetCommand=(msg='/리셋',sender='호이 남',isDev=false)=>{
  f.clear();const ctx=c.createCommandContext(isDev,'test'),previous=c.enterCommandContext(ctx),oldReplier=c.replier;c.beginDataSaveTransaction();
  try{c.ctx=ctx;c.msg=msg;c.sender=sender;c.replier=c.createContextReplier(oldReplier,ctx);c.executeDailyReset();}
  catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(previous);c.replier=oldReplier;}
  f.clock(f.now()+1);return f.replies().join('\n');
 };return f;
}
function seedGames(f){ok(f.run('/금고'));ok(f.run('/금고 100'));ok(f.run('ㅎㅈ'));ok(f.run('/밸런스 1 이유'));}
test('calendar midnight and automatic workers cannot reset any daily game without /리셋',()=>{
 const f=fixture();seedGames(f);const old=f.state();f.auto(86400000*3);for(const msg of ['/금고','/밸런스'])ok(f.run(msg));const now=f.state();assert.deepEqual(now.vault,old.vault);assert.deepEqual(now.balance,old.balance);assert.deepEqual(now.dice,old.dice);assert.equal(now.dailyReset.cycle,0);
});
test('actual authorized reset switches vault/question/attempts but retains the unfinished dice pair',()=>{
 const f=fixture();seedGames(f);const old=f.state(),p=f.read().member.a.point;f.clock(f.now()+86400000);f.resetCommand();const s=f.state();assert.equal(s.dailyReset.cycle,1);assert.equal(s.vault.current.prize,200000000);assert.notEqual(s.vault.current.answer,old.vault.current.answer);assert.deepEqual(s.vault.current.usage,{});assert.equal(s.vault.current.hints.length,0);assert.equal(s.vault.current.number,1);assert.equal(s.balance.current.order.length,0);assert.notEqual(s.balance.current.question.id,old.balance.current.question.id);assert.equal(s.dice.users['$'+f.id()].used,0);assert.deepEqual(s.dice.users['$'+f.id()].game,old.dice.users['$'+f.id()].game);assert.equal(f.read().member.a.point,p);assert.equal(f.read().member.a.today,0);
 const d=f.read();d.member.a.today=1;f.write(d);ok(f.run('ㅎㅈ'));assert.equal(f.state().dice.users['$'+f.id()].game.phase,'DONE');assert.equal(f.state().dice.users['$'+f.id()].used,0);
});
test('same-date resets keep distinct balance ledgers, summaries and original paid proofs',()=>{
 const f=fixture(),users=['a','b','c','admin','master'];for(let cycle=0;cycle<3;cycle++){for(const u of users)ok(f.run('/밸런스 1 이유',u));const p=f.read().member.a.point;f.resetCommand();ok(f.run('/밸런스'));assert.equal(f.read().member.a.point,p+100000000);assert.equal(f.state().dailyReset.cycle,cycle+1);const stats=ok(f.run('/밸런스결과','master'));assert(stats.includes('보상 대상: 5명')&&stats.includes('지급 완료: 1명'));}
 assert.equal(Object.values(f.state().ledger).filter(r=>r.kind==='balance'&&r.status==='PAID'&&r.accountId===f.id()).length,3);assert.equal(Object.values(f.state().ledger).filter(r=>r.kind==='balance').length,15);const archive=JSON.parse(f.disk()[base+'miniGameArchive_2026-10.json']);assert.equal(Object.keys(archive.days).filter(k=>k.startsWith('balance:')).length,3);
});
test('unauthorized and suffix reset inputs cannot publish game/member changes',()=>{
 const f=fixture();seedGames(f);for(const [msg,sender] of [['/리셋','a'],['/리셋 해봐','호이 남']]){const before=JSON.stringify(f.disk());f.resetCommand(msg,sender);assert.equal(JSON.stringify(f.disk()),before);}
});
test('archive and state save failures roll back legacy member/pet reset and allow retry',()=>{
 for(const name of ['miniGameArchive_2026-10.json','miniGameState.json']){const f=fixture();seedGames(f);const before={};for(const p of [base+'member.json',base+'member_pet.json',base+'miniGameState.json',base+'miniGameArchive_2026-10.json'])before[p]=f.disk()[p];f.fail((d,path)=>path.endsWith('/'+name));assert.throws(()=>f.resetCommand());for(const p in before)assert.equal(f.disk()[p],before[p],name+' '+p);f.fail(()=>false);f.resetCommand();assert.equal(f.state().dailyReset.cycle,1);}
});
test('legacy member save failure cannot publish a new mini-game period',()=>{
 const f=fixture();seedGames(f);const before=JSON.stringify(f.state());f.fail((d,p)=>p===base+'member.json');assert.throws(()=>f.resetCommand());assert.equal(JSON.stringify(f.state()),before);f.fail(()=>false);f.resetCommand();assert.equal(f.state().dailyReset.cycle,1);
});
test('DEV reset only touches DEV data; progress and balances in PROD remain exact',()=>{
 const f=fixture();f.seed(true);ok(f.run('/금고','a',true));ok(f.run('ㅎㅈ','a',true));const before=Object.fromEntries(Object.entries(f.disk()).filter(([p])=>p.startsWith(base)));f.resetCommand('/리셋','오픈채팅봇',true);assert.equal(f.state(true).dailyReset.cycle,1);assert.deepEqual(Object.fromEntries(Object.entries(f.disk()).filter(([p])=>p.startsWith(base))),before);assert(f.disk()[devBase+'miniGameState.json']);
});
test('pre-reset queued guesses/votes/dice are rejected without consuming new period attempts',()=>{
 const f=fixture();seedGames(f);const at=f.now();f.clock(at+1);f.resetCommand();for(const msg of ['/금고 100','/밸런스 1 이전이유','ㅎㅈ']){const out=ok(f.run(msg,'a',false,'test',at));assert(out.includes('리셋')||out.includes('새 금고')||out.includes('날짜가 바뀌'));}assert.deepEqual(f.state().vault.current.usage,{});assert.equal(f.state().balance.current.order.length,0);assert.equal(f.state().dice.users['$'+f.id()].used,0);
});
test('reset command waits for data lock while normal noncritical input retains tryLock flow',()=>{
 const f=fixture(),c=f.c;const start=h.main.indexOf('        if (isServerRaidMutationCommand(msg) || msg === "/리셋"'),end=h.main.indexOf('        responseTransactionAcquired = true;',start);assert(start>0&&end>start);let locked=0,tried=0;c.dataTransactionLock={lock(){locked++;},tryLock(){tried++;return false;}};vm.runInContext('function acquireResetLock(){'+h.main.slice(start,end)+'}',c);for(const msg of ['/리셋','dev/리셋']){c.msg=msg;c.acquireResetLock();}assert.equal(locked,2);assert.equal(tried,0);c.msg='/리셋 해봐';c.acquireResetLock();assert.equal(tried,1);
});
test('reset before installation creates no games; recovery-review hold preserves games while legacy reset works',()=>{
 const fresh=fixture();fresh.resetCommand();assert(!fresh.disk()[base+'miniGameState.json']);
 const f=fixture();seedGames(f);const before=JSON.stringify(f.state());f.disk()[base+'miniGamePending.json']=JSON.stringify({version:1,pending:null,recovery:{required:true,reason:'synthetic review'}});const out=f.resetCommand();assert(out.includes('일일 초기화는 보류'));assert.equal(JSON.stringify(f.state()),before);assert.equal(f.read().member.a.today,0);
});
test('clock rollback rejects a reset before member/pet/game changes',()=>{
 const f=fixture();seedGames(f);f.resetCommand();const before={...f.disk()};f.clock(f.now()-86400000);assert.throws(()=>f.resetCommand(),/시각 역행/);assert.deepEqual(f.disk(),before);
});
test('PROD/DEV: existing empty marble store joins reset; damaged store fails without changing member/game',()=>{
 for(const dev of [false,true]){
  const f=fixture();f.seed(dev);ok(f.run('/금고','a',dev));const root=dev?devBase:base,config=f.c.GLOBAL_CONFIG.guildMarble,path=root+config.fileName;
  f.disk()[path]='{';const before={...f.disk()};assert.throws(()=>f.resetCommand('/리셋','오픈채팅봇',dev));assert.deepEqual(f.disk(),before);
  f.disk()[path]=JSON.stringify({schemaVersion:config.schemaVersion,guilds:{}});const points=f.read(dev).member.a.point;
  assert(f.resetCommand('/리셋','오픈채팅봇',dev).includes('경기 0개 종료'));assert.equal(f.state(dev).dailyReset.cycle,1);assert.equal(f.read(dev).member.a.point,points);
 }
});
test('PROD/DEV: marble journal is recovered before loading reset member; confirmed balance survives',()=>{
 for(const dev of [false,true]){
  const f=fixture();f.seed(dev);ok(f.run('/금고','a',dev));const root=dev?devBase:base,config=f.c.GLOBAL_CONFIG.guildMarble,data=f.read(dev),points=data.member.a.point+123;
  data.member.a.point=points;f.disk()[root+config.pendingName]=JSON.stringify({schemaVersion:config.schemaVersion,pending:{memberText:JSON.stringify(data),marbleText:JSON.stringify({schemaVersion:config.schemaVersion,guilds:{}})}});
  f.resetCommand('/리셋','오픈채팅봇',dev);assert.equal(f.read(dev).member.a.point,points);assert.equal(f.read(dev).member.a.today,0);
  assert.equal(JSON.parse(f.disk()[root+config.pendingName]).pending,null);assert.equal(f.state(dev).dailyReset.cycle,1);
 }
});
console.log('PASS daily reset '+groups+' groups');
