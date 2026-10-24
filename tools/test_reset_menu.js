// 환경·방별 실제 초기화 세션 키를 테스트에서 계산한다.
const skey=(user,dev=false,room='test')=>(dev?'DEV:':'PROD:')+JSON.stringify([user,room,true]);
const assert = require('assert'), vm = require('vm');
const { createFixture } = require('./test_server_raid_delivery.js');
const clone = value => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(name, run) { run(); console.log('PASS reset ' + (++groups) + ': ' + name); }
// 전체 초기화 시험용 비식별 댓글·피드·알림을 준비한다.
function records() {
    return {
        comments: { comments: { owner: [{text:'댓글 A',from:'a',time:1},{text:'댓글 B',from:'b',time:2}], other: [] }, pinnedComments: { owner: [{text:'댓글 A',from:'a',time:1,pinnedAt:3}] }, keep: true },
        home: { owner: { feeds:[{id:'f1',content:'피드 A',createdAt:1},{id:'f2',content:'피드 B',createdAt:2}], comment:'옛 피드',commentTime:1,visitCnt:7,likeCnt:8,furnitureBag:[{name:'가구'}],guestComments:['이전 방명록'] } },
        activity: { alerts: { owner: [{type:'comment',commentPreview:'댓글 A'},{type:'feed',feedId:'f1',feedContent:'피드 A'},{type:'visit',actorId:'a'}] }, recentVisitors:{owner:[{visitorId:'a'}]},petHomeSocial:{owner:{stats:{receivedComments:20}}} }
    };
}
// 실제 Main 진입과 가상 저장소를 사용하며 최종 기존 명령 연결만 관측한다.
function fixture(saved) {
    let h = createFixture(saved), root=h.c.DATA_ROOT_PATH, dev=h.c.DEV_DATA_ROOT_PATH;
    if (!saved) {
        const state=h.persist();for(const prefix of [root,dev]){
            const r=records();state.disk[prefix+'comments.json']=JSON.stringify(r.comments);state.disk[prefix+'home.json']=JSON.stringify(r.home);state.disk[prefix+'activity.json']=JSON.stringify(r.activity);
            const m=JSON.parse(state.disk[prefix+'member.json']);m.member['호이 남']=clone(m.member.master);m.member['호이 남'].guild={id:'g'};m.member.master.guild={id:'g'};m.member.admin.guild={id:'g'};state.disk[prefix+'member.json']=JSON.stringify(m);
            state.disk[prefix+'guild.json']=JSON.stringify({guilds:{g:{master:'호이 남',subMasters:['master'],members:{'호이 남':{},master:{},admin:{}}}}});
        }h=createFixture(state);
    }
    const c=h.c;c.Master=['master','호이 남'];c.Admins=['admin'];c.petHomeCommentsFile=root+'comments.json';c.petHomeActivityFile=root+'activity.json';c.errorLogPath='/synthetic/error.json';
    for(const name of ['isAdmin','ensureGuildSubMasters','isGuildSubMaster','isGuildLeader'])vm.runInContext(h.block(h.main,'function '+name+'('),c);
    const start=h.main.indexOf('function response('),end=h.main.indexOf('// 확인 응답도',start);
    vm.runInContext(h.main.slice(start,end).replace('function response(','function probeReset(')+'return {command:msg,confirmed:ctx.manualResetConfirmed};}catch(error){rollbackDataSaveTransaction();throw error;}finally{if(commandContextEntered)exitCommandContext(prevCtx);if(dataSaveTransactionEntered)endDataSaveTransaction();if(responseTransactionAcquired)dataTransactionLock.unlock();responseDataLock.unlock();}}',c);
    function call(msg,user='admin',room='test',opts={}){const replies=[];const reply=opts.reply||((s)=>replies.push(String(s)));const result=(opts.actual?c.response:c.probeReset)(room,msg,user,opts.group===undefined?true:opts.group,{reply},{},'com.kakao.talk');return {result,replies};}
    function choose(id,user='admin',args='',isDev=false){const prefix=isDev?'dev/':'';call(prefix+(isDev?'초기화':'/초기화'),user);const state=c.manualResetSessions[skey(user,isDev)];assert(state.choices.includes(id),id);return call(prefix+(state.choices.indexOf(id)+1)+(args?' '+args:''),user);}
    function read(name,isDev=false){return JSON.parse(c.FileStream.read((isDev?dev:root)+name));}
    return {h,c,root,dev,call,choose,read};
}
test('권한별 메뉴·번호 선택·대상 확인은 무저장, 1삭제 전에는 실제 콜백도 삭제 안 함',()=>{
    const f=fixture(),before=f.h.persist();const output=f.call('/초기화','admin','test',{actual:true}).replies[0];assert(output.includes('초기화 메뉴')&&output.includes('1삭제 / 2취소'));assert(!f.c.manualResetSessions[skey('admin')].choices.includes('diamonds'));const selection=f.choose('comments').replies[0];assert(selection.includes('일반 댓글: 2개')&&selection.includes('픽 댓글: 1개')&&selection.includes('정말 초기화'));assert.deepStrictEqual(f.h.persist(),before);
});
test('댓글 전체 삭제는 일반·픽·댓글 알림만 삭제, 피드·통계·방문·가구 보존',()=>{
    const f=fixture(),before=f.h.persist(),home=f.read('home.json'),activity=f.read('activity.json');f.choose('comments');assert(f.call('1삭제','admin','test',{actual:true}).replies[0].includes('초기화 완료'));assert.equal(f.read('comments.json').comments.owner.length,0);assert.equal(f.read('comments.json').pinnedComments.owner.length,0);assert.equal(f.read('comments.json').keep,true);assert.deepStrictEqual(f.read('home.json'),home);assert.deepStrictEqual(f.read('activity.json').recentVisitors,activity.recentVisitors);assert.deepStrictEqual(f.read('activity.json').petHomeSocial,activity.petHomeSocial);assert.deepStrictEqual(f.read('activity.json').alerts.owner.map(a=>a.type),['feed','visit']);assert.equal(f.h.persist().disk[f.root+'member.json'],before.disk[f.root+'member.json']);
});
test('피드 전체 삭제는 피드·이전 한줄평·피드 알림만 삭제, 댓글·누적값 유지',()=>{
    const f=fixture(),comments=f.read('comments.json');f.choose('feeds');f.call('1삭제','admin','test',{actual:true});const home=f.read('home.json').owner;assert.deepStrictEqual(home.feeds,[]);assert(!('comment' in home)&&!('commentTime' in home));assert.equal(home.visitCnt,7);assert.equal(home.likeCnt,8);assert.equal(home.furnitureBag.length,1);assert.deepStrictEqual(f.read('comments.json'),comments);assert.deepStrictEqual(f.read('activity.json').alerts.owner.map(a=>a.type),['comment','visit']);
});
test('1삭제 중복·확인 전 입력·2취소·재실행 0건은 삭제나 저장 중복 없음',()=>{
    const f=fixture(),before=f.h.persist();assert.equal(f.call('1삭제').replies.length,0);f.call('/초기화');assert(f.call('1삭제').replies[0].includes('먼저'));f.choose('comments');f.call('2취소');assert.deepStrictEqual(f.h.persist(),before);f.call('1삭제');assert.deepStrictEqual(f.h.persist(),before);f.choose('comments');f.call('1삭제');const done=f.h.persist();f.call('1삭제');assert.deepStrictEqual(f.h.persist(),done);f.choose('comments');let saves=0;const save=f.c.saveJsonFile;f.c.saveJsonFile=(...a)=>{saves++;return save(...a);};assert(f.call('1삭제').replies[0].includes('일반 댓글: 0개'));assert.equal(saves,0);
});
test('다른 사용자·방·그룹 응답은 무시하고 원래 대기는 유지',()=>{
    const f=fixture();f.choose('comments');const before=f.h.persist(),pending=clone(f.c.manualResetSessions);for(const [user,room,opts] of [['a','test',{}],['admin','room8',{}],['admin','test',{group:false}]]){assert.equal(f.call('1삭제',user,room,opts).replies.length,0);assert.equal(f.call('2취소',user,room,opts).replies.length,0);}assert.deepStrictEqual(f.h.persist(),before);assert.deepStrictEqual(clone(f.c.manualResetSessions),pending);f.call('1삭제');assert.equal(f.read('comments.json').comments.owner.length,0);
});
test('60초 정확한 만료·선택 만료·재컴파일 후 대기는 무효',()=>{
    for(const phase of ['menu','confirm']){const f=fixture();if(phase==='menu')f.call('/초기화');else f.choose('comments');const before=f.h.persist();f.h.advance(60000);assert(f.call(phase==='menu'?'1':'1삭제').replies[0].includes('만료'));assert.deepStrictEqual(f.h.persist().disk,before.disk);assert.equal(Object.keys(f.c.manualResetSessions).length,0);}
    const f=fixture();f.choose('comments');f.h.advance(59999);f.call('1삭제');assert.equal(f.read('comments.json').comments.owner.length,0);
    const old=fixture();old.choose('comments');const next=fixture(old.h.persist());const before=next.h.persist();assert.equal(next.call('1삭제').replies.length,0);assert.deepStrictEqual(next.h.persist(),before);
});
test('DEV 선택·확인·취소는 운영 세션과 저장소에 영향 없음',()=>{
    const f=fixture();f.choose('comments');f.choose('feeds','admin','',true);const before=f.h.persist();f.call('dev/1삭제');for(const p of Object.keys(before.disk).filter(p=>p.startsWith(f.root)))assert.equal(f.h.persist().disk[p],before.disk[p]);assert.equal(f.read('home.json',true).owner.feeds.length,0);assert(f.c.manualResetSessions[skey('admin')]);f.call('1삭제');assert.equal(f.read('comments.json').comments.owner.length,0);
});
test('확인 직전 권한·패스·소속 길드 변경은 취소',()=>{
    const f=fixture();f.choose('comments');f.c.Admins=[];const before=f.h.persist();assert(f.call('1삭제').replies[0].includes('사용 권한이 없습니다'));assert.deepStrictEqual(f.h.persist(),before);
    const pass=fixture();pass.choose('ownFeeds','a');pass.c.hasActiveHoiPassAccess=()=>false;assert(pass.call('1삭제','a').replies[0].includes('사용 권한이 없습니다'));
    const guild=fixture();guild.choose('guildBoard','master');const data=guild.h.read();data.member.master.guild.id='g2';guild.h.write(data);const state=guild.h.persist();state.disk[guild.root+'guild.json']=JSON.stringify({guilds:{g2:{master:'master'}}});const current=JSON.parse(state.disk[guild.root+'guild.json']);const originalRead=guild.c.loadJsonFile;guild.c.loadJsonFile=p=>p===guild.c.guildPath?current:originalRead(p);assert(guild.call('1삭제','master').replies[0].includes('길드가 변경'));
});
test('글자수 정확한 입력 외 기존 직접 명령·접미사는 메뉴 안내만 유지',()=>{
    const f=fixture(),entries=f.c.GLOBAL_CONFIG.manualReset.entries;assert.equal(entries.length,32);for(const entry of entries.filter(e=>!e.personal)){for(const msg of [entry.command,entry.command+' 1 해봐',entry.command+'방법']){if(entry.id==='textCleanup'&&msg===entry.command)continue;const before=f.h.persist();assert(f.call(msg,'호이 남','test',{actual:true}).replies[0].includes('통합되었습니다'));assert.deepStrictEqual(f.h.persist(),before);}}
});
test('기존 28종은 번호·확인 뒤 정확한 원래 명령으로 연결',()=>{
    for(const entry of fixture().c.GLOBAL_CONFIG.manualReset.entries.filter(e=>!e.personal&&!e.cleanup&&!['comments','feeds'].includes(e.id))){const f=fixture();const args=entry.args==='user'?'a':entry.args==='userCount'?'a 0':entry.args==='server'?'호1':'';f.choose(entry.id,'호이 남',args);const result=f.call('1삭제','호이 남').result;assert.equal(result.command,entry.command+(args?' '+args:''),entry.id);assert.equal(result.confirmed,result.command);assert.equal(f.call('1삭제','호이 남').result,undefined);}
});
test('대상·숫자·접미사 오류와 확인 중 항목 변경은 실행되지 않음',()=>{
    const f=fixture();f.call('/초기화','master');for(const msg of ['0','9999','1 해봐','1삭제 해봐','1삭제']){f.call(msg,'master');assert.equal(f.c.manualResetSessions[skey('master')].stage,'menu');}const s=f.c.manualResetSessions[skey('master')];let index=s.choices.indexOf('collection')+1;for(const arg of ['', '없는계정','a 해봐']){f.call(index+(arg?' '+arg:''),'master');assert.equal(s.stage,'menu');}f.choose('comments');assert(f.call('2').replies[0].includes('확인 중'));assert.equal(f.c.manualResetSessions[skey('admin')].entryId,'comments');
});
test('대상 입력의 탭과 선행 0 횟수는 기존 실행 분기에 맞게 정규화',()=>{
    const f=fixture();f.choose('castleCount','호이 남','a\t0002');assert.equal(f.call('1삭제','호이 남').result.command,'/캐슬대전횟수리셋 a 2');
});
test('미리보기 후 새로 생긴 댓글도 확인 시 최신 데이터로 정리',()=>{
    const f=fixture();f.choose('comments');const read=f.c.loadJsonFile;f.c.loadJsonFile=p=>{const d=read(p);if(p===f.c.petHomeCommentsFile)d.comments.owner.push({text:'추가',from:'a',time:5});return d;};assert(f.call('1삭제').replies[0].includes('일반 댓글: 3개'));
});
test('댓글/피드 각각 두 저장 지점 실패 시 원복·확인 소비·새 요청으로 재시도',()=>{
    for(const id of ['comments','feeds'])for(const failure of [id==='comments'?'comments.json':'home.json','activity.json']){const f=fixture();f.choose(id);const before=f.h.persist();f.h.failWrite((_d,p)=>p===f.root+failure);assert.throws(()=>f.call('1삭제'));for(const name of ['comments.json','home.json','activity.json'])assert.equal(f.h.persist().disk[f.root+name],before.disk[f.root+name]);assert(!f.c.manualResetSessions[skey('admin')]);f.choose(id);f.call('1삭제');assert.equal(id==='comments'?f.read('comments.json').comments.owner.length:f.read('home.json').owner.feeds.length,0);}
});
test('누락·파싱·후반 형식 오류는 저장 없이 중단하고 대기 제거',()=>{
    for(const invalid of ['missing','json','shape']){const seed=fixture().h.persist();if(invalid==='missing')delete seed.disk['/sdcard/호이랜드/activity.json'];if(invalid==='json')seed.disk['/sdcard/호이랜드/activity.json']='{';if(invalid==='shape')seed.disk['/sdcard/호이랜드/activity.json']='{"alerts":[]}';const f=fixture(seed);f.call('/초기화');const before=f.h.persist();assert.throws(()=>f.call('1'));assert.deepStrictEqual(f.h.persist(),before);assert(!f.c.manualResetSessions[skey('admin')]);}
});
test('확인 직전 회원·길드 읽기 실패도 확인 대기를 취소하고 저장하지 않음',()=>{
    for(const name of ['filePath','guildPath']){const f=fixture();f.choose('comments');const before=f.h.persist(),read=f.c.loadJsonFile;f.c.loadJsonFile=p=>{if(p===f.c[name])throw Error('invalid required data');return read(p);};assert.throws(()=>f.call('1삭제'));assert.deepStrictEqual(f.h.persist(),before);assert(!f.c.manualResetSessions[skey('admin')]);}
});
test('예고 응답 실패는 대기 취소·완료 응답 실패는 확정 삭제 유지',()=>{
    const f=fixture();assert.throws(()=>f.call('/초기화','admin','test',{reply(){throw Error('reply');}}));assert(!f.c.manualResetSessions[skey('admin')]);f.choose('comments');f.c.debuggerLog=()=>{throw Error('log');};f.call('1삭제','admin','test',{reply(){throw Error('reply');}});assert.equal(f.read('comments.json').comments.owner.length,0);assert(!f.c.manualResetSessions[skey('admin')]);
});
test('메뉴 권한은 본인·길드 부길마까지 기존 역할 유지, 마스터 명단은 MASTER 전용',()=>{
    const f=fixture();f.call('/초기화','a');assert.deepStrictEqual(clone(f.c.manualResetSessions[skey('a')].choices),['ownFeeds']);f.call('/초기화','master');assert(f.c.manualResetSessions[skey('master')].choices.includes('guildBoard'));f.call('/초기화','admin');assert(!f.c.manualResetSessions[skey('admin')].choices.includes('masters'));assert(!f.c.manualResetSessions[skey('admin')].choices.includes('guildBoard'));
});
test('배타 잠금·필터 자기 차단 제외·정기 리셋과 별도 정리 명령은 경로 유지',()=>{
    const f=fixture();for(const msg of ['/초기화','1','1 a','1삭제','2취소','dev/1삭제','/인형전체초기화','/필터데이터정리'])assert(f.c.isExclusiveDataMutationCommandMessage(msg),msg);for(const msg of ['/리셋','/주기리셋','/알림리셋','!알림초기화','/주간일퀘','/데이터정리','/레벨리뉴얼적용','/펫홈소셜뱃지마이그레이션'])assert(!f.c.isManualResetLegacyCommand(msg),msg);f.c.setMessageFilterCache(['초기화','삭제'],'PROD',true);f.choose('comments');f.call('1삭제');assert.equal(f.read('comments.json').comments.owner.length,0);
});
test('Info는 메뉴·선택·응답에서 데이터 읽기나 중복 응답 없이 반환',()=>{
    const f=fixture(),start=f.h.info.indexOf('if (getMessageFilterRequest(msg))'),end=f.h.info.indexOf('if (ctx.isDev) {',start),c={GLOBAL_CONFIG:{manualReset:{commands:[...new Set(f.c.GLOBAL_CONFIG.manualReset.entries.filter(e=>!e.personal).map(e=>e.command).concat(f.c.GLOBAL_CONFIG.manualReset.directOperations.map(e=>e.command)))]}},getMessageFilterRequest:()=>null,containsMessageFilterWord:()=>{throw Error('no filter');},getCachedMessageFilterWords:()=>{throw Error('no read');}};vm.createContext(c);vm.runInContext('function check(msg,isDev){var ctx={isDev:isDev};'+f.h.info.slice(start,end)+'return "passed";}',c);for(const msg of ['/초기화','/댓글초기화','/피드초기화','1','3 a','1삭제','2취소'])assert.equal(c.check(msg,false),undefined);assert.equal(c.check('/1삭제',true),undefined);
});
test('초기화 대기 없는 일반 숫자·다른 방의 숫자는 원래 명령 흐름으로 통과',()=>{
    const f=fixture();assert.equal(f.call('123','a').result.command,'123');assert.equal(f.call('dev/123','a').result.command,'/123');f.call('/초기화');assert.equal(f.call('1','admin','room8').result.command,'1');assert.equal(f.c.manualResetSessions[skey('admin')].stage,'menu');
});
test('첫 파일 저장 직후 강제 종료한 스냅샷은 새 메뉴에서 남은 알림만 정리',()=>{
    const f=fixture();f.choose('comments');let interrupted;const save=f.c.saveJsonFile;f.c.saveJsonFile=(...a)=>{save(...a);if(a[1]===f.c.petHomeCommentsFile){interrupted=f.h.persist();throw Error('simulated process stop');}};assert.throws(()=>f.call('1삭제'));assert(interrupted);const next=fixture(interrupted);assert.equal(next.call('1삭제').replies.length,0);next.choose('comments');const reply=next.call('1삭제').replies[0];assert(reply.includes('일반 댓글: 0개')&&reply.includes('관련 알림: 1개'));assert.deepStrictEqual(next.read('activity.json').alerts.owner.map(a=>a.type),['feed','visit']);assert.equal(next.read('activity.json').petHomeSocial.owner.stats.receivedComments,20);
});
if (require.main === module) console.log('PASS reset menu: '+groups+' groups (synthetic only)');
module.exports = {fixture, records};
