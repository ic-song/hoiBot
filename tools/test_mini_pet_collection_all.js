// 실제 전체등록·수동등록·자동 강화·4개 저장을 합성 파일시스템으로 검증한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const { block } = require('./test_spirit_retirement');
const helperNames = ['selectMiniPetCollectionLowest','isMiniPetCollectionGradeAllowed','createMiniPetCollectionRegistered','normalizeMiniPetCollectionRegistered',
    'sanitizeMiniPetCollectionData','ensureMiniPetCollection','isMiniPetCollectionSeasonOneComplete','getMiniPetCollectionSeasonOneEndMessage',
    'buildMiniUpgradeProbabilityTable','buildMiniUpgradeCostTable','buildMiniUpgradeCharmTable','getMiniPetUpgradeMaxLevel','getMiniPetCollectionAutoUpgradePlan',
    'tryAutoUpgradeMiniPetForCollection','findBestMiniBoostItem','isElite','isMasterMiniPet','getCharmGainFor','ensureTitleUser','addTitle',
    'normalizePendantTransitionItemName','normalizeUniversalCollectionKeyBagItems','normalizePendantTransitionBagItem','addItem','hasItem','removeItem','isSafePointValue','roundToTwo','addPoint'];
const route = main.slice(main.indexOf('                var miniPetAllKey = '),main.indexOf('                if (msg === "/펫스킬컬렉션")')) + main.slice(main.indexOf('                if (msg === "/미니펫컬렉션전체등록")'), main.indexOf('                if (msg === "등록" && !miniPetAllConfirmed'));
const commands = route + ['if (/^\\/미니펫컬렉션등록(?:\\s+\\d+)+$/.test(msg)) {','if (msg === "등록") {',
    'if (msg === "ㄴㄴ" && userState[sender] && userState[sender].miniPetCollection)', 'if (/^\\/미니펫컬렉션만능(?:\\s+\\d+)+$/.test(msg)) {'].map(m => block(main,m)).join('\n');
