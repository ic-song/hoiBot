const assert = require('assert'), fs = require('fs'), path = require('path');
const { createHarness } = require('./test_guild_marble');
const h = createHarness(), { f, c, seed, run, recruit, game, store, setGame } = h;
c.checkRank = (_data,_pet,_guild,user) => user;
let groups = 0;
// 각 개선 요구를 실제 경기·저장 함수와 비식별 계정으로 확인하는 함수
function group(name, test) { seed(); test(); console.log('PASS MARBLE improve ' + (++groups) + ': ' + name); }
const saves = () => f.traces().filter(t => t.type === 'save');
const refund = () => { run('/마블중단','master'); for (const u of ['a','b','c','d']) run('/마블중단확인',u); };
// 실제 레거시 콜백에 필요한 기존 공통 환경만 준비하는 함수
function callback(command, user = 'a', dev = false, room) {
    const lock = () => ({ lock() {}, unlock() {}, tryLock() { return true; } });
    c.commandDataFlowLock = { readLock: lock, writeLock: lock }; c.autoDailyQuestInternalDepth = 0;
    c.isMasterIdentity = u => u === 'gm'; c.errorLogPath = '/synthetic/error.json';
    c.FileStream.write = (_p,t) => { throw Error(t); }; f.clear();
    c.response(room || c.testRoom, dev ? 'dev/' + command.replace(/^\//,'') : command, user, true, c.replier, null, 'com.kakao.talk');
    return f.replies().join('\n');
}
group('기존3회 사용 저장본은 무저장 조회 후 4·5회 가능·6회 무차감·자정 재개', () => {
    run('/마블시작','master'); run('/마블모집취소','master'); const s = store(); s.guilds.$g.usage.count = 3; f.put(c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.guildMarble.fileName,s);
    const before = f.files(); assert(run('/길드마블','sub').includes('3/5회')); assert.deepEqual(f.files(),before);
    for (const count of [4,5]) { recruit(); assert.equal(store().guilds.$g.usage.count,count); refund(); }
    const used=f.files(); assert(run('/마블시작','sub').includes('5회를 모두')); assert.deepEqual(f.files(),used);
    c.day='20261024'; run('/마블시작','sub'); for(const u of ['a','b','c','d'])run('/마블준비',u); assert.equal(store().guilds.$g.usage.count,1);
});
group('모집·준비 취소·참가 실패는 횟수0·시작만1회·시작 후 중단은 반환 없음', () => {
    run('/마블시작','sub'); run('/마블준비','a'); run('/마블준비취소','a'); assert.equal(store().guilds.$g.usage.count,0);
    run('/마블모집취소','master'); run('/마블시작','sub'); for(const u of ['a','b','c'])run('/마블준비',u);
    const data=f.read();data.member.a.point=1;f.write(data);run('/마블준비','d');assert.equal(store().guilds.$g.usage.count,0);
    const next=f.read();next.member.a.point=2e10;f.write(next);run('/마블준비','a');assert.equal(store().guilds.$g.usage.count,1);refund();assert.equal(store().guilds.$g.usage.count,1);
});
group('부길마 모집만 허용·참가비/모집취소/중단은 길마만·직책/소속 재검증', () => {
    run('/마블시작','sub'); assert.equal(game().state,'RECRUITING');const before=f.files();run('/마블모집취소','sub');run('/마블참가비 3','sub');assert.deepEqual(f.files(),before);
    for(const u of ['a','b','c','d'])run('/마블준비',u);const playing=f.files();run('/마블중단','sub');assert.deepEqual(f.files(),playing);
    seed();const guild=f.get(c.guildPath);delete guild.guilds.g.members.sub;f.put(c.guildPath,guild);const snapshot=f.files();run('/마블시작','sub');assert.deepEqual(f.files(),snapshot);
    seed();const data=f.read();data.member.sub.guild.id='other';f.write(data);assert(run('/마블시작','sub').includes('가입')||!f.raw(c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.guildMarble.fileName));
});
group('단축키와 정식 명령의 파일·턴·골드·선택 결과 일치', () => {
    const play = shortcut => { seed();recruit();c.Math.random=()=>0.4;run(shortcut?'ㅁㅂ':'/마블굴리기','a');run(shortcut?'ㅁㄱ':'/마블구매','a');const g=game();g.slot=0;g.players[0].position=0;setGame(g);run(shortcut?'ㅁㅂ':'/마블굴리기','a');run(shortcut?'ㅁㅌ':'/마블통과','a');return f.files(); };
    assert.deepEqual(play(true),play(false));
});
group('초성은 전체 일치만·접미/대화/슬래시는 무실행·비참가/다른 차례/방 차단', () => {
    recruit();const before=f.files();for(const input of ['ㅁㅂ 해봐','안녕 ㅁㅂ','ㅁㄱ1','ㅁㅌ 취소','/ㅁㅂ','/ㅁㄱ','/ㅁㅌ']) { assert.equal(c.getGuildMarbleRequest(input),null);run(input,'a');assert.deepEqual(f.files(),before); }
    for(const user of ['b','e','sub','gm']){run('ㅁㅂ',user);assert.deepEqual(f.files(),before);}run('ㅁㅂ','a','wrong-room');assert.deepEqual(f.files(),before);
});
group('기존7인수 콜백·단독 잠금·DEV 접두사로 초성3종 실행·운영 격리', () => {
    for(const shortcut of ['ㅁㅂ','ㅁㄱ','ㅁㅌ']){assert(c.isExclusiveDataMutationCommandMessage(shortcut));assert(c.isExclusiveDataMutationCommandMessage('dev/'+shortcut));}
    run('/마블시작','master','table');for(const u of ['a','b','c','d'])run('/마블준비',u,'table');c.Math.random=()=>0.4;
    callback('ㅁㅂ','a',false,'table');assert.equal(game().action,'BUY');callback('ㅁㄱ','a',false,'table');assert.equal(game().lands[3].level,1);
    const prod=f.raw(c.filePath),prodGame=f.raw(c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.guildMarble.fileName);
    c.Math.random=()=>0.999;run('dev/마블시작','sub','table');for(const u of ['a','b','c','d'])run('dev/마블준비',u,'table');c.Math.random=()=>0.4;
    callback('ㅁㅂ','a',true,'table');assert.equal(game(true).action,'BUY');callback('ㅁㅌ','a',true,'table');assert.equal(game(true).slot,1);
    assert.equal(f.raw(c.filePath),prod);assert.equal(f.raw(c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.guildMarble.fileName),prodGame);
});
group('초성도 정지·영지전·출석 공통 차단 유지', () => {
    recruit();const before=f.files(),suspended=c.isAccountSuspended;c.isAccountSuspended=()=>true;assert(callback('ㅁㅂ','a',false,'table').includes('계정정지'));c.isAccountSuspended=suspended;assert.deepEqual(f.files(),before);
    c.isGuildTerritoryWarCommandLockActive=()=>true;c.isGuildTerritoryBlockedDuringWarCommand=()=>true;assert(callback('ㅁㅂ','a',false,'table').includes('영지전'));assert.deepEqual(f.files(),before);
    c.isGuildTerritoryWarCommandLockActive=()=>false;c.isGuildTerritoryBlockedDuringWarCommand=()=>false;
    const data=f.read();data.blockAttendance=true;f.write(data);const blocked=f.files();assert(callback('ㅁㅂ','a',false,'table').includes('attendance'));assert.deepEqual(f.files(),blocked);
});
group('10개 토지의 Lv1/Lv2 실제 요금·정확히0 생존·부족 파산·소유자 지급 일치', () => {
    const board=c.GLOBAL_CONFIG.guildMarble.board;
    for(let cell=0;cell<board.length;cell++)if(board[cell].type==='land')for(const level of [1,2])for(const offset of [-1,0,1]){
        seed();recruit();const g=game(),base=board[cell].price===200?75:board[cell].price===300?120:150,toll=base*(level===2?3:1),gold=toll+offset;
        assert.equal(board[cell].toll,base);g.players[0].position=cell-1;g.players[0].gold=gold;g.lands[cell]={owner:1,level};setGame(g);c.Math.random=()=>0;
        const text=run('ㅁㅂ','a'),next=game();assert.equal(next.players[0].gold,Math.max(0,offset));assert.equal(next.players[1].gold,1020+Math.min(gold,toll));assert.equal(next.players[0].alive,offset>=0);
        assert.equal(text.split('💸 통행료 · ').length-1,1);assert(text.includes('💸 통행료 · '+toll+' 골드'));assert.equal(text.includes('✅ 통행료 납부 완료'),offset>=0);assert(text.includes('🏠 주인 [2]🔵 [b] · Lv.'+level));
    }
});
group('행운 두칸 고정100·출발+행운300·조회재출력 재추첨/재보상0', () => {
    for(const cell of [2,11]){seed();recruit();const g=game();g.players[0].position=cell-1;setGame(g);let calls=0;c.Math.random=()=>{assert.equal(++calls,1);return 0;};const text=run('ㅁㅂ','a');assert.equal(game().players[0].gold,1100);assert(text.includes('+100 골드'));assert(text.includes('!\n━━━━━━━━━━━━\n💰 +100'));const before=f.files();run('/마블판','a');assert.deepEqual(f.files(),before);assert.equal(calls,1);}
    seed();recruit();const g=game();g.players[0].position=13;setGame(g);let calls=0;c.Math.random=()=>{assert.equal(++calls,1);return 0.7;};const text=run('ㅁㅂ','a');assert.equal(game().players[0].gold,1300);assert(text.includes('출발 통과 · +200'));assert(text.includes('행운 · +100'));
});
group('기회 두칸 50%±효과 유지·부족과 정확히0·금액 아래 라운드 전환', () => {
    for(const cell of [7,14])for(const chance of [0.49,0.5]){seed();recruit();const g=game();g.players[0].position=cell-1;setGame(g);let calls=0;c.Math.random=()=>calls++===0?0:chance;const text=run('ㅁㅂ','a');assert.equal(game().players[0].gold,chance<0.5?1200:900);assert.equal(calls,2);assert(text.includes('\n━━━━━━━━━━━━\n💰 '+(chance<0.5?'+200':'-100')));}
    seed();recruit();const g=game();g.slot=3;g.players[3].position=6;setGame(g);let calls=0;c.Math.random=()=>calls++===0?0:0.49;const text=run('ㅁㅂ','d');assert(text.includes('💰 보유 금액 · '+c.numberWithCommas(1240)+' 골드\n🔄 새 라운드'));
});
group('최종40턴 대기 예시·이동/통행료/현재차례 순서·별도게임판소유자·allsee', () => {
    recruit();const g=game();g.slot=38;g.players[1].position=12;g.players[1].gold=320;g.players[0].gold=710;g.lands[15]={owner:0,level:1};setGame(g);c.Math.random=()=>0.4;
    const text=run('ㅁㅂ','b'),parts=f.replies();assert.equal(parts.length,2);assert.equal(game().slot,39);assert.equal(game().players[1].gold,245);assert.equal(game().players[0].gold,785);
    assert(parts[0].startsWith('🎲 길드마블 · 40/40턴'));assert(parts[0].includes('[2]🔵 [b] 님의 이동 결과\n🎲 【 3 】주사위가 나왔습니다!!\n📍 13 → 16칸 · 펜던트 공방📿\n🏠 주인'));
    assert(parts[0].includes('🔥 이번 경기의 마지막 차례입니다.\n[1]🔴 [a] 님의 차례입니다.\n👉 /마블굴리기 or ㅁㅂ\n━━━━━━━━━━━━\n👥 참가자 현황'));
    assert(parts[1].includes('[16] 펜던트 공방📿 Lv.1 · 주인 [1]🔴 [a]'));assert(parts[1].includes('가호의 성소✨ · 행운 · +100 골드'));
    for(const part of parts)assert.equal(part.split('<ALLSEE>').length-1,1);for(const old of ['📅 오늘 길드 이용','📘 /마블가이드','필요한 통행료','보낸 사람','받은 사람'])assert(!text.includes(old));
    assert.equal(parts[0].split('님의 차례입니다.').length-1,1);assert(!text.includes('━━━━━━━━━━━━\n━━━━━━━━━━━━'));
});
group('구매·건설 대기 현재 차례 유지·명령1회·부족 시 통과만·종료 후 다음행동0', () => {
    recruit();c.Math.random=()=>0.4;run('ㅁㅂ','a');let text=run('/마블판','b');assert(text.includes('[1]🔴 [a] 님의 차례입니다.\n👉 /마블구매 or ㅁㄱ\n👉 /마블통과 or ㅁㅌ'));assert.equal(text.split('👉 /마블구매').length-1,1);assert.equal(game().slot,0);
    const low=game();low.players[0].gold=1;setGame(low);text=run('ㅁㄱ','a');assert(!text.includes('👉 /마블구매'));assert.equal(text.split('👉 /마블통과').length-1,1);assert.equal(game().slot,0);
    const final=game();final.slot=39;final.action='ROLL';final.move=null;final.players[0].position=4;setGame(final);c.Math.random=()=>0;text=run('ㅁㅂ','a');assert.equal(store().guilds.$g.current,null);assert(!text.includes('님의 차례입니다.'));assert(!text.includes('👉 /마블굴리기'));assert(!text.includes('마지막 차례'));
});
group('기존 모집/경기/정산 파일은 스키마 변경·강제 저장 없이 조회 가능', () => {
    for(const state of ['RECRUITING','PLAYING','SETTLING']){seed();if(state==='RECRUITING')run('/마블시작','sub');else recruit();const s=store();s.guilds.$g.usage.count=3;if(state==='SETTLING')c.prepareGuildMarbleSettlement(s.guilds.$g.current,'PAYOUT');f.put(c.DATA_ROOT_PATH+c.GLOBAL_CONFIG.guildMarble.fileName,s);const before=f.files();run('/마블판','a');assert.deepEqual(f.files(),before);assert.equal(saves().length,0);}
});
group('가이드는 하루5회·역할·단축키·새요금·행운100 전체 교체·이용권보류·아이템불변', () => {
    const data=f.read();data.member.master.bag['길드마블이용권🎲']=7;data.member.a.bag['길드마블이용권🎲(/길드마블사용 숫자)']=5;f.write(data);const before=f.files();const guide=run('/마블가이드','a');assert.equal(f.replies().length,1);assert.equal(guide.split('<ALLSEE>').length-1,1);
    for(const wanted of ['보이스룸을 이용하며','하루 5회','부길드마스터','ㅁㅂ','ㅁㄱ','ㅁㅌ','75 / Lv.2 225','120 / Lv.2 360','150 / Lv.2 450','100 골드를 고정','실제 참가자 4명'])assert(guide.includes(wanted),wanted);
    assert(!/이용권|길드마블사용|하루 3회/.test(guide));assert.deepEqual(f.files(),before);assert(!guide.includes('👥 참가자 현황\n'));assert(!guide.includes('🏠 현재 길드마블 상황\n'));
    assert.equal(c.getGuildMarbleRequest('/길드마블사용 1'),null);recruit();refund();assert.equal(f.read().member.master.bag['길드마블이용권🎲'],7);assert.equal(f.read().member.a.bag['길드마블이용권🎲(/길드마블사용 숫자)'],5);
    const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/itemList.json'),'utf8'));assert(!catalog.nonItems.includes('길드마블이용권🎲'));
});
console.log('PASS guild marble improvements: '+groups+' requirement/exception groups (synthetic only)');
