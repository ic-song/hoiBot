// 새 2메시지 UI와 구 진행·재시도·잔액 보존을 합성 파일로 검증한다.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process'),h=require('./test_mini_games');
const original=cp.execFileSync('git',['show','8239aade:main.js'],{cwd:h.root,encoding:'utf8',maxBuffer:8e6}).replace(/\r\n/g,'\n');
const base='/sdcard/호이랜드/';let groups=0;
function test(name,fn){fn();console.log('PASS UI '+(++groups)+' '+name);}
function fixture(){const f=h.fixture();f.seed();return f;}
function ok(r){assert(!r.error,r.error);return r.text;}
function game(f){return f.state().dice.users['$'+f.id()].game;}
function next(f,msg='ㅎㅈ',user='a'){f.clock(f.now()+1);return f.run(msg,user);}
// 구버전의 실제 숫자·멘트 생성 함수를 사용해 패치 직전 각 저장 단계만 만든다.
function legacy(f,phase,index,paid=false){
 ok(f.run('/금고'));const c=f.c,state=f.state(),rows=JSON.parse(fs.readFileSync(h.root+'/data/howoriDiceDialogues.json','utf8')).dialogues;
 const advance=c.advanceMiniGameDice;c.advanceMiniGameDice=vm.runInContext('('+h.block(original,'function advanceMiniGameDice(')+')',c);
 const start=vm.runInContext('('+h.block(original,'function startMiniGameDice(')+')',c);
 const g=start(state,f.id(),'legacy',c.getVaultRobberyDay(f.now()),f.now()-2000,'test',rows,2).user.game;
 if(phase!=='USER1')c.advanceMiniGameDice(state,g,rows,f.now()-1000,false);
 if(['USER2','RESULT','DONE'].includes(phase))c.advanceMiniGameDice(state,g,rows,f.now()-900,true);
 if(['RESULT','DONE'].includes(phase))c.advanceMiniGameDice(state,g,rows,f.now(),false);
 c.advanceMiniGameDice=advance;g.outputIndex=index;if(index>=2)g.waitUserAt=f.now()-1000;
 if(paid){const d=f.read();c.payMiniGameRewards(state,d,c.buildServerRaidAccountIndex(d),f.id(),false,f.now());f.write(d);}
 if(phase==='DONE'){g.phase='DONE';state.dice.users['$'+f.id()].finishedAt=f.now();}
 f.putState(state);return JSON.parse(JSON.stringify(g));
}
test('exact shortcut and normal command share classification; ordinary text and suffixes do not execute',()=>{
 const c=fixture().c;for(const s of ['ㅎㅈ',' ㅎㅈ ','\tㅎㅈ\t','/호월주사위'])assert.equal(c.getMiniGameRequest(s).kind,'dice');
 for(const s of ['ㅎㅈ 해봐','ㅎㅈㅎ','문장 ㅎㅈ','/ㅎㅈ'])assert.equal(c.getMiniGameRequest(s),null);
 for(const s of ['ㅎㅈ',' ㅎㅈ ','dev/ㅎㅈ'])assert(c.isExclusiveDataMutationCommandMessage(s),s);
});
test('two inputs yield exactly two complete screens, one count and one reward; no automatic extra rolls/messages',()=>{
 const f=fixture(),p=f.read().member.a.point;const first=ok(f.run('ㅎㅈ'));assert.equal(f.replies().length,1);assert(first.includes('첫 번째 굴림')&&first.includes('👤')&&first.includes('🐹 호월이')&&first.includes('/호월주사위 or ㅎㅈ'));
 assert(first.indexOf('<ALLSEE>')>first.indexOf('📖 게임 안내'));assert(!first.includes(' 지급'));assert.equal(first.split('“').length-1,1);
 const fixed=game(f);assert.equal(fixed.rolls.length,2);f.auto(30000);assert.equal(f.replies().length,0);assert.deepEqual(game(f).rolls,fixed.rolls);
 const final=ok(next(f,'/호월주사위'));assert.equal(f.replies().length,1);assert(final.includes('최종 결과')&&final.includes('합계')&&final.includes('오늘 남은 게임: 1회'));
 assert(!final.includes('프리미엄')&&!final.includes('<ALLSEE>')&&!final.includes('/미니게임'));assert.equal(final.split('“').length-1,1);
 assert.equal(f.state().dice.users['$'+f.id()].used,1);assert.deepEqual(game(f).rolls.slice(0,2),fixed.rolls);assert.equal(f.read().member.a.point,p+f.c.GLOBAL_CONFIG.miniGames.rewards[game(f).result]);
});
test('all three results show the correct amount and preserve fair six-face rolls',()=>{
 for(const [rolls,result,amount] of [[[6,1,6,1],'win',30000000],[[1,6,1,6],'loss',10000000],[[3,3,3,3],'draw',20000000]]){const f=fixture();ok(f.run('/금고'));f.c.pickMiniGameDialogue=(s,rows,category)=>rows.find(x=>x.category===category);let i=0;f.c.Math.random=()=>((rolls[i++]-.5)/6);ok(f.run('/호월주사위'));const before=f.read().member.a.point;const out=ok(next(f));const done=game(f);assert.deepEqual(done.rolls,rolls);assert.equal(done.result,result);assert.equal(f.read().member.a.point,before+amount);assert(out.includes(' 지급'));}
 for(let face=1;face<=6;face++){const f=fixture();ok(f.run('/금고'));f.c.pickMiniGameDialogue=(s,rows,category)=>rows.find(x=>x.category===category);f.c.Math.random=()=>(face-.5)/6;ok(f.run('ㅎㅈ'));ok(next(f));assert.deepEqual(game(f).rolls,[face,face,face,face]);}
});
test('daily 2 games, cross-room/alias count sharing and no extra fee for second input',()=>{
 const f=fixture();for(let i=0;i<2;i++){ok(next(f,i?'ㅎㅈ':'/호월주사위'));ok(next(f,i?'/호월주사위':'ㅎㅈ'));assert.equal(f.state().dice.users['$'+f.id()].used,i+1);}assert(ok(next(f)).includes('모두 사용'));assert.equal(f.state().dice.users['$'+f.id()].used,2);
});
test('expiry and midnight preserve started game; only a new premium game is allowed',()=>{
 const f=fixture();ok(f.run('/호월주사위'));const first=game(f),d=f.read();d.member.a.pass='';f.write(d);f.clock(f.now()+86400000);const final=ok(f.run('ㅎㅈ'));assert(final.includes('오늘 남은 게임: 0회'));assert.equal(game(f).id,first.id);assert.deepEqual(game(f).rolls.slice(0,2),first.rolls);assert(ok(next(f)).includes('전용'));
});
test('every old in-progress stage preserves existing rolls and usage without reissuing completed gifts',()=>{
 for(const [phase,index] of [['USER1',0],['USER1',1],['WAIT_USER2',1],['WAIT_USER2',2],['USER2',2],['USER2',3],['RESULT',3],['RESULT',4]]){
  const f=fixture(),fixed=legacy(f,phase,index);const p=f.read().member.a.point;ok(next(f));assert.equal(f.replies().length,1);assert.equal(game(f).id,fixed.id);assert.deepEqual(game(f).rolls.slice(0,fixed.rolls.length),fixed.rolls);assert.equal(f.state().dice.users['$'+f.id()].used,1);
  if(game(f).phase!=='DONE')ok(next(f));assert.equal(game(f).phase,'DONE');assert.equal(f.read().member.a.point,p+f.c.GLOBAL_CONFIG.miniGames.rewards[game(f).result]);
 }
 const f=fixture(),fixed=legacy(f,'RESULT',4,true),p=f.read().member.a.point;ok(next(f));assert.equal(game(f).id,fixed.id);assert.equal(f.read().member.a.point,p);
});
test('first and final reply failure replay the saved numbers and pay once',()=>{
 const f=fixture();f.replyFail(true);assert(f.run('ㅎㅈ').error);const fixed=game(f);f.replyFail(false);ok(next(f));assert.deepEqual(game(f).rolls,fixed.rolls);
 f.replyFail(true);assert(next(f).error);const done=game(f),p=f.read().member.a.point;f.replyFail(false);ok(next(f));assert.deepEqual(game(f).rolls,done.rolls);assert.equal(f.read().member.a.point,p);assert.equal(f.state().dice.users['$'+f.id()].used,1);
});
test('invalid reward balance shows one pending final screen; repair settles once without a new roll',()=>{
 const f=fixture();ok(f.run('ㅎㅈ'));const d=f.read();d.member.a.point='invalid';f.write(d);const out=ok(next(f));assert.equal(f.replies().length,1);assert(out.includes(' 지급 대기'));assert.equal(game(f).phase,'RESULT');const rolls=game(f).rolls;const fixed=f.read();fixed.member.a.point=0;f.write(fixed);ok(next(f));assert.equal(game(f).phase,'DONE');assert.deepEqual(game(f).rolls,rolls);assert.equal(f.read().member.a.point,f.c.GLOBAL_CONFIG.miniGames.rewards[game(f).result]);
});
test('member/state/journal-clear publication interruption recovers fixed dice result exactly once',()=>{
 for(const stage of ['member.json','miniGameState.json','miniGamePending.json']){const f=fixture();ok(f.run('ㅎㅈ'));const p=f.read().member.a.point;f.crashAfter((path,v)=>path.endsWith('/'+stage)&&(stage==='member.json'?v.member.a.point>p:stage==='miniGameState.json'?Object.values(v.ledger).some(x=>x.status==='PAID'):v.pending===null&&f.read().member.a.point>p));assert(next(f).error);const fixed=game(f);ok(next(f));assert.deepEqual(game(f).rolls,fixed.rolls);assert.equal(f.read().member.a.point,p+f.c.GLOBAL_CONFIG.miniGames.rewards[game(f).result]);}
});
test('vault removes special hint generation and output while preserving old active answer/count/paid records',()=>{
 const f=fixture();ok(f.run('/금고'));let s=f.state();s.vault.current.low=1;s.vault.current.high=601;s.vault.current.answer=500;s.vault.current.usage['$'+f.id()]=1;f.putState(s);const before=JSON.stringify(f.state().vault);const out=ok(f.run('/금고'));assert(!out.includes('특별 힌트')&&!out.includes('비밀번호는 '));assert(out.includes('비밀번호 범위: 1~1,000')&&out.includes('최근 힌트'));assert.equal(JSON.stringify(f.state().vault),before);
 const c=f.c;for(let n=1;n<=1000;n++){c.Math.random=()=>(n-.5)/1000;const r=c.createVaultRobberyRound(20750,500000000);assert.equal(r.answer,n);assert(!('low'in r)&&!('high'in r));}
});
test('vault invalid guesses never use attempts; latest UP/DOWN and midnight continue with 1000억 cap',()=>{
 const f=fixture();ok(f.run('/금고'));const before=JSON.stringify(f.state().vault);for(const s of ['/금고 0','/금고 -1','/금고 1001','/금고 1.5','/금고 a','/금고 1 해봐'])ok(f.run(s));assert.equal(JSON.stringify(f.state().vault),before);
 const state=f.state();state.vault.current.answer=500;state.vault.current.prize=100000000000;f.putState(state);ok(next(f,'/금고 1'));ok(next(f,'/금고 1000'));const out=ok(f.run('/금고'));assert(out.indexOf('1000 → DOWN')<out.indexOf('1 → UP'));f.clock(f.now()+86400000);const beforeReset=JSON.stringify(f.state().vault);ok(f.run('/금고'));assert.equal(JSON.stringify(f.state().vault),beforeReset);f.dailyReset();ok(f.run('/금고'));assert.equal(f.state().vault.current.prize,100000000000);assert.deepEqual(f.state().vault.current.usage,{});assert.equal(f.state().vault.current.hints.length,0);
});
test('DEV UI and shortcut never alter production game/member bytes',()=>{
 const f=fixture();f.seed(true);const prod=f.disk()[base+'member.json'];ok(f.run('ㅎㅈ','a',true));f.clock(f.now()+1);ok(f.run('/호월주사위','a',true));assert.equal(f.disk()[base+'member.json'],prod);assert(!f.disk()[base+'miniGameState.json']);assert.equal(f.state(true).dice.users['$'+f.id('a',true)].used,1);
});
test('actual seven-argument callback normalizes whitespace/DEV shortcut and retains command gates',()=>{
 const source=fs.readFileSync(__dirname+'/test_mini_game_missing_journal.js','utf8');
 const runtime=new Function('require',source.slice(0,source.indexOf("\ntest('normal state"))+'\nreturn {fixture,callback};')(require);
 const f=runtime.fixture();ok(f.run('/금고'));let first=runtime.callback(f,' ㅎㅈ ');assert(!first.error,JSON.stringify(first.error));assert(first.text.includes('첫 번째 굴림'));
 let last=runtime.callback(f,'/호월주사위');assert(!last.error,JSON.stringify(last.error));assert(last.text.includes('최종 결과'));assert.equal(game(f).phase,'DONE');
 const snapshot=JSON.stringify(f.state().dice);for(const s of ['ㅎㅈ 해봐','문장ㅎㅈ','/ㅎㅈ']){runtime.callback(f,s);assert.equal(JSON.stringify(f.state().dice),snapshot);}
 const d=runtime.fixture();d.seed(true);const prod=d.disk()[base+'member.json'];const dev=runtime.callback(d,'dev/ㅎㅈ');assert(!dev.error,JSON.stringify(dev.error));assert(dev.text.includes('첫 번째 굴림'));assert.equal(d.disk()[base+'member.json'],prod);assert(!d.disk()[base+'miniGameState.json']);
});
console.log('PASS minigame UI '+groups+' groups');