const tableSetup = main.slice(main.indexOf('var MINIPET_MAX_LV = '), main.indexOf('\n', main.indexOf('var MINI_CHARM_OTHER = ')));
const gradesSource = main.match(/const MINI_PET_COLLECTION_ALLOWED_GRADES = \[[^\n]+\];/)[0].replace('const ', 'var ');
const root = '/sdcard/호이랜드/';
function createHarness() {
    const source = fs.readFileSync(path.join(__dirname, 'test_server_raid.js'), 'utf8');
    const f = new Function('require','__dirname',source.slice(0,source.indexOf('\ngroup("'))+`\nreturn {c,reset,read,write,raw:p=>disk[p],get:p=>JSON.parse(disk[p]),put:(p,v)=>disk[p]=JSON.stringify(v),files:()=>JSON.stringify(disk),
      replies:()=>replies,traces:()=>traces,clear:()=>{replies=[];traces=[];},advance:ms=>now+=ms,fail:p=>failWrite=(_d,target)=>target===p,replyFail:v=>replyFailure=v,putRaw:(p,t)=>disk[p]=t,remove:p=>delete disk[p]};`)(require,__dirname);
    const c = f.c;
    for (const name of helperNames) vm.runInContext(block(main,'function '+name+'('),c);
    vm.runInContext(gradesSource+'\n'+tableSetup,c);
    c.miniPetCollectionPath=root+'miniPet_collection.json';c.miniPetTitlePath=root+'miniPet_title.json';
    c.hasPetSkill=()=>false;c.getMiniPetBagLimit=()=>15;c.miniPetData={gradeTable:[]};c.castleSiegeFlag=false;
    c.miniPetCollectionInfo={gradeReward:{},stageReward:{},titles:{}};
    for (const grade of c.MINI_PET_COLLECTION_ALLOWED_GRADES) c.miniPetCollectionInfo.gradeReward[grade]={item:'등급보상',count:1};
    for (let stage=1;stage<=80;stage++){c.miniPetCollectionInfo.stageReward[String(stage)]={item:'단계보상',count:1};c.miniPetCollectionInfo.titles[String(stage)]={name:'합성 타이틀 '+stage,price:0};}
    vm.runInContext('function collectionCommands(){'+commands+'}',c);
    function seed({bag=[],stage=1,registered=[],point=1000000000000,stone=1000000,dev=false}={}) {
        f.reset();c.userState={};c.miniPetCollectionAllPending={};
        for (const base of [root,'/sdcard/호이랜드_dev/']) {
            const d=f.get(base+'member.json');d.member.a.point=point;d.member.a.bag['미니펫 강화석💫']=stone;f.put(base+'member.json',d);
            const p=f.get(base+'member_pet.json');p.a.miniPetBag=JSON.parse(JSON.stringify(bag));p.a.miniPet={name:'장착펫',grade:'창조',battleExp:1};f.put(base+'member_pet.json',p);
            const progress={stage,completedStage:stage-1,registered:{}};for(const g of c.MINI_PET_COLLECTION_ALLOWED_GRADES)progress.registered[g]=registered.includes(g);
            f.put(base+'miniPet_collection.json',{member:{a:{collection:progress}}});f.put(base+'miniPet_title.json',{});
        }
        c.Math=vm.runInContext('Math',c);c.Math.random=()=>0;f.clear();return dev?'/sdcard/호이랜드_dev/':root;
    }
    function run(message,user='a',dev=false,room='test',group=true) {
        f.clear();const ctx=c.createCommandContext(dev,room),previous=c.enterCommandContext(ctx);c.beginDataSaveTransaction();
        Object.assign(c,{ctx,msg:message,sender:user,room,isGroupChat:group});
        if(message.startsWith('dev/'))c.msg=c.stripDevCommandPrefix(message);
        try{c.data=c.loadJsonFile(c.filePath);c.petData=c.loadJsonFile(c.memberPetPath);c.petSkillData={};c.guildData={};c.collectionCommands();}
        catch(e){c.rollbackDataSaveTransaction();throw e;}finally{c.endDataSaveTransaction();c.exitCommandContext(previous);}
        return f.replies().join('\n');
    }
    return {f,c,seed,run};
}
const pet=(name,grade='창조',battleExp=10,upgrade=0)=>({name,grade,battleExp,castleExp:battleExp,raidExp:battleExp,upgrade});
function checks(){
    const h=createHarness(),{f,c,seed,run}=h;let groups=0;
    function test(name,fn){fn();console.log('PASS MINI COLLECTION '+(++groups)+' '+name);}
    test('3000개 전체 순회·빈 등급별 최저 매력·동률 가방 순서·미등록/장착 제외·미리보기 무저장',()=>{
        const grades=Array.from(c.MINI_PET_COLLECTION_ALLOWED_GRADES),bag=Array.from({length:3000},(_,i)=>pet('합성'+i,grades[i%8],10000-i,3));
        bag[2]=pet('최저 먼저','태초+',1,2);bag[10]=pet('동률 나중','태초+',1,9);seed({bag,stage:2,registered:['창조']});const before=f.files();
        const out=run('/미니펫컬렉션전체등록');assert(out.includes('자동 선택 7마리'));assert(out.includes('최저 먼저'));assert(!out.includes('동률 나중'));assert(!out.includes('장착펫'));assert.equal(f.files(),before);
        const selected=c.miniPetCollectionAllPending['PROD:a'].selectedList;assert.equal(selected.length,7);assert(!selected.some(p=>p.grade==='창조'));
        for(const picked of selected)assert.equal(picked.battleExp,Math.min(...bag.filter(p=>p.grade===picked.grade).map(p=>p.battleExp)));
        assert.equal(f.traces().filter(t=>t.type==='load'&&t.path===c.miniPetCollectionPath).length,1);assert.equal(f.traces().filter(t=>t.type==='save').length,0);
    });
    test('현재 단계 8등급만 소비·다음 단계 중복 개체 보존·단계/등급/타이틀 보상 각1회',()=>{
        const bag=Array.from(c.MINI_PET_COLLECTION_ALLOWED_GRADES).flatMap((g,i)=>[pet('선택'+i,g,10,2),pet('보존'+i,g,20,2)]);seed({bag});run('/미니펫컬렉션전체등록');const out=run('등록');
        assert(out.includes('등록 성공✅ [8개]'));const saved=f.get(c.memberPetPath).a;assert.equal(saved.miniPetBag.length,8);assert(saved.miniPetBag.every(p=>p.name.startsWith('보존')));assert.equal(saved.miniPet.name,'장착펫');
        const row=f.get(c.miniPetCollectionPath).member.a.collection;assert.equal(row.stage,2);assert.equal(row.completedStage,1);assert(Object.values(row.registered).every(x=>!x));
        assert.equal(f.read().member.a.bag['등급보상'],8);assert.equal(f.read().member.a.bag['단계보상'],1);assert.equal(f.get(c.miniPetTitlePath).member.a.title.list.length,1);
        for(const p of [c.filePath,c.memberPetPath,c.miniPetCollectionPath,c.miniPetTitlePath])assert.equal(f.traces().filter(t=>t.type==='save'&&t.path===p).length,1);
        const after=f.files();run('등록');assert.equal(f.files(),after);
    });
    test('기존 자동 강화의 포인트·강화석·매력 증가와 낮은 단계 보조 아이템 미사용',()=>{
        seed({bag:[pet('자동강화')],stage:3});const before=f.read().member.a.point;run('/미니펫컬렉션전체등록');const out=run('등록');assert(out.includes('자동 강화 후 등록 완료'));
        assert.equal(f.read().member.a.point,before-30000000);assert.equal(f.read().member.a.bag['미니펫 강화석💫'],1000000-6);assert.equal(f.get(c.memberPetPath).a.miniPetBag.length,0);
    });
    test('강화 확률 실패·보조 아이템은 기존 확률/소모 규칙 적용',()=>{
        seed({bag:[pet('확률','창조',10,49)],stage:50,point:100000000,stone:1000});const d=f.read();d.member.a.bag['미니펫강화확률UP🐷(30%)']=2;f.write(d);
        let random=0;c.Math.random=()=>random++===0?0.99:0;run('/미니펫컬렉션전체등록');const out=run('등록');assert(out.includes('자동 강화 후 등록 완료'));assert.equal(f.read().member.a.point,80000000);assert.equal(f.read().member.a.bag['미니펫 강화석💫'],900);assert.equal(f.read().member.a.bag['미니펫강화확률UP🐷(30%)']||0,0);
    });
    test('강화 재료 부족은 등록 실패·다른 후보로 임의 대체하지 않음',()=>{
        seed({bag:[pet('최저','창조',1,0),pet('높은매력','창조',100,5)],stage:3,point:0,stone:0});const before=f.files();run('/미니펫컬렉션전체등록');assert(run('등록').includes('부족'));assert.equal(f.files(),before);
    });
    test('가방 순서/개체/매력/수량 변경·컬렉션 변경은 전체 취소 무소모',()=>{
        for(const mutate of [()=>{const p=f.get(c.memberPetPath);p.a.miniPetBag.reverse();f.put(c.memberPetPath,p);},()=>{const p=f.get(c.memberPetPath);p.a.miniPetBag[0].name='교체';f.put(c.memberPetPath,p);},()=>{const p=f.get(c.memberPetPath);p.a.miniPetBag.push(pet('추가'));f.put(c.memberPetPath,p);},()=>{const d=f.get(c.miniPetCollectionPath);d.member.a.collection.registered['태초']=true;f.put(c.miniPetCollectionPath,d);}]){
            seed({bag:[pet('선택'),pet('보존','창조',20)]});run('/미니펫컬렉션전체등록');mutate();const before=f.files();assert(run('등록').includes('변경'));assert.equal(f.files(),before);run('등록');assert.equal(f.files(),before);
        }
    });
    test('취소·만료·다른 방/유저/채팅 유형·재시작은 무소모',()=>{
        seed({bag:[pet('선택')]});const before=f.files();run('/미니펫컬렉션전체등록');run('등록','b');run('등록','a',false,'other');run('등록','a',false,'test',false);assert.equal(f.files(),before);assert(run('ㄴㄴ').includes('취소'));
        run('/미니펫컬렉션전체등록');f.advance(60000);assert(run('등록').includes('시간이 지났'));assert.equal(f.files(),before);
        run('/미니펫컬렉션전체등록');c.miniPetCollectionAllPending={};run('등록');assert.equal(f.files(),before);
    });
    test('정확 명령만 실행·실행/확인/취소는 쓰기 잠금',()=>{
        seed({bag:[pet('선택')]});const before=f.files();for(const m of ['/미니펫컬렉션전체등록 1','/미니펫컬렉션전체등록 해봐','/미니펫컬렉션전체등록방법','/미니펫컬렉션전체등록\n','등록 해봐']){run(m);assert.equal(f.files(),before);assert.equal(Object.keys(c.miniPetCollectionAllPending).length,0);}
        for(const m of ['/미니펫컬렉션전체등록','등록','ㄴㄴ','dev/미니펫컬렉션전체등록','dev/등록'])assert(c.isExclusiveDataMutationCommandMessage(m));
    });
    test('DEV와 PROD 대기·실제 저장 완전 분리',()=>{
        seed({bag:[pet('선택')]});run('/미니펫컬렉션전체등록');run('dev/미니펫컬렉션전체등록','a',true);assert(c.miniPetCollectionAllPending['PROD:a']&&c.miniPetCollectionAllPending['DEV:a']);
        const prod=[c.filePath,c.memberPetPath,c.miniPetCollectionPath,c.miniPetTitlePath].map(p=>f.raw(p));assert(run('dev/등록','a',true).includes('등록 완료'));
        assert.deepEqual([c.filePath,c.memberPetPath,c.miniPetCollectionPath,c.miniPetTitlePath].map(p=>f.raw(p)),prod);assert.equal(f.get('/sdcard/호이랜드_dev/member_pet.json').a.miniPetBag.length,0);assert(run('등록').includes('등록 완료'));
    });
    test('4개 저장 각각 실패하면 원문 롤백·재선택 없이 중복 소비 없음',()=>{
        const paths=[c.filePath,c.memberPetPath,c.miniPetCollectionPath,c.miniPetTitlePath];
        for(const p of paths){seed({bag:[pet('선택')]});run('/미니펫컬렉션전체등록');const before=paths.map(p=>f.raw(p));f.fail(p);assert.throws(()=>run('등록'));assert.deepEqual(paths.map(p=>f.raw(p)),before);run('등록');assert.deepEqual(paths.map(p=>f.raw(p)),before);}
    });
    test('빈 가방·비허용 등급·시즌80완료는 소모/미리보기 저장 없음',()=>{
        for(const bag of [[],[pet('일반','일반')],[pet('엘리트','엘리트')]]){seed({bag});const before=f.files();assert(run('/미니펫컬렉션전체등록').includes('없습니다'));assert.equal(f.files(),before);}
        seed({bag:[pet('잔여')],stage:81});const before=f.files();assert(run('/미니펫컬렉션전체등록').includes('시즌1 종료'));assert.equal(f.files(),before);
    });
    test('80단계 마지막 빈칸만 소비·시즌 종료 후 추가 소비 없음',()=>{
        seed({bag:[pet('마지막','창조',1,80),pet('보존','창조',2,80)],stage:80,registered:Array.from(c.MINI_PET_COLLECTION_ALLOWED_GRADES).slice(1)});run('/미니펫컬렉션전체등록');assert(run('등록').includes('시즌1 종료'));assert.equal(f.get(c.memberPetPath).a.miniPetBag.length,1);const before=f.files();run('/미니펫컬렉션전체등록');assert.equal(f.files(),before);
    });
    test('수동/만능 등록은 기존 방식 유지·전체등록 대기와 충돌 없음',()=>{
        seed({bag:[pet('수동','창조',10,3)]});run('/미니펫컬렉션전체등록');run('/미니펫컬렉션등록 1');assert(!c.miniPetCollectionAllPending['PROD:a']);assert(run('등록').includes('등록 성공✅ [1개]'));
        seed();const d=f.read();d.member.a.bag[c.GLOBAL_CONFIG.universalBox.miniPetKeyItemName]=1;f.write(d);run('/미니펫컬렉션만능 1');assert(run('등록').includes(c.GLOBAL_CONFIG.universalBox.miniPetKeyItemName));assert.equal(f.read().member.a.bag[c.GLOBAL_CONFIG.universalBox.miniPetKeyItemName]||0,0);
        seed({bag:[pet('선택')]});run('/미니펫컬렉션전체등록');run('/펫스킬컬렉션등록 1');assert(!c.miniPetCollectionAllPending['PROD:a']);
        assert(main.indexOf('var miniPetAllKey = ')<main.indexOf('if (/^\\/펫스킬컬렉션등록'));
    });
    test('누락/손상 컬렉션 파일 오류 전파·다른 컬렉션 등록 대기 대체',()=>{
        for(const damage of [()=>f.put(c.miniPetCollectionPath,null),()=>f.putRaw(c.miniPetCollectionPath,'{'),()=>f.remove(c.miniPetCollectionPath)]){seed({bag:[pet('선택')]});damage();const before=f.files();assert.throws(()=>run('/미니펫컬렉션전체등록'));assert.equal(f.files(),before);}
        seed({bag:[pet('선택')]});c.userState.a={petSkillCollection:{selectedList:[{name:'이전스킬'}]}};run('/미니펫컬렉션전체등록');assert(!c.userState.a.petSkillCollection);assert(run('등록').includes('등록 완료'));
    });
    test('일부 등록 후 다른 후보 강화 실패 시 실제 소모와 미소모 펫을 정확히 표시',()=>{
        seed({bag:[pet('즉시등록','창조',1,50),pet('강화실패','창세',2,49)],stage:50,point:30000000,stone:200});c.Math.random=()=>0.99;
        run('/미니펫컬렉션전체등록');const out=run('등록');assert(out.includes('등록 성공✅ [1개]'));assert(out.includes('30,000,000 소모'));assert(out.includes('(등록 실패)'));
        assert.equal(f.read().member.a.point,0);assert.equal(f.read().member.a.bag['미니펫 강화석💫'],50);assert.equal(f.get(c.memberPetPath).a.miniPetBag[0].name,'강화실패');
    });
    test('완료 응답 실패도 원문 롤백·깨진 타이틀 파일은 저장 없이 오류',()=>{
        const paths=[c.filePath,c.memberPetPath,c.miniPetCollectionPath,c.miniPetTitlePath];
        seed({bag:[pet('선택')]});run('/미니펫컬렉션전체등록');const before=paths.map(p=>f.raw(p));f.replyFail(true);assert.throws(()=>run('등록'));f.replyFail(false);assert.deepEqual(paths.map(p=>f.raw(p)),before);run('등록');assert.deepEqual(paths.map(p=>f.raw(p)),before);
        seed({bag:[pet('선택')]});run('/미니펫컬렉션전체등록');f.putRaw(c.miniPetTitlePath,'{');const damaged=paths.map(p=>f.raw(p));assert.throws(()=>run('등록'));assert.deepEqual(paths.map(p=>f.raw(p)),damaged);
    });
    console.log('PASS mini-pet collection all '+groups+' groups');
}
if(require.main===module)checks();
module.exports={main,block,helperNames,route,commands,tableSetup,gradesSource,createHarness,pet,checks};
