// 실제 금고 진입·저장·재시작과 신규 스킬의 정상·예외를 합성 파일로 검증한다.
const assert=require('assert'),vm=require('vm'),h=require('./test_mini_games');
let groups=0;
function test(name,fn){fn();console.log('PASS VAULT RESET/SKILLS '+(++groups)+' '+name);}
function ok(r){assert(!r.error,r.error);return r.text;}
function next(f,msg,user='a',dev=false){f.clock(f.now()+1);return f.run(msg,user,dev);}
function fixture(dev=false){const f=h.fixture();f.seed(dev);ok(f.run('/금고','a',dev));return f;}
function equip(f,user,names,dev=false){const base=dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/';f.disk()[base+'skills.json']=JSON.stringify({[user]:{petSkills:{equipped:names,bag:{'경제사범':7},lockedPremium:['경제사범']}}});}
test('normal/hoi/premium plus 0/2/4, duplicates and new-skill pair never stack (PROD/DEV)',()=>{
 for(const dev of [false,true])for(const user of ['a','b','c'])for(const names of [[],['금고털이범📙'],['경제사범'],['경제사범','경제사범'],['금고털이범','경제사범']]){
  const f=fixture(dev),bonus=names.includes('경제사범')?4:names.length?2:0,limit=(user==='a'?5:3)+bonus;
  equip(f,user,names,dev);assert(ok(f.run('/금고',user,dev)).includes(limit+'/'+limit+'회'));
  for(let i=0;i<limit;i++)ok(next(f,'/금고 100',user,dev));
  assert.equal(f.state(dev).vault.current.usage['$'+f.id(user,dev)],limit);
  assert(ok(next(f,'/금고 '+f.state(dev).vault.current.answer,user,dev)).includes('기회를 모두'));
  assert.equal(f.state(dev).vault.dailyWinners.length,0);
  const loads=f.traces().filter(t=>t.type==='load'&&t.path.endsWith('skills.json'));assert.equal(loads.length,1);
 }
});
test('detach, exchange, premium downgrade and restart preserve used count; locked/bag give no bonus',()=>{
 const f=fixture();equip(f,'a',['경제사범']);for(let i=0;i<8;i++)ok(next(f,'/금고 100'));
 for(const names of [[],['금고털이범'],['경제사범']]){equip(f,'a',names);const text=ok(f.run('/금고'));assert(text.includes(names.includes('경제사범')?'1/9회':'0/'));assert.equal(f.state().vault.current.usage['$'+f.id()],8);}
 const d=f.read();d.member.a.pass='';f.write(d);assert(ok(f.run('/금고')).includes('0/7회'));
 const restarted=h.fixture();restarted.seed();Object.assign(restarted.disk(),f.disk());restarted.clock(f.now()+1);assert(ok(restarted.run('/금고')).includes('0/7회'));assert.equal(restarted.state().vault.current.usage['$'+f.id()],8);
});
test('full reset clears all users, winner UI and hints, persists restart, retains paid proof and other games',()=>{
 for(const dev of [false,true]){
  const f=fixture(dev);ok(f.run('/밸런스 1 보존','a',dev));equip(f,'a',['경제사범'],dev);
  for(const user of ['a','b','c'])ok(next(f,'/금고 100',user,dev));
  ok(next(f,'/금고 '+f.state(dev).vault.current.answer,'b',dev));const before=f.state(dev),member=f.read(dev),oldId=before.vault.current.id;
  ok(next(f,'/금고리셋','master',dev));const after=f.state(dev);
  assert.deepEqual(after.vault.current.usage,{});assert.deepEqual(after.vault.current.hints,[]);assert.deepEqual(after.vault.dailyWinners,[]);assert.deepEqual(after.vault.replyPending,{});assert.notEqual(after.vault.current.id,oldId);
  assert.deepEqual(after.vault.awards,before.vault.awards);assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.balance,before.balance);assert.deepEqual(after.dice,before.dice);assert.deepEqual(f.read(dev),member);
  assert(ok(f.run('/금고','a',dev)).includes('오늘의 금고: 0/15'));assert(ok(f.run('/금고','a',dev)).includes('9/9회'));
  const restarted=h.fixture();restarted.seed();Object.assign(restarted.disk(),f.disk());restarted.clock(f.now()+1);assert(ok(restarted.run('/금고','a',dev)).includes('0/15'));assert.deepEqual(restarted.state(dev).vault.current.usage,{});
  ok(next(restarted,'/금고 '+restarted.state(dev).vault.current.answer,'b',dev));assert.equal(restarted.read(dev).member.b.point,member.member.b.point+200000000);
 }
});
test('reset permissions, suffixes, stale requests and pending payout cannot clear data',()=>{
 const f=fixture();ok(next(f,'/금고 100','c'));const snapshot=JSON.stringify(f.state().vault);
 for(const [msg,user] of [['/금고리셋','a'],['/금고리셋','admin'],['/금고리셋 해봐','master'],['/금고리셋\n','master']]){ok(next(f,msg,user));assert.equal(JSON.stringify(f.state().vault),snapshot);}
 const at=f.now();ok(next(f,'/금고리셋','master'));const after=JSON.stringify(f.state().vault);ok(f.run('/금고 100','c',false,'test',at));assert.equal(JSON.stringify(f.state().vault),after);
 const d=f.read();d.member.a.point=9007199254740991;f.write(d);ok(next(f,'/금고 '+f.state().vault.current.answer));const unpaid=JSON.stringify(f.state().vault);assert(ok(next(f,'/금고리셋','master')).includes('복구 대기'));assert.equal(JSON.stringify(f.state().vault),unpaid);
});
test('reset journal/state/archive interruption recovers a consistent complete reset without altering points',()=>{
 for(const file of ['miniGamePending.json','miniGameState.json','miniGameArchive_2026-10.json']){
  const f=fixture();ok(next(f,'/금고 100','c'));const member=JSON.stringify(f.read());let interrupted=false;
  f.crashAfter((path,v)=>{if(!interrupted&&path.endsWith('/'+file)){interrupted=true;return true;}return false;});assert(next(f,'/금고리셋','master').error,file);assert(interrupted);
  ok(f.run('/금고'));const state=f.state().vault;assert.deepEqual(state.current.usage,{});assert.deepEqual(state.dailyWinners,[]);assert.deepEqual(state.current.hints,[]);assert.equal(JSON.stringify(f.read()),member);
 }
});
test('missing/invalid skills or failed initial journal write do not mutate vault/member',()=>{
 for(const broken of [undefined,'{']){const f=fixture(),p='/sdcard/호이랜드/skills.json',before=JSON.stringify(f.state()),member=JSON.stringify(f.read());if(broken===undefined)delete f.disk()[p];else f.disk()[p]=broken;assert(f.run('/금고').error);assert.equal(JSON.stringify(f.state()),before);assert.equal(JSON.stringify(f.read()),member);assert.equal(f.disk()[p],broken);}
 const f=fixture();ok(next(f,'/금고 100'));const before=JSON.stringify(f.state());f.fail((_d,p)=>p.endsWith('miniGamePending.json'));assert(next(f,'/금고리셋','master').error);assert.equal(JSON.stringify(f.state()),before);
});
test('individual attempt reset includes equipped bonus; usage 9 valid after detach, 10 remains corrupt',()=>{
 const f=fixture();equip(f,'a',['경제사범']);ok(next(f,'/금고 100'));assert(ok(next(f,'/금고횟수리셋 a','master')).includes('9/9회'));
 const s=f.state();s.vault.current.usage['$'+f.id()]=9;f.putState(s);equip(f,'a',[]);assert(ok(f.run('/금고')).includes('0/5회'));
 s.vault.current.usage['$'+f.id()]=10;f.putState(s);const before=JSON.stringify(f.state());assert(f.run('/금고').error);assert.equal(JSON.stringify(f.state()),before);
});
test('existing ten-vault completion resumes at eleven and preserves original payouts',()=>{
 const f=fixture(),s=f.state(),v=s.vault;for(let n=1;n<=10;n++){const r=f.c.applyVaultRobberyGuess(v,'winner'+n,'name'+n,v.current.answer,true,f.now());v.awards[r.awardKey].paid=true;v.awards[r.awardKey].notice='SENT';if(n<10)f.c.openNextVaultRobberyRound(v,f.now());}f.putState(s);const awards=JSON.stringify(v.awards);ok(f.run('/금고'));assert.equal(f.state().vault.current.number,11);assert.equal(f.state().vault.dailyWinners.length,10);assert.equal(f.state().vault.awards[v.current.id].nextOpened,true);assert.equal(f.c.getVaultRobberyPaidTotal(f.state().vault),5600000000);assert(awards.includes('"paid":true'));
});
test('skill catalogue grades, rates, info and actual equip confirmation match planning',()=>{
 const x=require('./test_pet_skill_lookup'),c=vm.createContext({});vm.runInContext(x.runtime(h.main,false),c);
 for(const n of ['getOpenablePetSkillCountByGrade','getPetSkillFixedActualRateTotal','getPetSkillRandomWeight','getPetSkillTotalRate','getPetSkillActualRate'])vm.runInContext(h.block(h.main,'function '+n+'('),c);
 vm.runInContext(h.main.match(/const PET_SKILL_FIXED_ACTUAL_RATES = (\{[\s\S]*?\n\});/)[0].replace('const ','var '),c);
 assert.equal(c.getPetSkillData('경제사범📙').grade,'한정판');assert.equal(c.getPetSkillActualRate(c.getPetSkillData('경제사범')),0);assert.equal(c.getPetSkillData('금고털이범').grade,'A');assert(Math.abs(c.getPetSkillActualRate(c.getPetSkillData('금고털이범'))-.4)<1e-9);assert(Math.abs(c.getPetSkillTotalRate()-100)<1e-9);
 for(const name of ['금고털이범','경제사범']){const f=x.commandFixture(h.main);f.reset();const skills=f.read(f.files.skills);skills[f.user].petSkills.bag[name]=1;f.seed(f.files.skills,skills);const index=f.c.getPetSkillBagList(f.c.loadJsonFile(f.files.skills),f.user).indexOf(name)+1;f.run('/펫스킬장착 '+index);assert(f.read(f.files.skills)[f.user].petSkills.equipped.includes(name));assert.equal(f.snapshot().replies.at(-1),h.fixture().c.GLOBAL_CONFIG.vaultRobbery.equipMessages[name]);assert(c.getPetSkillData(name).effect.includes('🔐'));}
});
console.log('PASS vault reset/skills '+groups+' groups (synthetic only)');
