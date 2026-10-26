// 실제 진입·저장·저널 복구를 합성 파일로 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),main=fs.readFileSync(path.join(root,'main.js'),'utf8').replace(/\r\n/g,'\n'),{block}=require('./test_pet_skill_preflight');
function fixture(){
 const s=fs.readFileSync(path.join(__dirname,'test_server_raid.js'),'utf8'),prefix=s.slice(0,s.indexOf('\ngroup("'));
 const localRequire=n=>n==='fs'?Object.assign({},fs,{readFileSync(p,...args){return String(p).replace(/\\/g,'/').endsWith('/main.js')?main:fs.readFileSync(p,...args);}}):require(n);
 const f=new Function('require','__dirname',prefix+'\nreturn {c,reset,read,write,tick,disk:()=>disk,traces:()=>traces,replies:()=>replies,now:()=>now,clear:()=>{traces=[];replies=[];},clock:t=>now=t,fail:fn=>failWrite=fn,replyFail:v=>replyFailure=v,noticeFail:v=>failNotice=v,dropTimers:()=>{timers.clear();c.miniGameTimers={};},timers:()=>timers};')(localRequire,__dirname),c=f.c;
 c.Math=vm.runInContext('Math',c);
 for(const n of ['isSafePointValue','roundToTwo','addPoint'])vm.runInContext(block(main,'function '+n+'('),c);
 c.java.io.File.prototype.lastModified=function(){return 1;};c.java.io.File.prototype.length=function(){return String(f.disk()[this.path]||'').length;};
 c.isHoiPassPremiumActive=(d,u)=>d.member[u].pass==='premium';c.isSupportPassActive=(d,u,k)=>k==='hoi'&&d.member[u].pass==='hoi';
 f.seed=(dev=false)=>{f.reset();c.miniGameTimers={};c.miniGameCatalogCaches={};f.clock(Date.parse('2026-10-25T03:00:00Z'));const base=dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/';for(const file of ['balanceQuestions.json','howoriDiceDialogues.json'])f.disk()[base+file]=fs.readFileSync(path.join(root,'data',file),'utf8');const d=f.read(dev);d.member.a.pass='premium';d.member.b.pass='hoi';f.write(d,dev);};
 f.run=(msg,user='a',dev=false,room='test',requestAt)=>{f.clear();const ctx=c.createCommandContext(dev,room),p=c.enterCommandContext(ctx);c.beginDataSaveTransaction();let error;try{c.runMiniGameEntry('recover',{ctx});c.runMiniGameEntry('command',{ctx,data:c.loadJsonFile(c.filePath),sender:user,nickname:'💛'+user,room,replier:c.replier,requestAt:requestAt===undefined?f.now():requestAt,request:c.getMiniGameRequest(msg)});}catch(e){c.rollbackDataSaveTransaction();error=String(e);}finally{c.endDataSaveTransaction();c.exitCommandContext(p);}return {error,text:f.replies().join('\n'),traces:JSON.parse(JSON.stringify(f.traces()))};};
 f.state=(dev=false)=>JSON.parse(f.disk()[(dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/')+'miniGameState.json']);f.putState=(v,dev=false)=>f.disk()[(dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/')+'miniGameState.json']=JSON.stringify(v);f.id=(u='a',dev=false)=>f.read(dev).member[u].serverRaidAccount.id;
 f.auto=(ms=800)=>{f.clear();f.tick(ms,20);return f.traces().filter(t=>t.type==='notice').map(t=>t.text);};
 f.crashAfter=fn=>{const old=c.writeVerifiedJsonFile;c.writeVerifiedJsonFile=function(p,t){old.apply(this,arguments);if(fn(p,JSON.parse(t))){c.writeVerifiedJsonFile=old;throw Error('simulated process stop');}};};
 f.dailyReset=(dev=false)=>{f.clock(f.now()+1);const ctx=c.createCommandContext(dev,'test'),previous=c.enterCommandContext(ctx);c.beginDataSaveTransaction();try{c.runMiniGameEntry('recover',{ctx});const writes=c.runMiniGameEntry('resetPlan',{ctx,data:c.loadJsonFile(c.filePath)});for(const w of writes)c.writeVerifiedJsonFile(c.resolveActiveDataPath(c.DATA_ROOT_PATH+w.name),w.text);return writes;}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(previous);f.clock(f.now()+1);}};
 return f;
}
let groups=0;function test(name,fn){fn();groups++;console.log('PASS '+groups+' '+name);}function ok(o){assert(!o.error,o.error);return o.text;}
function checks(){
 const f=fixture(),c=f.c,cfg=c.GLOBAL_CONFIG;
test('fixed stages replace carry configuration and total exactly 56억',()=>{assert.equal(cfg.vaultRobbery.schemaVersion,3);assert(!cfg.vaultRobbery.rewards);assert.equal(Array.from({length:10},(_,i)=>c.getVaultRobberyStage(i+1).prize).reduce((a,b)=>a+b),5600000000);});
 test('1300 unique questions, 26 categories and all 200 dialogue IDs',()=>{const q=JSON.parse(fs.readFileSync(path.join(root,'data/balanceQuestions.json'))),d=JSON.parse(fs.readFileSync(path.join(root,'data/howoriDiceDialogues.json')));c.requireMiniGameCatalog(q,'questions');c.requireMiniGameCatalog(d,'dialogues');assert.equal(new Set(q.questions.map(x=>x.category)).size,26);for(let i=1;i<=1300;i++)assert(q.questions.some(x=>x.id==='B'+String(i).padStart(4,'0')));q.questions[1].id=q.questions[0].id;assert.throws(()=>c.requireMiniGameCatalog(q,'questions'));});
 test('strict guides, real newline/control rejection, 80 emoji codepoints',()=>{for(const msg of ['/밸런스 1','/밸런스 3 이유','/밸런스 1 이유\n','/밸런스 1 이\u200b유','/밸런스 1 '+'😀'.repeat(81),'/호월주사위 해봐','/금고\n1','/밸런스결과\n'])assert.equal(c.getMiniGameRequest(msg).kind,'invalid',msg);assert.equal(c.getMiniGameRequest('/밸런스 2 '+'😀'.repeat(80)).kind,'vote');assert.equal(c.getMiniGameRequest('/금고정보'),null);});
 test('menu/invalid input no member write, state or random draw',()=>{f.seed();const before=f.disk()['/sdcard/호이랜드/member.json'];ok(f.run('/미니게임'));ok(f.run('/밸런스 1'));assert.equal(f.disk()['/sdcard/호이랜드/member.json'],before);assert(!f.disk()['/sdcard/호이랜드/miniGameState.json']);});
 test('one-time common ID migration; cross-room immutable vote and no member writes',()=>{f.seed();ok(f.run('/밸런스'));const id=f.id(),member=f.disk()['/sdcard/호이랜드/member.json'],out=f.run('/밸런스 1 재미있어서');ok(out);assert(!out.traces.some(t=>t.type==='save'&&t.path.endsWith('/member.json')));ok(f.run('/밸런스 2 바꿀래','a',false,'room8'));const s=f.state();assert.equal(s.balance.current.order.length,1);assert.equal(s.balance.current.votes['$'+id].reason,'재미있어서');const view=ok(f.run('/밸런스'));assert(view.includes('[💛a] 재미있어서'));assert(!view.includes('총 참여')&&!view.includes('표\n'));assert(view.indexOf('<ALLSEE>')>view.indexOf('📖 밸런스 게임 하는 방법'));assert.equal(f.disk()['/sdcard/호이랜드/member.json'],member);});
 test('filter rejection and MASTER only aggregate statistics',()=>{f.seed();ok(f.run('/밸런스'));c.messageFilterCaches.PROD={words:['금지'],text:'["금지"]'};ok(f.run('/밸런스 1 금지'));assert.equal(f.state().balance.current.order.length,0);assert(ok(f.run('/밸런스결과','admin')).includes('MASTER 전용'));assert(ok(f.run('/밸런스결과','master')).includes('총 참여: 0명'));});
 test('all questions cycle before reuse and immediate repeat avoided',()=>{const rows=JSON.parse(fs.readFileSync(path.join(root,'data/balanceQuestions.json'))).questions,pool={used:[],lastId:'',lastCategory:''},seen=new Set();let last;for(let i=0;i<rows.length;i++){const q=c.pickMiniGameCycle(pool,rows,true);assert(!seen.has(q.id));seen.add(q.id);last=q.id;}assert.notEqual(c.pickMiniGameCycle(pool,rows,true).id,last);});
 test('5:1 midnight majority credits 1억 each once; offline pending claims remain',()=>{f.seed();for(const u of ['a','b','c','admin','master'])ok(f.run('/밸런스 1 이유',u));ok(f.run('/밸런스 2 다른 이유','noPass'));const oldDay=f.state().balance.current.day,p=f.read().member.a.point;f.clock(f.now()+86400000);f.dailyReset();ok(f.run('/밸런스'));assert.equal(Object.values(f.state().ledger).filter(r=>r.kind==='balance').length,5);assert.equal(f.read().member.a.point,p+100000000);ok(f.run('/밸런스'));assert.equal(f.read().member.a.point,p+100000000);const stats=ok(f.run('/밸런스결과','master'));assert(stats.includes('보상 대상: 5명')&&stats.includes('지급 완료: 1명'));f.clock(f.now()+5*86400000);f.dailyReset();ok(f.run('/밸런스','b'));assert.equal(f.read().member.b.point,p+100000000);assert(Object.values(f.state().ledger).some(r=>r.day===oldDay&&r.status==='PENDING'));assert(ok(f.run('/밸런스결과','master')).includes('정산'));});
 test('zero, under five, tie, five all same reward policy',()=>{f.seed();ok(f.run('/밸런스'));const template=f.state().balance.current;for(const choices of [[],[1,2,1,2],[1,2,1,2,1,2],[1,1,1,1,1]]){const s=c.createMiniGameState();s.balance.current=JSON.parse(JSON.stringify(template));choices.forEach((choice,i)=>{const key='$u'+i;s.balance.current.order.push(key);s.balance.current.votes[key]={accountId:'u'+i,name:'n',reason:'r',choice,at:f.now()};});assert.equal(c.closeMiniGameBalance(s,f.now()).summary.eligible,choices.length===5?5:0);assert.equal(Object.keys(s.ledger).length,choices.length===5?5:0);}});
 test('long reason lists split folded, no omissions, choice/count hidden',()=>{f.seed();ok(f.run('/밸런스'));const s=f.state(),r=s.balance.current;for(let i=0;i<500;i++){const k='$x'+i;r.order.push(k);r.votes[k]={accountId:'x'+i,name:'name'+i,choice:i%2+1,reason:'이'.repeat(80),at:f.now()};}const original=JSON.stringify(s),msgs=c.buildMiniGameBalanceMessages(s,f.id(),'');assert.equal(JSON.stringify(s),original,'render preserves stored order/votes');assert.deepEqual([...msgs.join('\n').matchAll(/\[name(\d+)\]/g)].map(m=>Number(m[1])),Array.from({length:500},(_,i)=>499-i),'newest reasons stay first across split messages');assert(msgs.length>1);for(const msg of msgs)assert(msg.length<=cfg.miniGames.messageLimit&&msg.includes('<ALLSEE>'));for(let i=0;i<500;i++)assert.equal(msgs.join('\n').split('[name'+i+']').length-1,1);});
test('vault normal/hoi3 premium5 and last-three hints newest first',()=>{f.seed();ok(f.run('/금고'));const s=f.state();s.vault.current.answer=666;f.putState(s);assert(ok(f.run('/금고')).startsWith('[👑호이패스 프리미엄👑]'));for(const u of ['c','b','a']){const limit=u==='a'?5:3;for(let i=0;i<limit;i++)ok(f.run('/금고 '+(100+i),u));assert(ok(f.run('/금고 666',u)).includes('기회를 모두'));}assert.equal(f.state().vault.current.hints.length,3);const view=ok(f.run('/금고'));assert(view.indexOf('🔐104 → UP')<view.indexOf('🔐103 → UP'));const before=JSON.stringify(f.state().vault);ok(f.run('/금고 100 해봐'));assert.equal(JSON.stringify(f.state().vault),before);});
test('one payment per vault, successive fixed rounds share usage and queued inputs stay rejected',()=>{f.seed();ok(f.run('/금고'));const s=f.state(),answer=s.vault.current.answer,p=f.read().member.a.point;ok(f.run('/금고 '+answer));assert.equal(f.read().member.a.point,p+200000000);ok(f.run('/금고 '+answer));ok(f.run('/금고 '+answer,'b',false,'room8'));assert.equal(f.read().member.a.point,p+200000000);assert(!f.state().vault.current.usage['$'+f.id('b')]);assert.equal(f.state().vault.current.number,2);f.clock(f.now()+1);ok(f.run('/금고 '+f.state().vault.current.answer));assert.equal(f.read().member.a.point,p+400000000);assert.equal(f.state().vault.current.number,3);assert.equal(Object.keys(f.state().vault.awards).length,2);});
test('pre-reset input never debits new day and every daily reset starts fixed easy prize',()=>{f.seed();ok(f.run('/금고'));const old=f.now();f.clock(old+86400000);f.dailyReset();assert(ok(f.run('/금고 100','a',false,'test',old)).includes('횟수는 사용하지 않았어요'));assert.equal(f.state().vault.current.prize,200000000);assert.equal(Object.keys(f.state().vault.current.usage).length,0);f.clock(f.now()+1);ok(f.run('/금고 '+f.state().vault.current.answer));f.clock(f.now()+86400000);f.dailyReset();assert.equal(f.state().vault.current.prize,200000000);assert.equal(f.state().vault.current.number,1);});
 test('dice two messages/four immutable rolls/two inputs/one gift/no point loss',()=>{f.seed();const p=f.read().member.a.point;ok(f.run('/호월주사위'));assert.equal(f.replies().length,1);const first=f.state().dice.users['$'+f.id()].game;assert.equal(first.rolls.length,2);f.auto(1000);assert.equal(f.replies().length,0);assert.deepEqual(f.state().dice.users['$'+f.id()].game.rolls,first.rolls);ok(f.run('ㅎㅈ'));assert.equal(f.replies().length,1);const done=f.state().dice.users['$'+f.id()].game;assert.equal(done.phase,'DONE');assert.equal(done.rolls.length,4);assert.equal(done.outputIndex,5);assert.equal(f.read().member.a.point,p+cfg.miniGames.rewards[done.result]);const paid=f.read().member.a.point;ok(f.run('/호월주사위','a',false,'room8',f.now()-1));assert.equal(f.read().member.a.point,paid);assert.equal(f.state().dice.users['$'+f.id()].used,1);});
 test('normal/hoi cannot start; expired premium finishes the same game across midnight',()=>{f.seed();for(const u of ['c','b'])assert(ok(f.run('/호월주사위',u)).includes('전용'));assert(!f.disk()['/sdcard/호이랜드/miniGameState.json']);ok(f.run('/호월주사위'));const first=f.state().dice.users['$'+f.id()].game,d=f.read();d.member.a.pass='';f.write(d);f.clock(f.now()+86400000);ok(f.run('ㅎㅈ'));const done=f.state().dice.users['$'+f.id()].game;assert.equal(done.id,first.id);assert.deepEqual(done.rolls.slice(0,2),first.rolls);assert.equal(done.phase,'DONE');assert(ok(f.run('/호월주사위')).includes('전용'));});
 test('all eight dialogue cycles have full coverage and no immediate wrap repeat',()=>{f.seed();const s=c.createMiniGameState(),rows=JSON.parse(fs.readFileSync(path.join(root,'data/howoriDiceDialogues.json'))).dialogues;for(const [category,count] of Object.entries(cfg.miniGames.dialogueSizes)){const seen=new Set();let last;for(let i=0;i<count;i++){const q=c.pickMiniGameDialogue(s,rows,category);assert(!seen.has(q.id));seen.add(q.id);last=q.id;}assert.notEqual(c.pickMiniGameDialogue(s,rows,category).id,last);}});
 test('restart reuses persisted first roll/quotes and moves room without reset',()=>{f.seed();ok(f.run('/호월주사위'));const first=f.state().dice.users['$'+f.id()].game;f.dropTimers();c.miniGameCatalogCaches={};ok(f.run('/호월주사위','a',false,'room8'));assert.deepEqual(f.state().dice.users['$'+f.id()].game.rolls,first.rolls);c.scheduleMiniGameWork(c.createCommandContext(false,'room8'),1);f.auto(800);assert.equal(f.state().dice.users['$'+f.id()].game.phase,'WAIT_USER2');});
 test('payout crash after member/state/journal publication recovers before later transactions',()=>{for(const stop of ['member.json','miniGameState.json','miniGamePending.json']){f.seed();ok(f.run('/금고'));const s=f.state(),answer=s.vault.current.answer,p=f.read().member.a.point;f.crashAfter((path,v)=>path.endsWith('/'+stop)&&(stop==='member.json'?v.member.a.point===p+200000000:stop==='miniGameState.json'?Object.values(v.ledger).some(r=>r.status==='PAID'):v.pending===null&&f.read().member.a.point===p+200000000));assert(f.run('/금고 '+answer).error,'crash '+stop);ok(f.run('/금고'));assert.equal(f.read().member.a.point,p+200000000);const d=f.read();d.member.b.point+=17;f.write(d);ok(f.run('/금고'));assert.equal(f.read().member.a.point,p+200000000);assert.equal(f.read().member.b.point,d.member.b.point);}});
 test('failed reply replays same accepted guess; uncertain notice never repays',()=>{f.seed();ok(f.run('/금고'));let s=f.state();s.vault.current.answer=666;f.putState(s);const id=s.vault.current.id;f.replyFail(true);assert(f.run('/금고 100').error);f.replyFail(false);ok(f.run('/금고 100'));assert.equal(f.state().vault.current.usage['$'+f.id()],1);f.noticeFail(()=>true);ok(f.run('/금고 666'));s=f.state();assert.equal(s.vault.awards[id].notice,'UNCERTAIN');const p=f.read().member.a.point;ok(f.run('/금고'));assert.equal(f.read().member.a.point,p);});
 test('missing/corrupt installed state and journal never reset progress',()=>{for(const file of ['miniGameState.json','miniGamePending.json'])for(const action of ['delete','corrupt']){f.seed();ok(f.run('/밸런스 1 이유'));const p='/sdcard/호이랜드/'+file;if(action==='delete')delete f.disk()[p];else f.disk()[p]='{';const result=f.run('/밸런스');if(file==='miniGamePending.json'&&action==='delete'){assert(!result.error,result.error);assert.deepEqual(JSON.parse(f.disk()[p]),{version:1,pending:null});}else assert(result.error,file+action);}});
 test('DEV persistence isolated from PROD',()=>{f.seed(true);const prod=f.disk()['/sdcard/호이랜드/member.json'];ok(f.run('/밸런스 2 이유','a',true));ok(f.run('/금고','a',true));assert.equal(f.disk()['/sdcard/호이랜드/member.json'],prod);assert(!f.disk()['/sdcard/호이랜드/miniGameState.json']);assert.equal(f.state(true).balance.current.order.length,1);});
test('Info blocks partial reward publication and propagates corrupt journal errors',()=>{
   const h=require('./test_command_data_loading');
   for(const pending of [[],[{name:'member.json',text:'{}'}]]){
     const i=h.createInfoFixture(h.info);i.disk[h.prod+'miniGamePending.json']=JSON.stringify({version:1,pending});
     const r=i.run('/포인트');assert.equal(r.messages.length,0);assert.equal(r.writes.length,0);assert(!r.reads.includes(h.prod+'member.json'));
   }
   const i=h.createInfoFixture(h.info);i.disk[h.prod+'miniGamePending.json']='{';assert(i.run('/포인트').errors.length);
 });
 test('actual seven-argument callback keeps attendance/private/suspension/war gates',()=>{
   const h=require('./test_guild_marble').createHarness();h.seed();const g=h.c,files=h.f,locks=[];
   const counted=()=>{const l={depth:0,lock(){this.depth++;},tryLock(){this.lock();return true;},unlock(){assert(this.depth>0);this.depth--;}};locks.push(l);return l;};
   g.commandDataFlowLock={readLock:counted,writeLock:counted};g.dataTransactionLock=counted();g.autoDailyQuestInternalDepth=0;g.miniGameTimers={};g.miniGameCatalogCaches={};
   g.java.io.File.prototype.lastModified=function(){return 1;};g.java.io.File.prototype.length=function(){return String(files.raw(this.path)||'').length;};
   for(const file of ['balanceQuestions.json','howoriDiceDialogues.json'])files.put('/sdcard/호이랜드/'+file,JSON.parse(fs.readFileSync(path.join(root,'data',file))));
   g.isHoiPassPremiumActive=()=>true;g.isSupportPassActive=()=>true;g.getCachedMessageFilterWords=()=>[];
   g.recordBlockedPrivateChatAttempt=()=>false;g.getBlockedPrivateChatNoticeKind=()=>'required';
   g.errorLogPath='/synthetic/error.json';g.FileStream.write=(p,t)=>{throw Error('unexpected callback: '+t);};
   const run=(msg,user='a',group=true)=>{files.clear();g.response(group?'table':'private',msg,user,group,g.replier,null,'com.kakao.talk');assert(locks.every(l=>l.depth===0));assert.equal(g.getDataSaveTransaction(),null);return files.replies().join('\n');};
   assert(run('/미니게임').includes('/금고'));assert(run('/밸런스 1 이유').includes('등록됐어요'));
   const before=files.raw('/sdcard/호이랜드/miniGameState.json');
   g.isAccountSuspended=()=>true;assert(run('/밸런스').includes('계정정지'));g.isAccountSuspended=()=>false;
   g.hasActiveHoiPassAccess=()=>false;assert(run('/밸런스','a',false).includes('프리미엄'));
   g.isGuildTerritoryWarCommandLockActive=()=>true;g.isGuildTerritoryBlockedDuringWarCommand=()=>true;assert(run('/금고').includes('영지전 진행'));
   assert.equal(files.raw('/sdcard/호이랜드/miniGameState.json'),before);
 });
 test('pending payout range check keeps fixed winner and prize until balance is corrected',()=>{
   f.seed();ok(f.run('/금고'));const answer=f.state().vault.current.answer,d=f.read();d.member.a.point=9007199254740991;f.write(d);
   assert(ok(f.run('/금고 '+answer)).includes('지급 확인 중'));assert.equal(f.read().member.a.point,9007199254740991);
   assert(!f.state().vault.awards[f.state().vault.current.id].paid);
   const fixed=f.read();fixed.member.a.point=0;f.write(fixed);ok(f.run('/금고'));assert.equal(f.read().member.a.point,200000000);
 });
 test('queued input captured before first screen cannot advance the second pair',()=>{
   f.seed();ok(f.run('/호월주사위'));const queued=f.now();f.auto(800);
   ok(f.run('/호월주사위','a',false,'test',queued));assert.equal(f.state().dice.users['$'+f.id()].game.rolls.length,2);
   f.clock(f.now()+1);ok(f.run('/호월주사위'));assert.equal(f.state().dice.users['$'+f.id()].game.rolls.length,4);
 });
 test('archived records cannot be silently recreated after file loss',()=>{
   f.seed();ok(f.run('/밸런스 1 이유'));f.clock(f.now()+86400000);f.dailyReset();ok(f.run('/밸런스'));
   delete f.disk()['/sdcard/호이랜드/miniGameArchive_2026-10.json'];assert(f.run('/밸런스결과','master').error);
 });
test('wall-clock midnight does not close; explicit daily reset closes once and preserves pending rewards',()=>{
   f.seed();for(const u of ['a','b','c','admin','master'])ok(f.run('/밸런스 1 이유',u));
   const old=f.state().balance.current.day;f.auto(86400000);assert.equal(f.state().balance.current.day,old);assert.equal(Object.keys(f.state().ledger).length,0);
   f.dailyReset();assert.equal(f.state().balance.current.day,old+1);assert.equal(Object.keys(f.state().ledger).length,5);
   c.scheduleMiniGameWork(c.createCommandContext(false,'test'),1);f.auto(1);assert(f.traces().some(t=>t.type==='notice'&&t.text.includes('결과 발표')));
   f.auto(1);assert(!f.traces().some(t=>t.type==='notice'&&t.text.includes('결과 발표')));
 });
 test('failed journal write and failed member publication recover without changing fixed result',()=>{
   for(const name of ['miniGamePending.json','member.json','miniGameState.json']){
     f.seed();ok(f.run('/금고'));const s=f.state(),p=f.read().member.a.point;
     f.fail((d,path)=>path.endsWith('/'+name)&&(name==='miniGameState.json'?Object.values(d.ledger).some(r=>r.status==='PAID'):name==='member.json'?d.member.a.point>p:true));
     assert(f.run('/금고 '+s.vault.current.answer).error);
     ok(f.run('/금고 '+s.vault.current.answer));assert.equal(f.read().member.a.point,p+200000000);
   }
 });
 test('all six die faces and exact win/draw/loss reward formulas',()=>{
   f.seed();ok(f.run('/밸런스'));
   const original=c.Math.random,rows=JSON.parse(fs.readFileSync(path.join(root,'data/howoriDiceDialogues.json'))).dialogues;
   try{for(let face=1;face<=6;face++){const s=c.createMiniGameState();c.Math.random=()=>((face-.5)/6);const result=c.startMiniGameDice(s,'id','name',c.getVaultRobberyDay(f.now()),f.now(),'test',rows,2);assert.equal(result.user.game.rolls[0],face);}
   for(const [rolls,expected,amount] of [[[5,3,4,5],'win',30000000],[[3,4,4,4],'loss',10000000],[[3,4,5,4],'draw',20000000]]){const s=c.createMiniGameState();c.Math.random=()=>0;c.startMiniGameDice(s,'id','name',c.getVaultRobberyDay(f.now()),f.now(),'test',rows,2);const g=s.dice.users.$id.game;g.rolls=[rolls[0],rolls[1],rolls[2]];g.phase='USER2';g.quotes=[{id:'start',text:'s'},{id:'roll',text:'r'},{id:'mid',text:'m'}];c.Math.random=()=>((rolls[3]-.5)/6);c.advanceMiniGameDice(s,g,rows,f.now()+800,false);assert.equal(g.result,expected);assert.equal(s.ledger[g.rewardId].amount,amount);}
   }finally{c.Math.random=original;}
 });
 test('split member storage reward and journal recovery leave raid/log slots and revisions untouched',()=>{
   const h=fixture(),c=h.c;h.seed();
   c.java.io.File.prototype.getName=function(){return this.path.split('/').pop();};c.MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;c.java.lang.String=function(v){this.getBytes=()=>Buffer.from(String(v),'utf8');};
   c.getManagedJsonBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back.json'):null;
   c.getManagedJsonSecondaryBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back2.json'):null;
   vm.runInContext(block(main,'const MEMBER_STORAGE_SPLIT_CONFIG = {')+';this.MEMBER_STORAGE_SPLIT_CONFIG=MEMBER_STORAGE_SPLIT_CONFIG;var memberSplitBackupCache={};',c);
   for(const n of ['getMemberSplitMarker','getMemberSplitStorePath','getMemberSplitBackupPath','requireMemberSplitStore','readMemberSplitStore','readPublishedMemberSplitStore','buildMemberSplitRaidSummary','attachMemberSplitStores','buildMemberSplitSavePlan','stringifyMemberSplitStore','preserveMemberSplitBackupStores','createMemberSplitMigrationStores','isProtectedManagedJsonPath','parseManagedJsonContent','loadJsonFile'])vm.runInContext(block(main,'function '+n+'('),c);
   const d=h.read(),key=c.MEMBER_STORAGE_SPLIT_CONFIG.key;d.serverRaid=JSON.parse(JSON.stringify(c.createServerRaidState('synthetic')));
   for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)d[log]=[{keep:true}];
   const marker={version:c.MEMBER_STORAGE_SPLIT_CONFIG.version,id:'mini-split',phase:'COMPLETE',raidRevision:0,logsRevision:0},slots=c.createMemberSplitMigrationStores(d,marker);
   const raidPath=c.getMemberSplitStorePath('raid',0),logPath=c.getMemberSplitStorePath('logs',0);
   h.disk()[raidPath]=JSON.stringify(slots.raid);h.disk()[logPath]=JSON.stringify(slots.logs);
   const raw=JSON.parse(JSON.stringify(d));for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)delete raw[log];raw.serverRaid=c.buildMemberSplitRaidSummary(d.serverRaid);raw.migrations={[key]:marker};h.write(raw);
   const raid=h.disk()[raidPath],logs=h.disk()[logPath];ok(h.run('/금고'));
   const s=h.state(),p=h.read().member.a.point;h.crashAfter((path,value)=>path.endsWith('/member.json')&&value.member.a.point>p);
   assert(h.run('/금고 '+s.vault.current.answer).error);ok(h.run('/금고'));assert.equal(h.read().member.a.point,p+200000000);
   assert.equal(h.disk()[raidPath],raid);assert.equal(h.disk()[logPath],logs);assert.equal(h.read().migrations[key].raidRevision,0);assert.equal(h.read().migrations[key].logsRevision,0);
 });
