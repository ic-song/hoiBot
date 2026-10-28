// 15개 금고의 실제 명령·저장·이관·전체 리셋을 합성 파일로 검증한다.
const assert=require('assert'),h=require('./test_mini_games');
const base='/sdcard/호이랜드/';let groups=0;
function ok(r){assert(!r.error,r.error);return r.text;}
function fixture(){const f=h.fixture();f.seed();ok(f.run('/금고'));return f;}
function next(f,msg,user='a'){f.clock(f.now()+1);return f.run(msg,user);}
function win(f,user='a'){return ok(next(f,'/금고 '+f.state().vault.current.answer,user));}
function stageStore(c,n,day){const s={schemaVersion:4,serial:0,current:null,awards:{},replyPending:{},dailyWinners:[]};for(let i=1;i<=n;i++){c.startVaultRobberyRound(s,day,i,false,0,undefined,{});if(i<n){const r=c.applyVaultRobberyGuess(s,'old'+i,'old'+i,s.current.answer,true,1);s.awards[r.awardKey].paid=true;s.awards[r.awardKey].nextOpened=true;}}return s;}
function legacy(f,won=false,paid=true,number=1){
 const s=f.state(),day=s.vault.current.day,id=f.id(),key='$'+day+':1';
 s.vault={schemaVersion:2,serial:1,current:{id:key,serial:1,number,manual:false,openedAt:0,day,answer:666,prize:100000000000,usage:{['$'+id]:2},hints:[],winner:won?key:null},awards:{},replyPending:{}};
 if(won){const amount=1500000000;s.vault.current.prize=amount;s.vault.awards[key]={gameId:key,number:1,manual:false,nextOpened:false,rewardId:'vault:'+key+':'+id,day,accountId:id,name:'old',amount,answer:666,at:f.now()-10,paid,notice:paid?'SENT':'WAITING'};const a=s.vault.awards[key];s.ledger[a.rewardId]={id:a.rewardId,kind:'vault',gameId:key,day,accountId:id,amount,at:a.at,status:paid?'PAID':'PENDING',paidAt:paid?f.now():null};}
 f.putState(s);return {key,id};
}
function test(name,fn){fn();console.log('PASS VAULT BALANCE '+(++groups)+' '+name);}
test('twenty ordered vaults pay 156억 exactly; closed guesses stay unchanged and MASTER can restart',()=>{
 const f=fixture(),before=Object.values(f.read().member).reduce((a,u)=>a+u.point,0),ids=[];
 for(let n=1;n<=20;n++){
  const s=f.state(),r=s.vault.current,stage=f.c.getVaultRobberyStage(n);ids.push(r.id);
  assert.equal(r.number,n);assert.equal(r.prize,stage.prize);assert(r.answer>=stage.minNumber&&r.answer<=stage.maxNumber);
  const text=win(f,n<=5?'a':n<=8?'b':n<=11?'c':n<=14?'admin':n<=17?'master':'noPass');assert(!text.includes('/리셋'));assert(!text.includes('포인트 포인트'));
  assert.equal(f.state().vault.dailyWinners.length,n);if(n<20){assert.equal(f.state().vault.current.number,n+1);assert.equal(f.state().vault.current.hints.length,0);}
 }
 const after=Object.values(f.read().member).reduce((a,u)=>a+u.point,0);assert.equal(after-before,15600000000);assert.equal(new Set(ids).size,20);
 const s=f.state(),snapshot=JSON.stringify(s.vault);for(const msg of ['/금고','/금고 100','/금고 999999','/금고 1']){const text=ok(next(f,msg));assert(text.includes('20개 모두 개방'));assert.equal(JSON.stringify(f.state().vault),snapshot);}
 const text=ok(f.run('/금고'));assert(text.includes('156억'));assert(text.indexOf('[20번째]')<text.indexOf('[1번째]'));assert(text.indexOf('<ALLSEE>')<text.indexOf('[20번째]'));for(const id of ids)assert(text.includes('🔐'+s.vault.awards[id].answer));
 ok(next(f,'/금고리셋','master'));assert.equal(f.state().vault.current.number,1);assert.deepEqual(f.state().vault.dailyWinners,[]);assert.deepEqual(f.state().vault.current.usage,{});s.vault.awards[s.vault.current.winner].nextOpened=true;assert.deepEqual(f.state().vault.awards,s.vault.awards);assert.deepEqual(f.state().ledger,s.ledger);
});
test('normal/hoi three and premium five: exhausted correct answers do not win; upgrades/downgrades keep usage',()=>{
 for(const user of ['a','b','c']){const f=fixture(),limit=user==='a'?5:3;for(let i=0;i<limit;i++)ok(next(f,'/금고 100',user));assert.equal(f.state().vault.current.usage['$'+f.id(user)],limit);const s=JSON.stringify(f.state().vault);assert(ok(next(f,'/금고 '+f.state().vault.current.answer,user)).includes('기회를 모두'));assert.equal(JSON.stringify(f.state().vault),s);}
 const f=fixture();for(let i=0;i<3;i++)ok(next(f,'/금고 100','b'));const d=f.read();d.member.b.pass='premium';f.write(d);assert.equal(f.c.getVaultRobberyAttempts(f.state().vault,f.id('b'),true).remaining,2);ok(next(f,'/금고 100','b'));d.member.b.pass='hoi';f.write(d);assert(ok(f.run('/금고','b')).includes('0/3회'));
});
test('all stages reject values outside their own range without consuming or adding hints; strict command guards',()=>{
 const f=fixture();for(const msg of ['/금고 0','/금고 99','/금고 100000','/금고 -1','/금고 1.5','/금고 100 해봐','/금고 100\n','/금고\n100']){const s=JSON.stringify(f.state().vault);ok(next(f,msg));assert.equal(JSON.stringify(f.state().vault),s);}
 for(let n=1;n<=20;n++){const st=stageStore(f.c,n,f.state().vault.current.day),p=f.c.getVaultRobberyStage(n);for(const guess of [p.minNumber-1,p.maxNumber+1]){const s=JSON.stringify(st);assert.equal(f.c.applyVaultRobberyGuess(st,'x','x',guess,true,f.now()).kind,'invalid');assert.equal(JSON.stringify(st),s);}}
});
test('hint retention 3/5/5, UP/DOWN/newest-first and no password separators',()=>{
 const f=fixture();for(const n of [1,4,8]){const store=stageStore(f.c,n,20750),p=f.c.getVaultRobberyStage(n);store.current.answer=p.minNumber+10;
  for(let i=0;i<7;i++)assert.equal(f.c.applyVaultRobberyGuess(store,'id'+i,'name'+i,i%2?p.maxNumber:p.minNumber,false,f.now()).kind,'wrong');assert.equal(store.current.hints.length,p.recentHints);
  const out=f.c.buildVaultRobberyMessage(store,'id0',false,false,'name',{kind:'view'});assert(out.includes('('+p.label+')'));assert(out.indexOf('[name6]')<out.indexOf('[name5]'));assert(out.includes('🔐'+p.minNumber+' → UP⬆️'));assert(out.includes('🔐'+p.maxNumber+' → DOWN⬇️'));assert(!out.includes('/리셋'));assert(!out.includes('1,000'));}
});
test('wall clock midnight never resets and valid guesses remain possible; /리셋 alone clears round/winners/hints/counts to fixed 2억',()=>{
 const f=fixture();win(f);const old=f.state().vault;f.auto(3*86400000);ok(f.run('/금고'));assert.deepEqual(f.state().vault,old);ok(next(f,'/금고 1000','b'));assert.equal(f.state().vault.current.usage['$'+f.id('b')],1);const paid=f.read().member.a.point;f.dailyReset();const s=f.state().vault;assert.equal(s.current.number,1);assert.equal(s.current.prize,200000000);assert.deepEqual(s.current.usage,{});assert.deepEqual(s.dailyWinners,[]);assert.deepEqual(s.current.hints,[]);assert.equal(f.read().member.a.point,paid);f.dailyReset();assert.equal(f.state().vault.current.prize,200000000);
});
test('legacy carry is discarded once; used attempts and unrelated balance/dice/paid proof stay intact',()=>{
 const f=fixture();ok(f.run('/밸런스 1 보존'));const {id}=legacy(f),before=f.state(),points=f.read().member.a.point;ok(f.run('/금고'));const s=f.state();assert.equal(s.vault.schemaVersion,4);assert.equal(s.vault.current.prize,200000000);assert.equal(s.vault.current.usage['$'+id],2);assert.deepEqual(s.balance,before.balance);assert.deepEqual(s.dice,before.dice);assert.equal(f.read().member.a.point,points);const stable=JSON.stringify(s);ok(f.run('/금고'));assert.equal(JSON.stringify(f.state()),stable);assert(!ok(f.run('/금고')).includes('1,000억'));
});
test('legacy paid or pending winner retains amount/reward ID; no duplicate; next round is fixed 2억',()=>{
 for(const paid of [true,false]){const f=fixture(),{key,id}=legacy(f,true,paid),points=f.read().member.a.point;ok(f.run('/금고'));const s=f.state();assert.equal(s.vault.current.number,2);assert.equal(s.vault.current.prize,200000000);assert.deepEqual(s.vault.dailyWinners,[key]);assert.equal(s.vault.awards[key].rewardId,'vault:'+key+':'+id);assert.equal(s.vault.awards[key].amount,1500000000);assert.equal(f.read().member.a.point,points+(paid?0:1500000000));ok(f.run('/금고'));assert.equal(f.read().member.a.point,points+(paid?0:1500000000));}
});
test('legacy schema1 and old durable journal recover before migration without changing confirmed payment',()=>{
 const f=fixture(),{key,id}=legacy(f,true,false),s=f.state(),a=s.vault.awards[key],day=a.day,oldKey='$'+day,oldReward='vault:'+day+':'+id;delete s.ledger[a.rewardId];s.ledger[oldReward]={...a,id:oldReward,kind:'vault',status:'PENDING',paidAt:null};delete s.ledger[oldReward].gameId;s.vault.schemaVersion=1;delete s.vault.serial;s.vault.current.winner=oldKey;s.vault.awards={[oldKey]:{day,accountId:id,name:'old',amount:a.amount,answer:a.answer,at:a.at,paid:false,notice:'WAITING'}};f.putState(s);const p=f.read().member.a.point;
 f.disk()[base+'miniGamePending.json']=JSON.stringify({version:1,pending:[{name:'miniGameState.json',text:JSON.stringify(s)}]});ok(f.run('/금고'));assert.equal(f.read().member.a.point,p+a.amount);assert.equal(f.state().ledger[oldReward].status,'PAID');assert.equal(f.state().vault.current.number,2);
});
test('legacy same-date earlier /리셋 awards are not counted in the current new first round',()=>{
 const f=fixture(),{key}=legacy(f,true,true),s=f.state();s.vault.serial=2;s.vault.current={...s.vault.current,id:'$'+s.vault.current.day+':2',serial:2,number:1,winner:null};f.putState(s);ok(f.run('/금고'));assert.deepEqual(f.state().vault.dailyWinners,[]);assert(f.state().vault.awards[key]);assert.equal(f.state().vault.current.number,1);
});
test('pending payment cannot open next vault or let admin erase winner; totals count only actual payments',()=>{
 const f=fixture(),d=f.read();d.member.a.point=9007199254740991;f.write(d);const out=win(f);assert(out.includes('지급 확인 중'));const s=f.state().vault;assert.equal(s.current.number,1);assert.equal(f.c.getVaultRobberyPaidTotal(s),0);assert(ok(next(f,'/금고리셋','master')).includes('복구 대기'));assert.deepEqual(f.state().vault,s);const fix=f.read();fix.member.a.point=0;f.write(fix);ok(f.run('/금고'));assert.equal(f.read().member.a.point,200000000);assert.equal(f.state().vault.current.number,2);
});
test('reply failure replays accepted result without consuming twice and uncertain global notice never resends/rewards',()=>{
 const f=fixture();f.replyFail(true);assert(next(f,'/금고 100').error);f.replyFail(false);ok(next(f,'/금고 100'));assert.equal(f.state().vault.current.usage['$'+f.id()],1);f.noticeFail(()=>true);win(f);const s=f.state(),p=f.read().member.a.point;assert.equal(s.vault.awards[s.vault.dailyWinners[0]].notice,'UNCERTAIN');ok(f.run('/금고'));assert.equal(f.read().member.a.point,p);
});
test('member/state/journal-clear interruption recovers exactly one fixed reward and preserves later transactions',()=>{
 for(const file of ['member.json','miniGameState.json','miniGamePending.json']){const f=fixture(),p=f.read().member.a.point;f.crashAfter((path,v)=>path.endsWith('/'+file)&&(file==='member.json'?v.member.a.point>p:file==='miniGameState.json'?Object.values(v.ledger).some(r=>r.status==='PAID'):v.pending===null&&f.read().member.a.point>p));assert(next(f,'/금고 '+f.state().vault.current.answer).error);ok(f.run('/금고'));assert.equal(f.read().member.a.point,p+200000000);const d=f.read();d.member.b.point+=17;f.write(d);ok(f.run('/금고'));assert.equal(f.read().member.b.point,d.member.b.point);assert.equal(f.read().member.a.point,p+200000000);}
});
test('old observed game ID and pre-reset request time do not enter new vault or consume attempts',()=>{
 const f=fixture(),old=f.state().vault.current;win(f);f.clock(f.now()+1);const ctx=f.c.createCommandContext(false,'test'),previous=f.c.enterCommandContext(ctx);f.c.beginDataSaveTransaction();let text='';try{f.c.runMiniGameEntry('command',{ctx,data:f.c.loadJsonFile(f.c.filePath),sender:'b',nickname:'b',room:'test',replier:{reply:t=>text+=t},request:f.c.getMiniGameRequest('/금고 '+f.state().vault.current.answer),requestAt:f.now(),requestGameId:old.id});}finally{f.c.endDataSaveTransaction();f.c.exitCommandContext(previous);}assert(text.includes('횟수는 사용하지 않았어요'));assert(!f.state().vault.current.usage['$'+f.id('b')]);const stamp=f.now();f.dailyReset();assert(ok(f.run('/금고 100','b',false,'test',stamp)).includes('횟수는 사용하지 않았어요'));
});
test('malformed current stage/award/winner order rejects without resetting or writing defaults',()=>{
 for(const mutate of [s=>s.vault.current.prize=500000000,s=>s.vault.current.answer=1000,s=>s.vault.current.number=16,s=>s.vault.dailyWinners=['missing']]){const f=fixture(),s=f.state();mutate(s);f.putState(s);const raw=f.disk()[base+'miniGameState.json'];assert(f.run('/금고').error);assert.equal(f.disk()[base+'miniGameState.json'],raw);}
});
test('DEV changes only DEV vault and member, including winner and daily reset',()=>{
 const f=fixture(),prod={...f.disk()};f.seed(true);const p=f.disk()[base+'miniGameState.json'],member=f.disk()[base+'member.json'];ok(f.run('/금고','a',true));f.clock(f.now()+1);ok(f.run('/금고 '+f.state(true).vault.current.answer,'a',true));f.dailyReset(true);assert.equal(f.disk()[base+'miniGameState.json'],p);assert.equal(f.disk()[base+'member.json'],member);assert.equal(f.state(true).vault.current.prize,200000000);
});
test('missing legacy reset marker uses the saved round date rather than silently rolling forward with the clock',()=>{
 const f=fixture();legacy(f);const s=f.state();delete s.dailyReset;f.putState(s);f.clock(f.now()+3*86400000);ok(f.run('/금고'));assert.equal(f.state().dailyReset.day,s.vault.current.day);assert.equal(f.state().vault.current.day,s.vault.current.day);assert.equal(f.state().vault.current.usage['$'+f.id()],2);ok(next(f,'/금고 100','b'));assert.equal(f.state().vault.current.usage['$'+f.id('b')],1);
});
console.log('PASS vault balance '+groups+' groups');
