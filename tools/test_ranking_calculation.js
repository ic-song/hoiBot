// 운영 기준과 순위·동점·입장 판정 및 실제 정보 출력이 동일한지 합성 데이터로 대조한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const io=require('./test_command_data_loading'),root=io.root,baselineRef='0c5f64f0d6f33bda59cb3eaa5c652c7b407179af';
const read=n=>fs.readFileSync(path.join(root,n),'utf8').replace(/\r\n/g,'\n');
const main=read('main.js'),info=read('Info.js');
const old=n=>cp.execFileSync('git',['show',baselineRef+':'+n],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
const oldMain=old('main.js'),oldInfo=old('Info.js'),block=io.block;
const core=`
function check(v,s){if(!v)throw Error(s);}function equal(a,b,s){check(JSON.stringify(a)===JSON.stringify(b),s);}
var calls=0,sorts=0,scores={},failUser=null;
var originalSort=Array.prototype.sort;Array.prototype.sort=function(fn){sorts++;return originalSort.call(this,fn);};
function calculateCastleExp(u){calls++;if(u===failUser)throw Error('synthetic charm error');return scores[u];}
function calculateRaidExp(){calls++;return 0;}function calculatePetUpgradeCharm(){calls++;return 0;}
function calculateTotalExp(u){calls++;if(u===failUser)throw Error('synthetic charm error');return scores[u];}
${block(oldInfo,'function getMemberRank(').replace('function getMemberRank(','function beforeRank(')}
${block(info,'function getMemberRank(')}
${block(oldMain,'function isUserInTotalRankingTop(').replace('function isUserInTotalRankingTop(','function beforeTop(')}
${block(main,'function isUserInTotalRankingTop(')}
function fixture(size,tied){var d={member:{}},p={};scores={};for(var i=0;i<size;i++){var u='u'+i;d.member[u]={};p[u]={};scores[u]=tied?i%7:(i*7919)%size+0.125;}return {d:d,p:p};}
function compare(f,u,limit){var a=beforeRank(u,f.d,f.p,{},{},{}),b=getMemberRank(u,f.d,f.p,{},{},{});check(a===b,'personal rank '+u);check(getMemberRank(u,f.d,f.p,{},{},{},scores[u])===a,'cached raw score '+u);check(beforeTop(f.d,f.p,{},{},u,limit,{})===isUserInTotalRankingTop(f.d,f.p,{},{},u,limit,{}),'top '+u+' / '+limit);}
`;
const scenarios=`
var groups=0;function test(s,fn){fn();groups++;print('PASS '+s);}
test('100/1000/5000명 고유·동점 점수의 첫/중간/마지막 개인 순위·상위20 판정 동등',function(){
 for(var sizeIndex=0;sizeIndex<3;sizeIndex++)for(var tiedIndex=0;tiedIndex<2;tiedIndex++){var size=[100,1000,5000][sizeIndex],f=fixture(size,!!tiedIndex);for(var j=0;j<3;j++)compare(f,'u'+[0,Math.floor(size/2),size-1][j],20);}
});
test('Info 개인 순위의 엔진 정렬 유지 / Main 정상 상위판정은 정렬0',function(){
 var f=fixture(100,false);sorts=0;getMemberRank('u0',f.d,f.p,{},{},{},scores.u0);check(sorts===1,'personal sort preserved');sorts=0;isUserInTotalRankingTop(f.d,f.p,{}, {},'u0',20,{});check(sorts===0,'top no sort');
 f=fixture(100,true);sorts=0;var old=beforeRank('u0',f.d,f.p,{},{},{});sorts=0;check(getMemberRank('u0',f.d,f.p,{},{},{},scores.u0)===old,'engine tie exact');check(sorts===1,'tie fallback');
 for(var k=0;k<4;k++){f=fixture(30,false);scores.u4=[NaN,Infinity,-Infinity,'9'][k];sorts=0;compare(f,'u0',20);check(sorts>=(k===0?3:4),'abnormal sorting fallback');}
});
test('경계19/20/21등·한도0/음수/소수/문자열/NaN/무한·닉네임 동점 순서',function(){
 var f=fixture(35,true),limits=[0,-1,1,19,20,21,20.5,'20',NaN,Infinity,null,undefined];for(var i=0;i<35;i++)for(var l=0;l<limits.length;l++)compare(f,'u'+i,limits[l]);
});
test('미등록·펫없음·빈회원·숫자/한글 이름·열거순서·상속 회원의 기존 포함 차이',function(){
 var f=fixture(0,false);compare(f,'none',20);f=fixture(20,false);delete f.p.u0;compare(f,'u0',20);compare(f,'none',20);
 f={d:{member:{}},p:{}};scores={};var names=['10','2','가 나','가','힣','A','a','😀'];for(var i=0;i<names.length;i++){f.d.member[names[i]]={};f.p[names[i]]={};scores[names[i]]=i%3;}for(var i=0;i<names.length;i++)compare(f,names[i],3);
 var inherited={ancestor:{}};f.d.member=Object.create(inherited);f.d.member.u={};f.p={ancestor:{},u:{}};scores={ancestor:100,u:2};compare(f,'u',20);
 check(!isUserInTotalRankingTop(null,{}, {},{},'u',20,{}),'missing root');
});
test('반올림 전 소수·큰 수·음수·재조회 점수 갱신·추가 파일읽기 없음',function(){
 var f=fixture(5,false);scores={u0:10.9,u1:10.1,u2:9007199254740991,u3:-1.1,u4:1e21};for(var i=0;i<5;i++)compare(f,'u'+i,2);
 var oldRank=getMemberRank('u0',f.d,f.p,{},{},{});scores.u0=1e22;compare(f,'u0',2);check(getMemberRank('u0',f.d,f.p,{},{},{})!==oldRank,'fresh recalculation');
});
test('현재 응답의 대상 점수만 재사용·다른 회원 계산/오류 경로 보존',function(){
 var f=fixture(100,false);calls=0;beforeRank('u0',f.d,f.p,{},{},{});check(calls===300,'old N member stats');calls=0;getMemberRank('u0',f.d,f.p,{},{},{},scores.u0);check(calls===297,'skip own calculation only');
 failUser='u40';var failedBefore=false,failedAfter=false;try{beforeRank('u0',f.d,f.p,{},{},{});}catch(e){failedBefore=true;}try{getMemberRank('u0',f.d,f.p,{},{},{},scores.u0);}catch(e){failedAfter=true;}check(failedBefore&&failedAfter,'other error visible');failUser=null;
});
print('PASS ranking helper groups '+groups);
`;
// 전체 정보 응답에 실제 계산 호출 횟수만 추가 계측한다.
const metrics=`
var rankingMetrics={castle:0,raid:0,upgrade:0,ownCastle:0,ownRaid:0,ownUpgrade:0,rankSorts:0};
var nativeCastle=calculateCastleExp,nativeRaid=calculateRaidExp,nativeUpgrade=calculatePetUpgradeCharm,nativeMemberRank=getMemberRank;
calculateCastleExp=function(u){rankingMetrics.castle++;if(u==='u')rankingMetrics.ownCastle++;return nativeCastle.apply(this,arguments);};
calculateRaidExp=function(u){rankingMetrics.raid++;if(u==='u')rankingMetrics.ownRaid++;return nativeRaid.apply(this,arguments);};
calculatePetUpgradeCharm=function(u){rankingMetrics.upgrade++;if(u==='u')rankingMetrics.ownUpgrade++;return nativeUpgrade.apply(this,arguments);};
getMemberRank=function(){var nativeSort=Array.prototype.sort;Array.prototype.sort=function(fn){rankingMetrics.rankSorts++;return nativeSort.call(this,fn);};try{return nativeMemberRank.apply(this,arguments);}finally{Array.prototype.sort=nativeSort;}};
`;
function fullFixture(size=14,tied=false){const disk=io.seed();for(const base of [io.prod,io.dev]){
 const d=JSON.parse(disk[base+'member.json']),p=JSON.parse(disk[base+'member_pet.json']),home=JSON.parse(disk[base+'petSweetHomeData.json']);
 const template=d.member.u,pet=p.u,h=home.u;d.member={};const pets={},homes={};
 for(let i=0;i<size;i++){const u=i===0?'u':'player'+i;d.member[u]=JSON.parse(JSON.stringify(template));pets[u]=JSON.parse(JSON.stringify(pet));pets[u].petexp=tied?100:100+(i*7919)%size;homes[u]=JSON.parse(JSON.stringify(h));}
 disk[base+'member.json']=JSON.stringify(d);disk[base+'member_pet.json']=JSON.stringify(pets);disk[base+'petSweetHomeData.json']=JSON.stringify(homes);
 }return disk;}
function checks(){
 const c={print:console.log};vm.createContext(c);vm.runInContext(core+scenarios,c);
 let groups=6;
 for(const tied of [false,true])for(const message of ['/펫정보','/ㅎ','ㅁㅁㅁ','/종합순위','ㅈㅈㅈ','/서버순위']){
  const disk=fullFixture(100,tied),a=io.createInfoFixture(oldInfo,disk),b=io.createInfoFixture(info,disk);vm.runInContext(metrics,a.c);vm.runInContext(metrics,b.c);
  const old=a.run(message),now=b.run(message);assert.deepStrictEqual(now,old,message);assert.deepStrictEqual(b.disk,a.disk);assert.equal(now.errors.length,0);
  const x=JSON.parse(vm.runInContext('JSON.stringify(rankingMetrics)',a.c)),y=JSON.parse(vm.runInContext('JSON.stringify(rankingMetrics)',b.c));
  if(['/펫정보','/ㅎ','ㅁㅁㅁ'].includes(message)){assert.equal(x.ownCastle,3);assert.equal(x.ownRaid,3);assert.equal(y.ownCastle,1);assert.equal(y.ownRaid,1);assert.equal(y.ownUpgrade,1);assert.equal(y.rankSorts,1);assert.equal(y.castle,x.castle-2);assert.equal(y.raid,x.raid-2);}
  else assert.deepStrictEqual(y,x,'full ranking already shares rows');
  groups++;console.log('PASS full Info unchanged / per-response metrics '+message+' tied='+tied);
 }
 for(const state of ['absence','suspension','raid','guild','private','pending']){
  const disk=fullFixture(30,false),d=JSON.parse(disk[io.prod+'member.json']);
  if(state==='absence')d.member.u.today=0;if(state==='suspension')d.accountSuspensions={users:{u:{}}};if(state==='raid')d.serverRaid={current:{state:'ACTIVE'}};
  if(state==='guild')disk[io.prod+'guildData.json']='{"territoryWar":{"active":true}}';if(state==='pending'){disk[io.prod+'dollIndex.json']='{}';disk[io.prod+'dollPending.json']='{"pending":[]}';}disk[io.prod+'member.json']=JSON.stringify(d);
  const a=io.createInfoFixture(oldInfo,disk),b=io.createInfoFixture(info,disk);assert.deepStrictEqual(b.run('/펫정보','u','서버관리자',state!=='private'),a.run('/펫정보','u','서버관리자',state!=='private'));groups++;
 }
 for(const msg of ['dev/펫정보','dev/ㅎ','dev/종합순위','dev/서버순위']){const disk=fullFixture(100,false),a=io.createInfoFixture(oldInfo,disk),b=io.createInfoFixture(info,disk);assert.deepStrictEqual(b.run(msg,'u','팻 테스트방'),a.run(msg,'u','팻 테스트방'));assert.deepStrictEqual(b.disk,a.disk);groups++;}
 const beforeFixture=io.createInfoFixture(oldInfo,fullFixture(100,false)),afterFixture=io.createInfoFixture(info,fullFixture(100,false));
 for(const exp of [1,999999,100.5]){
  for(const f of [beforeFixture,afterFixture]){const p=JSON.parse(f.disk[io.prod+'member_pet.json']);p.u.petexp=exp;p.u.upgrade=exp===1?0:3;f.disk[io.prod+'member_pet.json']=JSON.stringify(p);}
  assert.deepStrictEqual(afterFixture.run('/펫정보'),beforeFixture.run('/펫정보'),'fresh stats '+exp);assert.deepStrictEqual(afterFixture.disk,beforeFixture.disk);
 }
 groups++;
 // 순위 최적화 함수 외 입장권·보상·저장 및 전체 목록 코드는 기준 버전과 동일하다.
 for(const marker of ['function buildNicknameWorldRanks(','function generateRanking(','function calculateTotalExp(','function calculateCastleExp(','function calculateRaidExp('])assert.equal(block(info,marker),block(oldInfo,marker));
 // 후속 저장 최적화는 전용 전후 동등성 시험으로 검증하며 여기서는 순위 변경 범위만 대조한다.
 let rankingScope=main;for(const n of ['getPetSkillData','getPetSkillBagList'])rankingScope=rankingScope.replace(block(main,'function '+n+'('),block(oldMain,'function '+n+'('));
 const normalizedMain=rankingScope.replace(block(main,'function writeVerifiedJsonFile('),block(oldMain,'function writeVerifiedJsonFile(')).replace(block(main,'function isUserInTotalRankingTop('),block(oldMain,'function isUserInTotalRankingTop(')).replace('// 앞선 인원으로 종합순위 입장 제한을 판정하고 비정상 점수는 기존 정렬로 확인하는 함수','// 유저가 종합순위 상위 제한 안에 있는지 확인하는 함수').replace(/^const HoiBotVersion = "[\d.]+";/m,oldMain.match(/^const HoiBotVersion = "[\d.]+";/m)[0]);
 assert.equal(normalizedMain,oldMain);
 const normalizedInfo=info.replace(block(info,'function getMemberRank('),block(oldInfo,'function getMemberRank('))
  .replace('// 현재 응답의 본인 매력만 재사용하고 기존 엔진 정렬 순서를 그대로 보존하는 함수\n','')
  .replace('getMemberRank(sender, data, petData, homeData, petSkillData, guildData, memberRankingTotalExp)','getMemberRank(sender, data, petData, homeData, petSkillData, guildData)')
  .replace('\t\t\tvar memberRankingTotalExp = castleExpNum + raidExpNum + calculatePetUpgradeCharm(sender, data, petData); // 순위 비교에는 반올림 전 기존 합산값 사용\n\t\t\tvar totalExpNum = parseInt(memberRankingTotalExp, 10);\n\t\t\tif (isNaN(totalExpNum)) totalExpNum = 0;','\t\t\tvar totalExpNum = calculateTotalExp(sender, data, petData, homeData, petSkillData, guildData);');
 assert.equal(normalizedInfo,oldInfo);groups++;console.log('PASS ranking calculation '+groups+' groups / actual UI, entry guards, rewards and save bodies unchanged');
}
const benchmark=`
function median(v){v.sort(function(a,b){return a-b;});return v[Math.floor(v.length/2)];}
var reports=[];for(var sizeIndex=0;sizeIndex<3;sizeIndex++)for(var tiedIndex=0;tiedIndex<2;tiedIndex++){
 var size=[100,1000,5000][sizeIndex],f=fixture(size,!!tiedIndex),u='u0';
 for(var kind=0;kind<2;kind++){var oldSamples=[],newSamples=[],a,b;
  for(var i=0;i<36;i++){var start;if(i%2===0){start=nanoMs();var oldResult=kind?beforeTop(f.d,f.p,{},{},u,20,{}):beforeRank(u,f.d,f.p,{},{},{});a=nanoMs()-start;start=nanoMs();var newResult=kind?isUserInTotalRankingTop(f.d,f.p,{},{},u,20,{}):getMemberRank(u,f.d,f.p,{},{},{},scores[u]);b=nanoMs()-start;}
  else{start=nanoMs();var newResult=kind?isUserInTotalRankingTop(f.d,f.p,{},{},u,20,{}):getMemberRank(u,f.d,f.p,{},{},{},scores[u]);b=nanoMs()-start;start=nanoMs();var oldResult=kind?beforeTop(f.d,f.p,{},{},u,20,{}):beforeRank(u,f.d,f.p,{},{},{});a=nanoMs()-start;}
  check(oldResult===newResult,'benchmark same result');if(i>=5){oldSamples.push(a);newSamples.push(b);}}
  sorts=0;calls=0;if(kind)beforeTop(f.d,f.p,{},{},u,20,{});else beforeRank(u,f.d,f.p,{},{},{});var beforeCalls=calls,beforeSorts=sorts;
  sorts=0;calls=0;if(kind)isUserInTotalRankingTop(f.d,f.p,{},{},u,20,{});else getMemberRank(u,f.d,f.p,{},{},{},scores[u]);
  var afterCalls=calls,afterSorts=sorts;
  reports.push({scope:kind?'Main top-limit helper':'Info personal-rank helper (own score provided)',members:size,tied:!!tiedIndex,beforeMedianMs:median(oldSamples),afterMedianMs:median(newSamples),beforeCalculations:beforeCalls,afterCalculations:afterCalls,beforeSorts:beforeSorts,afterSorts:afterSorts});
 }
}
print('BENCHMARK '+JSON.stringify(reports));
`;
if(require.main===module)checks();
module.exports={root,baselineRef,main,info,oldMain,oldInfo,block,core,scenarios,metrics,fullFixture,benchmark,checks};
