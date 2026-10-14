const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
const info=fs.readFileSync(path.join(__dirname,'..','Info.js'),'utf8');
const base=fs.readFileSync(path.join(__dirname,'test_doll_content.js'),'utf8');
const {c,fixture,block,input,draw,install,run,cat,root,devRoot}=new Function('require','__dirname',base+'\nreturn {c,fixture,block,input,draw,install,run,cat,root,devRoot};')(require,__dirname);
for(const name of ['addItem','getSupportPassConfigs','ensureSupportPassStore','getSupportPassDateValue','isValidSupportPassDateText','isSupportPassActive','getActiveSupportPassUsers','grantSupportPassDailyRewards','grantDollPassDailyRewards'])vm.runInContext(block(main,'function '+name+'('),c);
let day=20261014;c.getTodaySupportPassDateValue=()=>day;
const ticket=c.GLOBAL_CONFIG.doll.ticketName,up=p=>'인형뽑기확률UP🧸('+p+'%)';
let groups=0;function test(name,fn){fixture.reset();day=20261014;fn();console.log('PASS UP '+(++groups)+': '+name);}
function stocked(dev=false){install(dev);const d=fixture.read(dev);d.member.u.bag[up(20)]=3;fixture.write(d,dev);return d;}
test('5종의 우선순위·한 종류 1개·성공과 실패 소모',()=>{
 for(const percent of [50,40,30,20,10])for(const success of [true,false]){
  const x=input();for(const p of [50,40,30,20,10])if(p<=percent)x.d.member.u.bag[up(p)]=3;
  const r=draw(x,[success?0:0.999,0,0,0,0]);assert.strictEqual(r.success,success);assert.strictEqual(r.probability,15+percent);
  assert.strictEqual(r.probabilityUpName,up(percent));assert.strictEqual(r.remainingProbabilityUp,2);
  for(const p of [50,40,30,20,10])if(p<=percent)assert.strictEqual(x.d.member.u.bag[up(p)],p===percent?2:3);
  assert.strictEqual(x.d.member.u.bag[ticket],undefined);
  const ui=c.buildDollDrawMessage(x.d,x.p,{},cat,'u',r);
  assert(ui.includes('└ 기존 15% + 아이템 '+percent+'%'));assert(ui.includes('📈 '+up(percent)+'\n└ 1개 사용 · 잔여 2개'));
  assert(ui.indexOf('아이템 '+percent+'%')<ui.indexOf('━━━━━━━━━━━━'));assert(ui.indexOf('📈 '+up(percent))<ui.indexOf('📖 상세·명령어'));
 }
});
test('확률 직전/정확한 경계·100% 상한·0개 건너뛰기',()=>{
 for(const [roll,success] of [[0.349999,true],[0.35,false]]){const x=input();x.d.member.u.bag[up(20)]=1;assert.strictEqual(draw(x,[roll,0,0,0,0]).success,success);assert.strictEqual(x.d.member.u.bag[up(20)],undefined);}
 const x=input();x.d.member.u.rank.tier='호월신';x.d.member.u.bag[up(50)]=1;const r=draw(x,[0.999999,0,0,0,0]);assert(r.success);assert.strictEqual(r.probability,100);
 const y=input();y.d.member.u.bag[up(50)]=0;y.d.member.u.bag[up(10)]=1;assert.strictEqual(draw(y).probability,25);
});
test('UP 없음 UI·기존 확률/등급/크기/경험치/판매/매력 유지',()=>{
 for(const values of [[0,0.85,0.2,0.99,0.6],[0.999]]){
  const x=input(),y=input();y.d.member.u.bag[up(20)]=3;const a=draw(x,values),b=draw(y,values);
  assert.strictEqual(a.success,b.success);
  for(const field of ['doll','length','size','experience','sale','charm','record'])assert.strictEqual(JSON.stringify(a[field]),JSON.stringify(b[field]));
  assert(!c.buildDollDrawMessage(x.d,x.p,{},cat,'u',a).includes('확률UP'));
 }
});
test('이용권 부족·손상 UP·정수 범위 초과는 RNG/소모/기록 변경 없음',()=>{
 const x=input(0);x.d.member.u.bag[up(50)]=3;let before=JSON.stringify(x);assert(!draw(x,[]).ok);assert.strictEqual(JSON.stringify(x),before);
 for(const bad of [-1,0.5,'3',null,9007199254740992]){
  const y=input();y.d.member.u.bag[up(50)]=3;y.d.member.u.bag[up(10)]=bad;before=JSON.stringify(y);
  assert.throws(()=>draw(y,[]),/확률UP 수량/);assert.strictEqual(JSON.stringify(y),before);
 }
});
test('실제 성공/실패 저장·전송 실패는 재소모 없음·DEV 운영 격리',()=>{
 const random=c.Math.random;
 try{for(const roll of [0,0.999]){stocked();c.Math.random=()=>roll;const out=run();assert(out.includes(up(20)));assert.strictEqual(fixture.read().member.u.bag[up(20)],2);run();assert.strictEqual(fixture.read().member.u.bag[up(20)],2);}
  stocked();fixture.replyFail(true);c.Math.random=()=>0;run();fixture.replyFail(false);assert.strictEqual(fixture.read().member.u.bag[up(20)],2);
  stocked();stocked(true);const prod=fixture.raw(root+'member.json');run('/인형뽑기',true);assert.strictEqual(fixture.raw(root+'member.json'),prod);assert.strictEqual(fixture.read(true).member.u.bag[up(20)],2);
 }finally{c.Math.random=random;fixture.replyFail(false);}
});
test('모든 저장 단계 실패·복구 후 재시도는 두 아이템 각 1개만 사용',()=>{
 const random=c.Math.random;c.Math.random=()=>0;
 try{for(const name of ['dollRecords_'+c.getDollShard('u')+'.json','dollIndex.json','member_pet.json','member.json']){
  const before=stocked();fixture.failPath(root+name);assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);
  fixture.failPath('none');run('/인형도감');assert.deepStrictEqual(fixture.read(),before);run();assert.strictEqual(fixture.read().member.u.bag[up(20)],2);assert.strictEqual(fixture.read().member.u.bag[ticket],undefined);
 }
 stocked();const before=fixture.read();fixture.failNth(root+'dollPending.json',2);assert.throws(()=>run());assert.deepStrictEqual(fixture.read(),before);fixture.failPath('none');run('/인형도감');assert.deepStrictEqual(fixture.read(),before);
 }finally{fixture.failPath('none');c.Math.random=random;}
});
test('대전 3종·잘못된 접미 차단과 강제 중단 후 두 아이템 복구',()=>{
 for(const active of ['musou','raid','territory']){
  stocked();const before=fixture.read(),ctx=c.createCommandContext(false,'test'),prev=c.enterCommandContext(ctx),locked=c.isServerRaidLocked;
  c.beginDataSaveTransaction();try{c.ctx=ctx;c.msg='/인형뽑기';c.sender='u';c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.guildData={};c.petMusou={active:active==='musou'};c.territoryLocked=active==='territory';c.isServerRaidLocked=()=>active==='raid';fixture.clear();c.runDollBranch();assert(fixture.replies().join('').includes('진행 중'));assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==='save'));}
  finally{c.isServerRaidLocked=locked;c.petMusou={active:false};c.territoryLocked=false;c.endDataSaveTransaction();c.exitCommandContext(prev);}
 }
 for(const command of ['/인형뽑기 1','/인형뽑기 해봐']){stocked();const before=fixture.read();run(command);assert.deepStrictEqual(fixture.read(),before);assert(!fixture.traces().some(t=>t.type==='save'));}
 stocked();const before=fixture.read(),names=['member.json','member_pet.json','dollIndex.json','dollRecords_'+c.getDollShard('u')+'.json'];
 const snapshots=names.map(name=>({name,text:fixture.raw(root+name)}));fixture.put(root+'dollPending.json',{pending:snapshots});
 const changed=fixture.read();delete changed.member.u.bag[ticket];changed.member.u.bag[up(20)]=2;fixture.write(changed);run('/인형도감');assert.deepStrictEqual(fixture.read(),before);assert.strictEqual(fixture.get(root+'dollPending.json').pending,null);
});
test('패스 두 보상·동일일/기존 지급 기록 재지급 없음·다음날/만료',()=>{
 const d={member:{u:{pass:{doll:{enabled:true,permanent:true}},bag:{}},old:{pass:{doll:{enabled:true,permanent:true,dailyRewardLastDate:'20261014'}},bag:{[ticket]:3}}}};
 assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,1);assert.strictEqual(d.member.u.bag[ticket],3);assert.strictEqual(d.member.u.bag[up(20)],3);assert.strictEqual(d.member.old.bag[up(20)],undefined);
 assert.strictEqual(c.grantDollPassDailyRewards(d).grantedUserCount,0);day=20261015;c.grantDollPassDailyRewards(d);assert.strictEqual(d.member.u.bag[up(20)],6);assert.strictEqual(d.member.old.bag[up(20)],3);
 const expired={member:{u:{pass:{doll:{enabled:true,endDate:'26.10.14'}},bag:{}}}};assert.strictEqual(c.grantDollPassDailyRewards(expired).grantedUserCount,0);
});
test('패스 다중 계정 사전 검사·UP 손상/넘침 시 전체 무변경',()=>{
 for(const bad of [-1,0.5,'3',null,9007199254740989]){
  const d={member:{good:{pass:{doll:{enabled:true,permanent:true}},bag:{}},bad:{pass:{doll:{enabled:true,permanent:true}},bag:{[up(20)]:bad}}}};
  const before=JSON.stringify(d);assert.throws(()=>c.grantDollPassDailyRewards(d),/확률UP 수량/);assert.strictEqual(JSON.stringify(d),before);
 }
});
test('MAIN/Info 가방 5종은 이름·수량만 표시·설명 없음·정렬/번호 불변',()=>{
 c.normalizeItemName=x=>x;const items={};for(const p of [10,20,30,40,50])items[up(p)]=3;
 let expected;for(const src of [main,info]){vm.runInContext(block(src,'function generateBagOutput('),c);const bag=c.generateBagOutput(items);
  for(const p of [10,20,30,40,50])assert(bag.bagOutput.split('\n').some(line=>line.endsWith(up(p)+' x 3')));
  assert(!bag.bagOutput.includes('└'));assert(!bag.bagOutput.includes('성공률'));assert(!bag.bagOutput.includes('소모'));assert.strictEqual(bag.bagOutput.split('\n').filter(line=>/^\s*\d+\./.test(line)).length,5);
  if(expected)assert.strictEqual(bag.bagOutput,expected);expected=bag.bagOutput;assert.strictEqual(bag.sortedItemList.length,5);
 }
 const guide=c.buildDollGuideMessage();for(const text of ['최대 100%','50% → 40% → 30% → 20% → 10%','일일퀘스트 완료: 이용권 1개','인형뽑기확률UP🧸(20%) 3개','등급·크기 추첨과 보상은 기존 규칙'])assert(guide.includes(text));
 assert(guide.indexOf('📈 인형뽑기확률UP')>guide.indexOf('🎯 성공률'));assert(guide.indexOf('📈 인형뽑기확률UP')<guide.indexOf('🎲 뽑기 성공 후 등급 확률'));
});
console.log('Doll probability UP '+groups+' groups passed');
