// 2.697 기존 기록과 새 2게임·프리미엄·자료복원 정책의 경계를 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {fixture,root,main,block}=require('./test_mini_games');
const base='/sdcard/호이랜드/',stateName='miniGameState.json';
let groups=0;
function ok(r){assert(!r.error,r.error);return r.text;}
function test(name,fn){fn();console.log('PASS REVISION '+(++groups)+' '+name);}
function legacy(f,paid=false,notice='SENT'){
 const s=f.state(),day=s.vault.current.day,member=f.read(),id=f.id();
 s.vault={schemaVersion:1,current:{day,answer:666,low:300,high:900,prize:1500000000,usage:{['$'+id]:2},hints:[{accountId:id,name:'old',guess:100,direction:'UP'}],winner:paid?'$'+day:null},awards:{},replyPending:{}};
 if(paid){s.vault.current.hints=[];s.vault.awards['$'+day]={day,accountId:id,name:'old',amount:1500000000,answer:666,at:f.now()-100,paid:true,notice};const key='vault:'+day+':'+id;s.ledger[key]={id:key,kind:'vault',day,accountId:id,amount:1500000000,at:f.now()-100,status:'PAID',paidAt:f.now()-10};}
 f.putState(s);return {s,day,id,member};
}
function runObserved(f,msg,observed,who='a'){
 f.clear();const c=f.c,ctx=c.createCommandContext(false,'test'),previous=c.enterCommandContext(ctx);c.beginDataSaveTransaction();let error;
 try{c.runMiniGameEntry('recover',{ctx});c.runMiniGameEntry('command',{ctx,data:c.loadJsonFile(c.filePath),request:c.getMiniGameRequest(msg),sender:who,nickname:who,room:'test',requestAt:f.now(),requestGameId:observed,replier:c.replier});}
 catch(e){c.rollbackDataSaveTransaction();error=String(e);}finally{c.endDataSaveTransaction();c.exitCommandContext(previous);}
 return {error,text:f.replies().join('\n')};
}
function checks(){
 const f=fixture(),c=f.c;
 test('official menu replaces old command and both admin forms are exact',()=>{
  assert.equal(c.getMiniGameRequest('/호이월드미니게임'),null);assert.equal(c.getMiniGameRequest('/미니게임').kind,'menu');
  assert.equal(c.getMiniGameRequest('/금고리셋').action,'round');assert.equal(c.getMiniGameRequest('/금고리셋 해봐').kind,'invalid');
  assert.equal(c.getMiniGameRequest('/금고횟수리셋 테스트 닉').target,'테스트 닉');assert.equal(c.getMiniGameRequest('/금고횟수리셋 테스트 닉\n').kind,'invalid');
  const menu=c.buildMiniGameMenu();assert(menu.includes('(호패프 전용)')&&menu.includes('(호패프 +1회)'));
  for(const msg of ['/금고리셋','/금고횟수리셋 테스트 닉','dev/금고리셋'])assert(c.isExclusiveDataMutationCommandMessage(msg));
 });
 test('missing catalogs restore the exact full bundled originals without blank placeholders',()=>{
  for(const [file,command,kind] of [['balanceQuestions.json','/밸런스','questions'],['howoriDiceDialogues.json','/호월주사위','dialogues']]){
   f.seed();delete f.disk()[base+file];ok(f.run(command));
   assert.deepStrictEqual(JSON.parse(f.disk()[base+file]),JSON.parse(fs.readFileSync(path.join(root,'data',file))));
   assert.deepStrictEqual(JSON.parse(JSON.stringify(c.getMiniGameBundledCatalog(kind))),JSON.parse(fs.readFileSync(path.join(root,'data',file))));
   f.dropTimers();c.miniGameCatalogCaches={};const catalog=f.disk()[base+file];ok(f.run(command));assert.equal(f.disk()[base+file],catalog);
  }
 });
 test('restore write failure cannot start a game, allocate IDs, consume attempts or pay',()=>{
  for(const [file,command] of [['balanceQuestions.json','/밸런스'],['howoriDiceDialogues.json','/호월주사위']]){
   f.seed();delete f.disk()[base+file];const member=f.disk()[base+'member.json'];f.fail((_v,p)=>p===base+file);
   assert(f.run(command).error);assert(!f.disk()[base+stateName]);assert.equal(f.disk()[base+'member.json'],member);
   ok(f.run(command));assert(f.disk()[base+file]);
  }
 });
 test('existing corrupt or wrong-shaped catalogs stay failed and preserve game/member records',()=>{
  for(const [file,command] of [['balanceQuestions.json','/밸런스'],['howoriDiceDialogues.json','/호월주사위']])for(const corrupt of ['{','{"schemaVersion":1,"questions":[],"dialogues":[]}']){
   f.seed();ok(f.run('/금고'));const before=f.disk()[base+stateName],member=f.disk()[base+'member.json'];f.disk()[base+file]=corrupt;c.miniGameCatalogCaches={};
   assert(f.run(command).error);assert.equal(f.disk()[base+file],corrupt);assert.equal(f.disk()[base+stateName],before);assert.equal(f.disk()[base+'member.json'],member);
  }
 });
 test('interrupted catalog replacement uses its valid previous complete copy',()=>{
  f.seed();const original=f.disk()[base+'balanceQuestions.json'];delete f.disk()[base+'balanceQuestions.json'];f.disk()[base+'balanceQuestions.json.rollback']=original;ok(f.run('/밸런스'));assert.equal(f.disk()[base+'balanceQuestions.json'],original);
 });
 test('catalog recovery cannot overwrite existing votes, dice numbers, daily usage or paid ledger',()=>{
  f.seed();ok(f.run('/밸런스 1 이유'));ok(f.run('/호월주사위'));ok(f.run('/금고 1'));
  const before=f.state(),member=f.disk()[base+'member.json'];delete f.disk()[base+'balanceQuestions.json'];c.miniGameCatalogCaches={};ok(f.run('/밸런스'));
  const after=f.state();assert.deepStrictEqual(after,before);assert.equal(f.disk()[base+'member.json'],member);
 });
 test('legacy live state migrates once, keeping answer, hints, daily uses and all unrelated games',()=>{
  f.seed();ok(f.run('/밸런스 1 유지'));ok(f.run('/금고'));const {s,id}=legacy(f),member=f.disk()[base+'member.json'];ok(f.run('/금고'));
  const after=f.state();assert.equal(after.vault.schemaVersion,2);assert.equal(after.vault.current.id,'$'+s.vault.current.day);assert.equal(after.vault.current.answer,666);
  assert.deepStrictEqual(after.vault.current.usage,s.vault.current.usage);assert.deepStrictEqual(after.vault.current.hints,s.vault.current.hints);assert.deepStrictEqual(after.balance,s.balance);assert.equal(f.disk()[base+'member.json'],member);
  const stable=JSON.stringify(after);ok(f.run('/금고'));assert.equal(JSON.stringify(f.state()),stable);assert.equal(c.getVaultRobberyAttempts(after.vault,id,true).remaining,1);
 });
 test('legacy paid first prize is never repaid; it opens exactly one second and retains old proof',()=>{
  f.seed();ok(f.run('/금고'));const {day,id}=legacy(f,true),points=f.read().member.a.point;
  ok(f.run('/금고'));let s=f.state();assert.equal(f.read().member.a.point,points);assert.equal(s.vault.current.number,2);assert.equal(s.vault.current.prize,500000000);
  assert.equal(s.vault.current.usage['$'+id],2);assert.equal(s.vault.awards['$'+day].notice,'SENT');assert.equal(s.ledger['vault:'+day+':'+id].status,'PAID');
  const second=s.vault.current.id;ok(f.run('/금고'));assert.equal(f.state().vault.current.id,second);assert.equal(f.read().member.a.point,points);
 });
 test('legacy unpaid winner keeps original reward ID and is paid once before second opens',()=>{
  f.seed();ok(f.run('/금고'));const {s,day,id}=legacy(f,true,'WAITING'),key='vault:'+day+':'+id;
  s.vault.awards['$'+day].paid=false;s.ledger[key].status='PENDING';s.ledger[key].paidAt=null;f.putState(s);const p=f.read().member.a.point;
  ok(f.run('/금고'));const after=f.state();assert.equal(f.read().member.a.point,p+1500000000);assert.equal(after.ledger[key].status,'PAID');assert.equal(after.vault.current.number,2);
  ok(f.run('/금고'));assert.equal(f.read().member.a.point,p+1500000000);
 });
 test('normal and hoi cannot guess the correct answer after two attempts, including after reset',()=>{
  for(const user of ['b','c']){
   f.seed();ok(f.run('/금고'));let s=f.state();s.vault.current.answer=666;s.vault.current.low=300;s.vault.current.high=900;f.putState(s);
   ok(f.run('/금고 100',user));ok(f.run('/금고 200',user));const before=JSON.stringify(f.state()),p=f.read().member[user].point;
   const text=ok(f.run('/금고 666',user));assert(text.includes('0/2回')||text.includes('0/2회'));assert(!text.includes('666'));assert.equal(JSON.stringify(f.state()),before);assert.equal(f.read().member[user].point,p);
   f.clock(f.now()+1);ok(f.run('/금고리셋','master'));const answer=f.state().vault.current.answer;f.clock(f.now()+1);assert(ok(f.run('/금고 '+answer,user)).includes('기회를 모두'));assert(!f.state().vault.current.winner);
  }
 });
 test('premium-only third attempt and upgrade/downgrade keep already-used counts',()=>{
  f.seed();ok(f.run('/금고'));let s=f.state();s.vault.current.answer=666;s.vault.current.low=300;s.vault.current.high=900;f.putState(s);
  ok(f.run('/금고 1','b'));ok(f.run('/금고 2','b'));let d=f.read();d.member.b.pass='premium';f.write(d);ok(f.run('/금고 3','b'));assert.equal(f.state().vault.current.usage['$'+f.id('b')],3);
  d=f.read();d.member.b.pass='hoi';f.write(d);const view=ok(f.run('/금고','b'));assert(view.includes('0/2회'));assert(ok(f.run('/금고 666','b')).includes('기회를 모두'));
 });
 test('two prizes use distinct IDs, same-day attempts are shared, third automatic vault never opens',()=>{
  f.seed();ok(f.run('/금고'));const first=f.state().vault.current,points=f.read().member.a.point;ok(f.run('/금고 '+first.answer));const second=f.state().vault.current;
  assert.notEqual(first.answer,second.answer);assert.notEqual(first.id,second.id);assert.equal(second.usage['$'+f.id()],1);
  f.clock(f.now()+1);ok(f.run('/금고 '+second.answer));let s=f.state();assert.equal(s.vault.current.id,second.id);assert.equal(s.vault.current.number,2);assert(s.vault.current.winner);
  assert.equal(f.read().member.a.point,points+1000000000);assert.equal(Object.keys(s.vault.awards).length,2);assert.equal(Object.values(s.ledger).filter(r=>r.kind==='vault'&&r.status==='PAID').length,2);
  ok(f.run('/금고'));assert.equal(f.state().vault.current.id,second.id);
  f.clock(f.now()+86400000);f.dailyReset();ok(f.run('/금고'));assert.equal(f.state().vault.current.number,1);assert.equal(f.state().vault.current.prize,500000000);
 });
 test('live reset changes password/hints only, preserving prize, daily uses, members and regular number',()=>{
  f.seed();ok(f.run('/금고'));let s=f.state();s.vault.current.answer=666;s.vault.current.low=300;s.vault.current.high=900;s.vault.current.prize=100000000000;f.putState(s);
  ok(f.run('/금고 100'));const before=f.state(),member=f.disk()[base+'member.json'];f.clock(f.now()+1);
  const text=ok(f.run('/금고리셋','master')),after=f.state();assert(!text.includes(String(before.vault.current.answer)));assert.equal(after.vault.current.number,1);assert(!after.vault.current.manual);
  assert.notEqual(after.vault.current.id,before.vault.current.id);assert.notEqual(after.vault.current.answer,before.vault.current.answer);assert.equal(after.vault.current.prize,100000000000);
  assert.deepStrictEqual(after.vault.current.usage,before.vault.current.usage);assert.equal(after.vault.current.hints.length,0);assert.equal(f.disk()[base+'member.json'],member);
  const operations=JSON.parse(f.disk()[base+'miniGameArchive_2026-10.json']).operations;assert.equal(Object.keys(operations).length,1);assert(!Object.values(operations).some(r=>Object.hasOwn(r,'answer')));
 });
 test('admin denied or missing/invalid target never creates state or changes members',()=>{
  for(const [msg,user] of [['/금고리셋','admin'],['/금고횟수리셋 a','a'],['/금고횟수리셋','master'],['/금고횟수리셋 없는 사람','master'],['/금고리셋 해봐','master']]){
   f.seed();const before=f.disk()[base+'member.json'];ok(f.run(msg,user));assert.equal(f.disk()[base+'member.json'],before);assert(!f.disk()[base+stateName]);
  }
 });
 test('usage reset supports full spaced name and stable ID; leaves password/hints/prize/awards untouched',()=>{
  f.seed();ok(f.run('/금고'));const d=f.read();d.member['공백 있는 이름']=d.member.b;delete d.member.b;f.write(d);ok(f.run('/금고 1','공백 있는 이름'));ok(f.run('/금고 2','공백 있는 이름'));
  const before=f.state().vault;ok(f.run('/금고횟수리셋 공백 있는 이름','master'));let after=f.state().vault;const expected=JSON.parse(JSON.stringify(before));expected.current.usage['$'+f.id('공백 있는 이름')]=0;assert.deepStrictEqual(after,expected);
  ok(f.run('/금고 3','공백 있는 이름'));ok(f.run('/금고횟수리셋 '+f.id('공백 있는 이름'),'master'));assert.equal(f.state().vault.current.usage['$'+f.id('공백 있는 이름')],0);
 });
 test('completed second can only be manually reopened; manual wins do not open another vault',()=>{
  f.seed();ok(f.run('/금고'));ok(f.run('/금고 '+f.state().vault.current.answer));f.clock(f.now()+1);ok(f.run('/금고 '+f.state().vault.current.answer));const closed=f.state().vault.current.id;
  f.clock(f.now()+1);ok(f.run('/금고리셋','master'));let g=f.state().vault.current;assert(g.manual);assert.equal(g.number,2);assert.notEqual(g.id,closed);assert.equal(g.prize,500000000);assert(ok(f.run('/금고')).includes('운영자 리게임'));assert(!ok(f.run('/금고')).includes('3/2'));
  f.clock(f.now()+1);ok(f.run('/금고 '+g.answer));assert.equal(f.state().vault.current.id,g.id);assert(f.state().vault.current.winner);assert.equal(f.read().member.a.point,2500000000);
 });
 test('pending payout prevents reset without erasing winner, answer or reward',()=>{
  f.seed();ok(f.run('/금고'));const d=f.read();d.member.a.point=9007199254740991;f.write(d);ok(f.run('/금고 '+f.state().vault.current.answer));const before=f.state().vault;
  assert(ok(f.run('/금고리셋','master')).includes('복구 대기'));assert.deepStrictEqual(f.state().vault,before);
 });
 test('old observed game ID is rejected even when its timestamp is later than second opening',()=>{
  f.seed();ok(f.run('/금고'));const first=f.state().vault.current;ok(f.run('/금고 '+first.answer));const second=f.state().vault.current;f.clock(f.now()+10000);
  const p=f.read().member.b.point,text=ok(runObserved(f,'/금고 '+second.answer,first.id,'b'));assert(text.includes('횟수는 사용하지 않았어요'));assert(!f.state().vault.current.usage['$'+f.id('b')]);assert.equal(f.read().member.b.point,p);
  ok(runObserved(f,'/금고 '+second.answer,second.id,'b'));assert(f.state().vault.current.winner);
 });
 test('observed pre-reset game cannot be guessed or reset a second time by queued input',()=>{
  f.seed();ok(f.run('/금고'));const first=f.state().vault.current;f.clock(f.now()+1);ok(runObserved(f,'/금고리셋',first.id,'master'));const current=f.state().vault.current;
  f.clock(f.now()+100);ok(runObserved(f,'/금고 '+current.answer,first.id));assert.equal(f.state().vault.current.id,current.id);assert.equal(Object.keys(f.state().vault.current.usage).length,0);
  ok(runObserved(f,'/금고리셋',first.id,'master'));assert.equal(f.state().vault.current.id,current.id);
 });
 test('last attempt races always stop judging once daily used reaches limit',()=>{
  f.seed();ok(f.run('/금고'));let s=f.state();const id=f.id('b');s.vault.current.answer=666;s.vault.current.low=300;s.vault.current.high=900;s.vault.current.usage['$'+id]=1;f.putState(s);
  ok(f.run('/금고 100','b'));const before=JSON.stringify(f.state());assert(ok(f.run('/금고 666','b')).includes('기회를 모두'));assert.equal(JSON.stringify(f.state()),before);assert.equal(f.read().member.b.point,1000000000);
 });
 test('regular first/second prize history and paid evidence both archive without overwriting',()=>{
  f.seed();ok(f.run('/금고'));const first=f.state().vault.current.id;ok(f.run('/금고 '+f.state().vault.current.answer));const second=f.state().vault.current.id;f.clock(f.now()+1);ok(f.run('/금고 '+f.state().vault.current.answer));
  f.clock(f.now()+86400000);f.dailyReset();ok(f.run('/금고'));const archive=JSON.parse(f.disk()[base+'miniGameArchive_2026-10.json']);
  assert(archive.days['vault:'+first]&&archive.days['vault:'+second]);assert(archive.days['vaultAward:'+first]&&archive.days['vaultAward:'+second]);assert.equal(Object.values(archive.rewards).filter(r=>r.kind==='vault').length,2);
 });
 test('failed first-to-second publication recovers same second and never reissues first prize',()=>{
  f.seed();ok(f.run('/금고'));const first=f.state().vault.current,points=f.read().member.a.point;
  f.crashAfter((p,v)=>p.endsWith('/miniGameState.json')&&v.vault.current.number===2);
  assert(f.run('/금고 '+first.answer).error);const second=f.state().vault.current;f.dropTimers();ok(f.run('/금고'));assert.equal(f.state().vault.current.id,second.id);assert.equal(f.state().vault.current.answer,second.answer);assert.equal(f.read().member.a.point,points+500000000);
 });
 test('new catalog copies and all vault changes are isolated in DEV',()=>{
  f.seed(true);const prod=f.disk()[base+'member.json'];delete f.disk()['/sdcard/호이랜드_dev/balanceQuestions.json'];ok(f.run('/밸런스','a',true));ok(f.run('/금고','a',true));f.clock(f.now()+1);ok(f.run('/금고리셋','master',true));
  assert(!f.disk()[base+stateName]);assert.equal(f.disk()[base+'member.json'],prod);assert(f.disk()['/sdcard/호이랜드_dev/balanceQuestions.json']);
 });
test('all prior passwords and random endpoints produce a different valid password without a generated special hint',()=>{
  const original=c.Math.random;
  try{for(let previous=1;previous<=1000;previous++)for(const edge of [0,.999999]){c.Math.random=()=>edge;const round=c.createVaultRobberyRound(20751,500000000,previous);assert.notEqual(round.answer,previous);assert(round.answer>=1&&round.answer<=1000);assert(!('low' in round)&&!('high' in round));}}
  finally{c.Math.random=original;}
 });
 test('nickname versus another account ID ambiguity is rejected; @ forces exact nickname only',()=>{
  f.seed();ok(f.run('/금고'));const id=f.id('b'),d=f.read();d.member[id]=JSON.parse(JSON.stringify(d.member.c));d.member[id].serverRaidAccount.id='distinct-user-id';f.write(d);
  const s=f.state();s.vault.current.usage['$'+id]=2;s.vault.current.usage['$distinct-user-id']=2;f.putState(s);
  const before=JSON.stringify(f.state());assert(ok(f.run('/금고횟수리셋 '+id,'master')).includes('하나로 찾을 수 없어요'));assert.equal(JSON.stringify(f.state()),before);
  ok(f.run('/금고횟수리셋 @'+id,'master'));assert.equal(f.state().vault.current.usage['$distinct-user-id'],0);assert.equal(f.state().vault.current.usage['$'+id],2);
 });
 test('actual seven-argument callback gives short catalog-error guidance and records precise operator error',()=>{
  const h=require('./test_guild_marble').createHarness();h.seed();const g=h.c,files=h.f;
  g.commandDataFlowLock={readLock:()=>({lock(){},unlock(){}}),writeLock:()=>({lock(){},unlock(){}})};g.dataTransactionLock={lock(){},unlock(){},tryLock(){return true;}};g.autoDailyQuestInternalDepth=0;g.miniGameTimers={};g.miniGameCatalogCaches={};g.isHoiPassPremiumActive=()=>true;
  g.java.io.File.prototype.lastModified=()=>1;g.java.io.File.prototype.length=function(){return String(files.raw(this.path)||'').length;};
  g.getCachedMessageFilterWords=()=>[];g.errorLogPath='/synthetic/mini-game-error.json';let log;
  g.FileStream.write=(p,t)=>{assert.equal(p,g.errorLogPath);log=JSON.parse(t);};
  files.put(base+'balanceQuestions.json',{schemaVersion:1,questions:[]});
  const member=files.raw(g.filePath);files.clear();g.response('table','/밸런스','a',true,g.replier,null,'com.kakao.talk');
  const text=files.replies().join('\n');assert(text.includes('자료를 불러오지 못했어요'));assert(!text.includes('balanceQuestions.json')&&!text.includes('Error:'));
  assert(log.error.includes('balanceQuestions.json'));assert.equal(log.msg,'/밸런스');assert.equal(files.raw(g.filePath),member);assert(!files.raw(base+stateName));
 });
 test('waiting pair does not auto-roll; expired premium can finish but cannot start again',()=>{f.seed();ok(f.run('/호월주사위'));const first=f.state().dice.users['$'+f.id()].game,d=f.read();d.member.a.pass='hoi';f.write(d);f.auto(30000);assert.deepEqual(f.state().dice.users['$'+f.id()].game.rolls,first.rolls);const delay=c.getMiniGameWorkDelay(f.state(),f.now(),f.read(),c.buildServerRaidAccountIndex(f.read()));assert(delay>1000);ok(f.run('ㅎㅈ'));const done=f.state().dice.users['$'+f.id()].game;assert.equal(done.id,first.id);assert.equal(done.phase,'DONE');assert.deepEqual(done.rolls.slice(0,2),first.rolls);assert(ok(f.run('/호월주사위')).includes('전용'));});
 console.log('PASS mini game revision '+groups+' groups');
}
if(require.main===module)checks();
module.exports={checks,legacy,runObserved};