test('other member writers are blocked until durable minigame journal recovery',()=>{
   f.seed();ok(f.run('/금고'));const s=f.state(),before=f.read().member.a.point;
   f.crashAfter((p,v)=>p.endsWith('/member.json')&&v.member.a.point>before);
   assert(f.run('/금고 '+s.vault.current.answer).error);
   const pending=f.disk()['/sdcard/호이랜드/miniGamePending.json'],d=f.read();d.member.b.point+=99;
   assert.throws(()=>c.saveJsonFile(d,c.filePath),/복구 대기/);assert.equal(f.disk()['/sdcard/호이랜드/miniGamePending.json'],pending);
   ok(f.run('/금고'));assert.equal(f.read().member.a.point,before+200000000);assert.equal(f.read().member.b.point,1000000000);
 });
 test('automatic minigame worker defers while another feature has an unfinished member journal',()=>{
   f.seed();ok(f.run('/호월주사위'));const game=f.state().dice.users['$'+f.id()].game;
   f.disk()['/sdcard/호이랜드/'+cfg.guildMarble.pendingName]=JSON.stringify({schemaVersion:1,pending:{memberText:'{}',marbleText:null}});
   c.scheduleMiniGameWork(c.createCommandContext(false,'test'),1);f.auto(800);assert.equal(f.state().dice.users['$'+f.id()].game.rolls.length,game.rolls.length);
   assert(f.traces().some(t=>t.type==='log'&&t.text.includes('복구 대기')));
 });
 console.log('PASS mini games '+groups+' integration groups');
}
if(require.main===module)checks();module.exports={root,main,block,fixture,checks};
