const assert = require('assert'), vm = require('vm');
const { createFixture } = require('./test_server_raid_delivery.js');
const clone = value => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(name, run) { run(); console.log('PASS cleanup ' + (++groups) + ': ' + name); }
// 합성 기록만으로 실제 콜백·저장·복구 흐름을 검증한다.
function records() {
    const title = { title: { list: [{name:'禁止先',price:1},{name:'残す',price:2},{name:'禁止後',price:3}], num:2 }, keep:true };
    return [
        {comments:{owner:[{text:'禁止文',from:'actor',time:1},{text:'通常',from:'actor',time:2}]}, pinnedComments:{owner:[{text:'禁止文',from:'actor',time:1,pinnedAt:3}]}},
        {owner:{feeds:[{id:'1',content:'禁止文',createdAt:1},{id:'2',content:'通常',createdAt:2}],comment:'禁止旧文',commentTime:1,furnitureBag:[{name:'禁止家具'}],guestComments:['禁止旧コメント']}},
        {member:{owner:clone(title), other:{title:{list:[{name:'禁止選択'},{name:'残す'}],num:1}}}},
        {member:{owner:clone(title)}},
        {alerts:{owner:[{type:'comment',commentPreview:'禁止文',actorId:'actor'},{type:'feed',feedContent:'禁止文',feedId:'1'},{type:'comment',commentPreview:'通常'},{type:'visit',actorName:'禁止名前'}]},recentVisitors:{owner:[{visitorId:'actor'}]},petHomeSocial:{owner:{stats:{receivedComments:99}}}}
    ];
}
// 식별 정보 없는 가상 디스크를 운영·DEV 환경별로 준비한다.
function fixture(saved) {
    let h = createFixture(saved);
    const root = h.c.DATA_ROOT_PATH, names = ['comments.json','home.json','titles.json','petTitles.json','activity.json'];
    if (!saved) {
        const disk = h.persist();
        for (const prefix of [root,h.c.DEV_DATA_ROOT_PATH]) records().forEach((d,i) => disk.disk[prefix + names[i]] = JSON.stringify(d));
        h = createFixture(disk);
    }
    const c=h.c;
    Object.assign(c,{petHomeCommentsFile:root+names[0],memberTitlePath:root+names[2],petTitlePath:root+names[3],petHomeActivityFile:root+names[4]});
    vm.runInContext(h.block(h.main,'function cleanupMessageFilterData('),c);
    vm.runInContext(h.block(h.main,'function isAdmin('),c);
    const start=h.main.indexOf('function response('),end=h.main.indexOf('// 확인 응답도',start);
    vm.runInContext(h.main.slice(start,end).replace('function response(','function probeCleanup(')+'return "passed";}catch(error){rollbackDataSaveTransaction();throw error;}finally{if(commandContextEntered)exitCommandContext(prevCtx);if(dataSaveTransactionEntered)endDataSaveTransaction();if(responseTransactionAcquired)dataTransactionLock.unlock();responseDataLock.unlock();}}',c);
    c.setMessageFilterCache(['禁止'],'PROD',true); c.setMessageFilterCache(['禁止'],'DEV',true);
    function rawCall(msg,user='admin',room='test',reply,actual=false) {
        const replies=[];const result=(actual?c.response:c.probeCleanup)(room,msg,user,true,{reply:reply||((s)=>replies.push(String(s)))},{},'com.kakao.talk');return {result,replies};
    }
    function call(msg='/필터데이터정리',user='admin',room='test',reply,actual=false) {
        const dev=msg==='dev/필터데이터정리';
        if(msg!=='/필터데이터정리'&&!dev)return rawCall(msg,user,room,reply,actual);
        rawCall(dev?'dev/초기화':'/초기화',user,room);
        const state=c.manualResetSessions[(dev?'DEV:':'PROD:')+user];
        assert(state&&state.choices.includes('filterCleanup'),'filter cleanup permission');
        rawCall((dev?'dev/':'')+(state.choices.indexOf('filterCleanup')+1),user,room);
        return rawCall((dev?'dev/':'')+'1삭제',user,room,reply,actual);
    }
    function read(i,dev=false) { return JSON.parse(c.FileStream.read((dev?c.DEV_DATA_ROOT_PATH:root)+names[i])); }
    return {h,c,call,rawCall,read,names,root};
}
test('댓글·픽·피드·이전 한줄평·일반/펫 타이틀·알림 정리와 무관 데이터 보존',()=>{
    const f=fixture(),before=records();const output=f.call(undefined,undefined,undefined,undefined,true).replies[0];assert(output.includes('댓글: 1개')&&output.includes('홈알림: 2개'));
    const comments=f.read(0);assert.equal(comments.comments.owner.length,1);assert.equal(comments.pinnedComments.owner.length,0);
    const home=f.read(1).owner;assert.equal(home.feeds.length,1);assert.equal(home.feeds[0].id,'2');assert(!('comment' in home));assert(!('commentTime' in home));assert.deepStrictEqual(home.furnitureBag,before[1].owner.furnitureBag);assert.deepStrictEqual(home.guestComments,before[1].owner.guestComments);
    for(const i of [2,3]){assert.equal(f.read(i).member.owner.title.num,1);assert.equal(f.read(i).member.owner.title.list[0].name,'残す');assert.equal(f.read(i).member.owner.keep,true);}
    assert.equal(f.read(2).member.other.title.num,null);const activity=f.read(4);assert.equal(activity.alerts.owner.length,2);assert.deepStrictEqual(activity.recentVisitors,before[4].recentVisitors);assert.deepStrictEqual(activity.petHomeSocial,before[4].petHomeSocial);
});
test('정확한 명령·방별 권한·MASTER·배타 잠금·필터 자기 차단 예외',()=>{
    const f=fixture(),before=f.h.persist();for(const [user,room] of [['a','test'],['unassigned','test'],['admin','room8']]){f.rawCall('/초기화',user,room);const state=f.c.manualResetSessions['PROD:'+user];assert(!state||!state.choices.includes('filterCleanup'));assert.deepStrictEqual(f.h.persist(),before);}
    for(const msg of ['/필터데이터정리','/필터데이터정리 1','/필터데이터정리방법']){assert(f.rawCall(msg).replies[0].includes('통합되었습니다'));assert.deepStrictEqual(f.h.persist(),before);}
    assert(f.c.isExclusiveDataMutationCommandMessage('/필터데이터정리'));assert(f.c.isExclusiveDataMutationCommandMessage('dev/필터데이터정리'));assert(f.c.isExclusiveDataMutationCommandMessage('/필터데이터정리 1'));
    f.c.setMessageFilterCache(['필터','禁止'],'PROD',true);assert(f.call(undefined,'master').replies[0].includes('완료'));
});
test('빈 필터 확인 후에는 정리 대상 파일 읽기·저장 없음',()=>{
    const f=fixture();f.c.setMessageFilterCache([],'PROD',true);const reads=[];const read=f.c.loadJsonFile;f.c.loadJsonFile=(p,...a)=>{reads.push(p);return read(p,...a);};const before=f.h.persist();assert(f.call().replies[0].includes('등록된 필터가 없어'));assert(reads.every(p=>p===f.c.filePath||p===f.c.guildPath));assert.deepStrictEqual(f.h.persist(),before);
});
test('재실행은 0건·무저장·필터는 제거하지 않음',()=>{
    const f=fixture();f.call();const before=f.h.persist();let saves=0;const save=f.c.saveJsonFile;f.c.saveJsonFile=(...a)=>{saves++;return save(...a);};const output=f.call().replies[0];assert(output.includes('댓글: 0개'));assert.equal(saves,0);assert.deepStrictEqual(f.h.persist(),before);assert.deepStrictEqual(clone(f.c.getCachedMessageFilterWords(false)),['禁止']);
});
test('DEV 정리는 DEV 파일만 수정·운영 파일 무변경',()=>{
    const f=fixture(),before=f.h.persist().disk;f.call('dev/필터데이터정리');for(const p of Object.keys(before).filter(p=>p.startsWith(f.root)))assert.equal(f.h.persist().disk[p],before[p]);assert.equal(f.read(0,true).comments.owner.length,1);assert.equal(f.read(0).comments.owner.length,2);
});
test('다섯 저장 지점 각각 실패 시 앞서 저장한 파일까지 원복·재시도 성공',()=>{
    for(let index=0;index<5;index++){const f=fixture(),before=f.names.map((_,i)=>f.read(i));f.h.failWrite((_data,p)=>p===f.root+f.names[index]);assert.throws(()=>f.call());for(let i=0;i<5;i++)assert.deepStrictEqual(f.read(i),before[i]);f.call();assert.equal(f.read(0).comments.owner.length,1);assert.equal(f.read(4).alerts.owner.length,2);}
});
test('누락·잘못된 JSON과 후반 구조 오류는 쓰기 전에 실패',()=>{
    for(const bad of ['missing','json','shape']){const initial=fixture(),saved=initial.h.persist(),p=initial.root+initial.names[4];if(bad==='missing')delete saved.disk[p];if(bad==='json')saved.disk[p]='{broken';if(bad==='shape')saved.disk[p]='{"alerts":[]}';const f=fixture(saved),before=f.h.persist();assert.throws(()=>f.call());assert.deepStrictEqual(f.h.persist(),before);}
});
test('본문 외 작성자·닉네임·가격·메타데이터는 비교하지 않음',()=>{
    const f=fixture();const stores=records();for(const map of [stores[0].comments,stores[0].pinnedComments])map.owner.forEach(row=>{row.text='通常';row.from='禁止作者';});stores[1].owner.feeds.forEach(row=>row.content='通常');stores[1].owner.comment='通常';for(const store of stores.slice(2,4))for(const u of Object.values(store.member))u.title.list.forEach(t=>{t.name='通常';t.memo='禁止';});stores[4].alerts.owner= [{type:'visit',actorName:'禁止名前'}];const before=clone(stores);const r=f.c.cleanupMessageFilterData(stores,['禁止']);assert.deepStrictEqual(clone(r.changed),[false,false,false,false,false]);assert.deepStrictEqual(stores,before);
});
test('타이틀 선택 상태·같은 이름 다른 개체·삭제 전후 번호 보정',()=>{
    for(const num of [null,0,undefined,1,2,3,99,'2']){const f=fixture(),stores=records();stores[2].member={owner:{title:{list:[{name:'禁止'},{name:'同名',price:1},{name:'同名',price:2}],num}}};f.c.cleanupMessageFilterData(stores,['禁止']);const t=stores[2].member.owner.title;assert.equal(t.num,num==null||num===0?num:(Number(num)===2?1:Number(num)===3?2:null));assert.equal(t.list.length,2);}
});
test('정규식 기호·대소문자·긴 문구·이모지와 한 행 다중 일치는 한 번 제거',()=>{
    const f=fixture(),stores=records();stores[0].comments.owner=[{text:'a.b✨'},{text:'axb✨'},{text:'ABC'},{text:'긴'.repeat(80)+'禁止'}];const r=f.c.cleanupMessageFilterData(stores,['a.b','✨','abc','禁止']);assert.equal(r.comments,3);assert.equal(stores[0].comments.owner[0].text,'ABC');
});
test('완료 응답/로그 실패는 확정 저장을 되돌리지 않고 새 VM 재실행도 무중복',()=>{
    const f=fixture();f.c.debuggerLog=()=>{throw Error('log');};f.call(undefined,undefined,undefined,()=>{throw Error('reply');});assert.equal(f.read(0).comments.owner.length,1);const next=fixture(f.h.persist());assert(next.call().replies[0].includes('댓글: 0개'));
});
test('메뉴·선택은 정리 파일을 읽거나 저장하지 않고 확인 시 최신 필터로 처리',()=>{
    const f=fixture(),before=f.h.persist();const reads=[],read=f.c.loadJsonFile;f.c.loadJsonFile=(p,...args)=>{reads.push(p);return read(p,...args);};
    f.rawCall('/초기화');const choices=f.c.manualResetSessions['PROD:admin'].choices;const output=f.rawCall(String(choices.indexOf('filterCleanup')+1)).replies[0];
    assert(output.includes('확인 시점의 등록 필터'));assert(reads.every(p=>p===f.c.filePath||p===f.c.guildPath));assert.deepStrictEqual(f.h.persist(),before);
    f.c.setMessageFilterCache(['通常'],'PROD',true);f.rawCall('1삭제');assert.equal(f.read(0).comments.owner.length,1);assert.equal(f.read(0).comments.owner[0].text,'禁止文');assert.equal(f.read(0).pinnedComments.owner.length,1);assert.equal(f.read(1).owner.feeds[0].content,'禁止文');
});
test('필터 정리의 취소·만료·권한 상실·재컴파일은 확인 대기와 함께 무삭제',()=>{
    for(const mode of ['cancel','expire','role','restart']){const f=fixture();f.rawCall('/초기화');const choices=f.c.manualResetSessions['PROD:admin'].choices;f.rawCall(String(choices.indexOf('filterCleanup')+1));const before=f.h.persist();
        if(mode==='cancel')f.rawCall('2취소');if(mode==='expire')f.h.advance(60000);if(mode==='role')f.c.Admins=[];
        if(mode==='restart'){const next=fixture(before);next.rawCall('1삭제');assert.deepStrictEqual(next.h.persist(),before);}else{f.rawCall('1삭제');assert.deepStrictEqual(f.h.persist().disk,before.disk);assert(!f.c.manualResetSessions['PROD:admin']);}
    }
});
test('Info는 정리 명령에서 데이터 읽기 전에 종료',()=>{
    const f=fixture(),start=f.h.info.indexOf('if (getMessageFilterRequest(msg))'),end=f.h.info.indexOf('if (ctx.isDev)',start),ic={getMessageFilterRequest:()=>null,containsMessageFilterWord:()=>{throw Error('must bypass');},getCachedMessageFilterWords:()=>{throw Error('must bypass');}};vm.createContext(ic);vm.runInContext('function check(msg){var ctx={isDev:false};'+f.h.info.slice(start,end)+'return "passed";}',ic);assert.equal(ic.check('/필터데이터정리'),undefined);
});
console.log('PASS filter data cleanup: '+groups+' groups (synthetic only)');
