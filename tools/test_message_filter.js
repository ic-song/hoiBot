const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const {createFixture}=require("./test_server_raid_delivery.js");
let groups=0;const clone=v=>JSON.parse(JSON.stringify(v));
function test(name,fn){fn();console.log("PASS "+(++groups)+": "+name);}
// 실제 response의 필터 진입까지 실행하고 이후 게임 처리만 통과 표식으로 대체한다.
function fixture(){
 const h=createFixture(),c=h.c;vm.runInContext(h.block(h.main,"function isAdmin("),c);c.errorLogPath="/synthetic/error.json";c.FileStream.write=()=>{};
 const start=h.main.indexOf("function response("),end=h.main.indexOf("// 확인 응답도",start);
 vm.runInContext(h.main.slice(start,end).replace("function response(","function probeFilter(")+`return "passed";}catch(error){rollbackDataSaveTransaction();throw error;}finally{if(commandContextEntered)exitCommandContext(prevCtx);if(dataSaveTransactionEntered)endDataSaveTransaction();if(responseTransactionAcquired)dataTransactionLock.unlock();responseDataLock.unlock();}}`,c);
 function initialize(){c.initData=h.read();const init=h.main.slice(h.main.indexOf("var messageFilterCaches = {};"),start);vm.runInContext(init,c);}
 initialize();
 let replies=[];function call(msg,user="admin",room="test",actual=false){replies=[];const fn=actual?c.response:c.probeFilter;const result=fn(room,msg,user,true,{reply:t=>replies.push(String(t))},{},"com.kakao.talk");return {result,replies:replies.slice()};}
 return {h,c,call,initialize};
}
test("쉼표·앞뒤 공백·중복 입력·정확한 관리 명령 해석",()=>{
 const {c}=fixture();assert.deepStrictEqual(clone(c.getMessageFilterRequest("/필터추가 가, 나,가")),{action:"추가",words:["가","나"]});
 for(const s of ["/필터추가방법 가","/필터제거함 가","/필터추가\n가","/필터추가 가\n"])assert.equal(c.getMessageFilterRequest(s),null);
 for(const s of ["/필터추가","/필터추가 ,가","/필터추가 가,,나","/필터제거 가,"])assert(c.getMessageFilterRequest(s).error);
});
test("슬래시·단축 명령만 검사하며 일반 대화는 비교/공유 메모리 조회 없음",()=>{
 const {c,call}=fixture();c.setMessageFilterCache(["검사어"],"PROD",true);let comparisons=0,cacheReads=0;const compare=c.containsMessageFilterWord,get=c.getCachedMessageFilterWords;
 c.containsMessageFilterWord=(...a)=>{comparisons++;return compare(...a);};c.getCachedMessageFilterWords=(...a)=>{cacheReads++;return get(...a);};
 assert.equal(call("그냥 검사어 대화").result,"passed");assert.equal(comparisons,0);assert.equal(cacheReads,0);
 assert.equal(call("/정보 검사어").result,undefined);assert.equal(comparisons,1);assert.equal(cacheReads,1);
 for(const s of ["ㅊㅊ","ㅍㅍㅍ","ㄹㄹ","거래한다","출발한다","이쁘다"])assert(c.isMessageFilterCommandInput(s),s);
 c.setMessageFilterCache(["레이드턴"],"PROD",true);assert.equal(call(" /레이드턴 ").result,undefined);
});
test("차단 명령은 무응답·회원 읽기/저장/후속 처리 없음",()=>{
 const {h,c,call}=fixture();c.setMessageFilterCache(["검사어"],"PROD",true);let reads=0,writes=0;const read=c.FileStream.read,save=c.saveJsonFile;c.FileStream.read=p=>{reads++;return read(p);};c.saveJsonFile=(...a)=>{writes++;return save(...a);};const before=h.persist();
 const result=call("/댓글 대상 검사어","a","room8",true);assert.equal(result.replies.length,0);assert.equal(reads,0);assert.equal(writes,0);assert.deepStrictEqual(h.persist(),before);assert.equal(c.getDataSaveTransaction(),null);
});
test("추가/제거 실제 콜백은 저장 후 메모리를 갱신·중복 추가/미등록 제거는 무저장",()=>{
 const {h,c,call}=fixture();assert(call("/필터추가 검사어, 다른말,검사어","admin","test",true).replies[0].includes("추가 2개"));assert.deepStrictEqual(h.read().messageFilterWords,["검사어","다른말"]);assert.deepStrictEqual(clone(c.getCachedMessageFilterWords(false)),["검사어","다른말"]);
 let saves=0;const save=c.saveJsonFile;c.saveJsonFile=(...a)=>{saves++;return save(...a);};call("/필터추가 검사어","admin","test",true);call("/필터제거 없음","admin","test",true);assert.equal(saves,0);
 call("/필터제거 검사어","admin","test",true);assert.deepStrictEqual(h.read().messageFilterWords,["다른말"]);assert.equal(call("/정보 검사어").result,"passed");
});
test("필터 관리만 자기 차단 예외·기존 Admin/Master 방 권한 유지",()=>{
 const {h,c,call}=fixture();c.setMessageFilterCache(["필터","검사어"],"PROD",true);
 const d=h.read();d.messageFilterWords=["필터","검사어"];h.write(d);assert.equal(call("/필터제거 검사어","a","test",true).replies.length,0);assert.deepStrictEqual(h.read().messageFilterWords,d.messageFilterWords);
 call("/필터제거 검사어","admin","room8",true);assert.deepStrictEqual(h.read().messageFilterWords,d.messageFilterWords);
 call("/필터제거 검사어","admin","test",true);assert.deepStrictEqual(h.read().messageFilterWords,["필터"]);
});
test("저장 실패는 파일·캐시 유지, 응답 실패는 확정 목록 유지",()=>{
 const {h,c,call}=fixture();h.failWrite((_d,p)=>p===c.filePath);assert.throws(()=>call("/필터추가 실패어"));assert.equal(h.read().messageFilterWords,undefined);assert.deepStrictEqual(clone(c.getCachedMessageFilterWords(false)),[]);
 c.response("test","/필터추가 성공어","admin",true,{reply(){throw Error("reply fail");}},{},"com.kakao.talk");assert.deepStrictEqual(h.read().messageFilterWords,["성공어"]);assert.deepStrictEqual(clone(c.getCachedMessageFilterWords(false)),["성공어"]);
});
test("재컴파일 초기화로 저장 목록 복원·일반 명령 반복 시 필터 파일 읽기 없음",()=>{
 const {c,call,initialize}=fixture();call("/필터추가 검사어");initialize();let reads=0;const read=c.FileStream.read;c.FileStream.read=p=>{reads++;return read(p);};for(let i=0;i<100;i++)assert.equal(call("/정보 검사어").result,undefined);assert.equal(reads,0);
});
test("DEV 목록과 운영 목록/회원 저장 분리",()=>{
 const {h,c,call}=fixture(),before=h.read();call("dev/필터추가 데브검사");assert.deepStrictEqual(h.read(),before);assert.deepStrictEqual(h.read(true).messageFilterWords,["데브검사"]);assert.equal(call("dev/정보 데브검사").result,undefined);assert.equal(call("/정보 데브검사").result,"passed");assert.equal(call("dev/정보 데브검사").replies.length,0);
});
test("손상된 DEV 초기 설정은 빈 필터로 숨기지 않으며 운영 목록 유지",()=>{
 const {h,c,call,initialize}=fixture();call("/필터추가 운영검사");const d=h.read(true);d.messageFilterWords=null;h.write(d,true);initialize();assert.equal(call("/정보 운영검사").result,undefined);assert.throws(()=>call("dev/정보 검사"));assert.deepStrictEqual(clone(c.getCachedMessageFilterWords(false)),["운영검사"]);
});
test("문자열 그대로 포함 비교·정규식 기호/이모지·다른 문구 보존",()=>{
 const {c}=fixture();assert(c.containsMessageFilterWord("/댓글 a.b✨",["a.b"]));assert(!c.containsMessageFilterWord("/댓글 axb✨",["a.b"]));assert(c.containsMessageFilterWord("/댓글 ✨",["✨"]));assert(!c.containsMessageFilterWord("/댓글 ABC",["abc"]));
 for(const v of [null,{},[""],[" 가"],["가","가"],[1],["가,나"],["가\n나"]])assert.throws(()=>c.readMessageFilterWords({messageFilterWords:v}));assert.deepStrictEqual(clone(c.readMessageFilterWords({})),[]);
});
test("Main·Info 공통 필터 함수 원문 일치와 Info 초기 차단",()=>{
 const {h,c,call}=fixture(),ic={java:c.java,GLOBAL_CONFIG:{messageFilter:clone(c.GLOBAL_CONFIG.messageFilter)},messageFilterCaches:{PROD:{words:[],text:"[]"},DEV:{words:[],text:"[]"}}};vm.createContext(ic);
 for(const name of ["readMessageFilterWords","setMessageFilterCache","getCachedMessageFilterWords","getMessageFilterRequest","containsMessageFilterWord"]){assert.equal(h.block(h.main,"function "+name+"("),h.block(h.info,"function "+name+"("));vm.runInContext(h.block(h.info,"function "+name+"("),ic);}
 const start=h.info.indexOf('if (getMessageFilterRequest(msg))'),end=h.info.indexOf('if (ctx.isDev)',start);vm.runInContext('function probeInfo(msg,isDev){var ctx={isDev:isDev};'+h.info.slice(start,end)+'return "passed";}',ic);
 call("/필터추가 정보검사");assert.equal(ic.probeInfo("/정보 정보검사",false),undefined);assert.equal(ic.probeInfo("/정보 깨끗",false),"passed");assert.equal(ic.probeInfo("/필터제거 정보검사",false),undefined);call("/필터제거 정보검사");assert.equal(ic.probeInfo("/정보 정보검사",false),"passed");
 let checked=0;ic.containsMessageFilterWord=()=>{checked++;return false;};assert.equal(ic.probeInfo("정보검사 일반 대화",false),"passed");assert.equal(checked,0);
});
test("실제 분리 회원 저장에서도 필터만 변경·레이드/로그와 세대 보존",()=>{
 const util=fs.readFileSync(path.join(__dirname,"test_server_raid_io.js"),"utf8");const {storageFixture}=new Function("require","__dirname",util.slice(0,util.indexOf("\nlet count"))+"\nreturn {storageFixture};")(require,__dirname);
 const h=storageFixture();h.setup();h.migrate();const c=h.c,lock=()=>({lock(){},unlock(){},tryLock(){return true;}});c.commandDataFlowLock={readLock:lock,writeLock:lock};c.autoDailyQuestInternalDepth=0;
 const raid=clone(h.store("raid")),logs=clone(h.store("logs")),before=h.c.getMemberSplitMarker(h.load());
 c.response("test","/필터추가 분리검사","admin",true,{reply(){}},{},"com.kakao.talk");assert.deepStrictEqual(clone(h.load().messageFilterWords),["분리검사"]);assert.deepStrictEqual(clone(h.store("raid")),raid);assert.deepStrictEqual(clone(h.store("logs")),logs);assert.deepStrictEqual(clone(c.getMemberSplitMarker(h.load())),clone(before));
 for(const s of ["/필터추가 가","/필터제거 가","dev/필터추가 가"])assert(c.isExclusiveDataMutationCommandMessage(s));
});
test("필터리스트 실제 콜백은 등록 순서·번호·개수·빈 목록 안내, 파일 IO 없음",()=>{
 const {h,c,call}=fixture();const before=h.persist();let reads=0,saves=0;const read=c.FileStream.read;c.FileStream.read=(...args)=>{reads++;return read(...args);};c.saveJsonFile=()=>{saves++;};
 assert(call("/필터리스트","admin","test",true).replies[0].includes("등록된 필터가 없습니다."));c.setMessageFilterCache(["한 문구","둘째","필터"],"PROD",true);
 const output=call("/필터리스트","admin","test",true).replies[0];assert(output.includes("3개")&&output.includes("1. 한 문구\n2. 둘째\n3. 필터"));assert.equal(reads,0);assert.equal(saves,0);assert.deepStrictEqual(h.persist(),before);
});
test("필터리스트 권한·정확한 명령·DEV 분리·Info 중복 차단",()=>{
 const {h,c,call}=fixture();c.setMessageFilterCache(["운영목록"],"PROD",true);c.setMessageFilterCache(["개발목록"],"DEV",true);
 assert.equal(call("/필터리스트","a","test",true).replies.length,0);assert.equal(call("/필터리스트","admin","room8",true).replies.length,0);assert(call("/필터리스트","master","test",true).replies[0].includes("운영목록"));assert(call("dev/필터리스트","admin","test",true).replies[0].includes("개발목록"));
 for(const msg of ["/필터리스트 1","/필터리스트방법","/필터리스트 해봐"])assert.equal(call(msg).result,"passed");
 const ic={getMessageFilterRequest:()=>null,containsMessageFilterWord:()=>{throw Error("Info must bypass");},getCachedMessageFilterWords:()=>{throw Error("Info must bypass");}};vm.createContext(ic);const start=h.info.indexOf('if (getMessageFilterRequest(msg))'),end=h.info.indexOf('if (ctx.isDev)',start);vm.runInContext('function check(msg){var ctx={isDev:false};'+h.info.slice(start,end)+'return "passed";}',ic);assert.equal(ic.check("/필터리스트"),undefined);
});
test("추가·제거 쉼표 분리는 내부 띄어쓰기 보존·완전 일치 제거",()=>{
 const {h,call}=fixture();call("/필터추가  한 문구  , 둘째,한 문구");assert.deepStrictEqual(h.read().messageFilterWords,["한 문구","둘째"]);call("/필터제거 한");assert.deepStrictEqual(h.read().messageFilterWords,["한 문구","둘째"]);call("/필터제거  한 문구 , 둘째 ");assert.deepStrictEqual(h.read().messageFilterWords,[]);
});
console.log("PASS message filter: "+groups+" groups (synthetic only)");
