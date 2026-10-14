const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8'),info=fs.readFileSync(path.join(__dirname,'..','Info.js'),'utf8');
const base=fs.readFileSync(path.join(__dirname,'test_doll_content.js'),'utf8');
const {c,fixture,block,input,draw,cat,install,run,inRealm}=new Function('require','__dirname',base+'\nreturn {c,fixture,block,input,draw,cat,install,run,inRealm};')(require,__dirname);
for(const name of ['buildDollDrawDebugMessage','getAdventureOnboardingMemberState','getAdventureBlessingItemName','applyAdventureStarterMemberRewards','buildAdventureStarterCompleteMessage','debuggerToggle'])vm.runInContext(block(main,'function '+name+'('),c);
const root='/sdcard/호이랜드/',devRoot='/sdcard/호이랜드_dev/',clone=v=>JSON.parse(JSON.stringify(v)),up=p=>'인형뽑기확률UP🧸('+p+'%)';
let groups=0;function test(name,fn){fixture.reset();c.isDebuggerFlag=false;fn();console.log('PASS OCT16 '+(++groups)+': '+name);}
c.addPoint=(d,u,n)=>{d.member[u].point+=n;};c.addItem=(d,u,n,q)=>{d.member[u].bag[n]=(d.member[u].bag[n]||0)+q;};c.formatDateTime=()=> '2026-10-15 10:00';
c.hasItem=(d,u,n,q)=>(d.member[u].bag[n]||0)>=q;
c.applyAdventureStarterPetSettings=(d,u)=>{d[u].starterBlessingApplied=true;return true;};c.applyAdventureStarterSkill=()=>false;c.applyAdventureStarterHome=()=>false;c.applyAdventureStarterIntimacyReward=()=>false;c.buildAdventureOnboardingResumeMessage=()=> 'resume';
vm.runInContext('function starterBranch(){'+block(main,'if (msg === "/호여!!")')+'}',c);
function seedStarter(dev=false){install(dev);const d=fixture.read(dev);d.member.u.adventureOnboarding={stage:'WAIT_BLESSING',receipts:{}};d.member.u.bag[c.getAdventureBlessingItemName()]=1;fixture.write(d,dev);const base=dev?devRoot:root;fixture.put(base+'member_pet.json',{u:{petname:'synthetic'}});c.homeDataFile=root+'synthetic-home.json';fixture.put(base+'synthetic-home.json',{});}
function starter(dev=false,msg='/호여!!'){const ctx=c.createCommandContext(dev,'test'),prior=c.enterCommandContext(ctx);c.beginDataSaveTransaction();c.msg=msg;c.sender='u';try{c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.petSkillData={};c.adventureOnboarding=c.getAdventureOnboardingMemberState(c.data,'u');c.starterBranch();}catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(prior);}}
test('Starter exact four rewards, existing rewards, receipt and UI agree; repeat pays nothing',()=>{
 seedStarter();const before=fixture.read();starter();const after=fixture.read();
 for(const [n,q] of c.GLOBAL_CONFIG.adventureStarter.dollItems)assert.strictEqual(after.member.u.bag[n],(before.member.u.bag[n]||0)+q);
 assert.strictEqual(after.member.u.point,before.member.u.point+c.GLOBAL_CONFIG.adventureStarter.points);assert.strictEqual(after.member.u.adventureOnboarding.receipts.memberRewards,true);
 const text=fixture.replies().join('\n');assert(text.includes('🧸 인형뽑기 스타터 아이템 추가 지급\n\n인형뽑기이용권🧸(/인형뽑기) 20개\n인형뽑기확률UP🧸(50%) 5개\n인형뽑기확률UP🧸(40%) 5개\n인형뽑기확률UP🧸(30%) 5개'));assert(text.includes('펜던트 강화석📿 3개'));starter();assert.deepStrictEqual(fixture.read(),after);
});
test('Prior recipients, quest recipients and wrong onboarding stage are never granted retroactively',()=>{
 for(const mode of ['paid','quest','complete','wrong']){seedStarter();const d=fixture.read();if(mode==='paid')d.member.u.adventureOnboarding.receipts.memberRewards=true;if(mode==='quest')d.member.u.adventureQuest={receipts:{starterMemberRewards:true}};if(mode==='complete')d.member.u.adventureOnboarding.stage='COMPLETE';if(mode==='wrong')d.member.u.adventureOnboarding.stage='WAIT_REFERRAL';fixture.write(d);const before=clone(d.member.u.bag);starter();const after=fixture.read().member.u.bag;for(const [n] of c.GLOBAL_CONFIG.adventureStarter.dollItems)assert.strictEqual(after[n],before[n]);assert(!fixture.replies().join('\n').includes('인형뽑기 스타터 아이템 추가 지급'));}
});
test('Starter quantity corruption and overflow fail without saving new rewards',()=>{
 for(const bad of [-1,.5,'5',9007199254740991]){seedStarter();const d=fixture.read();d.member.u.bag[up(50)]=bad;fixture.write(d);const before=fixture.read();assert.throws(()=>starter());assert.deepStrictEqual(fixture.read(),before);}
});
test('Starter member/pet save failure rolls back and retry adds each new item once',()=>{
 for(const p of [root+'member.json',root+'member_pet.json']){seedStarter();const before=fixture.read();fixture.failPath(p);assert.throws(()=>starter());assert.deepStrictEqual(fixture.read(),before);fixture.failPath('none');starter();assert.strictEqual(fixture.read().member.u.bag[up(50)],5);assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],21);}
});
test('Starter missing blessing, missing pet and suffix never grant; DEV leaves PROD intact',()=>{
 seedStarter();const d=fixture.read();delete d.member.u.bag[c.getAdventureBlessingItemName()];fixture.write(d);const before=fixture.read();starter();assert.deepStrictEqual(fixture.read(),before);
 seedStarter();fixture.put(root+'member_pet.json',{u:{}});const noPet=fixture.read();starter();assert.deepStrictEqual(fixture.read(),noPet);
 seedStarter();const noSuffix=fixture.read();starter(false,'/호여!! 해봐');assert.deepStrictEqual(fixture.read(),noSuffix);
 seedStarter();seedStarter(true);const prod=fixture.read();starter(true);assert.strictEqual(fixture.read(true).member.u.bag[up(50)],5);assert.deepStrictEqual(fixture.read(),prod);
});
test('Bag full/partial/hidden anchor order is identical in MAIN/Info with continuous numbering',()=>{
 const order=['고급 티어 승급티켓🎫',c.GLOBAL_CONFIG.doll.ticketName,...[50,40,30,20,10].map(up)];c.normalizeItemName=x=>x;
 for(const mode of ['full','partial','anchorZero','empty']){const bag={'티어 승급티켓🎟':2,'일반아이템':4};for(let i=0;i<order.length;i++)if(mode!=='empty'&&(mode!=='partial'||i%2===0))bag[order[i]]=i+1;if(mode==='anchorZero')bag[order[0]]=0;let expected;
  for(const src of [main,info]){vm.runInContext(block(src,'function generateBagOutput('),c);const result=c.generateBagOutput(bag,false),positions=order.filter(n=>bag[n]).map(n=>result.sortedItemList.indexOf(n));for(let i=1;i<positions.length;i++)assert.strictEqual(positions[i],positions[i-1]+1);for(const n of order)assert.strictEqual(result.sortedItemList.filter(v=>v===n).length,bag[n]?1:0);assert(!result.bagOutput.includes('└'));assert.deepStrictEqual(result.bagOutput.split('\n').filter(l=>/^\s*\d+\./.test(l)).map(l=>Number(l.match(/^\s*(\d+)\./)[1])),clone(result.sortedItemList).map((_v,i)=>i+1));if(expected)assert.deepStrictEqual(clone(result.sortedItemList),expected);expected=clone(result.sortedItemList);}
 }
});
test('Debug records same random at exact boundary and cap with actual consumption',()=>{
 for(const [tier,percent,random,success] of [['킹',20,.349999,true],['킹',20,.35,false],['호월신',50,.999999,true],['새싹',0,.05,false]]){const x=input(1);x.d.member.u.rank.tier=tier;if(percent)x.d.member.u.bag[up(percent)]=1;let calls=0;const r=c.applyDollDraw(x.d,x.p,cat,x.s,x.idx,'u','id','2026.10.15',()=>{calls++;return calls===1?random:0;});assert.strictEqual(r.success,success);assert.strictEqual(calls,success?5:1);assert.strictEqual(r.debug.random,random);assert.strictEqual(r.debug.roll,random*100);assert.strictEqual(r.debug.finalProbability,r.probability);assert.strictEqual(r.debug.ticketBefore,1);assert.strictEqual(r.debug.ticketAfter,0);assert.strictEqual(r.debug.upBefore,percent?1:0);assert.strictEqual(r.debug.upAfter,0);const text=c.buildDollDrawDebugMessage(r);assert(text.includes(' < '+r.probability+' = '+success));assert(text.includes('하한 제한 없음'));if(tier==='호월신')assert(text.includes('105% → 100%'));if(!percent)assert(text.includes('확률UP: 없음'));}
});
test('Debug OFF has no debug output; ON uses existing logger target; log failure keeps paid result',()=>{
 const logger=c.debuggerLog,api=c.Api.replyRoom,random=c.Math.random;vm.runInContext(block(main,'function debuggerLog('),c);const logs=[];c.Api.replyRoom=(room,text)=>{logs.push({room,text});return true;};c.Math.random=()=>.999;
 try{install();run();assert(!logs.length);install();c.isDebuggerFlag=true;run();assert.strictEqual(logs.length,1);assert.strictEqual(logs[0].room,c.testRoom);assert(logs[0].text.includes('[인형뽑기 디버그]'));assert(!fixture.replies().join('\n').includes('난수'));
  install();c.Api.replyRoom=()=>{throw Error('no session');};run();assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName],undefined);assert.strictEqual(fixture.get(root+'dollPending.json').pending,null);
 }finally{c.debuggerLog=logger;c.Api.replyRoom=api;c.Math.random=random;c.isDebuggerFlag=false;}
});
test('Debug logs are absent on failed save and RNG is never used on shortage',()=>{
 const logger=c.debuggerLog,random=c.Math.random;const logs=[];c.debuggerLog=t=>logs.push(String(t));c.isDebuggerFlag=true;c.Math.random=()=>.999;
 try{install();fixture.failPath(c.filePath);assert.throws(()=>run());assert(!logs.some(t=>t.startsWith('[인형뽑기 디버그]')));fixture.failPath('none');install();const d=fixture.read();d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName]=0;fixture.write(d);let draws=0;c.Math.random=()=>{draws++;return 0;};run();assert.strictEqual(draws,0);assert(logs.some(t=>t.includes('난수 판정 없음')));}finally{c.debuggerLog=logger;c.Math.random=random;c.isDebuggerFlag=false;}
});
test('Existing debug permission and toggle work without adding a new command or output room',()=>{
 vm.runInContext('function toggleBranch(){'+block(main,'if (msg == "/디버깅모드" &&')+'}',c);c.msg='/디버깅모드';c.sender='u';c.toggleBranch();assert.strictEqual(c.isDebuggerFlag,false);c.sender='호이 남';c.toggleBranch();assert.strictEqual(c.isDebuggerFlag,true);c.toggleBranch();assert.strictEqual(c.isDebuggerFlag,false);
});
console.log('OCT16 READY '+groups+' groups passed');
