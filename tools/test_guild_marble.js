const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const info = fs.readFileSync(path.join(root, 'Info.js'), 'utf8');
const modelStart = main.indexOf('// 길드마블의 실행 명령'), modelEnd = main.indexOf('// 길드 영지전 관련 함수들', modelStart);
const model = main.slice(modelStart, modelEnd);
const recoveryStart = main.indexOf('        // 중단된 두 파일 게시를 다른 회원 변경보다'), recoveryEnd = main.indexOf('        recoverAdventureRecordPending();', recoveryStart);
const recovery = main.slice(recoveryStart, recoveryEnd);
const entryStart = main.indexOf('        if (/^\\/(?:길드마블|마블'), entryEnd = main.indexOf('        if (msg === "/정령컨텐츠보상")', entryStart);
const entry = main.slice(entryStart, entryEnd);
assert(modelStart > 0 && modelEnd > modelStart && entryStart > 0 && recoveryStart > 0);
const fixtureSource = fs.readFileSync(path.join(__dirname, 'test_server_raid.js'), 'utf8');
// 기존 실제 관리 저장 함수·메모리 파일시스템 검증 하네스를 준비하는 함수
function createHarness() {
    const prefix = fixtureSource.slice(0, fixtureSource.indexOf('\ngroup("'));
    const f = new Function('require', '__dirname', prefix + `
return {c,block,reset,read,write,traces:()=>traces,replies:()=>replies,clear:()=>{traces=[];replies=[];},
put:(p,v)=>{disk[p]=JSON.stringify(v);},get:p=>JSON.parse(disk[p]),raw:p=>disk[p],files:()=>({...disk}),
failPath:p=>{failWrite=(_d,t)=>t===p;},replyFail:v=>{replyFailure=v;}};`)(require, __dirname);
    const c = f.c;
    vm.runInContext(model, c);
    for (const n of ['isSafePointValue', 'roundToTwo', 'getMyGuildId', 'createContextReplier', 'isCarrotTradeCommand', 'isAccountSuspensionBlockedMessage', 'getChatExperienceQueryTarget', 'isPassFreeHomeBadgeCommand']) vm.runInContext(f.block(main, 'function ' + n + '('), c);
    c.day = '20261023'; c.getAttendanceKstDateKey = () => c.day;
    c.isAttendanceFreeCommand = () => false;
    c.isGuildTerritoryWarCommandLockActive = () => false;
    c.isGuildTerritoryBlockedDuringWarCommand = () => false;
    c.isGlobalOperatorCommandAllowed = () => false;
    c.buildAttendanceRequiredMessage = () => 'attendance required';
    c.hasAttendedToday = d => !d.blockAttendance;
    vm.runInContext(`function runMarble(message,user,where){var msg=isDevCommandMessage(message)?stripDevCommandPrefix(message):message,sender=user||'a',room=where||'table',isGroupChat=true;
var ctx=createCommandContext(isDevCommandMessage(message),room),prev=enterCommandContext(ctx);beginDataSaveTransaction();var outputReplier=replier;if(ctx.isDev&&['/ㅁㅂ','/ㅁㄱ','/ㅁㅌ'].indexOf(msg)!==-1)msg=msg.substring(1);if(msg.trim()==='ㅁㄱ')msg='ㅁㄱ';var marbleLandShortcut=msg==='ㅁㄱ';try{
` + recovery + `var data=loadJsonFile(filePath);` + entry + `
}catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(prev);}}
`, c);
    // 합성 계정과 길드만 사용해 각 시나리오를 초기화하는 함수
    function seed(options = {}) {
        f.reset(); c.day = '20261023'; c.Math = Object.create(Math); c.Math.random = () => 0.999;
        const data = { member: {} }, guild = { guilds: { g: { master: 'master', subMasters: ['sub'], members: {} }, other: { master: 'outsider', members: { outsider: {} } } } };
        for (const user of ['master', 'sub', 'a', 'b', 'c', 'd', 'e', 'outsider', 'gm']) {
            data.member[user] = { point: 20000000000, today: 1, agree: true, server: '호이서버1[30]', bag: {}, guild: { id: user === 'outsider' ? 'other' : 'g' } };
            if (!options.noIds) data.member[user].serverRaidAccount = { id: 'id-' + user, period: 0, server: '호이서버1[30]', latest: null, total: null };
            if (user !== 'outsider') guild.guilds.g.members[user] = { role: user === 'master' ? 'MASTER' : user === 'sub' ? 'SUBMASTER' : 'MEMBER' };
        }
        c.Master = ['gm']; c.Admins = ['gm'];
        for (const folder of ['/sdcard/호이랜드/', '/sdcard/호이랜드_dev/']) {
            f.put(folder + 'member.json', data); f.put(folder + 'member_pet.json', {}); f.put(folder + 'guild.json', guild);
        }
        f.clear(); return data;
    }
    const store = (dev = false) => f.get((dev ? '/sdcard/호이랜드_dev/' : '/sdcard/호이랜드/') + c.GLOBAL_CONFIG.guildMarble.fileName);
    const game = (dev = false) => store(dev).guilds.$g.current;
    const run = (command, user = 'a', where = 'table') => { f.clear(); c.runMarble(command, user, where); return f.replies().join('\n'); };
    const recruit = (dev = false) => { const pre = dev ? 'dev/' : '/'; run(pre + '마블시작', 'master'); for (const user of ['a', 'b', 'c', 'd']) run(pre + '마블준비', user); return game(dev); };
    const actor = () => { const g = game(), index = c.getGuildMarbleTurnIndex(g), id = g.players[index].id; return Object.keys(f.read().member).find(u => f.read().member[u].serverRaidAccount?.id === id); };
    const setGame = g => { const s = store(); s.guilds.$g.current = g; f.put('/sdcard/호이랜드/' + c.GLOBAL_CONFIG.guildMarble.fileName, s); };
    return { f, c, seed, store, game, run, recruit, actor, setGame };
}

