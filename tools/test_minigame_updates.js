// 확정 기획의 보너스와 전체 길드 리셋을 실제 진입/합성 저장으로 검증한다.
const assert=require('assert'),vm=require('vm'),h=require('./test_mini_games'),marble=require('./test_guild_marble');
let groups=0;function test(name,fn){fn();console.log('PASS UPDATES '+(++groups)+' '+name);}
function ok(r){assert(!r.error,r.error);return r.text;}
const scenarios=[[[6,4,6,5],0,80000000,1],[[6,5,6,5],4,180000000,5],[[6,6,6,6],3,70000000,3],[[4,5,5,3],2,80000000,3],[[4,4,6,5],0,30000000,1],[[4,5,5,4],2,20000000,2],[[4,5,1,3],3,10000000,0],[[4,2,5,3],3,30000000,4],[[4,2,5,3],5,30000000,6],[[4,2,5,3],1,40000000,2]];
function dice(rolls,before,dev=false){const f=h.fixture();f.seed(dev);ok(f.run('/호월주사위','a',dev));const s=f.state(dev),u=s.dice.users['$'+f.id('a',dev)];u.streak=before;u.game.streakBefore=before;u.game.rolls=rolls.slice(0,2);f.putState(s,dev);let n=2;f.c.Math.random=()=>n<4?(rolls[n++]-.5)/6:0;f.clock(f.now()+1);const points=f.read(dev).member.a.point,text=ok(f.run('ㅎㅈ','a',dev));return {f,text,points,u:f.state(dev).dice.users['$'+f.id('a',dev)]};}
test('planning scenarios, exact amounts, two messages, shared guide, premium/DEV and no extra charge',()=>{
 for(const dev of [false,true])for(const [rolls,before,total,after]of scenarios){const{f,text,points,u}=dice(rolls,before,dev);assert.equal(u.streak,after);assert.equal(u.game.bonus.total,total);assert.equal(f.read(dev).member.a.point,points+total);assert.equal(u.used,1);assert.equal(f.replies().length,1);assert(text.includes('<ALLSEE>'));assert(!text.startsWith('[👑'));const mainText=text.split('<ALLSEE>')[0];assert.equal(mainText.includes('총 지급'),total!==u.game.bonus.base);assert.equal(mainText.includes('현재 '+after+'연승'),after>0);assert(!mainText.includes('현재 0연승'));assert.equal(f.c.GLOBAL_CONFIG.miniGames.dicePremium,4);}
});
test('all 1296 fair outcomes at seven streak levels satisfy independent bonus equations',()=>{
 const c=h.fixture().c;for(let before=0;before<=6;before++)for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let d=1;d<=6;d++)for(let e=1;e<=6;e++){
  const rolls=vm.runInContext(JSON.stringify([a,b,d,e]),c),bonus=c.calculateMiniGameDiceBonus(rolls,before),delta=a+d-b-e,after=delta>0?before+1:delta<0?0:before;
  const expected=(delta>0?30000000:delta<0?10000000:20000000)+(a===6&&d===6?50000000:0)+(delta>0&&a<b?20000000:0)+(delta>0?({2:10000000,3:30000000,5:100000000}[after]||0):0);
  assert.equal(bonus.total,expected);assert.equal(bonus.streakAfter,after);assert(!(bonus.comeback&&bonus.luckySix));c.requireMiniGameDiceBonus(bonus);
 }
});
test('streak persists /리셋, midnight, restart and next game; loss permits a new milestone',()=>{
 const{f}=dice([4,2,5,3],1);assert.equal(f.state().dice.users['$'+f.id()].streak,2);f.dailyReset();assert.equal(f.state().dice.users['$'+f.id()].streak,2);
 const restarted=h.fixture();restarted.seed();Object.assign(restarted.disk(),f.disk());restarted.clock(f.now()+86400000);ok(restarted.run('ㅎㅈ'));assert.equal(restarted.state().dice.users['$'+f.id()].game.streakBefore,2);
 const c=f.c;assert.equal(c.calculateMiniGameDiceBonus(vm.runInContext('[1,6,1,6]',c),2).streakAfter,0);assert.equal(c.calculateMiniGameDiceBonus(vm.runInContext('[6,1,1,1]',c),1).streak,10000000);
 const quotes=c.GLOBAL_CONFIG.miniGames.diceQuotes.draw,record={};const first=c.pickMiniGameDiceQuote(record,'lastFinalQuote',quotes);assert.notEqual(c.pickMiniGameDiceQuote(record,'lastFinalQuote',quotes),first);
});
test('damaged bonus/ledger/streak fails unchanged; old completed rewards are not retroactively upgraded',()=>{
 const{f}=dice([6,4,6,5],0);for(const mutate of [s=>s.dice.users['$'+f.id()].streak=-1,s=>s.dice.users['$'+f.id()].game.bonus.total++,s=>Object.values(s.ledger).find(r=>r.kind==='dice').bonus.luckySix=0]){const s=f.state();mutate(s);f.putState(s);const raw=JSON.stringify(s);assert(f.run('ㅎㅈ').error);assert.equal(JSON.stringify(f.state()),raw);}
 const old=dice([6,4,6,5],0).f,s=old.state(),u=s.dice.users['$'+old.id()],r=s.ledger[u.game.rewardId];delete u.game.bonus;delete u.game.streakBefore;delete u.streak;delete r.bonus;r.amount=30000000;old.putState(s);const point=old.read().member.a.point;old.clock(old.now()+1);ok(old.run('/금고'));assert.equal(old.read().member.a.point,point);assert(!old.state().dice.users['$'+old.id()].game.bonus);
});
function resetHarness(){const g=marble.createHarness(),c=g.c;c.resetAttendance=()=>{};c.stopAllIntervals=()=>{};c.runHoiPassPremiumAutoAttendance=()=>({message:'reset complete'});c.scheduleMiniGameWork=()=>{};c.carrotBoardPath=c.DATA_ROOT_PATH+'carrotBoard.json';
 const entry=h.block(h.main,'if (msg === "/리셋" &&');
 vm.runInContext("function runReset(sender,dev){var msg='/리셋',ctx=createCommandContext(!!dev,'reset-room'),previous=enterCommandContext(ctx);beginDataSaveTransaction();try{"+marble.recovery+"var data=loadJsonFile(filePath),petData=loadJsonFile(memberPetPath),petSkillData={},guildData=loadJsonFile(guildPath),replier={reply:function(text){resetMessages.push(String(text));}};"+entry+"}catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(previous);}}",c);
 g.reset=(user='호이 남',dev=false)=>{c.resetMessages=[];c.runReset(user,dev);return c.resetMessages.join('\n');};return g;}
