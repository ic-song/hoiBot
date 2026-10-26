const assert = require('assert');
const gm = require('./test_gm_education'), marble = require('./test_guild_marble');
let groups = 0;
// 승인된 네 기획의 결과와 예외를 합성 계정으로 검증한다.
function test(name, check) { check(); console.log('PASS READY ' + (++groups) + ': ' + name); }
// 테스트에서만 한국시간 경계의 논리 시계를 고정한다.
function education(at = '2026-10-25T03:00:00Z') {
    const h = gm.createHarness(); h.seed(); let time = Date.parse(at);
    h.c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } };
    h.clock = at => { time = Date.parse(at); }; return h;
}
// 실제 일곱 인수 콜백의 공통 환경을 준비한다.
function callback(h, msg, user, room) {
    const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } });
    h.c.commandDataFlowLock = { readLock: lock, writeLock: lock }; h.c.autoDailyQuestInternalDepth = 0;
    h.c.isMasterIdentity = u => ['master', 'gm'].includes(u); h.c.errorLogPath = '/synthetic/error.json';
    h.c.FileStream.write = (_p, text) => { throw Error(text); }; h.f.clear();
    h.c.response(room, msg, user, true, h.c.replier, null, 'com.kakao.talk'); return h.f.replies().join('\n');
}
test('교육방의 MASTER만 전체 교육 명령 사용·일반/유사방 거절·다른 운영권한 미확대', () => {
    const h = education(), { c, f } = h;
    for (const msg of ['/교육', '/교육 a', '/교육 11', '/교육 12', '/교육명령어', '/교육실적', '/교육실적 전체 2026-10']) assert(!callback(h, msg, 'master', '교육방').includes('MASTER만'));
    assert(callback(h, '/교육완료 a 1', 'master', '교육방').includes('1/12'));
    assert(h.run('/교육 a', 'gm').includes('1/12'));
    const before = f.files();
    for (const room of ['교육방', '새 교육방', '교육방2']) for (const user of ['a', 'sub']) assert(callback(h, '/교육완료 a 2', user, room).includes('MASTER만'));
    assert(callback(h, '/교육완료 a 2', 'master', '교육방2').includes('MASTER만')); assert.deepEqual(f.files(), before);
    const prev = c.enterCommandContext(c.createCommandContext(false, '교육방')); assert(!c.isMaster('master')); c.exitCommandContext(prev);
});
test('독립 명령어 안내·1월 지난달 자동 변경·12매뉴얼·조회 무저장', () => {
    const h = education('2027-01-01T00:00:00Z'), before = h.f.files(), help = h.run('/교육명령어');
    assert(help.includes('/교육실적 전체 2026-12')); assert(help.includes('/교육실적 GM아이디 2026-12')); assert(help.includes('1~12'));
    assert.equal(help.split('<ALLSEE>').length - 1, 1); assert(!help.includes('[allsee]'));
    const overview=h.run('/교육');assert(!overview.includes('/교육명령어'));assert(overview.includes('11챕터 · 홈뱃지·큐브'));assert(overview.includes('12챕터 · 패키지 상품 확인'));assert.equal(overview.split('<ALLSEE>').length-1,1);
    for(const [index,chapter] of h.c.GLOBAL_CONFIG.gmEducation.chapters.entries())assert(overview.includes((index+1)+'챕터 · '+chapter.title));
    for (const n of [11,12]) { const manual=h.run('/교육 '+n);assert(manual.includes(n+'/12'));assert.equal(manual.split('<ALLSEE>').length-1,1); }
    assert(h.run('/교육 11').includes('실제 큐브 사용은 완료 조건이 아니에요')); assert(h.run('/교육 12').includes('실제 후원·결제·후원 이력 없이'));
    assert(h.run('/교육 12').includes('/패키지가방')); assert(!h.run('/교육 12').includes('/패키지리스트')); assert(!h.run('/교육 12').includes('/호이패스구독'));
    assert.equal(h.run('/교육명령어 방법'),''); assert.deepEqual(h.f.files(), before);
});
test('기존10챕터 수료자는 10/12 유지·11/12만 두 개 지급·기지급/실적 재처리 없음', () => {
    const h=education(), reward=h.c.GLOBAL_CONFIG.gmEducation.rewardItem;
    for(let n=1;n<=10;n++)h.run('/교육완료 a '+n);
    const old=h.f.read();delete old.member.a.gmEducationRewardTimes;delete old.member.a.bag[reward];h.f.write(old);
    const before=h.f.files();assert(h.run('/교육 a').includes('10/12'));assert(!h.run('/교육 a').includes('🎓'));assert.deepEqual(h.f.files(),before);
    assert(h.run('/교육완료 a 12').includes('11챕터를 먼저'));h.run('/교육완료 a 11','gm');assert(h.run('/교육완료 a 12','master').includes('12챕터 · 패키지 상품 확인 완료!'));
    assert.equal(h.f.read().member.a.bag[reward],2);assert.equal(h.store().users['$id-a'].chapters.length,12);assert(h.run('/교육 a').includes('🎓'));
    const done=h.f.files();for(let n=1;n<=12;n++)h.run('/교육완료 a '+n,'gm');assert.deepEqual(h.f.files(),done);
    assert(h.f.read().member.a.gmEducationRewardTimes.slice(0,10).every(v=>v===null));
});
test('한국시간 월 경계·지난달 보존·챕터 수/상세 날짜 일치·미래와 빈 달', () => {
    const h=education('2026-10-31T14:59:59Z');h.run('/교육완료 a 1');h.clock('2026-10-31T15:00:00Z');h.run('/교육완료 a 2','gm');
    const before=h.f.files(),oct=h.run('/교육실적 전체 2026-10'),nov=h.run('/교육실적 전체');
    assert(oct.includes('전체 완료 챕터: 1개')&&oct.includes('1챕터 · 2026.10.31'));assert(!oct.includes('2챕터 ·'));
    assert(nov.includes('전체 완료 챕터: 1개')&&nov.includes('2챕터 · 2026.11.01'));assert(!nov.includes('1챕터 ·'));
    assert(h.run('/교육 a').includes('2/12'));assert(!nov.includes('교육 인원'));assert(!nov.includes('수료 인원'));assert(!nov.includes('원'));
    assert(h.run('/교육실적 전체 2026-12').includes('아직 집계가 시작되지 않은 달'));
    const empty=h.run('/교육실적 전체 2026-09');assert(empty.includes('0개')&&empty.includes('해당 월'));assert(!empty.includes('<ALLSEE>'));assert.deepEqual(h.f.files(),before);
});
test('월 형식·초기화 예약어·공백/숫자 아이디·없는 GM·조회 오류 무저장', () => {
    const h=education();const before=h.f.files();
    for(const input of ['2026-13','2026-1','0000-01','2026/10','전체 2026-10 해봐'])assert(h.run('/교육실적 '+input).includes('연도-월'));
    assert(h.run('/교육실적 초기화').includes('/교육실적 전체 2026-09'));assert(h.run('/교육실적 없는 GM 2026-10').includes('GM 아이디를 확인'));
    assert(h.run('/교육실적 공백 이름 여 2026-10').includes('0개'));assert.deepEqual(h.f.files(),before);
    const data=h.f.read();data.member['2026-10']=JSON.parse(JSON.stringify(data.member.a));data.member['2026-10'].serverRaidAccount.id='date-name';h.f.write(data);
    assert(h.run('/교육실적 @2026-10 2026-10').includes('0개'));assert(h.run('/교육실적 date-name 2026-10').includes('0개'));
});
test('월별 순위 1·1·3 및 본문 최대3명·전체 상세 합계·최근 완료 순', () => {
    const h=education();h.c.Master.push('a','b');
    for(const [chapter,user] of [[1,'master'],[2,'gm'],[3,'master'],[4,'gm'],[5,'a']]){h.clock('2026-10-25T03:0'+chapter+':00Z');h.run('/교육완료 c '+chapter,user);}
    const all=h.run('/교육실적 전체'),own=h.run('/교육실적 master');assert(all.includes('전체 완료 챕터: 5개'));assert(all.includes('3등'));
    assert.equal((all.split('<ALLSEE>')[0].match(/1등/g)||[]).length,2);assert(own.indexOf('3챕터 ·')<own.indexOf('1챕터 ·'));
    assert(!own.includes('2챕터 ·'));assert(own.includes('완료 챕터: 2개'));assert(!all.includes('300원'));
    const other=education();other.c.Master.push('a','b');for(const [n,u]of[[1,'master'],[2,'gm'],[3,'a'],[4,'b']])other.run('/교육완료 c '+n,u);
    const four=other.run('/교육실적 전체').split('<ALLSEE>');assert.equal((four[0].match(/1등/g)||[]).length,3);assert.equal((four[1].match(/1등/g)||[]).length,4);
});
test('요청 후 월을 넘겨 첫 지급하면 완료 확정 월로 집계', () => {
    const h=education('2026-10-31T14:59:59Z'),publish=h.c.writeVerifiedJsonFile;
    h.c.writeVerifiedJsonFile=(...args)=>{publish(...args);if(args[0]===h.paths().pending)h.clock('2026-10-31T15:00:01Z');};
    h.run('/교육완료 a 1');const entry=h.store().users['$id-a'].chapters[0];assert.equal(entry.completedAt,'2026-10-31T15:00:01.000Z');
    assert(h.run('/교육실적 전체 2026-10').includes('0개'));assert(h.run('/교육실적 전체 2026-11').includes('1개'));
});
test('지급 후 완료 저장 중단·다음 달 다른 GM 복구에도 최초 월/GM·보상1회', () => {
    const h=education('2026-10-31T14:59:59Z'),p=h.paths(),reward=h.c.GLOBAL_CONFIG.gmEducation.rewardItem;
    h.f.failPath(p.store);h.run('/교육완료 a 1');const time=h.f.read().member.a.gmEducationRewardTimes[0];h.clock('2026-11-01T01:00:00Z');
    h.run('/교육완료 a 1','gm');const entry=h.store().users['$id-a'].chapters[0];assert.equal(entry.completedAt,time);assert.equal(entry.gmId,'id-master');assert.equal(h.f.read().member.a.bag[reward],1);
    assert(h.run('/교육실적 master 2026-10').includes('1개'));assert(h.run('/교육실적 전체 2026-11').includes('0개'));
});
test('날짜 없는 기존 완료는 원본 보존·월 미분류 인계·잘못된 날짜/영수증은 오류', () => {
    const h=education();h.run('/교육완료 a 1');let data=h.f.read(),store=h.store();delete data.member.a.gmEducationRewardTimes;delete store.users['$id-a'].chapters[0].completedAt;h.f.write(data);h.f.put(h.paths().store,store);
    const before=h.f.files(),text=h.run('/교육실적 전체');assert(text.includes('전체 완료 챕터: 0개'));assert(text.includes('기존 누적·월 미분류 · 1개'));assert(text.includes('1챕터 · 완료 날짜 없음'));assert.deepEqual(h.f.files(),before);
    store.users['$id-a'].chapters[0].completedAt='invalid';h.f.put(h.paths().store,store);const bad=h.f.files();assert.throws(()=>h.run('/교육실적 전체'));assert.deepEqual(h.f.files(),bad);
    const fresh=education();fresh.run('/교육완료 a 1');data=fresh.f.read();data.member.a.gmEducationRewardTimes[0]='2026-01-01T00:00:00Z';fresh.f.write(data);assert.throws(()=>fresh.run('/교육 a'));
});
test('교육방 DEV 완료/실적·12챕터 접미사·잘못된 완료 무저장', () => {
    const h=education(),prod=h.f.files();assert(callback(h,'dev/교육완료 a 1','master','교육방').includes('1/12'));
    for(const path of Object.keys(prod))if(path.startsWith(h.c.DATA_ROOT_PATH))assert.equal(h.f.raw(path),prod[path]);
    assert.equal(h.store(true).users['$id-a'].chapters.length,1);const before=h.f.files();
    for(const msg of ['/교육완료 a 13','/교육완료 a 12 해봐','/교육완료 a 011'])h.run(msg);assert.deepEqual(h.f.files(),before);
});
test('파산225/90/135·반환3곳·생존/다음 순서·2메시지/allsee 일치', () => {
    const h=marble.createHarness();h.seed();h.recruit();h.c.checkRank=(_d,_p,_g,u)=>u;const g=h.game();g.slot=28;g.players[3].position=4;g.players[3].gold=90;g.lands[6]={owner:1,level:2};for(const cell of [1,3,8])g.lands[cell]={owner:3,level:1};h.setGame(g);h.c.Math.random=()=>0.2;
    h.run('ㅁㅂ','d');const [text,board]=h.f.replies(),next=h.game();assert.equal(next.players[1].gold,1110);assert.equal(next.players[3].gold,0);assert(!next.players[3].alive);assert.equal(next.slot,29);
    const ordered=['생존 · 3/4명','💥 파산 · 최종 4등 확정','🎲 【 2 】','🏠 주인','🧾 통행료 정산','통행료 · 225 골드','실제 지급 · 90 골드','부족 금액 · 135 골드','남은 골드 · 0','보유 지역 3곳 → 빈 땅','상금은 경기 종료 후','[3]🟢 [c] 님의 차례','👥 참가자 현황'];
    let position=-1;for(const marker of ordered){const found=text.indexOf(marker);assert(found>position,marker);position=found;}
    assert(!text.includes('새 라운드'));assert(!text.includes('통행료를 내세요'));assert.equal(text.split('<ALLSEE>').length-1,1);assert.equal(board.split('<ALLSEE>').length-1,1);
    for(const cell of [1,3,8])assert.deepEqual(next.lands[cell],{owner:-1,level:0});assert(board.includes('빈 땅'));assert(text.includes('💥 탈락 · 4등'));
});
test('파산 무소유·기회 손실·정확0 생존·라운드 전환·마지막 생존 종료', () => {
    for(const gold of [90,100]){const h=marble.createHarness();h.seed();h.recruit();const g=h.game();g.players[0].position=6;g.players[0].gold=gold;h.setGame(g);let n=0;h.c.Math.random=()=>n++?0.9:0;const text=h.run('ㅁㅂ','a');assert.equal(h.game().players[0].alive,gold===100);if(gold===90)assert(text.includes('반환할 보유 지역이 없습니다.'));else assert(!text.includes('💥 파산'));}
    const h=marble.createHarness();h.seed();h.recruit();let g=h.game();g.slot=3;g.players[3].position=0;g.players[3].gold=1;g.lands[1]={owner:0,level:1};h.setGame(g);h.c.Math.random=()=>0;assert(h.run('ㅁㅂ','d').includes('새 라운드'));
    const last=marble.createHarness();last.seed();last.recruit();g=last.game();for(const i of [2,3]){g.players[i].alive=false;g.players[i].eliminated=i-1;}g.players[0].gold=1;g.lands[1]={owner:1,level:1};last.setGame(g);last.c.Math.random=()=>0;const text=last.run('ㅁㅂ','a');assert.equal(last.store().guilds.$g.current,null);assert(!text.includes('👉 /마블굴리기'));assert(text.includes('지급 완료'));
});
test('ㅁㄱ 구매/건설 동등·공백·중복·타인/단계/잔액 차단·DEV 격리', () => {
    for(const command of ['ㅁㄱ',' ㅁㄱ ','/마블건설']){const h=marble.createHarness();h.seed();h.recruit();const g=h.game();g.action='BUILD';g.players[0].position=3;g.lands[3]={owner:0,level:1};g.move={from:0,to:3,die:3};h.setGame(g);assert(h.run('/마블판').includes('/마블건설 or ㅁㄱ'));h.run(command,'a');assert.equal(h.game().lands[3].level,2);assert.equal(h.game().players[0].gold,800);const before=h.f.files();h.run(command,'a');assert.deepEqual(h.f.files(),before);}
    const h=marble.createHarness();h.seed();h.recruit();const before=h.f.files();for(const command of ['ㅁㄱ 해봐','대화 ㅁㄱ','ㅁㄱ','/마블건설'])h.run(command,'b');assert.deepEqual(h.f.files(),before);
    assert(h.c.isExclusiveDataMutationCommandMessage(' ㅁㄱ '));const prod=h.f.raw(h.c.filePath);callback(h,'dev/ㅁㄱ','a',h.c.testRoom);assert.equal(h.f.raw(h.c.filePath),prod);
});
// 기존 초기화 하네스의 정의 부분만 불러와 중복 시험 실행 없이 재사용한다.
const fs=require('fs'),path=require('path'),Module=require('module'),file=path.resolve(__dirname,'test_reset_menu.js'),source=fs.readFileSync(file,'utf8');
const resetFixture=new Function('require',source.slice(0,source.indexOf("test('권한별"))+'\nreturn fixture;')(Module.createRequire(file));
test('모든 운영 메뉴/구형/직접예외 일반방 무응답·데이터/대기 불변·영지전 상태만 확인', () => {
    const r=resetFixture();r.call('/초기화');const before=r.h.persist(),pending=JSON.stringify(r.c.manualResetSessions),read=r.c.loadJsonFile;let otherReads=0;r.c.loadJsonFile=(...a)=>{if(a[0]!==r.c.guildPath)otherReads++;return read(...a);};
    const inputs=['/초기화','1삭제','2취소',...r.c.GLOBAL_CONFIG.manualReset.entries.filter(e=>!e.personal).map(e=>e.command),...r.c.GLOBAL_CONFIG.manualReset.directOperations.map(e=>e.command),'/계삭진행\ta','/계정잠수삭제 a'];
    for(const room of ['일반방','교육방','서버관리자2','팻테스트방','room90'])for(const user of ['a','admin','master','호이 남'])for(const msg of inputs)assert.equal(r.call(msg,user,room).replies.length,0,msg+'/'+room);
    assert.equal(otherReads,0);assert.deepEqual(r.h.persist(),before);assert.equal(JSON.stringify(r.c.manualResetSessions),pending);
});
test('허용방 권한거절·두 방/사용자/DEV 대기 독립·권한상실 최종 차단', () => {
    const r=resetFixture();r.c.hasActiveHoiPassAccess=()=>false;assert.deepEqual(r.call('/초기화','a').replies,['⛔ 사용 권한이 없습니다.']);assert.deepEqual(r.call('/댓글초기화','a').replies,['⛔ 사용 권한이 없습니다.']);
    r.call('/초기화','admin','test');r.call('/초기화','admin',r.c.room92);const key=room=>r.c.getManualResetSessionKey('admin',room,true,false);assert(r.c.manualResetSessions[key('test')]&&r.c.manualResetSessions[key(r.c.room92)]);
    const other=JSON.stringify(r.c.manualResetSessions[key(r.c.room92)]);r.call('2취소','admin','test');assert.equal(JSON.stringify(r.c.manualResetSessions[key(r.c.room92)]),other);
    r.choose('comments');const before=r.h.persist();r.c.Admins=[];assert.deepEqual(r.call('1삭제').replies,['⛔ 사용 권한이 없습니다.']);assert.deepEqual(r.h.persist(),before);
});
test('개인 전적/개별삭제·정기 자동처리 경로는 운영 방 제한과 분리', () => {
    const r=resetFixture();assert(!r.c.isManualResetInput('/미니펫전적초기화'));assert.equal(r.call('/미니펫전적초기화','a','일반방').result.command,'/미니펫전적초기화');
    for(const msg of ['/피드삭제 1','/댓글삭제 1','/주기리셋','/리셋','/미니펫가방정리 100'])assert(!r.c.isManualResetLegacyCommand(msg));
    r.call('/초기화','admin');assert(!Object.values(r.c.manualResetSessions)[0].choices.includes('miniPetBattle'));
    for(const operation of r.c.GLOBAL_CONFIG.manualReset.directOperations) { assert(r.c.isExclusiveDataMutationCommandMessage(operation.command)); assert(!r.c.isAutoDailyEntryCommandMessage(operation.command)); }
});
test('Info 운영 명령 목록은 Main과 일치하고 전체 경로를 읽기·응답 전에 반환', () => {
    const vm=require('vm'),spirit=require('./test_spirit_retirement'),c={};vm.createContext(c);vm.runInContext(spirit.block(marble.info,'const GLOBAL_CONFIG = {')+';this.config=GLOBAL_CONFIG;',c);
    const h=marble.createHarness(),expected=[...new Set(h.c.GLOBAL_CONFIG.manualReset.entries.filter(e=>!e.personal).map(e=>e.command).concat(h.c.GLOBAL_CONFIG.manualReset.directOperations.map(e=>e.command)))];
    assert.deepEqual(c.config.manualReset.commands,expected);c.GLOBAL_CONFIG=c.config;c.getMessageFilterRequest=()=>null;c.containsMessageFilterWord=()=>{throw Error('must return before filter');};
    const start=marble.info.indexOf('if (getMessageFilterRequest(msg))'),end=marble.info.indexOf('if (ctx.isDev) {',start);
    vm.runInContext('function probe(msg){var ctx={isDev:false};'+marble.info.slice(start,end)+'return true;}',c);
    for(const msg of expected)assert.equal(c.probe(msg),undefined,msg);assert(!expected.includes('/미니펫전적초기화'));
});
console.log('PASS October READY: '+groups+' integration/exception groups; synthetic only');
