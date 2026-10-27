const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, 'test_pet_home_village.js'), 'utf8');
const h = new Function('require', '__dirname', source.slice(0, source.indexOf('\nlet groups=0;')) + '\nreturn {c, f, main, block, seed, run, user, other, root, furniture};')(require, __dirname);
const {c, f, main, block, seed, run, user, other, root, furniture} = h;
const protectedPath = c.isProtectedManagedJsonPath;
c.isProtectedManagedJsonPath = p => !String(p).endsWith('/petHomeComments.json') && protectedPath(p); // 실제 댓글 파일은 기본 보호 대상이 아님
vm.runInContext(main.slice(main.indexOf('// 펫홈 댓글 저장소 기본 구조'), main.indexOf('// 펫스윗홈\nfunction initSweetHomeUser')), c);
for (const name of ['getPetHomePassBenefitCost', 'hasPoint', 'addPoint']) vm.runInContext(block(main, 'function ' + name + '('), c);
c.getPetSkillFollowerBonus = () => 0; c.getPetSkillHeartBonus = () => 0;
c.getPetHomeTodayText = () => '2026-10-22';
vm.runInContext('function runVillage(){' + [
 'if (msg === "/댓글핀" ||', 'if (msg === "/댓글핀삭제" ||', 'if (msg === "/댓글삭제" ||',
 'if (msg === "/댓글확인" ||', 'if (msg === "/홈알림" ||', 'if (msg == "/가구가방")', 'if (msg === "/가구정보" ||'
].map(s => block(main, s)).join('\n') + '}', c);
let groups = 0;
function test(name, fn) { fn(); console.log('PASS UI ' + (++groups) + ': ' + name); }
function comments() {
 seed(); f.put(root + 'petHomeComments.json', {comments: {[user]: [{from:other,text:'이전 댓글',time:'old'},{from:other,text:'최신 댓글',time:'new'}]}, pinnedComments:{}});
}
test('댓글핀 등록·표시 번호·재조회·삭제', () => {
 comments(); const point = f.read().member[user].point;
 assert(run('/댓글핀 1').includes('상단에 고정했습니다'));
 assert.equal(f.get(root+'petHomeComments.json').pinnedComments[user][0].text,'최신 댓글');
 assert.equal(f.read().member[user].point,point);
 assert(run('/댓글확인').includes('1. 📌 [💛'+other+']: 최신 댓글'));
 assert(run('/댓글핀삭제 1').includes('댓글핀을 삭제했습니다'));
 assert.equal(f.get(root+'petHomeComments.json').comments[user].length,2);
 assert.equal(f.get(root+'petHomeComments.json').pinnedComments[user].length,0);
});
test('댓글핀 중복·없는 번호·최대3개·접미 입력은 무변경', () => {
 comments();const store=f.get(root+'petHomeComments.json');
 store.comments[user]=Array.from({length:4},(_,i)=>({from:other,text:'댓글'+i,time:String(i)}));f.put(root+'petHomeComments.json',store);
 for(const no of [1,2,3])assert(run('/댓글핀 '+no).includes('상단에 고정했습니다'));
 const saved=f.raw(root+'petHomeComments.json'),member=f.raw(root+'member.json');
 assert(run('/댓글핀 1').includes('이미 고정'));assert(run('/댓글핀 4').includes('가득'));
 for(const input of ['/댓글핀 0','/댓글핀 99','/댓글핀삭제 0','/댓글핀삭제 4','/댓글핀 1 해봐','/댓글핀삭제 1 해봐','/댓글핀 -1','/댓글핀 1.5'])run(input);
 assert.equal(f.raw(root+'petHomeComments.json'),saved);assert.equal(f.raw(root+'member.json'),member);
});
test('댓글핀 패스·회원·펫 조건·타인 번호는 무변경', () => {
 comments();const saved=f.raw(root+'petHomeComments.json'),check=c.hasActiveHoiPassAccess;
 try{c.hasActiveHoiPassAccess=()=>false;assert(run('/댓글핀 1').includes('활성 가입자'));assert(run('/댓글핀삭제 1').includes('활성 가입자'));}finally{c.hasActiveHoiPassAccess=check;}
 assert(run('/댓글핀 1',other).includes('댓글 번호를 찾을 수 없습니다'));run('/댓글핀 1','unregistered');
 f.put(root+'member_pet.json',{});assert(run('/댓글핀 1').includes('펫을 생성하지 않았습니다'));
 assert.equal(f.raw(root+'petHomeComments.json'),saved);
});
test('댓글핀 첫번째·두번째 저장 실패와 파일 파싱 실패는 원본 보존', () => {
 for(const target of ['member.json','petHomeComments.json']){
  comments();const saved=f.raw(root+'petHomeComments.json'),member=f.raw(root+'member.json');f.fail(root+target);
  assert.throws(()=>run('/댓글핀 1'));assert.equal(f.raw(root+'petHomeComments.json'),saved);assert.equal(f.raw(root+'member.json'),member);
  assert(run('/댓글핀 1').includes('상단에 고정했습니다'));
 }
 comments();const member=f.raw(root+'member.json');f.corrupt(root+'petHomeComments.json');assert.throws(()=>run('/댓글핀 1'));assert.equal(f.raw(root+'member.json'),member);assert.equal(f.raw(root+'petHomeComments.json'),'{');
 comments();const list=Array.from({length:50},(_,i)=>({from:other,text:'댓글'+i,time:String(i)}));
 f.put(root+'petHomeComments.json',{comments:{[user]:list},pinnedComments:{[user]:[list[0]]}});const beforeTrim=f.raw(root+'petHomeComments.json');
 f.fail(root+'petHomeComments.json');assert.throws(()=>run('/댓글핀 1'));assert.equal(f.raw(root+'petHomeComments.json'),beforeTrim);
});
test('댓글핀30개 정리·기존핀 보존·해제 후 최근목록 재삽입 없음', () => {
 comments();const list=Array.from({length:50},(_,i)=>({from:other,text:'댓글'+i,time:String(i)}));
 f.put(root+'petHomeComments.json',{comments:{[user]:list},pinnedComments:{[user]:[list[0]]}});
 assert(run('/댓글핀 1').includes('상단에 고정했습니다'));let saved=f.get(root+'petHomeComments.json');
 assert.equal(saved.comments[user].length,30);assert.equal(saved.pinnedComments[user][0].text,'댓글0');assert.equal(saved.pinnedComments[user][1].text,'댓글49');
 assert(run('/댓글핀삭제 1').includes('댓글핀을 삭제했습니다'));saved=f.get(root+'petHomeComments.json');assert.equal(saved.comments[user].length,30);assert(!saved.comments[user].some(x=>x.text==='댓글0'));
});
test('댓글핀 DEV 저장 격리와 삭제 저장 실패 복구', () => {
 comments();const saved=f.raw(root+'petHomeComments.json'),member=f.raw(root+'member.json');
 seed({dev:true});f.put(root+'petHomeComments.json',JSON.parse(saved));f.put(root+'member.json',JSON.parse(member));f.put('/sdcard/호이랜드_dev/petHomeComments.json',JSON.parse(saved));
 assert(run('/댓글핀 1',user,'test',true).includes('상단에 고정했습니다'));assert.equal(f.raw(root+'petHomeComments.json'),saved);assert.equal(f.raw(root+'member.json'),member);
 const dev=f.raw('/sdcard/호이랜드_dev/petHomeComments.json');f.fail('/sdcard/호이랜드_dev/petHomeComments.json');assert.throws(()=>run('/댓글핀삭제 1',user,'test',true));assert.equal(f.raw('/sdcard/호이랜드_dev/petHomeComments.json'),dev);
});
test('가구가방은 안내 전부 목록 위·첫3개 뒤 전체보기·기존 번호 유지', () => {
 seed({bag:Array.from({length:6},(_,i)=>furniture('B'+i,'리브',600-i))});
 const text=run('/가구가방'),list=text.indexOf('✧━인벤토리 가구 목록🪑━✧');
 for(const guide of ['※ 가구 장착:', '※ 1번 장착 예시:', '※ 적용 매력 확인:', '※ 가구 판매:', '※ 장착 가구판매:', '※ 장착 귀속해제:'])assert(text.indexOf(guide)>0&&text.indexOf(guide)<list,guide);
 assert(text.indexOf('📥 /별채등록')<text.indexOf('※ 가구 장착:'));
 assert(text.indexOf('3. 가구B2')<text.indexOf('<ALLSEE>')&&text.indexOf('<ALLSEE>')<text.indexOf('4. 가구B3'));
 assert.equal(text.split('<ALLSEE>').length,2);assert(text.endsWith('━━━━━━ ✦ ━━━━━━'));
 assert(!text.includes('현재 배치된 가구'));assert(!text.includes('🛠️ 가구 관리'));assert(!text.includes('로열 10개 →'));
 assert.deepEqual(f.get(root+'home.json')[user].furnitureBag.map(x=>x.id),['B0','B1','B2','B3','B4','B5']);
 for(const length of [0,1,3]){seed({bag:Array.from({length},(_,i)=>furniture('B'+i))});const short=run('/가구가방');assert.equal(short.split('<ALLSEE>').length,2);assert(short.endsWith('━━━━━━ ✦ ━━━━━━<ALLSEE>'));}
});
test('가구정보의 종합·캐슬·레이드가 각각 한 줄', () => {
 seed({placed:[furniture('P','일반',100)]});const text=run('/가구정보');
 assert(text.includes('💞 가구 종합매력 +200\n⚔️ 캐슬 +100\n👾 레이드 +100\n'));
});
test('홈알림·ㅎㄹ의 마음5종·알림수·최근방문·기존 방문뱃지와 읽음 처리', () => {
 seed();const home=f.get(root+'home.json');home[user].likeCnt=5;home[user].visitCnt=7;home[user].heartExpressions={cute:1,cheer:2,cool:3,love:4};f.put(root+'home.json',home);
 f.put(root+'petHomeActivityData.json',{alerts:{[user]:Array.from({length:5},()=>({type:'comment',actorId:other,createdAt:'2026-10-22 12:23:00',read:false}))},recentVisitors:{[user]:[{visitorId:other,visitedAt:'2026-10-22 12:20:00'}]},petHomeSocial:{},migrations:{}});
 const text=run('/홈알림'),top=text.split('<ALLSEE>')[0];
 assert(top.includes('팔로워🐾 0명 · 팔로잉🎀 0명'));assert(top.includes('맞팔🤝 0명 · 남은 마음💌 '));
 assert(top.includes('💝 받은 마음 15회\n[🐾 1] [⭐ 2] [✨ 3]\n[💖 4] [💌 5]\n━━━━━━━━━━━━\n🔔 새 알림 5개 · 📭 보관 [5/100]\n👣 최근 방문자 [1/100명]'));
 assert(text.includes('🔔 최근 활동 알림'));assert(text.includes('1. 💛'+other+' ─ 2026-10-22 12:20:00'));
 assert(text.includes('누적 방문👣 7회'));assert(text.includes('🏅 방문 뱃지'));
 assert(f.get(root+'petHomeActivityData.json').alerts[user].every(x=>x.read));
 const second=run('ㅎㄹ');assert(second.includes('🔔 새 알림 0개 · 📭 보관 [5/100]'));assert(second.includes('💝 받은 마음 15회'));
 assert.equal(f.get(root+'home.json')[user].visitCnt,7);
});
console.log('PASS '+groups+' UI followup groups');