test('actual /리셋 closes every room/guild; recruiting cancels, playing full refund and confirmed payout preserved',()=>{
 const g=resetHarness();g.seed();g.recruit();const s=g.store();s.guilds.$other=JSON.parse(JSON.stringify(s.guilds.$g));s.guilds.$other.guildId='other';s.guilds.$other.current.id='second';s.guilds.$other.current.guildId='other';s.guilds.$other.current.room='other-room';g.c.prepareGuildMarbleSettlement(s.guilds.$other.current,'PAYOUT');s.guilds.$recruit=JSON.parse(JSON.stringify(s.guilds.$g));s.guilds.$recruit.guildId='recruit';s.guilds.$recruit.current={id:'recruit',state:'RECRUITING',room:'third-room',ready:[]};
 // 모집 구조는 실제 모집 경기를 복사한다.
 const recruit=marble.createHarness();recruit.seed();recruit.run('/마블시작','master');s.guilds.$recruit.current=recruit.game();s.guilds.$recruit.current.id='third';s.guilds.$recruit.current.guildId='recruit';
 g.f.put(g.c.DATA_ROOT_PATH+g.c.GLOBAL_CONFIG.guildMarble.fileName,s);const data=g.f.read(),expected={};for(const p of s.guilds.$g.current.players)expected[p.id]=s.guilds.$g.current.fee;for(const row of s.guilds.$other.current.results)expected[s.guilds.$other.current.players[row.index].id]+=row.amount;
 const text=g.reset();assert(text.includes('경기 2개 종료')&&text.includes('모집 1개 취소'));for(const row of Object.values(g.store().guilds))assert.equal(row.current,null);for(const[u,m]of Object.entries(data.member))assert.equal(g.f.read().member[u].point,m.point+(expected[m.serverRaidAccount.id]||0));const raw=g.f.raw(g.c.filePath);g.reset();assert.equal(g.f.raw(g.c.filePath),raw);
});
test('missing account/overflow holds immutable settlement, never reopens play, repair pays exactly once',()=>{
 const g=resetHarness();g.seed();g.recruit();const d=g.f.read();d.member.a.point=Number.MAX_SAFE_INTEGER;g.f.write(d);assert(g.reset().includes('정산 대기 1개'));assert.equal(g.game().state,'SETTLING');assert.equal(g.game().kind,'REFUND');const game=JSON.stringify(g.game()),point=g.f.read().member.b.point;g.reset();assert.equal(JSON.stringify(g.game()),game);assert.equal(g.f.read().member.b.point,point);const fix=g.f.read();fix.member.a.point=0;g.f.write(fix);g.reset();assert.equal(g.game(),null);assert.equal(g.f.read().member.b.point,point+1e8);
});
test('deleted account and same-name replacement cannot receive another account refund',()=>{
 const g=resetHarness();g.seed();g.recruit();const d=g.f.read(),original=d.member.a;delete d.member.a;g.f.write(d);const otherPoint=g.f.read().member.b.point;assert(g.reset().includes('정산 대기 1개'));assert.equal(g.f.read().member.b.point,otherPoint);const replacement=g.f.read();replacement.member.a=JSON.parse(JSON.stringify(original));replacement.member.a.serverRaidAccount.id='new-account';g.f.write(replacement);g.reset();assert.equal(g.f.read().member.a.point,original.point);replacement.member.a=original;g.f.write(replacement);g.reset();assert.equal(g.game(),null);assert.equal(g.f.read().member.a.point,original.point+1e8);
});
test('reset permission, DEV isolation and malformed store protect production and unrelated files',()=>{
 const g=resetHarness();g.seed();g.recruit();const before=g.f.files();g.reset('gm');assert.deepEqual(g.f.files(),before);g.recruit(true);const prod=g.f.raw(g.c.filePath),store=g.f.raw(g.c.DATA_ROOT_PATH+g.c.GLOBAL_CONFIG.guildMarble.fileName);g.reset('호이 남',true);assert.equal(g.f.raw(g.c.filePath),prod);assert.equal(g.f.raw(g.c.DATA_ROOT_PATH+g.c.GLOBAL_CONFIG.guildMarble.fileName),store);assert.equal(g.game(true),null);
 const bad=resetHarness();bad.seed();bad.recruit();const path=bad.c.DATA_ROOT_PATH+bad.c.GLOBAL_CONFIG.guildMarble.fileName;bad.f.put(path,{broken:true});const files=bad.f.files();assert.throws(()=>bad.reset());assert.deepEqual(bad.f.files(),files);
});
test('member/marble/clear save failures rollback or recover without a second refund',()=>{
 for(const suffix of ['member.json','guildMarble.json','guildMarblePending.json']){const g=resetHarness();g.seed();g.recruit();const points=g.f.read().member.a.point;g.f.failPath(g.c.DATA_ROOT_PATH+suffix);assert.throws(()=>g.reset());g.reset();assert.equal(g.game(),null);assert.equal(g.f.read().member.a.point,points+1e8);g.reset();assert.equal(g.f.read().member.a.point,points+1e8);}
});
test('bonus payout failure retains result/streak and pays once after repair; first and final replies are fixed',()=>{
 const f=h.fixture();f.seed();ok(f.run('ㅎㅈ'));const s=f.state(),u=s.dice.users['$'+f.id()];u.streak=4;u.game.streakBefore=4;u.game.rolls=[6,5];f.putState(s);f.c.Math.random=()=>.999;const d=f.read();d.member.a.point=Number.MAX_SAFE_INTEGER;f.write(d);f.clock(f.now()+1);assert(ok(f.run('ㅎㅈ')).includes('총 지급 예정'));const pending=f.state().dice.users['$'+f.id()].game;assert.equal(pending.bonus.total,180000000);assert.equal(pending.phase,'RESULT');assert.equal(f.state().dice.users['$'+f.id()].streak,5);f.clock(f.now()+1);ok(f.run('ㅎㅈ'));assert.deepEqual(f.state().dice.users['$'+f.id()].game,pending);const fix=f.read();fix.member.a.point=0;f.write(fix);ok(f.run('ㅎㅈ'));assert.equal(f.read().member.a.point,180000000);assert.equal(f.state().dice.users['$'+f.id()].streak,5);
});
test('actual marble reset preserves ongoing dice, its first pair and cross-day streak',()=>{
 const fs=require('fs'),g=resetHarness();g.seed();g.recruit();const c=g.c;c.isHoiPassPremiumActive=()=>true;c.miniGameCatalogCaches={};c.miniGameTimers={};c.java.io.File.prototype.lastModified=function(){return 1;};c.java.io.File.prototype.length=function(){return String(g.f.raw(this.path)||'').length;};
 for(const file of ['balanceQuestions.json','howoriDiceDialogues.json'])g.f.put(c.DATA_ROOT_PATH+file,JSON.parse(fs.readFileSync(h.root+'/data/'+file,'utf8')));
 const previous=c.enterCommandContext(c.createCommandContext(false,'dice-room'));c.beginDataSaveTransaction();try{c.runMiniGameEntry('command',{ctx:c.getCurrentContext(),data:c.loadJsonFile(c.filePath),sender:'a',nickname:'a',room:'dice-room',replier:c.replier,requestAt:c.Date.now(),request:c.getMiniGameRequest('ㅎㅈ')});}finally{c.endDataSaveTransaction();c.exitCommandContext(previous);}
 const path=c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.miniGames.stateName,state=g.f.get(path),id='id-a';state.dice.users['$'+id].streak=3;state.dice.users['$'+id].game.streakBefore=3;g.f.put(path,state);const before=JSON.stringify(state.dice.users['$'+id].game);g.reset();const after=g.f.get(path).dice.users['$'+id];assert.equal(JSON.stringify(after.game),before);assert.equal(after.streak,3);assert.equal(after.used,0);assert.equal(g.game(),null);assert(c.isExclusiveDataMutationCommandMessage('/리셋'));
});
if(require.main===module)console.log('PASS minigame updates '+groups+' groups');
module.exports={resetHarness};