// 실제 명령으로 상태 전이와 금액 경계를 검증하는 함수
function runTests() {
    const h = createHarness(), { f, c, seed, store, game, run, recruit, actor, setGame } = h;
    const memberPath = c.filePath, marblePath = '/sdcard/호이랜드/' + c.GLOBAL_CONFIG.guildMarble.fileName;
    let groups = 0;
    // 독립된 합성 시나리오를 실행하고 결과를 표시하는 함수
    function group(name, test) { seed(); test(); console.log('PASS MARBLE ' + (++groups) + ': ' + name); }
    const saves = () => f.traces().filter(t => t.type === 'save');
    const footer = text => {
        const messages = f.replies(); assert.equal(messages.length, 2);
        assert(messages[0].includes('👥 참가자 현황\n<ALLSEE>\n[1]')); assert(!messages[0].includes('🏠 현재 길드마블 상황'));
        assert(messages[1].startsWith('🏠 현재 길드마블 상황\n<ALLSEE>[01]')); assert(!messages[1].includes('👥 참가자 현황'));
        for (const message of messages) assert.equal(message.split('<ALLSEE>').length - 1, 1);
        assert(text.includes('[16] 펜던트 공방📿')); assert(!text.endsWith('━━━━━━━━━━━━'));
    };
    group('MASTER 권한과 길드마스터 구분·첫 조회 무파일 생성·정확한 명령과 인수', () => {
        run('/길드마블', 'a'); assert.equal(saves().length, 0); assert.equal(f.raw(marblePath), undefined);
        for (const user of ['gm', 'a', 'outsider']) assert(run('/마블시작', user).includes('길드마스터') || user === 'outsider');
        seed(); run('/마블시작', 'sub'); assert.equal(game().state, 'RECRUITING');
        seed(); for (const text of ['/마블시작 설명', '/마블참가비 1 해봐', '/마블참가비 0', '/마블참가비 11', '/마블참가비 -1', '/마블참가비 1.5']) { run(text, 'master'); assert.equal(saves().length, 0); }
    });
    group('참가비 1·3·10억 총액·10% 수수료·40/30/20/10% 지급·단일 비용 차감', () => {
        for (const units of [1, 3, 10]) {
            seed(); run('/마블참가비 ' + units, 'master'); const before = f.read(); const g = recruit();
            assert.equal(g.fee, units * 1e8); assert.equal(g.commission, units * 4e7); assert.equal(g.pool, units * 3.6e8);
            assert.deepEqual([...g.prizes], [units * 1.44e8, units * 1.08e8, units * 7.2e7, units * 3.6e7]);
            assert.equal(g.prizes.reduce((a,b) => a+b), g.pool); assert.equal(store().guilds.$g.usage.count, 1);
            for (const user of ['a','b','c','d']) assert.equal(f.read().member[user].point, before.member[user].point - units * 1e8);
            assert.equal(f.read().member.master.point, before.member.master.point); assert.equal(g.state, 'PLAYING');
            assert.deepEqual(g.players.map(p => p.gold), [1000,1020,1030,1040]); footer(run('/마블판', 'a'));
        }
    });
    group('모집·중복 준비·준비취소·길마 비참가·설정 잠금', () => {
        run('/마블시작', 'master'); run('/마블준비', 'a'); const before = f.raw(marblePath);
        run('/마블준비', 'a'); assert.equal(f.raw(marblePath), before); assert.equal(saves().length, 0);
        run('/마블준비취소', 'a'); assert.equal(game().players.length, 0); assert.equal(f.read().member.a.point, 2e10);
        run('/마블참가비 3', 'master'); assert.equal(store().guilds.$g.feeUnits, 1); assert.equal(saves().length, 0);
        run('/마블모집취소', 'master'); assert.equal(store().guilds.$g.current, null); assert.equal(store().guilds.$g.usage.count, 0);
    });
    group('4명 시작 재검증 실패는 해당 준비만 해제·전체 포인트/일일 횟수 미차감', () => {
        run('/마블시작', 'master'); for (const u of ['a','b','c']) run('/마블준비', u);
        const d = f.read(); d.member.a.point = 1; d.member.b.guild.id = 'other'; f.write(d);
        run('/마블준비', 'd'); assert.equal(game().state, 'RECRUITING'); assert.deepEqual(game().players.map(p=>p.user), ['c','d']);
        assert.equal(f.read().member.c.point, 2e10); assert.equal(f.read().member.d.point, 2e10); assert.equal(store().guilds.$g.usage.count, 0);
    });
    group('계정 ID 없는 기존 회원도 한 번만 발급·닉변·탈퇴 후 참가와 상금 대상 유지', () => {
        seed({noIds:true}); recruit(); const d = f.read(), id = d.member.a.serverRaidAccount.id;
        d.member.renamed = d.member.a; delete d.member.a; delete d.member.renamed.guild; f.write(d);
        const guild = f.get(c.guildPath); delete guild.guilds.g.members.a; f.put(c.guildPath,guild);
        const g=game(); g.slot=g.players.findIndex(p=>p.id===id); g.action='ROLL'; setGame(g);
        footer(run('/마블굴리기','renamed')); assert.equal(game().players.find(p=>p.id===id).position,6);
        assert.equal(f.read().member.renamed.serverRaidAccount.id,id);
    });
    group('조회·잘못된 입력·타인·다른 방은 저장/난수/턴/동의 미변경·공통 하단', () => {
        recruit(); const before=f.raw(marblePath), points=f.raw(memberPath); c.Math.random=()=>{throw Error('query must not roll');};
        for(const command of ['/길드마블','/마블판','/마블굴리기 1','/마블구매 1 해봐']) { footer(run(command,'b')); assert.equal(saves().length,0); }
        footer(run('/마블굴리기','e')); assert.equal(f.raw(marblePath),before); assert.equal(f.raw(memberPath),points);
        assert(run('/마블굴리기',actor(),'otherRoom').includes('원래 방')); assert.equal(saves().length,0);
    });
    group('첫 구매 대기·재조회/재굴리기 차단·건설·골드 부족 통과 대기', () => {
        recruit(); c.Math.random=()=>0.4; const user=actor(); footer(run('/마블굴리기',user)); const moved=game(); assert.equal(moved.action,'BUY'); assert.equal(moved.move.die,3);
        const before=f.raw(marblePath); footer(run('/마블굴리기',user)); assert.equal(f.raw(marblePath),before); assert.equal(saves().length,0);
        footer(run('/마블구매',user)); assert.equal(game().lands[3].level,1); assert.equal(game().players[0].gold,800); assert.equal(game().slot,1);
        const g=game(); g.slot=0;g.players[0].position=0;setGame(g);run('/마블굴리기',user);assert.equal(game().action,'BUILD');
        run('/마블건설',user);assert.equal(game().lands[3].level,2);assert.equal(game().players[0].gold,600);
        const low=game();low.slot=0;low.players[0].position=0;low.lands[3]={owner:-1,level:0};low.players[0].gold=100;setGame(low);
        run('/마블굴리기',user);const waiting=f.raw(marblePath);footer(run('/마블구매',user));assert.equal(f.raw(marblePath),waiting);assert.equal(saves().length,0);
        run('/마블통과',user);assert.equal(game().players[0].gold,100);assert.equal(game().slot,1);
    });
    group('홀수 정순·짝수 역순·라운드 경계 같은 참가자 연속 차례·최대40턴', () => {
        recruit(); const g=game();g.slot=3;g.players[3].position=4;setGame(g);c.Math.random=()=>0;
        footer(run('/마블굴리기','d'));assert.equal(game().slot,4);assert.equal(c.getGuildMarbleTurnIndex(game()),3);
        c.Math.random=()=>0.2;footer(run('/마블굴리기','d'));assert.equal(game().slot,5);assert.equal(c.getGuildMarbleTurnIndex(game()),2);
    });
    group('출발 통과·정확한 도착 한 번·행운 고정100·기회 양방향·휴식', () => {
        for(const [from,rng,gold] of [[15,0,1200],[13,0.4,1200]]) { seed();recruit();const g=game();g.players[0].position=from;setGame(g);c.Math.random=()=>rng;run('/마블굴리기','a');assert.equal(game().players[0].gold,gold); }
        for(const chance of [0,0.34,0.99]) { seed();recruit();let calls=0;c.Math.random=()=>calls++===0?0.2:chance;run('/마블굴리기','a');assert.equal(game().players[0].gold,1100);assert.equal(calls,1); }
        for(const [chance,delta] of [[0.49,200],[0.5,-100]]) {seed();recruit();const g=game();g.players[0].position=1;setGame(g);let calls=0;c.Math.random=()=>calls++===0?0.99:chance;run('/마블굴리기','a');assert.equal(game().players[0].gold,1000+delta);}
    });
    group('통행료 정확히 0골드는 생존·부족하면 잔여만 이전·지역 초기화·탈락 차례 제외', () => {
        for(const gold of [120,50,0]) {seed();recruit();const g=game();g.players[0].gold=gold;g.players[0].position=9;g.lands[10]={owner:1,level:1};g.lands[1]={owner:0,level:2};setGame(g);c.Math.random=()=>0;
            const text=run('/마블굴리기','a');footer(text);const after=game();assert.equal(after.players[0].gold,0);assert.equal(after.players[1].gold,1020+gold);assert.equal(after.players[0].alive,gold===120);
            if(gold<120){assert.equal(after.lands[1].owner,-1);assert.equal(after.players[0].eliminated,1);assert(text.includes('실제 지급 · '+gold+' 골드'));assert(text.includes('부족 금액 · '+(120-gold)));assert(!text.includes('납부 완료'));}
        }
    });
    group('전원 동의 중단·중복/비참가 동의 제외·탈락자 포함·전액 환급·횟수 유지', () => {
        recruit();const g=game();g.players[2].alive=false;g.players[2].gold=0;g.players[2].eliminated=1;setGame(g);
        footer(run('/마블중단','master'));run('/마블중단확인','outsider');assert.equal(game().stop.agreements.length,0);
        run('/마블중단확인','a');const before=f.raw(marblePath);run('/마블중단확인','a');assert.equal(f.raw(marblePath),before);assert.equal(saves().length,0);
        for(const user of ['b','c','d'])run('/마블중단확인',user);
        assert.equal(store().guilds.$g.current,null);assert.equal(store().guilds.$g.last.kind,'REFUND');assert.equal(store().guilds.$g.usage.count,1);
        for(const user of ['a','b','c','d'])assert.equal(f.read().member[user].point,2e10);
        run('/마블중단확인','a');assert.equal(saves().length,0);
    });
    group('유효한 진행만 중단 요청 취소·잘못된 입력/부족 구매는 동의 보존', () => {
        recruit();run('/마블중단','master');run('/마블중단확인','b');run('/마블구매','a');assert.equal(game().stop.agreements.length,1);
        c.Math.random=()=>0.4;run('/마블굴리기','a');assert.equal(game().stop,null);
        run('/마블중단','master');run('/마블중단확인','a');const g=game();g.players[0].gold=1;setGame(g);run('/마블구매','a');assert.equal(game().stop.agreements.length,1);
    });
    group('최종턴·정산 지급액·참가비 별도 반환 없음·최종판 포함·상세 정리', () => {
        recruit();const g=game();g.slot=39;g.players[0].position=4;setGame(g);c.Math.random=()=>0;
        const text=run('/마블굴리기','a');footer(text);assert(!text.includes('41/40'));assert(text.includes('지급 완료'));assert.equal(store().guilds.$g.current,null);
        assert.deepEqual(store().guilds.$g.last.payments.map(p=>p.amount),[144000000,108000000,72000000,36000000]);
        assert.equal(Object.values(f.read().member).reduce((t,m)=>t+m.point,0),9*2e10-40000000);
    });
    group('일일7회·개인 추가 제한 없음·자정 진행 보존·다음 날짜 재모집', () => {
        for(let i=0;i<7;i++){recruit();run('/마블중단','master');for(const u of ['a','b','c','d'])run('/마블중단확인',u);}
        assert(run('/마블시작','master').includes('7회'));assert.equal(saves().length,0);
        c.day='20261024';run('/마블시작','master');for(const u of ['a','b','c','d'])run('/마블준비',u);assert.equal(store().guilds.$g.usage.count,1);
        const before=f.raw(marblePath);c.day='20261025';footer(run('/마블판','a'));assert.equal(f.raw(marblePath),before);assert.equal(saves().length,0);
    });
    group('정산 범위 오류는 순위 먼저 보존·조회 무저장·재시도 재추첨/중복 없음', () => {
        recruit();const d=f.read();d.member.d.point=9007199254740991;f.write(d);const g=game();g.slot=39;g.players[0].position=4;setGame(g);c.Math.random=()=>0;
        footer(run('/마블굴리기','a'));assert.equal(game().state,'SETTLING');const fixed=JSON.stringify(game().results),before=f.raw(marblePath),points=f.raw(memberPath);
        c.Math.random=()=>{throw Error('no second lottery');};footer(run('/마블판','a'));assert.equal(saves().length,0);assert.equal(f.raw(marblePath),before);assert.equal(f.raw(memberPath),points);
        const expected=JSON.parse(fixed).map(r=>({id:game().players[r.index].id,amount:r.amount}));
        const next=f.read();next.member.d.point=1;f.write(next);const out=run('/마블굴리기','a');footer(out);assert.equal(store().guilds.$g.current,null);assert.deepEqual(store().guilds.$g.last.payments,expected);
    });
    group('회원/경기 저장 실패 후 원문 복구·재시도 시작 한 번만 차감', () => {
        for(const target of [memberPath,marblePath]){seed();run('/마블시작','master');for(const u of ['a','b','c'])run('/마블준비',u);const before=f.raw(memberPath);f.failPath(target);assert.throws(()=>run('/마블준비','d'));assert.equal(f.raw(memberPath),before);run('/마블준비','d');assert.equal(game().state,'PLAYING');for(const u of ['a','b','c','d'])assert.equal(f.read().member[u].point,19900000000);}
    });
    group('응답 실패는 확정된 차감/주사위/구매를 되돌리지 않음·DEV 분리', () => {
        recruit();f.replyFail(true);c.Math.random=()=>0.4;run('/마블굴리기','a');assert.equal(game().action,'BUY');run('/마블구매','a');assert.equal(game().lands[3].level,1);f.replyFail(false);
        const prod=f.raw(memberPath),prodGame=f.raw(marblePath);recruit(true);assert.equal(game(true).state,'PLAYING');assert.equal(f.raw(memberPath),prod);assert.equal(f.raw(marblePath),prodGame);
    });
    group('생존자 총자산·건설 원가·탈락 역순·동점 그룹만 한 번 추첨', () => {
        recruit();const g=game();g.players[0].gold=200;g.lands[1]={owner:0,level:2};g.players[1].gold=600;
        g.players[2].gold=0;g.players[2].alive=false;g.players[2].eliminated=1;g.players[3].gold=0;g.players[3].alive=false;g.players[3].eliminated=2;
        assert.equal(c.getGuildMarbleAssets(g,0),600);let calls=0;c.Math.random=()=>{calls++;return 0;};c.prepareGuildMarbleSettlement(g,'PAYOUT');
        assert.deepEqual(g.results.map(r=>r.index),[1,0,3,2]);assert.equal(calls,1);const fixed=JSON.stringify(g);c.prepareGuildMarbleSettlement(g,'REFUND');assert.equal(JSON.stringify(g),fixed);
        const other=JSON.parse(fixed);other.state='PLAYING';other.players[0].gold=201;c.Math.random=()=>{throw Error('only ties draw');};c.prepareGuildMarbleSettlement(other,'PAYOUT');assert.deepEqual(other.results.map(r=>r.index),[0,1,3,2]);
    });
    group('이미 지급한 참가자는 건너뛰고 미지급만 처리·정산 중 환급 전환 불가', () => {
        recruit();const g=game();c.prepareGuildMarbleSettlement(g,'PAYOUT');const paid=g.results[0];g.players[paid.index].paid=true;
        const d=f.read(),user=g.players[paid.index].user;d.member[user].point+=paid.amount;f.write(d);setGame(g);const before=d.member[user].point;
        c.Math.random=()=>{throw Error('no settlement lottery');};const pending=f.raw(marblePath),points=f.raw(memberPath);
        footer(run('/마블중단','master'));assert.equal(f.raw(marblePath),pending);assert.equal(f.raw(memberPath),points);assert.equal(saves().length,0);
        footer(run('/마블굴리기','a'));assert.equal(f.read().member[user].point,before);assert.equal(store().guilds.$g.last.kind,'PAYOUT');
        assert.equal(Object.values(f.read().member).reduce((t,m)=>t+m.point,0),9*2e10-4e7);
    });
    group('삭제 계정과 같은 닉네임의 새 계정에 오지급하지 않고 정산 대기', () => {
        recruit();const g=game();c.prepareGuildMarbleSettlement(g,'PAYOUT');setGame(g);const d=f.read();d.member.d.serverRaidAccount.id='new-account';f.write(d);
        footer(run('/마블시작','master'));assert.equal(game().state,'SETTLING');assert.equal(f.read().member.d.point,19900000000);assert.equal(saves().length,0);
        const next=f.read();next.member.returned=next.member.d;delete next.member.d;next.member.returned.serverRaidAccount.id='id-d';f.write(next);
        footer(run('/마블굴리기','returned'));assert.equal(store().guilds.$g.current,null);assert(f.read().member.returned.point>19900000000);
    });
    group('Lv.2 세 배 통행료·마지막 상대 파산 즉시 종료·탈락 예정 턴 건너뛰기', () => {
        recruit();const g=game();for(const i of [1,2]){g.players[i].alive=false;g.players[i].gold=0;g.players[i].eliminated=i;}
        g.players[0].gold=50;g.players[0].position=9;g.lands[10]={owner:3,level:2};setGame(g);c.Math.random=()=>0;
        const text=run('/마블굴리기','a');footer(text);assert(text.includes('한 명의 생존자'));assert(text.includes('360 골드'));assert.equal(store().guilds.$g.current,null);
        assert.deepEqual(store().guilds.$g.last.payments.map(p=>p.id),['id-d','id-a','id-c','id-b']);
        seed();recruit();const skip=game();skip.players[1].alive=false;skip.players[1].gold=0;skip.players[1].eliminated=1;skip.players[0].position=4;setGame(skip);c.Math.random=()=>0;run('/마블굴리기','a');assert.equal(game().slot,2);
    });
    group('출발 통과와 행운 동시 반영·이벤트 정확히 0 생존/부족 파산', () => {
        recruit();const g=game();g.players[0].position=13;setGame(g);let calls=0;c.Math.random=()=>calls++===0?0.7:0.99;
        const text=run('/마블굴리기','a');assert.equal(game().players[0].gold,1300);assert(text.includes('출발 통과'));assert(text.includes('+100 골드'));
        for(const gold of [100,99]){seed();recruit();const loss=game();loss.players[0].position=6;loss.players[0].gold=gold;setGame(loss);let n=0;c.Math.random=()=>n++===0?0:0.5;run('/마블굴리기','a');assert.equal(game().players[0].gold,0);assert.equal(game().players[0].alive,gold===100);}
    });
    group('중단 환급에 추첨 없음·원 참가자 순서로 환급만 안내', () => {
        recruit();run('/마블중단','master');c.Math.random=()=>{throw Error('refund must not draw');};let text;for(const u of ['a','b','c','d'])text=run('/마블중단확인',u);
        footer(text);assert(text.includes('환급 완료'));assert(!text.includes('🥇'));assert(!text.includes('총자산'));assert.deepEqual(store().guilds.$g.last.payments.map(p=>p.id),['id-a','id-b','id-c','id-d']);
    });
    group('일반 턴은 작은 경기 파일만 저장·가이드/조회/잘못된 명령 0저장·출석 차단', () => {
        recruit();c.Math.random=()=>0.4;const text=run('/마블굴리기','a');assert.equal(text.split('🎲 【 ').length-1,1);assert(saves().length>0);assert(saves().every(t=>t.path===marblePath));
        const snapshot=f.raw(marblePath);for(const command of ['/마블판','/길드마블','/마블가이드','/마블건설','/마블준비 설명']){run(command,'b');assert.equal(saves().length,0);assert.equal(f.raw(marblePath),snapshot);}
        const d=f.read();d.blockAttendance=true;f.write(d);assert(run('/마블구매','a').includes('attendance required'));assert.equal(saves().length,0);assert.equal(f.raw(marblePath),snapshot);
    });
    group('잘못된 기존 저장 자료는 빈 경기로 덮지 않고 실패', () => {
        recruit();const base=store();for(const corrupt of [s=>s.schemaVersion=9,s=>s.guilds.$g.current.players[1].id='id-a',s=>s.guilds.$g.current.lands[0]={owner:0,level:1},s=>s.guilds.$g.current.prizes[0]++,s=>s.guilds.$g.current.action='BUY']){
            const s=JSON.parse(JSON.stringify(base));corrupt(s);f.put(marblePath,s);assert.throws(()=>run('/마블판','a'));assert.equal(saves().length,0);assert.equal(f.raw(marblePath),JSON.stringify(s));
        }
    });
    group('64개 시드의 완주 경기·선택 단계·유효 상태·최종 4명 금액 보존', () => {
        for(let seedNumber=1;seedNumber<=64;seedNumber++){
            seed();let state=seedNumber;c.Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};recruit();let inputs=0;
            while(game()){
                const g=game();c.requireGuildMarbleStore(store());const user=actor(),p=g.players[c.getGuildMarbleTurnIndex(g)],cell=c.GLOBAL_CONFIG.guildMarble.board[p.position];
                const command=g.action==='ROLL'?'/마블굴리기':p.gold>=cell.price&&c.Math.random()<0.7?g.action==='BUY'?'/마블구매':'/마블건설':'/마블통과';
                footer(run(command,user));assert(++inputs<=80);assert(!f.replies().join('').includes('41/40'));
            }
            assert.equal(store().guilds.$g.last.payments.length,4);assert.equal(new Set(store().guilds.$g.last.payments.map(p=>p.id)).size,4);
            assert.equal(Object.values(f.read().member).reduce((t,m)=>t+m.point,0),9*2e10-4e7);
        }
    });
    group('실제 7인수 콜백 모집·시작·조회·구매·DEV·정지/패스/영지전 검사 유지', () => {
        const locks=[];const counted=()=>{const l={depth:0,lock(){this.depth++;},tryLock(){this.lock();return true;},unlock(){assert(this.depth>0);this.depth--;}};locks.push(l);return l;};
        const read=counted(),write=counted();c.commandDataFlowLock={readLock:()=>read,writeLock:()=>write};c.dataTransactionLock=counted();c.autoDailyQuestInternalDepth=0;
        c.errorLogPath='/synthetic/error.json';const originalWrite=c.FileStream.write;c.FileStream.write=(p,t)=>{throw Error('unexpected callback error: '+t);};
        c.recordBlockedPrivateChatAttempt=()=>false;c.getBlockedPrivateChatNoticeKind=()=>'required';
        const callback=(msg,user='a',room='table',isGroup=true)=>{f.clear();c.response(room,msg,user,isGroup,c.replier,null,'com.kakao.talk');assert(locks.every(l=>l.depth===0));assert.equal(c.getCurrentContext().isDev,false);assert.equal(c.getDataSaveTransaction(),null);return f.replies().join('\n');};
        try{
            callback('/마블시작','master');for(const u of ['a','b','c','d'])callback('/마블준비',u);assert.equal(game().state,'PLAYING');
            const before=f.raw(memberPath);footer(callback('/마블판'));assert.equal(saves().length,0);assert.equal(f.raw(memberPath),before);
            c.Math.random=()=>0.4;footer(callback('/마블굴리기'));callback('/마블구매');assert.equal(game().lands[3].level,1);
            callback('dev/마블시작','master');assert.equal(game(true).state,'RECRUITING');assert.equal(f.raw(memberPath),before);
            const snapshot=f.raw(marblePath),suspended=c.isAccountSuspended,pass=c.hasActiveHoiPassAccess;
            c.isAccountSuspended=()=>true;assert(callback('/마블굴리기','b').includes('계정정지'));c.isAccountSuspended=suspended;
            c.hasActiveHoiPassAccess=()=>false;assert(callback('/마블굴리기','b','private',false).includes('프리미엄'));c.hasActiveHoiPassAccess=pass;
            c.isGuildTerritoryWarCommandLockActive=()=>true;c.isGuildTerritoryBlockedDuringWarCommand=()=>true;assert(callback('/마블굴리기','b').includes('영지전 진행'));assert.equal(f.raw(marblePath),snapshot);
        }finally{c.FileStream.write=originalWrite;c.isGuildTerritoryWarCommandLockActive=()=>false;}
    });
    group('분리된 실제 회원 저장과 백업·원문 복구는 레이드/운영 로그 슬롯을 바꾸지 않음', () => {
        const h=createHarness(),{f,c,seed,run,recruit,game}=h;seed();
        c.java.io.File.prototype.getName=function(){return this.path.split('/').pop();};c.java.io.File.prototype.lastModified=()=>0;
        c.MANAGED_BACKUP_SECONDARY_ROTATION_MS=86400000;c.java.lang.String=function(v){this.getBytes=()=>Buffer.from(String(v),'utf8');};
        c.getManagedJsonBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back.json'):null;
        c.getManagedJsonSecondaryBackupPath=p=>p.endsWith('/member.json')?p.replace(/member\.json$/,'member_back2.json'):null;
        vm.runInContext(f.block(main,'const MEMBER_STORAGE_SPLIT_CONFIG = {')+';this.MEMBER_STORAGE_SPLIT_CONFIG=MEMBER_STORAGE_SPLIT_CONFIG;var memberSplitBackupCache={};',c);
        for(const n of ['getMemberSplitMarker','getMemberSplitStorePath','getMemberSplitBackupPath','requireMemberSplitStore','readMemberSplitStore','readPublishedMemberSplitStore','buildMemberSplitRaidSummary','attachMemberSplitStores','buildMemberSplitSavePlan','stringifyMemberSplitStore','preserveMemberSplitBackupStores','createMemberSplitMigrationStores','isProtectedManagedJsonPath','parseManagedJsonContent','loadJsonFile'])vm.runInContext(f.block(main,'function '+n+'('),c);
        const d=f.read(),key=c.MEMBER_STORAGE_SPLIT_CONFIG.key;d.serverRaid=JSON.parse(JSON.stringify(c.createServerRaidState('synthetic')));
        for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)d[log]=[{feature:'synthetic',keep:true}];
        const marker={version:c.MEMBER_STORAGE_SPLIT_CONFIG.version,id:'split-test',phase:'COMPLETE',raidRevision:0,logsRevision:0};
        const slots=c.createMemberSplitMigrationStores(d,marker);f.put(c.getMemberSplitStorePath('raid',0),slots.raid);f.put(c.getMemberSplitStorePath('logs',0),slots.logs);
        const raw=JSON.parse(JSON.stringify(d));for(const log of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)delete raw[log];raw.serverRaid=c.buildMemberSplitRaidSummary(d.serverRaid);raw.migrations={[key]:marker};f.write(raw);
        const raid=f.raw(c.getMemberSplitStorePath('raid',0)),logs=f.raw(c.getMemberSplitStorePath('logs',0));recruit();assert.equal(game().state,'PLAYING');
        const after=f.read();assert.equal(after.member.a.point,19900000000);assert.equal(after.migrations[key].raidRevision,0);assert.equal(after.migrations[key].logsRevision,0);
        for(const name of c.MEMBER_STORAGE_SPLIT_CONFIG.logKeys)assert(!Object.hasOwn(after,name));assert.equal(f.raw(c.getMemberSplitStorePath('raid',0)),raid);assert.equal(f.raw(c.getMemberSplitStorePath('logs',0)),logs);
        run('/마블중단','master');for(const u of ['a','b','c','d'])run('/마블중단확인',u);assert.equal(f.read().member.a.point,2e10);assert.equal(f.raw(c.getMemberSplitStorePath('raid',0)),raid);assert.equal(f.raw(c.getMemberSplitStorePath('logs',0)),logs);
    });
    group('실제 채크랭크의 길드 정리 부작용 없이 추방/잘못된 성주 참조 표시', () => {
        const h=createHarness(),{f,c,seed,recruit,run}=h;seed();recruit();
        for(const n of ['checkRank','getCheckRankTierEmoji','getTierEmojiForMember','getVisibleRankEmoji','getGuildMasterRankEmoji'])vm.runInContext(f.block(info,'function '+n+'('),c);
        vm.runInContext(f.block(main,'function getMyGuildInfo('),c);
        const d=f.read();d.HoiCastle={lord:'master'};d.member.master.guild.id='missing';f.write(d);const guild=f.get(c.guildPath);delete guild.guilds.g.members.a;f.put(c.guildPath,guild);
        const before=f.raw(c.filePath);for(const command of ['/마블판','/길드마블','/마블가이드']){const text=run(command,'a');assert(text.includes('a'));assert.equal(f.traces().filter(t=>t.type==='save').length,0);assert.equal(f.raw(c.filePath),before);}
        c.Math.random=()=>0.4;run('/마블굴리기','a');run('/마블구매','a');assert.equal(f.raw(c.filePath),before);
    });
    console.log('PASS guild marble: '+groups+' command/storage groups');
}
module.exports={main,info,model,recovery,entry,createHarness};
if(require.main===module)runTests();
