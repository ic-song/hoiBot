// ============================================================================================
// * 상수
// ============================================================================================

const HoiBotVersion = '1.511';
const raidSpecialItem = {
  dept1: {
    item_0: { name: '항생제💊', exp: 50 },
    item_1: { name: '마늘🧄', exp: 50 },
    item_2: { name: '거울🪞', exp: 50 },
    item_3: { name: '에프킬라💦', exp: 50 },
    item_4: { name: '도깨비가면👹', exp: 50 },
    item_5: { name: '곰팡이🍄', exp: 50 },
    item_6: { name: '트롤심장💓', exp: 50 },
    item_7: { name: '하리보🪼', exp: 50 }
  },
  dept2: {
    item_1: { name: '레이드공격대인장🥇(+500👾)', exp: 500 },
    item_2: { name: '레이드타격대인장👑(+600👾)', exp: 600 }
  }
};

// 캐슬 프리미엄 아이템 정의,  확률 높은것이 우선적용되게 낮은숫자(item_1) 지정해야함
const castlePremiumItem = {
  offense: {
    item_0: { name: '캐슬기습공격권🔥(100%)', successRate: 100 },
    item_1: { name: '캐슬기습공격권🔥(40%)', successRate: 0.4 },
    item_2: { name: '캐슬기습공격권🔥(20%)', successRate: 0.2 },
    item_3: { name: '캐슬기습공격권🔥(10%)', successRate: 0.1 },
  },
  defense: {
    item_0: { name: '캐슬절대방어권🛡(100%)', successRate: 100 },
    item_1: { name: '캐슬절대방어권🛡(50%)', successRate: 0.5 },
    item_2: { name: '캐슬절대방어권🛡(25%)', successRate: 0.25 },
    item_3: { name: '캐슬절대방어권🛡(5%)', successRate: 0.05 },
  }
};
// 공성전 프래그 (true : 진행중 / false : 미진행중)
let castleSiegeFlag = false;
// 캐슬 아이템 정의
const castleItem = {
  item_1: { name: '캐슬초급유닛💂(+1💕)', exp: 1 },
  item_2: { name: '캐슬중급유닛🥷🏼(+10💕)', exp: 10 },
  item_3: { name: '캐슬고급유닛🧙🏼‍♂(+50💕)', exp: 50 },
  item_4: { name: '캐슬유니크유닛👑(+200💕)', exp: 200 },
  item_5: { name: '호랜캐슬을 위하여!🏴‍☠(+1000💕)', exp: 1000 },
  item_6: { name: '캐슬튜브유닛🇨🇦(+250💕)', exp: 250 },
  item_7: { name: '캐슬레온유닛🇺🇸(+250💕)', exp: 250 },
  item_8: { name: '캐슬비광유닛🎴(+250💕)', exp: 250 },
  item_9: { name: '캐슬춘배유닛🐯(+250💕)', exp: 250 },
  item_10: { name: '캐슬노아유닛🐹(+250💕)', exp: 250 },
  item_11: { name: '캐슬베라유닛💘(+250💕)', exp: 250 },
  item_12: { name: '캐슬버블킹유닛🫧(+1000💕)', exp: 1000 },
  item_13: { name: '캐슬건징어유닛🐙(+250💕)', exp: 250 },
  item_14: { name: '캐슬온오프유닛🚘(+250💕)', exp: 250 },
  item_15: { name: '캐슬우유유닛🥛(+250💕)', exp: 250 },
  item_16: { name: '캐슬산타유닛🎅(+250💕)', exp: 250 },
  item_17: { name: '캐슬코크유닛🪽(+250💕)', exp: 250 },
  item_18: { name: '캐슬벨라유닛🦄(+250💕)', exp: 250 },
  item_19: { name: '캐슬콘트유닛🚹(+250💕)', exp: 250 },
  item_20: { name: '캐슬빠루유닛🔧(+250💕)', exp: 250 },
  item_21: { name: '캐슬소솜유닛🧸(+250💕)', exp: 250 },
  item_22: { name: '캐슬덕구유닛🗿(+250💕)', exp: 250 },
  item_23: { name: '캐슬우니대장유닛🃏(+18💕)', exp: 18 },
  item_24: { name: '캐슬쏭쏭유닛🪻(+250💕)', exp: 250 },
  item_25: { name: '캐슬효순유닛🐰(+250💕)', exp: 250 },
  item_26: { name: '캐슬알레유닛👀(+250💕)', exp: 250 },
  item_27: { name: '캐슬심심유닛🦷(+250💕)', exp: 250 },
  item_28: { name: '캐슬호이봇유닛🤖(+100💕)', exp: 100 },
  item_29: { name: '캐슬흑형유닛🧔🏿‍♂(+250💕)', exp: 250 },
  item_30: { name: '캐슬호랜유닛🎲(+300💕)', exp: 300 },
  item_31: { name: '캐슬히히유닛🪀(+250💕)', exp: 250 },
  item_32: { name: '캐슬주먹유닛👊(+250💕)', exp: 250 },
  item_33: { name: '캐슬사월유닛♠(+250💕)', exp: 250 },
  item_34: { name: '캐슬제우유닛⚡(+250💕)', exp: 250 },
  item_35: { name: '캐슬베베유닛🐿(+250💕)', exp: 250 },
  item_36: { name: '캐슬찐이유닛🪷(+250💕)', exp: 250 },
  item_37: { name: '캐슬진주유닛🔮(+250💕)', exp: 250 },
  item_38: { name: '캐슬꼬북유닛🐢(+250💕)', exp: 250 },
  item_39: { name: '캐슬무지유닛🤶(+250💕)', exp: 250 },
  item_40: { name: '캐슬삼삼유닛💜(+33💕)', exp: 33 },
  item_41: { name: '캐슬호이유닛👑(+1500💕)', exp: 1500 },
  item_42: { name: '캐슬레이유닛👩🏻‍⚕(+1200💕)', exp: 1200 },
  item_43: { name: '캐슬콩두유닛🍓(+250💕)', exp: 250 },
  item_44: { name: '캐슬만두유닛🥟(+250💕)', exp: 250 },
  item_45: { name: '캐슬죠니유닛😶‍🌫(+250💕)', exp: 250 },
  item_46: { name: '캐슬케베유닛💩(+250💕)', exp: 250 },
  item_47: { name: '캐슬까까유닛🍪(+250💕)', exp: 250 },
  item_48: { name: '캐슬뿜뿜유닛🐣(+250💕)', exp: 250 },
  item_49: { name: '캐슬코피유닛🦖(+250💕)', exp: 250 },
  item_50: { name: '캐슬쿵쿵유닛🐌(+250💕)', exp: 250 },
  item_51: { name: '캐슬머빗유닛🌱(+250💕)', exp: 250 },
  item_52: { name: '캐슬웨이유닛🦝(+250💕)', exp: 250 },
  item_53: { name: '캐슬악마유닛😈(+250💕)', exp: 250 },
  item_54: { name: '캐슬코드유닛🟰(+250💕)', exp: 250 },
  item_55: { name: '캐슬데일유닛🩹(+250💕)', exp: 250 },
  item_56: { name: '캐슬호박유닛🎃(+250💕)', exp: 250 },
  item_57: { name: '캐슬리리유닛👥(+125💕)', exp: 125 },
  item_58: { name: '캐슬댕청유닛👥(+125💕)', exp: 125 },
  item_59: { name: '캐슬삼오유닛👺(+250💕)', exp: 250 },
  item_60: { name: '캐슬라임유닛🍋‍🟩(+250💕)', exp: 250 },
  item_61: { name: '캐슬기본유닛🐶(+250💕)', exp: 250 },
  item_62: { name: '캐슬빔빔유닛🍞(+250💕)', exp: 250 },
  item_63: { name: '캐슬밤밤유닛🌰(+250💕)', exp: 250 },
  item_64: { name: '캐슬구름유닛🌥(+250💕)', exp: 250 },
  item_65: { name: '캐슬잔다유닛😴(+250💕)', exp: 250 },
  item_66: { name: '캐슬주디유닛🦊(+250💕)', exp: 250 },
  item_67: { name: '캐슬히민유닛⚠(+250💕)', exp: 250 },
  item_68: { name: '캐슬좌절유닛👨‍🦼(+250💕)', exp: 250 },
  item_69: { name: '캐슬코쿠시보유닛⚔(+250💕)', exp: 250 },
  item_70: { name: '캐슬농부유닛👨‍🌾(+18💕)', exp: 18 },
  item_71: { name: '캐슬쓱싹유닛👻(+250💕)', exp: 250 },
  item_72: { name: '캐슬초코유닛🍫(+250💕)', exp: 250 },
  item_73: { name: '캐슬도리유닛🍭(+250💕)', exp: 250 },
  item_74: { name: '캐슬하루유닛🥱(+250💕)', exp: 250 },
  item_75: { name: '캐슬프백유닛🐷(+250💕)', exp: 250 },
  item_76: { name: '캐슬공백유닛💯(+250💕)', exp: 250 },
  item_77: { name: '캐슬룰루유닛🥳(+250💕)', exp: 250 },
  item_78: { name: '캐슬이지유닛💋(+250💕)', exp: 250 },
  item_79: { name: '캐슬신나유닛🧚(+250💕)', exp: 250 },
  item_80: { name: '캐슬떨어유닛🥶(+250💕)', exp: 250 },
  item_81: { name: '캐슬여름유닛🏖(+250💕)', exp: 250 },
  item_82: { name: '캐슬해마유닛🍤(+250💕)', exp: 250 },
  item_83: { name: '캐슬새솔유닛스🦋(+250💕)', exp: 250 },
  item_84: { name: '캐슬광복절유닛🇰🇷(+500💕)', exp: 500 },
  item_85: { name: '캐슬대장졸렬우삼유닛👨‍❤‍👨(+1018💕)', exp: 1018 },
  item_86: { name: '캐슬올림픽유닛🏅(+300💕)', exp: 300 },
  item_87: { name: '캐슬봉화유닛🔥(+200💕)', exp: 200 },
  item_88: { name: '캐슬태극유닛🇰🇷(+250💕)', exp: 250 },
  item_89: { name: '캐슬진짜유닛👫(+801💕)', exp: 801 },
  item_90: { name: '캐슬레온킹유닛🦁(+1000💕)', exp: 1000 },
  item_91: { name: '캐슬건징킹유닛🤴(+1000💕)', exp: 1000 },
  item_92: { name: '캐슬쏭쏭퀸유닛👸(+1000💕)', exp: 1000 },
  item_93: { name: '캐슬아콩유닛💞(+250💕)', exp: 250 },
  item_94: { name: '캐슬세균맨유닛👾(+350💕)', exp: 350 },
  item_95: { name: '캐슬송편유닛🍡(+200💕)', exp: 200 },
  item_96: { name: '캐슬만둣국유닛🥟(+200💕)', exp: 200 }

};

// 디버깅 상태
let isDebuggerFlag = false;

// 크리티컬 정보
const BASE_CRIT_DAMAGE_MULTIPLIER = 1.4; // 크리티컬 데미지
const BASE_CRIT_CHANCE = 0; // 초기 크리티컬 확률 0%
const CRIT_CHANCE_PER_UPGRADE = 0.005; // 1강당 크리티컬 확률 0.5% 증가


const Ngears = ['헐렁한 티셔츠', '늘어난 난닝구', '구멍난 신발', '브래지어', '각목', '몽둥이', '전자담배', '담배', '뽕브라', '냄새나는 모자', '가발', '하얀 운동화', '진통제', '종합비타민', '김 빠진 펩시', '물티슈', '발렌타인 -10년산', '숙취해소제', '탈모약', '파랑 버섯', '바나나 우유', '모나미 팬', '고장난 스피커', '깨진 모니터', '비둘기', '갤럭시 S2', '아이폰3Gs', '햄스터 먹이', '해바가리씨', '상한 누텔라', '곰팡이 핀 식빵', '상한 우유', '데오드란트', '극세사 이불', '손난로', '형관팬', '모나미팬', '손톱깍이', '삐삐', '호이 여', '산타 여', '무지 남', '격리 남', '레이 남', '거품 여', '하리보', '젤리 여', '모기향', '물 먹는 하마', '맥주 먹는 호이', '차오팟', 'He is Chinese', 'tw no.1', 'He is Japanese', '고장난 마티즈', '엔진 없는 인력거', '파리지옥', '츄르', '개껌', '목줄', '수갑', '안대', '핸드크림', '변비약', '뿅망치', '솜터진 인형', '먹다 남은 피자', '지옥 참마도', '뇌먹는 아메바', '베개', '딸기 우유', '초코 우유', '대머리', '냥냥 펀치', '립밤', '열쇠', '후진만 가능한 페라리', '녹용', '입마개', '안장', '라면 받침대', '간식통', '고양이 모래', '강아지 패드', '소금빵', '나무젓가락', '올라프', '인공눈물', '소주', '맥주', '구급약', '감기약', 'She is Gone', 'A형 독감', '타미플루', '딥티슈', '토너', '로션', '수분크림', 'Hi', 'Bye', '꽝', '꽝이다 이놈아', '예끼 이놈아', '레어 나올줄 알고 설렜어?', '유니크 나올줄 알고 설렜어?', '왜? 전설 나올거 같애?'];
const Rgears = ['카시오 전자시계⏰', '용 조각상🐉', '제리의 치즈🧀', '라멘🍜', '개뼈다귀🦴', '감자튀김🍟', '와플🧇', '스와치 시계🕚', '애플 워치⌚', '아이폰100 Pro Ulta Max📱✨️', '갤럭시S100 Limite Edition📲', 'BOSS 스피커🔊', 'MLB 모자🧢', '슈프림 후드티🩲', '유니클로 히트텍👕', '삼성 전자발찌🕐', '피카츄⚡', '그레이구스 보드카🥃', '이슬처럼✨️', '톰포드 립스틱💄', '런던 베이글🥯', '서울 우유🥛', '삼성팟 맥스🎧', '태권복🥋', '트럼팻🎺', '색소폰🎷', '주사위🎲', '빅토리아시크릿 비키니👙', '육군 철모🪖', '귀여운 곰인형🧸', '니주식〽', '7번의 번뇌 펀치👊', '풍선🎈', '에어팟 맥스🎧', '뇌먹는 아메바🦠', 'I was car🚗', '킥보드 🛴', '귀신들린 인형🎎', '초록 공책📗', '다이어리📔', '파랑 공책📘', '나무젓가락🥢', '올라프☃', '임플란트🦷', '네일아트 회원권💅🏻', '각궁🏹', '부채표🪭', '오이비누🧼', '방패🛡', '도끼🪓', '관짝⚰', '거울🪞', '싹둑✂', '시몬스 침대🚼', '레드와인🍷', '허브향 솔트🧂', '막대가리 사탕🍭', '선글라스👓'];
const Ugears = ['삐에로 가면🤡', '악귀의 가면👹', '도깨비의 가면👺', '피크닉🧃', '롤렉스 시계🕰', '티파니 반지💍', '구찌 스네이크 지갑👝', '루이비통 가방🧳', '미우미우 지갑👛', '샤넬 백팩🎒', '에르메스 넥타이👔', '델보 가방💼', '롱소드🗡', 'AK-47🔫', '나무젓가락⚔', '신궁🏹', '텍사스 전기톱🪚', '드워프 망치⚒', '팔광🎴', '다이아♦', '클로버♣', '스페이드♠', '하트♥', '입생로랑 선글라스🕶'];
const Lgears = ['다이스🎲', '에르메스 버킨백👜', '예리한 나무젓가락⚔', '성령이 깃든 올라프☃❄', '조커🃏'];
const Agears = ['별의 유물✡', '달의 유물☪', '왕의 유물🪯', '태극의 유물☯', '혼의 유물♉', '신의 유물✝'];
const Ggears = ['신검🔆', '신관⚜'];
const Kgears = ['고대의 숟가락🥄', '고대의 물방울🫧', '고대의 담배🚬'];
const Zgears = ['오라클🪬'];
const Xgears = ['집행검👑'];
const Tgears = ['나뭇가지🌳(+1000🌰)'];
var bidItems = [];
//메인 정보
var isSaving = false;
var allsee = "​".repeat(500);
const room1 = '🐶30대 반말방💕친목🐯 보룸,디코,수다,벙🎙️';
const room2 = '🐷30대 반말방💕친목🐰디코,보룸,벙🎙️';
const room3 = '🎠30대 반말방💕친목🐈디코,보룸,벙🎙';
const room4 = '팻 테스트방';
const room5 = '🐰2030 수다방💘 친목,디코,벙🎙';

//sd카드에 호이랜드 폴더를 생성 및 경로 지정
var sdcard = android.os.Environment.getExternalStorageDirectory().getAbsolutePath();
var folder = new java.io.File(sdcard, "호이랜드");
folder.mkdirs();
const filePath = "/sdcard/호이랜드/member.json";
const boardPath = "/sdcard/호이랜드/board.json";
const castleBattlePath = "/sdcard/호이랜드/castleBattle.json";
const errorLogPath = "/sdcard/호이랜드/errorLog.json";
//초기 어드민 설정
var initData = loadJsonFile(filePath);
var Master = Object.keys(initData.master);
var Admins = Object.keys(initData.admin);
function isAdmin(sender) {
  return Admins.includes(sender);
}
//출석 기준포인트
var attendBonusPoint = 3000;
var attendBonusExp = 100;
var lvlpoint = 200000;
//game기준
var gamePoint = 3000;
var gameExp = 3;
var gameAnswer = Math.floor(Math.random() * 9000) + 1000;
var quizpreAnswer = Math.floor(Math.random() * 9000) + 1000;
var quizAnswer = Math.floor(Math.random() * 9000) + 1000;
var musicquizpreAnswer = Math.floor(Math.random() * 9000) + 1000;
var musicquizAnswer = Math.floor(Math.random() * 9000) + 1000;
var musicquizresultmsg = '';
var songhint = '';
//퀴즈
let quiznow = false;
let musicquiznow = false;
let newQuestionInfo = null;
let passCounts = {};
let passedUsers = [];
//다이스
let diceinterval = false;
const setint = 60;//다이스 주기 1시간
var Winx = 2;//호이승 배율 초기화 설정
var Losex = 2;//봇승 배율 초기화 설정
var Tiex = 5;//무승부 배율 초기화 설정
var stan = 50000;// 수익 수수료 기준
var HighFee = 0.7;// 기준이상 수수료 30%
var LowFee = 0.95;// 기준이하 수수료 5%
//로또
var Pot = 1000;// 로또 참여비&누적추가금
var MinPot = 30000000;//로또 최소 당첨금
var fee = 1;//수수료 설정
//진화 필요 매력치
var requiredpoint = 10;
//좀비모드
const zombieEmojis = ['🧟‍♂️', '🧟‍♀️', '🧟'];
//const zombieRewards = ['선물상자🎁', '나락상자👹', '극락상자👹'];
const zombieRewards = ['혼자레이드리셋권😝'];//백신보상
const zombieRewards1 = '혼자레이드리셋권😝';//숙주보상
var zombieadd = false;
var addfirstZB = false;
var addhealer = false;
const zombiewinreward = 200000;// 좀비팀승 보상 
const healwinreweward = 100000;// 백신팀승 보상
// 종족 및 이모지 정보
const petTypes1 = [{
  name: '하늘',
  emojis: ['🪺']
}, {
  name: '땅',
  emojis: ['🐾']
}, {
  name: '바다',
  emojis: ['🌊']
}];
// 기본 펫 종류
const petTypes2 = [{
  name: '하늘',
  emojis: ['🦃', '🐓', '🐥', '🐦', '🕊', '🦅', '🦆', '🦢', '🦉', '🦤', '🦩', '🦚', '🦜', '🐦‍⬛', '🦋', '🐝', '🐤', '🦇']
}, {
  name: '땅',
  emojis: ['🦧', '🐕', '🐩', '🐈', '🐈‍⬛', '🫏', '🦌', '🦬', '🐄', '🐖', '🐏', '🦛', '🐀', '🐇', '🐿', '🦔', '🦥', '🦦', '🦨', '🦘', '🐍', '🐆', '🦓']
}, {
  name: '바다',
  emojis: ['🐧', '🐢', '🐊', '🐋', '🐬', '🦭', '🐟', '🐠', '🐡', '🦈', '🐙', '🦀', '🦞', '🦐', '🦑', '🪼']
}];
// 유닠 펫 종류
const petTypes3 = [{
  name: '하늘',
  emojis: ['🧚‍♂️', '🧚‍♀️', '🧚', '🐉']
}, {
  name: '땅',
  emojis: ['🧟‍♂️', '🧟‍♀️', '🧟', '🦄', '🦖', '🐅']
}, {
  name: '바다',
  emojis: ['🧜‍♂️', '🧜‍♀️', '🧜', '🐳']
}];
const NonSenseGame = (function () {
  function getRand() {
    return ((Math.random() * 937) | 0) + 1;
  }
  function getResponse(url) {
    return org.jsoup.Jsoup.connect(url).ignoreContentType(true).execute().body();
  }
  function setNewQuestion() {
    let questionInfo = getResponse("https://m.search.naver.com/p/csearch/content/qapirender.nhn?pkid=54&where=m&q=%EB%84%8C%EC%84%BC%EC%8A%A4%ED%80%B4%EC%A6%88&display=1&start=" + getRand());
    questionInfo = JSON.parse(questionInfo).itemList[0].html;
    questionInfo = org.jsoup.Jsoup.parse(questionInfo);
    const question = questionInfo.select(".question_q").text();
    const hint = questionInfo.select(".hint_area").text();
    const answer = questionInfo.select(".n_answer").text();
    const why = questionInfo.select(".ns_why").text();
    return {
      "question": question,
      "hint": hint,
      "answer": answer,
      "why": why
    };
  }
  return function () {
    let question = "", hint = "", answer = "", why = "";
    return {
      "setNewQuestion": () => setNewQuestion(),
      "getQuestion": () => question,
      "getAnswer": () => answer,
      "getWhy": () => why,
      "getHint": () => hint,
      "getInfo": () => {
        return {
          "question": question,
          "hint": hint,
          "answer": answer,
          "why": why
        };
      }
    };
  };
})();
const QuizBot = NonSenseGame();
//메인채팅응답기능
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  try {
    var data = loadJsonFile(filePath);
    var board = loadJsonFile(boardPath);
    var castleBattleData = loadJsonFile(castleBattlePath);
    if (isSaving == false) {
      if (sender.length >= 4 || sender == "오픈채팅봇") {
        if (!data.member[sender]) {
          initializeMember(sender, data);
        }
        if (msg.length > 2) {
          data.member[sender].point++;
          data.member[sender].exp++;
          data.member[sender].chatcnt0++;
          if (data.member[sender].boostercnt > 0) {
            data.member[sender].exp++;
            data.member[sender].boostercnt--;
            if (data.member[sender].boostercnt == 0) {
              replier.reply("[" + checkRank(data, sender) + "] 님의\n 경험치 부스터가 소진되었습니다.");
            }
          }
        }

        let requiredExp = 6 * data.member[sender].lv + 84;
        let lvlupmsg = '';
        if (data.member[sender].exp >= requiredExp) {
          data.member[sender].lv++;
          data.member[sender].point += parseInt(lvlpoint);
          lvlupmsg = '[' + checkRank(data, sender) + '] 님\n✨레벨 ' + data.member[sender].lv + ' 달성, 축하합니다!\n보너스 포인트 🅟' + numberWithCommas(lvlpoint) + '지급';
          data.member[sender].exp = 0;
          if (data.member[sender].lv % 3 === 0) {
            data.member[sender].pet.petexp++;
            lvlupmsg += ('\n보너스 펫매력 💕1 지급');
          }
          let congratmsg = '';
          let additionalRewardsMsg = '';
          if (data.member[sender].lv === 50) {
            addRewards(data, sender, "슬롯상자🧳", 3);
            congratmsg = '축하합니다! 레벨 50을 달성했습니다.\n슬롯상자🧳 3개 획득';
          } else if (data.member[sender].lv === 30) {
            addRewards(data, sender, "슬롯상자🧳", 2);
            congratmsg = '축하합니다! 레벨 30을 달성했습니다.\n슬롯상자🧳 2개 획득';
          } else if (data.member[sender].lv === 10) {
            addRewards(data, sender, "슬롯상자🧳", 1);
            congratmsg = '축하합니다! 레벨 10을 달성했습니다.\n슬롯상자🧳 1개 획득';
          } else if (data.member[sender].lv === 80) {
            addRewards(data, sender, "선물상자🎁", 3);
            addRewards(data, sender, "슬롯상자🧳", 3);
            congratmsg = '축하합니다! 레벨 80을 달성했습니다.\n선물상자🎁 3개,\n슬롯상자🧳 3개 획득';
          } else if (data.member[sender].lv === 100) {
            addRewards(data, sender, "선물상자🎁", 3);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 5);
            addRewards(data, sender, "혼자레이드리셋권😝", 5);
            addRewards(data, sender, "슬롯상자🧳", 5);
            congratmsg = '축하합니다! 레벨 100을 달성했습니다.\n선물상자🎁 3개,\n펫 장비드랍방지권🛡 5개,\n혼자레이드리셋권😝 5개,\n슬롯상자🧳 5개 획득';
          } else if (data.member[sender].lv === 125) {
            addRewards(data, sender, "선물상자🎁", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 5);
            congratmsg = '축하합니다! 레벨 125을 달성했습니다.\n선물상자🎁 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳 5개 획득';
          } else if (data.member[sender].lv === 150) {
            addRewards(data, sender, "선물상자🎁", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 8);
            congratmsg = '축하합니다! 레벨 150을 달성했습니다.\n선물상자🎁 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳 8개 획득';
          } else if (data.member[sender].lv === 170) {
            addRewards(data, sender, "선물상자🎁", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 20);
            congratmsg = '축하합니다! 레벨 170을 달성했습니다.\n선물상자🎁 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳 20개 획득';
          } else if (data.member[sender].lv === 175) {
            addRewards(data, sender, "쓰레기", 50);
            congratmsg = '🎁히든 레벨보상🎁\n호이 남: 옛다 오다 주웠다. 쓰레기 50개 획득';
          } else if (data.member[sender].lv === 185) {
            addRewards(data, sender, "선물상자🎁", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 25);
            congratmsg = '축하합니다! 레벨 185을 달성했습니다.\n선물상자🎁 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳 25개 획득';
          } else if (data.member[sender].lv === 195) {
            addRewards(data, sender, "슬롯코인🪙", 30);
            congratmsg = '🎁히든 레벨보상🎁\n호이 남: 옛다 오다 주웠다.슬롯코인🪙 30개 획득';
          } else if (data.member[sender].lv === 199) {
            addRewards(data, sender, "슬롯코인🪙", 100);
            congratmsg = '🎁히든 레벨보상🎁\n대단합니다!\n레벨이 199? 우리 방에 최소 5개월은 왕성한 활동을 했다는 것인데..\n좋은 활동과 좋은 인간관계가 아니고선 올리기 힘든 레벨이에요!\n그 래 서! 감사한 마음에 작은 선물을 드립니다 좋은 활동 해줘서 고마워요 :)\n슬롯코인🪙100개 획득!';
          } else if (data.member[sender].lv === 200) {
            addRewards(data, sender, "극락상자👹", 4);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 30);
            congratmsg = '축하합니다! 레벨 200을 달성했습니다.\n극락상자👹 4개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳30개 획득';
          } else if (data.member[sender].lv === 210) {
            addRewards(data, sender, "극락상자👹", 4);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 35);
            congratmsg = '축하합니다! 레벨 210을 달성했습니다.\n극락상자👹 4개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳35개 획득';
          } else if (data.member[sender].lv === 220) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 40);
            congratmsg = '축하합니다! 레벨 220을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳 40개 획득';
          } else if (data.member[sender].lv === 230) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 45);
            congratmsg = '축하합니다! 레벨 230을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳45개 획득';
          } else if (data.member[sender].lv === 235) {
            addRewards(data, sender, "쓰레기", 100);
            congratmsg = '🎁히든 레벨보상🎁\n호이 남: 옛다 오다 주웠다. 쓰레기 100개 획득';
          } else if (data.member[sender].lv === 240) {
            addRewards(data, sender, "극락상자👹", 4);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 10);
            addRewards(data, sender, "슬롯상자🧳", 50);
            congratmsg = '축하합니다! 레벨 240을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 10개,\n혼자레이드리셋권😝 10개,\n슬롯상자🧳50개 획득';
          } else if (data.member[sender].lv === 250) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 20);
            addRewards(data, sender, "혼자레이드리셋권😝", 20);
            addRewards(data, sender, "슬롯상자🧳", 50);
            congratmsg = '축하합니다! 레벨 250을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 20개,\n혼자레이드리셋권😝 20개,\n슬롯상자🧳 50개 획득';
          } else if (data.member[sender].lv === 260) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 20);
            addRewards(data, sender, "혼자레이드리셋권😝", 20);
            addRewards(data, sender, "슬롯상자🧳", 60);
            congratmsg = '축하합니다! 레벨 260을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 20개,\n혼자레이드리셋권😝 20개,\n슬롯상자🧳 60개 획득';
          } else if (data.member[sender].lv === 270) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 20);
            addRewards(data, sender, "혼자레이드리셋권😝", 20);
            addRewards(data, sender, "슬롯상자🧳", 70);
            congratmsg = '축하합니다! 레벨 270을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 20개,\n혼자레이드리셋권😝 20개,\n슬롯상자🧳 70개 획득';
          } else if (data.member[sender].lv === 280) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 30);
            addRewards(data, sender, "혼자레이드리셋권😝", 30);
            addRewards(data, sender, "슬롯상자🧳", 70);
            congratmsg = '축하합니다! 레벨 280을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 30개,\n혼자레이드리셋권😝 30개,\n슬롯상자🧳 70개 획득';
          } else if (data.member[sender].lv === 290) {
            addRewards(data, sender, "극락상자👹", 5);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 30);
            addRewards(data, sender, "혼자레이드리셋권😝", 30);
            addRewards(data, sender, "슬롯상자🧳", 80);
            congratmsg = '축하합니다! 레벨 290을 달성했습니다.\n극락상자👹 5개,\n펫 장비드랍방지권🛡 30개,\n혼자레이드리셋권😝 30개,\n슬롯상자🧳 80개 획득';
          } else if (data.member[sender].lv === 300) {
            addRewards(data, sender, "극락상자👹", 7);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 35);
            addRewards(data, sender, "혼자레이드리셋권😝", 35);
            addRewards(data, sender, "슬롯상자🧳", 100);
            congratmsg = '축하합니다! 만랩 레벨 300을 달성했습니다.\n극락상자👹 7개,\n펫 장비드랍방지권🛡 35개,\n혼자레이드리셋권😝 35개,\n슬롯상자🧳 100개 획득';
          }
          let totalLv = data.member[sender].lv + data.member[sender].lv0;
          if (totalLv % 500 === 0) {
            addRewards(data, sender, "극락상자👹", 10);
            addRewards(data, sender, "혼자레이드리셋권😝", 30);
            addRewards(data, sender, "펫 장비드랍방지권🛡", 30);
            addRewards(data, sender, "슬롯상자🧳", 50);
            addRewards(data, sender, "펫 강화석⭐", 10);
            addRewards(data, sender, "불멸 강화석🪬", 10);
            additionalRewardsMsg = '누적 레벨이 500에 도달하여\n보너스 보상을 획득하셨습니다.\n' + '극락상자👹 10개,\n혼자레이드리셋권😝 30개,\n펫 장비드랍방지권🛡 30개,\n슬롯상자🧳 50개,\n펫 강화석⭐ 10개,\n불멸 강화석🪬 10개 획득';
          }
          replier.reply(lvlupmsg);
          replier.reply(congratmsg);
          replier.reply(additionalRewardsMsg);
        }
        if (data.member[sender].pet.newimg0) {
          zombieadd = true;
        }
        if (zombieadd == true && !data.member[sender].pet.newimg && !data.member[sender].pet.newimg2) {
          var randomZombieEmoji0 = zombieEmojis[Math.floor(Math.random() * zombieEmojis.length)];
          data.member[sender].pet.newimg = randomZombieEmoji0;
          zombieadd = false;
          let ZBCount = 0;
          for (let user in data.member) {
            if (data.member[user].pet && data.member[user].pet.newimg) {
              ZBCount++;
            }
          }
          if (ZBCount > 19) {
            Api.replyRoom(room1, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
            Api.replyRoom(room2, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
            Api.replyRoom(room3, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
            Api.replyRoom(room4, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
            for (let user in data.member) {
              if (data.member[user].pet && data.member[user].pet.newimg) {
                data.member[user].point += parseInt(zombiewinreward);
                delete data.member[user].pet.newimg;
              }
              if (data.member[user].pet && data.member[user].pet.newimg2) {
                Api.replyRoom(room1, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                Api.replyRoom(room2, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                Api.replyRoom(room3, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                Api.replyRoom(room4, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                delete data.member[user].pet.newimg2;
              }
              if (data.member[user].pet && data.member[user].pet.newimg0) {
                if (data.member[user].bag[zombieRewards1] === undefined) {
                  data.member[user].bag[zombieRewards1] = 1;                // 상품을 bag에 추가
                } else {
                  data.member[user].bag[zombieRewards1]++;
                }
                Api.replyRoom(room1, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                Api.replyRoom(room2, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                Api.replyRoom(room3, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                Api.replyRoom(room4, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                delete data.member[user].pet.newimg0;
              }
              zombieadd = false;
              addfirstZB = false;
              addhealer = false;
            }
          }
        }
        if (addhealer == true && !data.member[sender].pet.newimg && !data.member[sender].pet.newimg0 && !data.member[sender].pet.newimg2) {
          data.member[sender].pet.newimg2 = 1;
          addhealer = false;
          Api.replyRoom("팻 테스트방", "백신 선정완료");
        }
        if (addfirstZB == true && !data.member[sender].pet.newimg && !data.member[sender].pet.newimg0 && !data.member[sender].pet.newimg2) {
          var randomZombieEmoji1 = zombieEmojis[Math.floor(Math.random() * zombieEmojis.length)];
          data.member[sender].pet.newimg0 = 1;
          data.member[sender].pet.newimg = randomZombieEmoji1;
          addfirstZB = false;
          Api.replyRoom("팻 테스트방", "숙주 선정완료");
        }
        if (msg === "/리셋" && (sender == "오픈채팅봇" || sender == "호잉 남")) {
          resetAttendance(data, replier);
          stopAllIntervals(data);
          delete data.previnterval;
        }
        if (msg === '/r' && (sender == "젤리 남" || sender == "호이 남")) {
          data.member[sender].cntlike = 0;
        }
        if (msg.startsWith('/슬롯머신 ')) {
          let parts = msg.split(' ');
          let openCount = parseInt(parts[1]);
          debuggerLog(openCount + '회 실행')
          // 입력된 숫자가 없거나 잘못된 경우 기본값으로 1을 설정
          if (isNaN(openCount) || openCount < 1) {
            openCount = 1;
          }

          if (data.member[sender].bag['슬롯코인🪙'] < openCount) {
            replier.reply('[' + checkRank(data, sender) + '] 님\n[슬롯코인🪙]이 부족합니다.');
            return;
          } else {
            data.member[sender].bag['슬롯코인🪙'] -= openCount;
            if (data.member[sender].bag['슬롯코인🪙'] == 0) {
              delete data.member[sender].bag['슬롯코인🪙'];
            }
          }

          // 슬롯머신 실행 결과 
          let slotResults = {};
          let isJackpotFlag = false;
          for (let i = 0; i < openCount; i++) {
            var slotimg = ['☠️', '☠️', '☠️', '💝', '💝', '💝', '🐔', '🐔', '🐔', '🛡', '🛡', '🛡', '🎁', '🎁', '🎁', '⭐', '⭐', '7️⃣'];
            let slotPrizes = {
              '7️⃣': '잭팟당첨!!',
              '☠️': '잡템☠️',
              //    '🎫': '고급 급티켓🎫',
              '💝': '랜덤박스💝',
              '⭐': '펫 강화석⭐',
              '💰': '금괴💰',
              '😝': '혼자레이드리셋권😝',
              '🎁': '미니상자🎁',
              '🛡': '방패조각🛡',
              //   '🛡': '펫 장비드랍방지권🛡',
              '🐔': '치킨상자🐔'
            };
            if (data.slotPot) {
              if (data.slotPot > 99999999) {
                data.slotPot = 100000000;
                slotimg = ['☠️', '☠️', '☠️', '🎫', '🛡', '🛡', '💝', '💝', '🐔', '🐔', '🐔', '💰', '💰', '💰', '🎁', '🎁', '🎁', '7️⃣', '7️⃣'];
              } else if (data.slotPot > 79999999) {
                data.slotPot += parseInt(5000);
              } else if (data.slotPot > 29999999) {
                data.slotPot += parseInt(10000);
              } else {
                data.slotPot += parseInt(20000);
              }
            } else {
              data.slotPot = 10000000;
            }

            var slotResult = [];
            for (let i = 0; i < 9; i++) {
              slotResult[i] = slotimg[Math.floor(Math.random() * slotimg.length)];
            }
            var countSevens = slotResult.filter(symbol => symbol === '7️⃣').length;
            var horizontalMatch = '';
            var verticalMatch = '';
            var diagonalMatch = '';
            var slotpoints = 0;
            var matchedSymbol = '';
            var prize = '';

            //수평 매치 체크
            if ((slotResult[0] === slotResult[1] && slotResult[1] === slotResult[2]) || (slotResult[3] === slotResult[4] && slotResult[4] === slotResult[5]) || (slotResult[6] === slotResult[7] && slotResult[7] === slotResult[8])) {

              if (slotResult[0] === slotResult[1] && slotResult[1] === slotResult[2]) {
                horizontalMatch += slotResult[0] + ' ';
                matchedSymbol = slotResult[0];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }

              if (slotResult[3] === slotResult[4] && slotResult[4] === slotResult[5]) {
                horizontalMatch += slotResult[3] + ' ';
                matchedSymbol = slotResult[3];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }

              if (slotResult[6] === slotResult[7] && slotResult[7] === slotResult[8]) {
                horizontalMatch += slotResult[6] + ' ';
                matchedSymbol = slotResult[6];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;
                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
            }

            //수직 매치 체크
            if ((slotResult[0] === slotResult[3] && slotResult[3] === slotResult[6]) || (slotResult[1] === slotResult[4] && slotResult[4] === slotResult[7]) || (slotResult[2] === slotResult[5] && slotResult[5] === slotResult[8])) {
              if (slotResult[0] === slotResult[3] && slotResult[3] === slotResult[6]) {
                verticalMatch += slotResult[0] + ' ';
                matchedSymbol = slotResult[0];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
              if (slotResult[1] === slotResult[4] && slotResult[4] === slotResult[7]) {
                verticalMatch += slotResult[1] + ' ';
                matchedSymbol = slotResult[1];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
              if (slotResult[2] === slotResult[5] && slotResult[5] === slotResult[8]) {
                verticalMatch += slotResult[2] + ' ';
                matchedSymbol = slotResult[2];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
            }

            //대각선 매치 체크
            if ((slotResult[0] === slotResult[4] && slotResult[4] === slotResult[8]) || (slotResult[2] === slotResult[4] && slotResult[4] === slotResult[6])) {
              if (slotResult[0] === slotResult[4] && slotResult[4] === slotResult[8]) {
                diagonalMatch += slotResult[0] + ' ';
                matchedSymbol = slotResult[0];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
              if (slotResult[2] === slotResult[4] && slotResult[4] === slotResult[6]) {
                diagonalMatch += slotResult[2] + ' ';
                matchedSymbol = slotResult[2];
                prize = slotPrizes[matchedSymbol];
                if (matchedSymbol == '7️⃣') {
                  slotpoints += data.slotPot; slotResults.point += data.slotPot;

                  isJackpotFlag = true;
                } else {
                  slotpoints += 100000; slotResults.point += 100000;
                  isJackpotFlag = false;
                  data.member[sender].bag[prize] = (data.member[sender].bag[prize] || 0) + 1;
                  if (slotResults.item[prize]) {
                    slotResults.item[prize]++;
                  } else {
                    slotResults.item[prize] =  1;
                  }
                }
              }
            }

            //잭팟일 때
            if (isJackpotFlag) {
              data.slotPot = 10000000;
              debuggerLog('젝팟');
            }

            // 경험치 부스트
            let bonusBooster = parseInt(10 * countSevens);
            slotResults.bonusBooster += bonusBooster;
            if (data.member[sender].boostercnt) {
              data.member[sender].boostercnt += parseInt(bonusBooster);
            } else {
              data.member[sender].boostercnt = parseInt(bonusBooster);
            }
            // 포인트일괄지급
            data.member[sender].point += parseInt(slotResults.point);
            debuggerLog(i + '/' + openCount + '회 : ' + JSON.stringify(slotResults));

          }
          let resultMessage = '🎰호이슬롯🎰 (' + openCount + '회)'
          resultMessage += '\n잭팟포인트 : 🅟' + slotResults.point
          resultMessage += '\n경험치 부스트 : ' + slotResults.bonusBooster
          resultMessage += '\n\n슬롯머신 결과:'
          Object.keys(slotResults.item).forEach(prize => {
            resultMessage += '\n' + prize + slotResults[prize] + '개';
          });

          replier.reply(resultMessage);
        }
        if (msg.startsWith('/슬롯오픈')) {
          // 명령어에서 숫자 부분을 추출
          let parts = msg.split(' ');
          let openCount = parseInt(parts[1]);

          // 입력된 숫자가 없거나 잘못된 경우 기본값으로 1을 설정
          if (isNaN(openCount) || openCount < 1) {
            openCount = 1;
          }

          // 사용자의 슬롯상자 수량 확인
          if (data.member[sender].bag["슬롯상자🧳"]) {
            if (data.member[sender].bag["슬롯상자🧳"] >= openCount) {
              // 슬롯상자 개수 감소
              data.member[sender].bag["슬롯상자🧳"] -= openCount;
              if (data.member[sender].bag["슬롯상자🧳"] === 0) {
                delete data.member[sender].bag["슬롯상자🧳"];
              }

              // 총 슬롯코인 개수 계산
              let totalSlotCoins = 0;
              for (let i = 0; i < openCount; i++) {
                totalSlotCoins += parseInt(Math.floor(Math.random() * 6) + 5);
              }

              // 슬롯코인을 가방에 추가
              if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
                data.member[sender].bag['슬롯코인🪙'] = totalSlotCoins;
              } else {
                data.member[sender].bag['슬롯코인🪙'] += totalSlotCoins;
              }

              // 결과 메시지 생성 및 전송
              let slotbagmsg = "슬롯상자🧳 " + openCount + "개 오픈!!\n[" + checkRank(data, sender) + "] 님 슬롯코인🪙 " + totalSlotCoins + "개 획득";
              replier.reply(slotbagmsg);
            } else {
              replier.reply("슬롯상자🧳가 충분하지 않습니다.");
            }
          } else {
            replier.reply("슬롯상자🧳가 필요합니다.");
          }
        }

        if (msg.startsWith('/슬롯오픈')) {
          // 명령어에서 숫자 부분을 추출
          let parts = msg.split(' ');
          let openCount = parseInt(parts[1]);

          // 입력된 숫자가 없거나 잘못된 경우 기본값으로 1을 설정
          if (isNaN(openCount) || openCount < 1) {
            openCount = 1;
          }

          // 사용자의 슬롯상자 수량 확인
          if (data.member[sender].bag["슬롯상자🧳"]) {
            if (data.member[sender].bag["슬롯상자🧳"] >= openCount) {
              // 슬롯상자 개수 감소
              data.member[sender].bag["슬롯상자🧳"] -= openCount;
              if (data.member[sender].bag["슬롯상자🧳"] === 0) {
                delete data.member[sender].bag["슬롯상자🧳"];
              }

              // 총 슬롯코인 개수 계산
              let totalSlotCoins = 0;
              for (let i = 0; i < openCount; i++) {
                totalSlotCoins += parseInt(Math.floor(Math.random() * 6) + 5);
              }

              // 슬롯코인을 가방에 추가
              if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
                data.member[sender].bag['슬롯코인🪙'] = totalSlotCoins;
              } else {
                data.member[sender].bag['슬롯코인🪙'] += totalSlotCoins;
              }

              // 결과 메시지 생성 및 전송
              let slotbagmsg = "슬롯상자🧳 " + openCount + "개 오픈!!\n[" + checkRank(data, sender) + "] 님 슬롯코인🪙 " + totalSlotCoins + "개 획득";
              replier.reply(slotbagmsg);
            } else {
              replier.reply("슬롯상자🧳가 충분하지 않습니다.");
            }
          } else {
            replier.reply("슬롯상자🧳가 필요합니다.");
          }
        }


        if (msg === '/금괴오픈') {
          if (data.member[sender].bag["금괴상자💰"]) {
            if (data.member[sender].bag["금괴상자💰"] > 1) {
              data.member[sender].bag["금괴상자💰"]--;
            } else {
              delete data.member[sender].bag["금괴상자💰"];
            }
            var slotbagqty = parseInt(Math.floor(Math.random() * 6) + 5);
            if (data.member[sender].bag['금괴💰'] === undefined) {
              data.member[sender].bag['금괴💰'] = slotbagqty;            // 상품을 bag에 추가
            } else {
              data.member[sender].bag['금괴💰'] += slotbagqty;
            }
            let slotbagmsg = "금괴상자💰 오픈!!\n[" + checkRank(data, sender) + "] 님 금괴💰" + slotbagqty + "개 획득";
            replier.reply(slotbagmsg);
          } else {
            replier.reply("금괴상자💰가 필요합니다.");
          }
        }

        if (msg === '/이걸안사?') {
          if (data.member[sender].bag["슬롯가방🎒(+5) 패키지"]) {
            if (data.member[sender].bag["슬롯가방🎒(+5) 패키지"] > 1) {
              data.member[sender].bag["슬롯가방🎒(+5) 패키지"]--;
            } else {
              delete data.member[sender].bag["슬롯가방🎒(+5) 패키지"];
            }

            var petStoneQty = 1;
            var slotBoxQty = 3;
            var petEquipPreventQty = 5;
            var soloRaidResetQty = 30;
            var tierUpgradeTicketQty = 50;
            //   var kr = 1;
            var post = 1;

            if (data.member[sender].bag['슬롯가방🎒(+5)'] === undefined) {
              data.member[sender].bag['슬롯가방🎒(+5)'] = petStoneQty;
            } else {
              data.member[sender].bag['슬롯가방🎒(+5)'] += petStoneQty;
            }

            if (data.member[sender].bag['펫 강화석⭐'] === undefined) {
              data.member[sender].bag['펫 강화석⭐'] = slotBoxQty;
            } else {
              data.member[sender].bag['펫 강화석⭐'] += slotBoxQty;
            }

            if (data.member[sender].bag['슬롯상자🧳'] === undefined) {
              data.member[sender].bag['슬롯상자🧳'] = petEquipPreventQty;
            } else {
              data.member[sender].bag['슬롯상자🧳'] += petEquipPreventQty;
            }

            if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
              data.member[sender].bag['슬롯코인🪙'] = soloRaidResetQty;
            } else {
              data.member[sender].bag['슬롯코인🪙'] += soloRaidResetQty;
            }

            if (data.member[sender].bag['슬롯지원금'] === undefined) {
              data.member[sender].bag['슬롯지원금'] = tierUpgradeTicketQty;
            } else {
              data.member[sender].bag['슬롯지원금'] += tierUpgradeTicketQty;
            }

            //    if (data.member[sender].bag['슬롯버킨백👝'] === undefined) {
            //      data.member[sender].bag['슬롯버킨백👝'] = kr;
            //    } else {
            //      data.member[sender].bag['슬롯버킨백👝'] += kr;
            //   }
            if (data.member[sender].bag['호이의 편지✉(/편지를열어본다)'] === undefined) {
              data.member[sender].bag['호이의 편지✉(/편지를열어본다)'] = post;
            } else {
              data.member[sender].bag['호이의 편지✉(/편지를열어본다)'] += post;
            }
            let openMsg = "와 이걸 사네? 모야모야\n너 대단할지도..\n멋지다능!\n\n[" + checkRank(data, sender) + "] 님\n" +
              "슬롯가방🎒(+5) " + petStoneQty + "개\n" +
              "펫 강화석⭐ " + slotBoxQty + "개\n" +
              "슬롯상자🧳 " + petEquipPreventQty + "개\n" +
              "슬롯코인🪙 " + soloRaidResetQty + "개\n" +
              "슬롯지원금 " + tierUpgradeTicketQty + "개\n" +
              //    "슬롯버킨백👝 " + kr + "개\n" +
              "호이의 편지✉ " + post + "개";
            replier.reply(openMsg);
          } else {
            replier.reply("슬롯가방🎒(+5) 패키지가 필요합니다.");
          }
        }
        if (msg.startsWith('/가방패키지, ')) {
          var commandParts = msg.split(', '); // 명령어를 ", " 기준으로 나눕니다.

          // 명령어를 입력한 사용자가 "호이 남"인지 확인합니다.
          if (sender !== '호이 남') {
            replier.reply("해당 명령어를 사용할 권한이 없습니다.");
          } else {
            if (commandParts.length !== 2) {
              replier.reply("명령어 형식이 잘못되었습니다. 올바른 형식: /패키지, 사용자아이디");
            } else {
              var targetUserId = commandParts[1].trim(); // 명령어 뒤에 입력된 아이디를 가져옵니다.

              if (!data.member[targetUserId]) {
                replier.reply("해당 사용자를 찾을 수 없습니다.");
              } else {
                if (data.member[targetUserId].bag['슬롯가방🎒(+5) 패키지'] === undefined) {
                  data.member[targetUserId].bag['슬롯가방🎒(+5) 패키지'] = 1;
                } else {
                  data.member[targetUserId].bag['슬롯가방🎒(+5) 패키지'] += 1;
                }

                replier.reply("[" + targetUserId + "]님에게 슬롯가방🎒(+5) 패키지가 지급되었습니다.");
              }
            }
          }
        }


        if (msg === '/주간오픈') {
          if (data.member[sender].bag["주간상자🦋(/주간오픈)"] !== undefined && data.member[sender].bag["주간상자🦋(/주간오픈)"] > 0) {
            // 주간상자🦋 개수 감소
            if (data.member[sender].bag["주간상자🦋(/주간오픈)"] > 1) {
              data.member[sender].bag["주간상자🦋(/주간오픈)"]--;
            } else {
              delete data.member[sender].bag["주간상자🦋(/주간오픈)"];
            }

            var soloRaidResetQty = 20;
            var petEquipProtectQty = 10;
            var slotBoxQty = 10;
            var petEnhanceStoneQty = 10;
            var castleDrawTicketQty = 10;
            var weeklySupportFundQty = 150;
            var reset = 5;

            if (data.member[sender].bag['혼자레이드리셋권😝'] === undefined) {
              data.member[sender].bag['혼자레이드리셋권😝'] = soloRaidResetQty;
            } else {
              data.member[sender].bag['혼자레이드리셋권😝'] += soloRaidResetQty;
            }

            if (data.member[sender].bag['펫 장비드랍방지권🛡'] === undefined) {
              data.member[sender].bag['펫 장비드랍방지권🛡'] = petEquipProtectQty;
            } else {
              data.member[sender].bag['펫 장비드랍방지권🛡'] += petEquipProtectQty;
            }

            if (data.member[sender].bag['슬롯상자🧳'] === undefined) {
              data.member[sender].bag['슬롯상자🧳'] = slotBoxQty;
            } else {
              data.member[sender].bag['슬롯상자🧳'] += slotBoxQty;
            }

            if (data.member[sender].bag['펫 강화석⭐'] === undefined) {
              data.member[sender].bag['펫 강화석⭐'] = petEnhanceStoneQty;
            } else {
              data.member[sender].bag['펫 강화석⭐'] += petEnhanceStoneQty;
            }

            if (data.member[sender].bag['캐슬뽑기권♟'] === undefined) {
              data.member[sender].bag['캐슬뽑기권♟'] = castleDrawTicketQty;
            } else {
              data.member[sender].bag['캐슬뽑기권♟'] += castleDrawTicketQty;
            }

            if (data.member[sender].bag['주간후원지원금🍭'] === undefined) {
              data.member[sender].bag['주간후원지원금🍭'] = weeklySupportFundQty;
            } else {
              data.member[sender].bag['주간후원지원금🍭'] += weeklySupportFundQty;
            }

            if (data.member[sender].bag['캐슬대전리셋권🐶'] === undefined) {
              data.member[sender].bag['캐슬대전리셋권🐶'] = reset;
            } else {
              data.member[sender].bag['캐슬대전리셋권🐶'] += reset;
            }


            let openMsg = "주간상자🦋를 오픈합니다!\n\n" +
              "혼자레이드리셋권😝 " + soloRaidResetQty + "개\n" +
              "펫 장비드랍방지권🛡 " + petEquipProtectQty + "개\n" +
              "슬롯상자🧳 " + slotBoxQty + "개\n" +
              "펫 강화석⭐ " + petEnhanceStoneQty + "개\n" +
              "캐슬뽑기권♟ " + castleDrawTicketQty + "개\n" +
              "주간후원지원금🍭 " + weeklySupportFundQty + "개\n" +
              "캐슬대전리셋권🐶 " + reset + "개";

            replier.reply(openMsg);
          } else {
            replier.reply("주간상자🦋가 없습니다. 후원해 주세요.");
          }
        }

        if (msg.startsWith('/주간,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["주간상자🦋(/주간오픈)"] === undefined) {
              data.member[userId].bag["주간상자🦋(/주간오픈)"] = 1;
            } else {
              data.member[userId].bag["주간상자🦋(/주간오픈)"]++;
            }
            replier.reply(userId + "님에게 주간상자🦋를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }
        if (msg === '/월간오픈') {
          if (data.member[sender].bag["월간상자🌸(/월간오픈)"] !== undefined && data.member[sender].bag["월간상자🌸(/월간오픈)"] > 0) {
            // 월간상자🦋 개수 감소
            if (data.member[sender].bag["월간상자🌸(/월간오픈)"] > 1) {
              data.member[sender].bag["월간상자🌸(/월간오픈)"]--;
            } else {
              delete data.member[sender].bag["월간상자🌸(/월간오픈)"];
            }

            var soloRaidResetQty = 60;
            var petEquipProtectQty = 30;
            var slotBoxQty = 30;
            var petEnhanceStoneQty = 30;
            var castleDrawTicketQty = 30;
            var cookieQty = 50;
            var reset = 25;

            if (data.member[sender].bag['혼자레이드리셋권😝'] === undefined) {
              data.member[sender].bag['혼자레이드리셋권😝'] = soloRaidResetQty;
            } else {
              data.member[sender].bag['혼자레이드리셋권😝'] += soloRaidResetQty;
            }

            if (data.member[sender].bag['펫 장비드랍방지권🛡'] === undefined) {
              data.member[sender].bag['펫 장비드랍방지권🛡'] = petEquipProtectQty;
            } else {
              data.member[sender].bag['펫 장비드랍방지권🛡'] += petEquipProtectQty;
            }

            if (data.member[sender].bag['슬롯상자🧳'] === undefined) {
              data.member[sender].bag['슬롯상자🧳'] = slotBoxQty;
            } else {
              data.member[sender].bag['슬롯상자🧳'] += slotBoxQty;
            }

            if (data.member[sender].bag['펫 강화석⭐'] === undefined) {
              data.member[sender].bag['펫 강화석⭐'] = petEnhanceStoneQty;
            } else {
              data.member[sender].bag['펫 강화석⭐'] += petEnhanceStoneQty;
            }

            if (data.member[sender].bag['캐슬뽑기권♟'] === undefined) {
              data.member[sender].bag['캐슬뽑기권♟'] = castleDrawTicketQty;
            } else {
              data.member[sender].bag['캐슬뽑기권♟'] += castleDrawTicketQty;
            }

            if (data.member[sender].bag['꼬츈쿠키🐢'] === undefined) {
              data.member[sender].bag['꼬츈쿠키🐢'] = cookieQty;
            } else {
              data.member[sender].bag['꼬츈쿠키🐢'] += cookieQty;
            }
            if (data.member[sender].bag['캐슬대전리셋권🐶'] === undefined) {
              data.member[sender].bag['캐슬대전리셋권🐶'] = reset;
            } else {
              data.member[sender].bag['캐슬대전리셋권🐶'] += reset;
            }

            let openMsg = "월간상자🦋를 오픈합니다!\n\n" +
              "혼자레이드리셋권😝 " + soloRaidResetQty + "개\n" +
              "펫 장비드랍방지권🛡 " + petEquipProtectQty + "개\n" +
              "슬롯상자🧳 " + slotBoxQty + "개\n" +
              "펫 강화석⭐ " + petEnhanceStoneQty + "개\n" +
              "캐슬뽑기권♟ " + castleDrawTicketQty + "개\n" +
              "꼬츈쿠키🐢" + cookieQty + "개\n" +
              "캐슬대전리셋권🐶" + reset + "개";

            replier.reply(openMsg);
          } else {
            replier.reply("월간상자🦋가 없습니다. 후원해 주세요.");
          }
        }

        if (msg.startsWith('/월간,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["월간상자🌸(/월간오픈)"] === undefined) {
              data.member[userId].bag["월간상자🌸(/월간오픈)"] = 1;
            } else {
              data.member[userId].bag["월간상자🌸(/월간오픈)"]++;
            }
            replier.reply(userId + "님에게 월간상자🌸를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }

        if (msg === '/초보오픈') {
          if (data.member[sender].bag["초보자패키지🌱(/초보오픈)"] !== undefined && data.member[sender].bag["초보자패키지🌱(/초보오픈)"] > 0) {
            if (data.member[sender].bag["초보자패키지🌱(/초보오픈)"] > 1) {
              data.member[sender].bag["초보자패키지🌱(/초보오픈)"]--;
            } else {
              delete data.member[sender].bag["초보자패키지🌱(/초보오픈)"];
            }

            var ticketQty = 1;
            var petEnhanceStoneQty = 3;
            var petEquipProtectQty = 3;
            var soloRaidResetQty = 5;
            var miniBoxQty = 3;
            var slotCoinQty = 20;
            var newbieWelcomeQty = 1;

            if (data.member[sender].bag['티어 승급티켓🎟'] === undefined) {
              data.member[sender].bag['티어 승급티켓🎟'] = ticketQty;
            } else {
              data.member[sender].bag['티어 승급티켓🎟'] += ticketQty;
            }

            if (data.member[sender].bag['펫 강화석⭐'] === undefined) {
              data.member[sender].bag['펫 강화석⭐'] = petEnhanceStoneQty;
            } else {
              data.member[sender].bag['펫 강화석⭐'] += petEnhanceStoneQty;
            }

            if (data.member[sender].bag['펫 장비드랍방지권🛡'] === undefined) {
              data.member[sender].bag['펫 장비드랍방지권🛡'] = petEquipProtectQty;
            } else {
              data.member[sender].bag['펫 장비드랍방지권🛡'] += petEquipProtectQty;
            }

            if (data.member[sender].bag['혼자레이드리셋권😝'] === undefined) {
              data.member[sender].bag['혼자레이드리셋권😝'] = soloRaidResetQty;
            } else {
              data.member[sender].bag['혼자레이드리셋권😝'] += soloRaidResetQty;
            }

            if (data.member[sender].bag['미니상자🎁'] === undefined) {
              data.member[sender].bag['미니상자🎁'] = miniBoxQty;
            } else {
              data.member[sender].bag['미니상자🎁'] += miniBoxQty;
            }

            if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
              data.member[sender].bag['슬롯코인🪙'] = slotCoinQty;
            } else {
              data.member[sender].bag['슬롯코인🪙'] += slotCoinQty;
            }

            if (data.member[sender].bag['초보자패키지 후원자🌱'] === undefined) {
              data.member[sender].bag['초보자패키지 후원자🌱'] = newbieWelcomeQty;
            } else {
              data.member[sender].bag['초보자패키지 후원자🌱'] += newbieWelcomeQty;
            }
            let openMsg = "초보자님 이거 먹고 힘내세요 알아요 알아 그 고통 알아요 지금까지 많이 힘들었죠 울지마요 왜 울어요 뚝 눈물 뚝!\n\n" +
              "티어 승급티켓🎟 " + ticketQty + "개\n" +
              "펫 강화석⭐ " + petEnhanceStoneQty + "개\n" +
              "펫 장비드랍방지권🛡 " + petEquipProtectQty + "개\n" +
              "혼자레이드리셋권😝 " + soloRaidResetQty + "개\n" +
              "미니상자🎁" + miniBoxQty + "개\n" +
              "슬롯코인🪙" + slotCoinQty + "개\n" +
              "초보자패키지 후원자🌱 " + newbieWelcomeQty + "개";

            replier.reply(openMsg);
          } else {
            replier.reply("너 초보야?🌱 너 초보 맞아?🌱 맞냐고 그러다 맞아🌱");
          }
        }





        // 상자 오픈과 관련된 아이템들을 사용자의 가방에 추가하는 함수
        if (msg === '/초보오픈2') {
          if (data.member[sender].bag["초보자패키지🌱🌱(/초보오픈2)"] !== undefined && data.member[sender].bag["초보자패키지🌱🌱(/초보오픈2)"] > 0) {
            // 초보자패키지 개수 감소
            if (data.member[sender].bag["초보자패키지🌱🌱(/초보오픈2)"] > 1) {
              data.member[sender].bag["초보자패키지🌱🌱(/초보오픈2)"]--;
            } else {
              delete data.member[sender].bag["초보자패키지🌱🌱(/초보오픈2)"];
            }

            // 아이템 추가
            var items3 = {
              '티어 승급티켓🎟': 5,
              '캐슬호이봇유닛🤖(+100💕)': 1,
              '펫 강화석⭐': 5,
              '펫 장비드랍방지권🛡': 10,
              '혼자레이드리셋권😝': 10,
              '선물상자🎁': 3,
              '슬롯코인🪙': 30,
              '초보자패키지 후원자🌱🌱': 1
            };

            for (var item in items3) {
              addItemToBag(data.member[sender].bag, item, items3[item]);
            }

            // 메세지 작성
            let openMsg = "초보자님 이거 먹고 힘내세요 알아요 알아 그 고통 알아요 지금까지 많이 힘들었죠 울지마요 왜 울어요 뚝 눈물 뚝!\n\n" +
              "티어 승급티켓🎟  " + items3['티어 승급티켓🎟'] + "개\n" +
              "캐슬호이봇유닛🤖(+100💕)  " + items3['캐슬호이봇유닛🤖(+100💕)'] + "개\n" +
              "펫 강화석⭐  " + items3['펫 강화석⭐'] + "개\n" +
              "펫 장비드랍방지권🛡  " + items3['펫 장비드랍방지권🛡'] + "개\n" +
              "혼자레이드리셋권😝  " + items3['혼자레이드리셋권😝'] + "개\n" +
              "선물상자🎁  " + items3['선물상자🎁'] + "개\n" +
              "슬롯코인🪙  " + items3['슬롯코인🪙'] + "개\n" +
              "초보자패키지 후원자🌱🌱  " + items3['초보자패키지 후원자🌱🌱'] + "개";

            replier.reply(openMsg);
          } else {
            replier.reply("너 초보야?🌱 너 초보 맞아?🌱맞냐고 그러다 맞아🌱\n찾아간다 어디냐🌱");
          }
        }

        // 새로운 명령어 /초보오픈3 추가
        if (msg === '/초보오픈3') {
          if (data.member[sender].bag["초보자패키지🌱🌱🌱(/초보오픈3)"] !== undefined && data.member[sender].bag["초보자패키지🌱🌱🌱(/초보오픈3)"] > 0) {
            // 초보자패키지 개수 감소
            if (data.member[sender].bag["초보자패키지🌱🌱🌱(/초보오픈3)"] > 1) {
              data.member[sender].bag["초보자패키지🌱🌱🌱(/초보오픈3)"]--;
            } else {
              delete data.member[sender].bag["초보자패키지🌱🌱🌱(/초보오픈3)"];
            }

            // 아이템 추가
            var items3 = {
              '티어 승급티켓🎟': 10,
              '캐슬호랜유닛🎲(+300💕)': 1,
              '펫 강화석⭐': 20,
              '펫 장비드랍방지권🛡': 30,
              '혼자레이드리셋권😝': 30,
              '극락상자👹': 5,
              '슬롯코인🪙': 100,
              '초보자패키지 후원자🌱🌱🌱': 1
            };

            for (var item in items3) {
              addItemToBag(data.member[sender].bag, item, items3[item]);
            }

            // 메세지 작성
            let openMsg = "초보자님 이거 먹고 힘내세요 알아요 알아 그 고통 알아요 지금까지 많이 힘들었죠 울지마요 왜 울어요 뚝 눈물 뚝!\n\n" +
              "티어 승급티켓🎟  " + items3['티어 승급티켓🎟'] + "개\n" +
              "캐슬호랜유닛🎲(+300💕)  " + items3['캐슬호랜유닛🎲(+300💕)'] + "개\n" +
              "펫 강화석⭐  " + items3['펫 강화석⭐'] + "개\n" +
              "펫 장비드랍방지권🛡  " + items3['펫 장비드랍방지권🛡'] + "개\n" +
              "혼자레이드리셋권😝  " + items3['혼자레이드리셋권😝'] + "개\n" +
              "극락상자👹  " + items3['극락상자👹'] + "개\n" +
              "슬롯코인🪙  " + items3['슬롯코인🪙'] + "개\n" +
              "초보자패키지 후원자🌱🌱🌱  " + items3['초보자패키지 후원자🌱🌱🌱'] + "개";

            replier.reply(openMsg);
          } else {
            replier.reply("뭐래 찐따야🌱");
          }
        }
        if (msg.startsWith('/캐슬코인')) {
          var args = msg.split(' ');

          // 몇 개 사용할지 결정 (기본은 1개)
          var numToOpen = 1;
          if (args.length > 1) {
            numToOpen = Math.max(1, parseInt(args[1])); // 최소 1개 이상
          }

          // 사용자의 가방에 캐슬코인이 충분히 있는지 확인
          if (data.member[sender].bag['캐슬코인🥇'] && data.member[sender].bag['캐슬코인🥇'] >= numToOpen) {
            let itemCounts = {}; // 각 아이템의 개수를 저장할 객체
            let rank = checkRank(data, sender) || "Unknown Rank";  // checkRank 함수가 undefined를 반환하지 않도록 처리
            let message5 = '';  // 결과 메시지

            for (var i = 0; i < numToOpen; i++) {
              var chance = Math.random();  // 0부터 1 사이의 랜덤한 값 생성
              var item = '';  // 아이템 이름을 저장할 변수

              if (chance < 0.00001) {  // 0.001% 확률
                item = '🅟5억 포인트';
                // 전체 채팅방에 공지 전송
                replier.reply("🎉축하드립니다! [" + rank + "] " + sender + " 님이 🅟5억 포인트를 획득하셨습니다!🎉");
              } else if (chance < 0.0001) {  // 0.09% 확률
                item = '환생버섯🍄';
              } else if (chance < 0.001) {  // 0.9% 확률
                item = '고급 티어 승급티켓🎫';
              } else if (chance < 0.01) {  // 1% 확률
                item = '나락상자👹';
              } else if (chance < 0.02) {  // 1% 확률
                item = '펫강화상자⭐';
              } else if (chance < 0.04) {  // 2% 확률
                item = '극락상자👹';
              } else if (chance < 0.11) {  // 7% 확률
                item = '잡템상자☠';
              } else if (chance < 0.26) {  // 15% 확률
                item = '펫 장비드랍방지권🛡';
              } else {  // 남은 확률로 '영주민의 코묻은 돈💰'
                item = '영주민의 코묻은 돈💰';
              }

              // 아이템이 '🅟5억 포인트'인 경우와 아닌 경우 처리
              if (item === '🅟5억 포인트') {
                if (!data.member[sender].point) {
                  data.member[sender].point = 0;
                }
                data.member[sender].point += 500000000;  // 5억 포인트 추가
              } else {
                if (itemCounts[item]) {
                  itemCounts[item] += 1;  // 이미 존재하면 수량을 추가
                } else {
                  itemCounts[item] = 1;  // 존재하지 않으면 새로 추가
                }
              }
            }

            // 캐슬코인 개수 차감
            data.member[sender].bag['캐슬코인🥇'] -= numToOpen;
            if (data.member[sender].bag['캐슬코인🥇'] === 0) {
              delete data.member[sender].bag['캐슬코인🥇'];
            }

            // 사용자의 가방에 아이템 추가
            for (let item in itemCounts) {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += itemCounts[item];
              } else {
                data.member[sender].bag[item] = itemCounts[item];
              }
            }

            // 결과 메시지 생성
            message5 += "[" + rank + "] 님의 캐슬코인🥇(" + numToOpen + "회)\n오픈 결과:\n\n";
            for (let item in itemCounts) {
              message5 += item + " " + itemCounts[item] + "개\n";
            }
            message5 += "축하드립니다!";

            replier.reply(message5);
          } else {
            // 캐슬코인이 없거나 부족할 때 메시지 출력
            replier.reply("[" + checkRank(data, sender) + "]님\n캐슬코인🥇이 부족합니다.");
          }
        }
        if (msg === '/캐슬뽑기') {
          // 사용자의 가방에 캐슬뽑기권이 있는지 확인
          if (data.member[sender].bag['캐슬뽑기권♟'] && data.member[sender].bag['캐슬뽑기권♟'] >= 1) {
            var chance = Math.random();  // 0부터 1 사이의 랜덤한 값 생성
            var item = '';  // 아이템 이름을 저장할 변수
            var quantity = 1;  // 아이템의 수량을 저장할 변수
            var message3 = '';  // 출력할 메시지를 저장할 변수
            var isSpecialUnit = false; // 특별 유닛이 나왔는지 체크하는 플래그

            if (chance < 0.001) {  // 0.1% 확률
              // 0.1% 확률로 나오는 유닛 목록
              var specialUnits = ['캐슬버블킹유닛🫧(+1000💕)', '캐슬호이유닛👑(+1500💕)', '캐슬레이유닛👩🏻‍⚕(+1200💕)', '불멸🪬(이미 착용시 +5강)', '캐슬레온킹유닛🦁(+1000💕)', '캐슬건징킹유닛🤴(+1000💕)', '캐슬쏭쏭퀸유닛👸(+1000💕)'];
              item = specialUnits[Math.floor(Math.random() * specialUnits.length)];
              quantity = 1;
              message3 = "대박 🥇레전드유닛 등장🥇\n[" + checkRank(data, sender) + "] 님이\n'" + item + "'을(를)\n뽑았습니다. 앙 기 모 띠☺";
              isSpecialUnit = true;
            } else if (chance < 0.02) {  // 추가 1.9% 확률
              var units = ['캐슬아콩유닛💞(+250💕)', '캐슬레온유닛🇺🇸(+250💕)', '캐슬튜브유닛🇨🇦(+250💕)', '캐슬비광유닛🎴(+250💕)', '캐슬춘배유닛🐯(+250💕)', '캐슬노아유닛🐹(+250💕)', '캐슬베라유닛💘(+250💕)', '캐슬건징어유닛🐙(+250💕)', '캐슬온오프유닛🚘(+250💕)', '캐슬우유유닛🥛(+250💕)', '캐슬산타유닛🎅(+250💕)', '캐슬코크유닛🪽(+250💕)', '캐슬벨라유닛🦄(+250💕)', '캐슬콘트유닛🚹(+250💕)', '캐슬빠루유닛🔧(+250💕)', '캐슬소솜유닛🧸(+250💕)', '캐슬덕구유닛🗿(+250💕)', '캐슬우니대장유닛🃏(+18💕)', '캐슬히히유닛🪀(+250💕)', '캐슬주먹유닛👊(+250💕)', '캐슬사월유닛♠(+250💕)', '캐슬제우유닛⚡(+250💕)', '캐슬베베유닛🐿(+250💕)', '캐슬찐이유닛🪷(+250💕)', '캐슬진주유닛🔮(+250💕)', '캐슬꼬북유닛🐢(+250💕)', '캐슬무지유닛🤶(+250💕)', '캐슬삼삼유닛💜(+33💕)', '캐슬쏭쏭유닛🪻(+250💕)', '캐슬효순유닛🐰(+250💕)', '캐슬알레유닛👀(+250💕)', '캐슬심심유닛🦷(+250💕)', '캐슬흑형유닛🧔🏿‍♂(+250💕)', '캐슬만두유닛🥟(+250💕)', '캐슬죠니유닛😶‍🌫(+250💕)', '캐슬케베유닛💩(+250💕)', '캐슬까까유닛🍪(+250💕)', '캐슬뿜뿜유닛🐣(+250💕)', '캐슬코피유닛🦖(+250💕)', '캐슬쿵쿵유닛🐌(+250💕)', '캐슬머빗유닛🌱(+250💕)', '캐슬웨이유닛🦝(+250💕)', '캐슬악마유닛😈(+250💕)', '캐슬코드유닛🟰(+250💕)', '캐슬데일유닛🩹(+250💕)', '캐슬호박유닛🎃(+250💕)', '캐슬리리유닛👥(+125💕)', '캐슬댕청유닛👥(+125💕)', '캐슬삼오유닛👺(+250💕)', '캐슬라임유닛🍋‍🟩(+250💕)', '캐슬빔빔유닛🍞(+250💕)', '캐슬밤밤유닛🌰(+250💕)', '캐슬구름유닛🌥(+250💕)', '캐슬잔다유닛😴(+250💕)', '캐슬주디유닛🦊(+250💕)', '캐슬히민유닛⚠(+250💕)', '캐슬좌절유닛👨‍🦼(+250💕)', '캐슬코쿠시보유닛⚔(+250💕)', '캐슬농부유닛👨‍🌾(+18💕)', '캐슬쓱싹유닛👻(+250💕)', '캐슬초코유닛🍫(+250💕)', '캐슬도리유닛🍭(+250💕)', '캐슬하루유닛🥱(+250💕)', '캐슬프백유닛🐷(+250💕)', '캐슬이지유닛💋(+250💕)', '캐슬신나유닛🧚(+250💕)', '캐슬떨어유닛🥶(+250💕)', '캐슬여름유닛🏖(+250💕)', '캐슬해마유닛🍤(+250💕)', '캐슬새솔유닛🦋(+250💕)', '캐슬콩두유닛🍓(+250💕)', '캐슬공백유닛💯(+250💕)'];
              item = units[Math.floor(Math.random() * units.length)];
              quantity = 1;
              message3 = "🪽축하합니다! 영웅유닛 등장🪽\n[" + checkRank(data, sender) + "] 님이\n'" + item + "'을(를)\n뽑았습니다. 기 모 띠☺";
              isSpecialUnit = true;
            } else if (chance < 0.05) {  // 추가 3% 확률
              item = '캐슬공격권⚔';
              message3 = "전진! 🏇🏻전진!!🏇🏻\n눈 앞에 호랜캐슬🏰이 있습니다\n당장 공격하세요!\n캐슬공격권⚔('/캐슬공격') 1개를 획득하였습니다.";
            } else if (chance < 0.25) {  // 추가 20% 확률
              item = '캐슬상자🏰';
              quantity = 1;
              message3 = "앞에 문🚪에 자물쇠🔒가 있습니다\n깡🔨 깡🔨  앞에 🗝열쇠가 있는데\n굳이 부셔버립니다..\n캐슬상자🏰 1개를 발견했습니다.";
            } else {  // 나머지 75% 확률
              item = '잡템☠️';
              quantity = 5;
              message3 = "찰칵..🗝 끼이익..\n물에 젖은 박스📦 에서\n잡템☠ 5개를 발견했습니다.";
            }

            // 캐슬뽑기권 사용
            data.member[sender].bag['캐슬뽑기권♟'] -= 1;
            if (data.member[sender].bag['캐슬뽑기권♟'] === 0) {
              delete data.member[sender].bag['캐슬뽑기권♟'];
            }

            // 아이템 추가
            if (data.member[sender].bag[item]) {
              data.member[sender].bag[item] += quantity;
            } else {
              data.member[sender].bag[item] = quantity;
            }

            // 메시지 출력
            replier.reply(message3);
            // 특별 유닛 획득 시 전체 알림
            if (isSpecialUnit) {
              noticeMsg(message3); // 전체 방에 알림을 보내는 함수 호출
            }

          } else {
            replier.reply("[" + checkRank(data, sender) + "] 님\n캐슬뽑기권♟이 없습니다.");
          }
        }


        if (msg.startsWith('/초보, ')) {
          var commandParts = msg.split(', '); // 명령어를 ", " 기준으로 나눕니다.

          // 명령어를 입력한 사용자가 "호이 남"인지 확인합니다.
          if (sender !== '호이 남') {
            replier.reply("해당 명령어를 사용할 권한이 없습니다.");
          } else {
            if (commandParts.length !== 2) {
              replier.reply("명령어 형식이 잘못되었습니다. 올바른 형식: /초보, 사용자아이디");
            } else {
              var targetUserId = commandParts[1].trim(); // 명령어 뒤에 입력된 아이디를 가져옵니다.

              if (!data.member.hasOwnProperty(targetUserId)) {
                replier.reply("해당 사용자를 찾을 수 없습니다.");
              } else {
                if (data.member[targetUserId].bag['초보자패키지🌱(/초보오픈)'] === undefined) {
                  data.member[targetUserId].bag['초보자패키지🌱(/초보오픈)'] = 1;
                } else {
                  data.member[targetUserId].bag['초보자패키지🌱(/초보오픈)'] += 1;
                }

                replier.reply("[" + targetUserId + "]님에게 초보자패키지가 지급되었습니다.");
              }
            }
          }
        }
        if (msg.startsWith('/초보2, ')) {
          var commandParts = msg.split(', '); // 명령어를 ", " 기준으로 나눕니다.

          // 명령어를 입력한 사용자가 "호이 남"인지 확인합니다.
          if (sender !== '호이 남') {
            replier.reply("해당 명령어를 사용할 권한이 없습니다.");
          } else {
            if (commandParts.length !== 2) {
              replier.reply("명령어 형식이 잘못되었습니다. 올바른 형식: /초보2, 사용자아이디");
            } else {
              var targetUserId = commandParts[1].trim(); // 명령어 뒤에 입력된 아이디를 가져옵니다.

              if (!data.member.hasOwnProperty(targetUserId)) {
                replier.reply("해당 사용자를 찾을 수 없습니다.");
              } else {
                if (data.member[targetUserId].bag['초보자패키지🌱🌱(/초보오픈2)'] === undefined) {
                  data.member[targetUserId].bag['초보자패키지🌱🌱(/초보오픈2)'] = 1;
                } else {
                  data.member[targetUserId].bag['초보자패키지🌱🌱(/초보오픈2)'] += 1;
                }

                replier.reply("[" + targetUserId + "]님에게 초보자패키지가🌱🌱지급되었습니다.");
              }
            }
          }
        }
        if (msg.startsWith('/초보3, ')) {
          var commandParts = msg.split(', '); // 명령어를 ", " 기준으로 나눕니다.

          // 명령어를 입력한 사용자가 "호이 남"인지 확인합니다.
          if (sender !== '호이 남') {
            replier.reply("해당 명령어를 사용할 권한이 없습니다.");
          } else {
            if (commandParts.length !== 2) {
              replier.reply("명령어 형식이 잘못되었습니다. 올바른 형식: /초보3, 사용자아이디");
            } else {
              var targetUserId = commandParts[1].trim(); // 명령어 뒤에 입력된 아이디를 가져옵니다.

              if (!data.member.hasOwnProperty(targetUserId)) {
                replier.reply("해당 사용자를 찾을 수 없습니다.");
              } else {
                if (data.member[targetUserId].bag['초보자패키지🌱🌱🌱(/초보오픈3)'] === undefined) {
                  data.member[targetUserId].bag['초보자패키지🌱🌱🌱(/초보오픈3)'] = 1;
                } else {
                  data.member[targetUserId].bag['초보자패키지🌱🌱🌱(/초보오픈3)'] += 1;
                }

                replier.reply("[" + targetUserId + "]님에게 초보자패키지가🌱🌱🌱지급되었습니다.");
              }
            }
          }
        }
        if (msg.startsWith('/잡템오픈')) {
          let args = msg.split(' ');
          let openCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            openCount = Math.min(parseInt(args[1]), data.member[sender].bag["잡템상자☠"]); // 입력한 숫자만큼 오픈, 최대 소지한 개수만큼
          }

          if (data.member[sender].bag["잡템상자☠"]) {
            let totalQty = 0;
            for (let i = 0; i < openCount; i++) {
              let slotbagqty = parseInt(Math.floor(Math.random() * 6) + 5);
              totalQty += slotbagqty;
            }

            data.member[sender].bag["잡템상자☠"] -= openCount;
            if (data.member[sender].bag["잡템상자☠"] === 0) {
              delete data.member[sender].bag["잡템상자☠"];
            }

            if (data.member[sender].bag['잡템☠️'] === undefined) {
              data.member[sender].bag['잡템☠️'] = totalQty;
            } else {
              data.member[sender].bag['잡템☠️'] += totalQty;
            }

            let slotbagmsg = "잡템상자☠️ " + openCount + "개 오픈!!\n[" + checkRank(data, sender) + "] 님 잡템☠️ " + totalQty + "개 획득";
            replier.reply(slotbagmsg);
          } else {
            replier.reply("잡템상자☠️가 필요합니다.");
          }
        }
        if (msg.startsWith('/방패오픈')) {
          let args = msg.split(' ');
          let openCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            openCount = Math.min(parseInt(args[1]), data.member[sender].bag["방패상자⚔"]); // 입력한 숫자만큼 오픈, 최대 소지한 개수만큼
          }

          if (data.member[sender].bag["방패상자⚔"]) {
            let totalQty = 0;
            for (let i = 0; i < openCount; i++) {
              let slotbagqty = parseInt(Math.floor(Math.random() * 6) + 5);
              totalQty += slotbagqty;
            }

            data.member[sender].bag["방패상자⚔"] -= openCount;
            if (data.member[sender].bag["방패상자⚔"] === 0) {
              delete data.member[sender].bag["방패상자⚔"];
            }

            if (data.member[sender].bag['방패조각🛡'] === undefined) {
              data.member[sender].bag['방패조각🛡'] = totalQty;
            } else {
              data.member[sender].bag['방패조각🛡'] += totalQty;
            }

            let slotbagmsg = "방패상자⚔ " + openCount + "개 오픈!!\n[" + checkRank(data, sender) + "] 님 방패조각🛡 " + totalQty + "개 획득";
            replier.reply(slotbagmsg);
          } else {
            replier.reply("방패상자⚔가 필요합니다.");
          }
        }
        if (msg.startsWith('/치킨오픈')) {
          let args = msg.split(' ');
          let openCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            openCount = Math.min(parseInt(args[1]), data.member[sender].bag["치킨상자🐔"]); // 입력한 숫자만큼 오픈, 최대 소지한 개수만큼
          }

          if (data.member[sender].bag["치킨상자🐔"]) {
            let totalQty = 0;
            for (let i = 0; i < openCount; i++) {
              let slotbagqty = parseInt(Math.floor(Math.random() * 6) + 5);
              totalQty += slotbagqty;
            }

            data.member[sender].bag["치킨상자🐔"] -= openCount;
            if (data.member[sender].bag["치킨상자🐔"] === 0) {
              delete data.member[sender].bag["치킨상자🐔"];
            }

            if (data.member[sender].bag['양념치킨🐔'] === undefined) {
              data.member[sender].bag['양념치킨🐔'] = totalQty;
            } else {
              data.member[sender].bag['양념치킨🐔'] += totalQty;
            }

            let slotbagmsg = "치킨상자🐔 " + openCount + "개 오픈!!\n[" + checkRank(data, sender) + "] 님 양념치킨🐔 " + totalQty + "개 획득";
            replier.reply(slotbagmsg);
          } else {
            replier.reply("치킨상자🐔가 필요합니다.");
          }
        }
        if (msg === '/레이드기본조합') {
          if ((data.member[sender].bag['하트💝'] && data.member[sender].bag['하트💝'] >= 110) || (data.member[sender].bag['잡템☠️'] && data.member[sender].bag['잡템☠️'] >= 100)) {
            const items = ["항생제💊", "마늘🧄", "거울🪞", "에프킬라💦", "도깨비가면👹", "곰팡이🍄", "트롤심장💓", "하리보🪼"];
            const randomItem = items[Math.floor(Math.random() * items.length)];

            if (data.member[sender].bag[randomItem] && data.member[sender].bag[randomItem] >= 30) {
              replier.reply('해당 레이드 아이템 수량이 이미 30개 이상입니다. 조합에 실패했습니다.');
            } else {
              if (data.member[sender].bag['하트💝'] && data.member[sender].bag['하트💝'] >= 110) {
                data.member[sender].bag['하트💝'] -= 110;
              } else {
                data.member[sender].bag['잡템☠️'] -= 100;
              }

              data.member[sender].bag[randomItem] = (data.member[sender].bag[randomItem] || 0) + 1;
              replier.reply('축하합니다! 조합에 성공하여\n[' + randomItem + '] 를(을) 획득하셨습니다!');
            }
          } else {
            replier.reply('하트💝 110개 또는 잡템☠️ 100개가 필요해요!');
          }
        }
        if (msg === '/레이드고급조합') {
          // dept1 내 모든 아이템이 있는지 확인
          let userBag = data.member[sender].bag;
          let hasAllDept1Items = true;
          let userBagKeys = Object.keys(userBag);
          for (let key in raidSpecialItem.dept1) {
            let itemName = raidSpecialItem.dept1[key].name;
            if (!userBagKeys.includes(itemName)) {
              hasAllDept1Items = false;
              break;
            }
          }
          // 모든 아이템이 있다면 dept2 아이템 중 하나를 랜덤으로 추가
          if (hasAllDept1Items) {

            let dept2Keys = Object.keys(raidSpecialItem.dept2);
            let randomIndex = Math.floor(Math.random() * dept2Keys.length);
            let selectedDept2Key = dept2Keys[randomIndex];
            let selectedDept2Item = raidSpecialItem.dept2[selectedDept2Key];
            let addItem = selectedDept2Item.name;

            // dept2 아이템 이름으로 bag 객체에 추가
            if (userBag[addItem]) {
              userBag[addItem] += 1;
            } else {
              userBag[addItem] = 1;
            }

            // dept1 아이템 차감 및 삭제            
            for (let key in raidSpecialItem.dept1) {
              let itemName = raidSpecialItem.dept1[key].name;
              if (userBag[itemName]) {
                userBag[itemName] -= 1;
                if (userBag[itemName] === 0) {
                  delete userBag[itemName];
                }
              }
            }

            replier.reply('[' + checkRank(data, sender) + '] 님\n[' + addItem + '] 의\n조합이 완료되었습니다.');
          } else {
            // 부족한 아이템 확인
            let missingItems = [];
            for (let key in raidSpecialItem.dept1) {
              let itemName = raidSpecialItem.dept1[key].name;
              if (!(itemName in userBag) || userBag[itemName] <= 0) {
                missingItems.push(itemName);
              }
            }
            let missingItemsList = missingItems.join(', ');
            let message = '[' + checkRank(data, sender) + '] 님\n레이드아이템 [' + missingItemsList + ']이 부족합니다.';

            // 부족한 아이템을 알려주는 메시지 전송
            replier.reply(message);
          }

        }

        if (msg.startsWith('/인증 ') && isAdmin(sender)) {
          const regexvc = /\/인증\s+([^]+)/;
          const matchvc = msg.match(regexvc);
          if (matchvc) {
            const targetUservc = matchvc[1];
            if (!data.member[targetUservc].voicecheck) {
              data.member[targetUservc].voicecheck = 1;
              replier.reply('[' + targetUservc + '] 님 보룸인증 완료했습니다.');
              // 보룸인증 완료 후 슬롯코인과 point 증정
              if (data.member[sender].bag["슬롯코인🪙"] === undefined) {
                data.member[sender].bag["슬롯코인🪙"] = 1;              // 슬롯코인 1개씩 증정
              } else {
                data.member[sender].bag["슬롯코인🪙"] += 1;              // 슬롯코인 1개씩 증정
              }
              if (data.member[sender].bag["부방 보룸인센"] === undefined) {
                data.member[sender].bag["부방 보룸인센"] = 3;              // point 3개씩 증정
              } else {
                data.member[sender].bag["부방 보룸인센"] += 3;              // point 3개씩 증정
              }
              replier.reply('관리자 [' + checkRank(data, sender) + '] 님 고생했다.\n슬롯코인🪙x1, 부방인센 x3 증정완');            // 메시지 수정
            } else {
              replier.reply('이미 보룸인증 완료한 유저입니다.');
            }
          }
        }
        if (msg === '/인증필요' && isAdmin(sender)) {
          let currentDate = getCurrentDate();
          let checkmsg1 = '\n1일차 : ';
          let checkmsg2 = '\n2일차 : ';
          let checkmsg3 = '\n3일차 : ';
          let checkmsg4 = '\n강퇴 대상 : ';
          for (let user in data.member) {
            if (!data.member[user].voicecheck) {
              let joinYear = parseInt(data.member[user].join.substring(0, 4));
              let joinMonth = parseInt(data.member[user].join.substring(4, 6)) - 1;
              let joinDay = parseInt(data.member[user].join.substring(6, 8));
              let joinDate = new Date(joinYear, joinMonth, joinDay);
              let currentDate = new Date();            // 현재 날짜
              let currentDateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
              if (joinDate.getFullYear() === currentDateObj.getFullYear() && joinDate.getMonth() === currentDateObj.getMonth() && joinDate.getDate() === currentDateObj.getDate()) {
                checkmsg1 += '[' + user + '], ';
              } else {
                let daysSinceJoin = Math.floor((currentDateObj - joinDate) / (1000 * 60 * 60 * 24)) + 1;
                if (daysSinceJoin === 2) {
                  checkmsg2 += '[' + user + '], ';
                } else if (daysSinceJoin === 3) {
                  checkmsg3 += '[' + user + '], ';
                } else {
                  checkmsg4 += '[' + user + '], ';
                }
              }
            }
          }
          checkmsg1 += checkmsg1 === '\n1일차 : ' ? '-' : '';
          checkmsg2 += checkmsg2 === '\n2일차 : ' ? '-' : '';
          checkmsg3 += checkmsg3 === '\n3일차 : ' ? '-' : '';
          checkmsg4 += checkmsg4 === '\n강퇴 대상 : ' ? '-' : '';
          checkmsg1 = checkmsg1.replace(/, $/, '');
          checkmsg2 = checkmsg2.replace(/, $/, '');
          checkmsg3 = checkmsg3.replace(/, $/, '');
          checkmsg4 = checkmsg4.replace(/, $/, '');
          replier.reply('신입 보룸인증 필요 list \n' + checkmsg1 + checkmsg2 + checkmsg3 + checkmsg4);
        }
        // 매 명령어에 적용
        if (msg.startsWith('/판매')) {
          const regexBagsell = /\/판매\s+(\d+)\s+(\d+)$/;
          const matchBagsell = msg.match(regexBagsell);
          if (matchBagsell) {
            const itemIndex = parseInt(matchBagsell[1]) - 1; // 아이템 인덱스는 0부터 시작하므로 입력값에서 1을 뺌
            const quantityToSell = parseInt(matchBagsell[2]);
            if (data.member && data.member[sender]) {
              let memberInfo = data.member[sender];
              if (memberInfo) {
                let bagItems = memberInfo.bag;
                let itemList = generateBagOutput(bagItems).sortedItemList;

                // 유효한 인덱스 확인
                if (itemIndex >= 0 && itemIndex < itemList.length) {
                  let targetItem = itemList[itemIndex];
                  const nonSellableItems = ["티어 승급티켓🎟", "고급 티어 승급티켓🎫", "펫 장비드랍방지권🛡", "혼자레이드리셋권😝", "펫 강화석⭐", "자동대깨무🐔 패스이용권", "슬롯코인🪙", "하트💝", "슬롯가방🎒(+5)", "슬롯가방👜(+10)", "슬롯가방💼(+20)", "자동배팅권(🅟50만)😣🤖🐔", "초보자패키지 후원자🌱", "호랜캐슬을 위하여!🏴‍☠(+1000💕)", "캐슬유니크유닛👑(+200💕)", "캐슬고급유닛🧙🏼‍♂(+50💕)", "캐슬중급유닛🥷🏼(+10💕)", "캐슬초급유닛💂(+1💕)", "초보자패키지 후원자🌱", "캐슬호이봇유닛🤖(+100💕)", "캐슬쏭쏭유닛🪻(+250💕)", "캐슬효순유닛⚘(+250💕)", "캐슬알레유닛👀(+250💕)", "캐슬심심유닛🦷(+250💕)", "캐슬흑형유닛🧔🏿‍♂(+250💕)", "캐슬호랜유닛🎲(+300💕)", "캐슬우니대장유닛🃏(+18💕)", "캐슬덕구유닛🗿(+250💕)", "캐슬소솜유닛🧸(+250💕)", "캐슬빠루유닛🔧(+250💕)", "캐슬벨라유닛🦄(+250💕)", "캐슬코크유닛🪽(+250💕)", "캐슬콘트유닛🚹(+250💕)", "캐슬산타유닛🎅(+250💕)", "캐슬우유유닛🥛(+250💕)", "캐슬온오프유닛🚘(+250💕)", "캐슬건징어유닛🐙(+250💕)", "캐슬베라유닛💘(+250💕)", "캐슬노아유닛🐹(+250💕)", "캐슬춘배유닛🐯(+250💕)", "캐슬비광유닛🎴(+250💕)", "초보자패키지 후원자🌱🌱", "우표💌", "캐슬호이봇유닛🤖(+100💕)", "초보자패키지 후원자🌱🌱🌱", "잡템☠️", "캐슬기습공격권🔥(20%)", "캐슬기습공격권🔥(40%)", "캐슬기습공격권🔥(10%)", "캐슬절대방어권🛡(25%)", "캐슬절대방어권🛡(5%)", "캐슬절대방어권🛡(50%)", "방패조각🛡", "캐슬상자🏰", "캐슬뽑기권♟", "캐슬공격권⚔", "양념치킨🐔", "금괴💰", '금괴상자💰', '치킨상자🐔', "잡템상자☠", "랜덤박스💝", "미니상자🎁", "선물상자🎁", " 슬롯상자🧳", "펫 이름변경권🎫", "항생제💊", "마늘🧄", "거울🪞", "에프킬라💦", "도깨비가면👹", "곰팡이🍄", "트롤심장💓", "하리보🪼", "레이드공격대인장🥇(+500👾)", "레이드타격대인장👑(+600👾)"];
                  if (nonSellableItems.includes(targetItem)) {
                    replier.reply('[' + targetItem + ']은(는) 판매 불가합니다.');
                  } else if (bagItems[targetItem] >= quantityToSell) {
                    let returnPrice = parseInt(quantityToSell * 100000);
                    data.member[sender].point += returnPrice;
                    bagItems[targetItem] -= quantityToSell;
                    if (bagItems[targetItem] === 0) {
                      delete bagItems[targetItem];
                    }
                    replier.reply('[' + checkRank(data, sender) + '] 님의 가방에서\n[' + targetItem + '] 이(가) ' + quantityToSell + '개 판매 완료!\n🅟' + numberWithCommas(returnPrice) + ' 획득');
                  } else {
                    replier.reply('야 더 팔게 있어야 팔지\n제대로 팔아라');
                  }
                } else {
                  replier.reply('유효한 아이템 번호를 입력해주세요.\n판매 가능한 번호 범위는 1 부터 ' + itemList.length + ' 까지입니다.');
                }
              }
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요.\n예: /판매 [아이템번호] [수량]');
          }
        } else if (msg === '/좋아리셋' && (sender == "젤리 남" || sender == "호이 남")) {
          for (let user in data.member) {
            if (!data.member[user].like0) {
              data.member[user].like0 = data.member[user].like;
            } else {
              data.member[user].like0 += parseInt(data.member[user].like);
            }
            data.member[user].like = 0;
          }
          replier.reply('리셋완.');
        }
        if (msg === '/레벨리셋' && (sender == "젤리 남" || sender == "호이 남")) {
          for (let user in data.member) {
            if (!data.member[user].lv0) {
              data.member[user].lv0 = data.member[user].lv;
            } else {
              data.member[user].lv0 += parseInt(data.member[user].lv);
            }
            data.member[user].lv = 1;
          }
          replier.reply('리셋완.');
        }
        if (msg == '/환생') {
          if (data.member[sender].lv > 299 || data.member[sender].bag['환생버섯🍄']) {
            if (data.member[sender].bag['환생버섯🍄'] > 1) {
              data.member[sender].bag['환생버섯🍄']--;
            } else {
              delete data.member[sender].bag['환생버섯🍄'];
            }
            if (!data.member[sender].lv0) {
              data.member[sender].lv0 = data.member[sender].lv;
            } else {
              data.member[sender].lv0 += parseInt(data.member[sender].lv);
            }
            data.member[sender].lv = 1;
            data.member[sender].rebirthcnt++;
            replier.reply('[' + checkRank(data, sender) + '] 님이 환생하여\n레벨이 1로 감소되었습니다.🍼');

            // 전체 알림
            const rooms = [room1, room2, room3, room5];
            let message = "내게 호강 같은 평화! 넘치네!!\n호렐루야! [" + checkRank(data, sender) + "] 님이\n호신의 축복을 받고 다시 태어납니다.\n환생 완료!";
            rooms.forEach(room => Api.replyRoom(room, message));

          } else {
            replier.reply('현재 ✨️레벨 300 이상 또는\n환생버섯🍄이 필요합니다.');
          }
        }
        if (msg.startsWith('/환생') && (sender == "젤리 남" || sender == "호이 남")) {
          const regexr = /^\/환생\s+([^]+)/;
          const matchr = msg.match(regexr);
          if (matchr) {
            const targetUserr = matchr[1];
            if (data.member[targetUserr]) {
              if (!data.member[targetUserr].lv0) {
                data.member[targetUserr].lv0 = data.member[targetUserr].lv;
              } else {
                data.member[targetUserr].lv0 += parseInt(data.member[targetUserr].lv);
              }
              data.member[targetUserr].lv = 1;
              data.member[targetUserr].rebirthcnt++;
              // 전체 알림
              const rooms2 = [room1, room2, room3, room5];
              let message2 = "내게 호강 같은 평화! 넘치네!!\n호렐루야! [" + checkRank(data, sender) + "] 님이\n호신의 축복을 받고 다시 태어납니다.\n환생 완료!";
              rooms.forEach(room => Api.replyRoom(room, message));
              //replier.reply('내게 강 같은 평화! 내가 강 같은 평화! 넘치네!! 호렐루야!\n호신의 축복을 받고 다시 태어납니다.\n환생 완료!');
            } else {
              replier.reply('해당 유저가 존재하지 않습니다.');
            }
          }
        }
        if (msg === '/극락오픈') {
          if (data.member[sender].bag['극락상자👹']) {
            if (data.member[sender].bag["극락상자👹"] > 1) {
              data.member[sender].bag["극락상자👹"]--;
            } else {
              delete data.member[sender].bag["극락상자👹"];
            }
            var gift2 = parseInt(Math.floor(Math.random() * 10) + 1);
            gift2 = parseInt(gift2 * 1000000).toFixed(0);
            data.member[sender].point += parseInt(gift2);
            let giftmsg = "☠️극락상자☠️ 오픈!!\n[" + checkRank(data, sender) + "] 짐은.. 극락이니라\n극락왕생 하소서👹\n🅟" + numberWithCommas(gift2) + "획득🚨";
            replier.reply(giftmsg);
          } else {
            replier.reply("미천한 것! 극락을 이미 사용하였느니라.");
          }
        }

        if (msg === '/편지를열어본다') {
          if (data.member[sender].bag['호이의 편지✉(/편지를열어본다)']) {
            if (data.member[sender].bag["호이의 편지✉(/편지를열어본다)"] > 1) {
              data.member[sender].bag["호이의 편지✉(/편지를열어본다)"]--;
            } else {
              delete data.member[sender].bag["호이의 편지✉(/편지를열어본다)"];
            }
            replier.reply("안녕 난 호이야 친구들에게 감사의 마음을 담아 간단하게 편지를 적어\n우선 너희들에게 감사해 이 방의 방장은 나지만\n친구들이 없었다면 이 방도 없어 이 방이 운영이 될 수 있는 이유는 너희가 있기 때문이야\n나는 그저 너희들이 꾸며놓은 이 방을 유지하게 해주는 사람일 뿐\n너희가 이 방을 운영하는 진짜 사람들이야 :)\n그게 어떠한 사람이든, 행동이든, 이롭게 하든, 이롭게 하지 않든,\n어느 하나 빠짐없는 각자 자리에 있어줘야 지금의 쳇바퀴가 굴러가는 거라 생각해\n그래야 비로소 인간적이고 아름다운 것이니까, 항상 고맙고 앞으로도 고마워 다시 한번 잘 부탁해!");
          } else {
            replier.reply("난 자네에게 편지를 보낸적이 없어.");
          }
        }


        if (msg === '/펫강화오픈') {
          if (data.member[sender].bag["펫강화상자⭐"]) {
            if (data.member[sender].bag["펫강화상자⭐"] > 1) {
              data.member[sender].bag["펫강화상자⭐"]--;
            } else {
              delete data.member[sender].bag["펫강화상자⭐"];
            }
            var petStoneQty = Math.floor(Math.random() * 2) + 2;
            if (data.member[sender].bag['펫 강화석⭐'] === undefined) {
              data.member[sender].bag['펫 강화석⭐'] = petStoneQty;
            } else {
              data.member[sender].bag['펫 강화석⭐'] += petStoneQty;
            }
            let petStoneMsg = "펫강화상자⭐ 오픈!!\n[" + checkRank(data, sender) + "] 님 펫 강화석⭐ " + petStoneQty + "개 획득";
            replier.reply(petStoneMsg);
          } else {
            replier.reply("펫강화상자⭐가 필요합니다.");
          }
        }
        if (msg === '/나락오픈') {
          if (data.member[sender].bag['나락상자👹']) {
            if (data.member[sender].bag["나락상자👹"] > 1) {
              data.member[sender].bag["나락상자👹"]--;
            } else {
              delete data.member[sender].bag["나락상자👹"];
            }
            var gift3 = parseInt(Math.floor(Math.random() * 30) - 10);
            gift3 = parseInt(gift3 * 1000000).toFixed(0);
            data.member[sender].point += parseInt(gift3);
            let giftmsg = "☠️나락상자☠️ 오픈!!\n[" + checkRank(data, sender) + "] 짐은.. 나락이느니라\n나락왕생 하소서👹\n🅟" + numberWithCommas(gift3) + "획득🚨";
            replier.reply(giftmsg);
          } else {
            replier.reply("미천한 것! 나락을 이미 사용하였느니라.");
          }
        }
        if (msg === '/선물전달' && (sender == "젤리 남" || sender == "호이 남")) {
          for (let user in data.member) {
            if (data.member[user].bag['선물상자🎁']) {
              data.member[user].bag["선물상자🎁"]++;
            } else {
              data.member[user].bag["선물상자🎁"] = 1;
            }
          }
          Api.replyRoom(room1, "가방에 선물상자🎁가 추가되었습니다.!\n('/선물오픈' 으로 사용가능)");
          Api.replyRoom(room2, "가방에 선물상자🎁가 추가되었습니다.!\n('/선물오픈' 으로 사용가능)");
          Api.replyRoom(room3, "가방에 선물상자🎁가 추가되었습니다.!\n('/선물오픈' 으로 사용가능)");
          Api.replyRoom(room5, "가방에 선물상자🎁가 추가되었습니다.!\n('/선물오픈' 으로 사용가능)");
        }
        if (msg === '/선물오픈') {
          if (data.member[sender].bag['선물상자🎁']) {
            if (data.member[sender].bag["선물상자🎁"] > 1) {
              data.member[sender].bag["선물상자🎁"]--;
            } else {
              delete data.member[sender].bag["선물상자🎁"];
            }
            var gift = parseInt(Math.floor(Math.random() * 10) + 1);
            gift = parseInt(gift * 500000).toFixed(0);
            data.member[sender].point += parseInt(gift);
            let giftmsg = "선물상자🎁오픈!\n[" + checkRank(data, sender) + "] 님 기모찡♡\n🎁🅟" + numberWithCommas(gift) + "획득🎁";
            replier.reply(giftmsg);
          } else {
            replier.reply("선물을 이미 사용했어요.😅");
          }
        }
        if (msg.startsWith('/랜덤오픈')) {
          // 명령어 뒤에 숫자가 있는지 확인
          let args = msg.split(' ');
          let openCount = 1; // 기본값은 1개
          if (args.length > 1 && !isNaN(args[1])) {
            openCount = Math.min(parseInt(args[1]), data.member[sender].bag['랜덤박스💝']); // 숫자 제한 (현재 가진 랜덤박스 개수만큼만 가능)
          }

          if (data.member[sender].bag['랜덤박스💝']) {
            if (data.member[sender].bag["랜덤박스💝"] >= openCount) {
              data.member[sender].bag["랜덤박스💝"] -= openCount;
            } else {
              openCount = data.member[sender].bag["랜덤박스💝"];
              delete data.member[sender].bag["랜덤박스💝"];
            }

            // 랜덤 아이템 목록
            var items2 = ['잡템상자☠', '금괴상자💰', '방패상자⚔', '치킨상자🐔', '캐슬절대방어권🛡(5%)', '캐슬기습공격권🔥(10%)', '캐슬공격권⚔'];

            let acquiredItems = {}; // 여러 아이템을 저장할 객체

            // openCount만큼 반복
            for (let i = 0; i < openCount; i++) {
              var randomItem2 = items2[Math.floor(Math.random() * items2.length)];
              if (data.member[sender].bag[randomItem2]) {
                data.member[sender].bag[randomItem2]++;
              } else {
                data.member[sender].bag[randomItem2] = 1;
              }

              // 획득한 아이템을 기록
              if (acquiredItems[randomItem2]) {
                acquiredItems[randomItem2]++;
              } else {
                acquiredItems[randomItem2] = 1;
              }
            }

            // 획득한 아이템들을 출력
            let itemMessage = "랜덤박스💝 " + openCount + "개 오픈!\n[" + checkRank(data, sender) + "] 님 💝내 사랑을 받아라💝\n\n획득 아이템:\n";
            for (let item in acquiredItems) {
              itemMessage += item + " " + acquiredItems[item] + "개 획득!\n";
            }

            replier.reply(itemMessage);
          } else {
            replier.reply("랜덤박스💝를 이미 사용했어요.😅");
          }
        }

        if (msg === '/미니오픈') {
          if (data.member[sender].bag['미니상자🎁']) {
            if (data.member[sender].bag["미니상자🎁"] > 1) {
              data.member[sender].bag["미니상자🎁"]--;
            } else {
              delete data.member[sender].bag["미니상자🎁"];
            }
            var gift6 = parseInt(Math.floor(Math.random() * 6) + 1);
            gift6 = parseInt(gift6 * 500000).toFixed(0);
            data.member[sender].point += parseInt(gift6);
            let giftmsg = "미니상자🎁오픈!\n[" + checkRank(data, sender) + "] 님 ♡\n🎁🅟" + numberWithCommas(gift6) + "획득🎁";
            replier.reply(giftmsg);
          } else {
            replier.reply("미니선물을 이미 사용했어요.😅");
          }
        }
        if (msg === '/호이봇버전') {
          replier.reply("ver_" + HoiBotVersion);
        }
        if (msg.startsWith('/불멸조합')) {
          const inputArgs = msg.split(' ');
          const combineCount = parseInt(inputArgs[1]) || 1; // 사용자가 입력한 갯수를 가져옴, 기본값은 1
          const requiredItemForBuly = '펫 장비드랍방지권🛡';
          const requiredQuantityForBuly = 2 * combineCount; // 조합할 갯수에 따라 필요한 아이템 수량 계산
          const requiredPointsForBuly = 700000 * combineCount; // 조합할 갯수에 따라 필요한 포인트 계산

          if (data.member[sender].bag[requiredItemForBuly] && data.member[sender].bag[requiredItemForBuly] >= requiredQuantityForBuly) {
            if (data.member[sender].point && data.member[sender].point >= requiredPointsForBuly) {
              // 필요한 수량만큼 차감
              data.member[sender].bag[requiredItemForBuly] -= requiredQuantityForBuly;
              data.member[sender].point -= requiredPointsForBuly;

              // 펫 장비드랍방지권이 0개가 되면 삭제
              if (data.member[sender].bag[requiredItemForBuly] === 0) {
                delete data.member[sender].bag[requiredItemForBuly];
              }

              // 불멸 강화석 지급
              if (!data.member[sender].bag['불멸 강화석🪬']) {
                data.member[sender].bag['불멸 강화석🪬'] = combineCount;
              } else {
                data.member[sender].bag['불멸 강화석🪬'] += combineCount;
              }

              let msg = '깡! 깡! 깡! 펫장비🛡를 대장장이가\n망치로 줘팹니다!\n[' + checkRank(data, sender) + '] 님 불멸 강화석🪬 ' + combineCount + '개 조합 완료!';
              replier.reply(msg);
            } else {
              replier.reply('🅟' + requiredPointsForBuly.toLocaleString() + ' 가 필요해요!');
            }
          } else {
            replier.reply('펫 장비드랍방지권🛡이 부족합니다.\n펫 장비드랍방지권🛡 ' + requiredQuantityForBuly + '개 필요');
          }
        }
        if (msg.startsWith('/혼레리조합')) {
          let args = msg.split(' ');
          let chickenCombineCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            chickenCombineCount = parseInt(args[1]);
          }

          let requiredChicken = 5 * chickenCombineCount;

          if (data.member[sender].bag['양념치킨🐔']) {
            if (data.member[sender].bag["양념치킨🐔"] >= requiredChicken) {
              data.member[sender].bag["양념치킨🐔"] -= requiredChicken;
              if (!data.member[sender].bag['혼자레이드리셋권😝']) {
                data.member[sender].bag["혼자레이드리셋권😝"] = chickenCombineCount;
              } else {
                data.member[sender].bag["혼자레이드리셋권😝"] += chickenCombineCount;
              }

              let msg = "치이익..🔥🔥🔥 양념치킨🐔 " + chickenCombineCount + "번 조합!\n기름에 줘팹니다.\n오 대단한 요리 완성🍗\n[" + checkRank(data, sender) + "] 님 혼레리 조합 " + chickenCombineCount + "개 성공!!";
              replier.reply(msg);

              if (data.member[sender].bag["양념치킨🐔"] === 0) {
                delete data.member[sender].bag["양념치킨🐔"];
              }
            } else {
              replier.reply("양념치킨🐔 " + requiredChicken + "마리가 필요해요!");
            }
          } else {
            replier.reply("양념치킨🐔 " + requiredChicken + "마리가 필요해요!");
          }
        }
        if (msg.startsWith('/캐슬대전조합')) {
          let args = msg.split(' ');
          let chickenCombineCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            chickenCombineCount = parseInt(args[1]);
          }

          let requiredChicken = 6 * chickenCombineCount;

          if (data.member[sender].bag['양념치킨🐔']) {
            if (data.member[sender].bag["양념치킨🐔"] >= requiredChicken) {
              data.member[sender].bag["양념치킨🐔"] -= requiredChicken;
              if (!data.member[sender].bag['캐슬대전리셋권🐶']) {
                data.member[sender].bag["캐슬대전리셋권🐶"] = chickenCombineCount;
              } else {
                data.member[sender].bag["캐슬대전리셋권🐶"] += chickenCombineCount;
              }

              let msg = "캐슬대전리셋권🐶 " + chickenCombineCount + "개가 완성되었습니다!\n/캐슬대전 으로 대전에 참여하세요!";
              replier.reply(msg);

              if (data.member[sender].bag["양념치킨🐔"] === 0) {
                delete data.member[sender].bag["양념치킨🐔"];
              }
            } else {
              replier.reply("양념치킨🐔 " + requiredChicken + "마리가 필요해요!");
            }
          } else {
            replier.reply("양념치킨🐔 " + requiredChicken + "마리가 필요해요!");
          }
        }
        else if (msg.startsWith('/랜덤조합')) {
          let args = msg.split(' ');
          let heartCombineCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            heartCombineCount = parseInt(args[1]);
          }

          let requiredHearts = 20 * heartCombineCount;

          if (data.member[sender].bag['하트💝']) {
            if (data.member[sender].bag["하트💝"] >= requiredHearts) {
              data.member[sender].bag["하트💝"] -= requiredHearts;
              if (!data.member[sender].bag['랜덤박스💝']) {
                data.member[sender].bag["랜덤박스💝"] = heartCombineCount;
              } else {
                data.member[sender].bag["랜덤박스💝"] += heartCombineCount;
              }

              let msg = "[" + checkRank(data, sender) + "] 아조씨 사랑해요..💝\n랜덤박스💝 " + heartCombineCount + "개를 획득하셨습니다.";
              replier.reply(msg);

              if (data.member[sender].bag["하트💝"] === 0) {
                delete data.member[sender].bag["하트💝"];
              }
            } else {
              replier.reply("하트💝 " + requiredHearts + "개가 필요해요!");
            }
          } else {
            replier.reply("하트💝 " + requiredHearts + "개가 필요해요!");
          }
        } else if (msg.startsWith('/장드방조합')) {
          let args = msg.split(' ');
          let shieldCombineCount = 1; // 기본값 1
          if (args.length > 1 && !isNaN(args[1])) {
            shieldCombineCount = parseInt(args[1]);
          }

          let requiredShields = 10 * shieldCombineCount;
          if (data.member[sender].bag['방패조각🛡']) {
            if (data.member[sender].bag["방패조각🛡"] >= requiredShields) {
              data.member[sender].bag["방패조각🛡"] -= requiredShields;
              if (!data.member[sender].bag['펫 장비드랍방지권🛡']) {
                data.member[sender].bag["펫 장비드랍방지권🛡"] = shieldCombineCount;
              } else {
                data.member[sender].bag["펫 장비드랍방지권🛡"] += shieldCombineCount;
              }

              let msg = "방패장인이 방패조각🛡을 " + shieldCombineCount + "번 딱풀로 붙힙니다 오 스고이,,\n[" + checkRank(data, sender) + "] 님 장드방 조합 " + shieldCombineCount + "개 성공!!";
              replier.reply(msg);

              if (data.member[sender].bag["방패조각🛡"] === 0) {
                delete data.member[sender].bag["방패조각🛡"];
              }
            } else {
              replier.reply("방패조각🛡 " + requiredShields + "개가 필요해요!");
            }
          } else {
            replier.reply("방패조각🛡 " + requiredShields + "개가 필요해요!");
          }
        }
        else if (msg === '/펫이름조합') {
          if (data.member[sender].bag['잡템☠️']) {
            if (data.member[sender].bag["잡템☠️"] >= 10) {
              if (data.member[sender].point && data.member[sender].point >= 100000) {
                data.member[sender].bag["잡템☠️"] -= 10;
                data.member[sender].point -= 100000;
                if (!data.member[sender].bag['펫 이름변경권🎫']) {
                  data.member[sender].bag["펫 이름변경권🎫"] = 1;
                } else {
                  data.member[sender].bag["펫 이름변경권🎫"] += 1;
                }
                let msg = "행복주민센터에서 [" + checkRank(data, sender) + "] 님께\n펫 이름변경권🎫을 주었습니다.";
                replier.reply(msg);
                if (data.member[sender].bag["잡템☠️"] === 0) {
                  delete data.member[sender].bag["잡템☠️"];
                }
              } else {
                replier.reply("🅟100,000 가 필요해요!");
              }
            } else {
              replier.reply("잡템☠️ 10개가 필요해요!");
            }
          } else {
            replier.reply("잡템☠️ 10개가 필요해요!");
          }
        } else if (msg.startsWith('/캐슬기습조합')) {
          var args = msg.split(' ');

          // 몇 개 조합할지 결정 (기본은 1개)
          var count = 1;
          if (args.length > 1) {
            count = Math.max(1, parseInt(args[1])); // 최소 1개 이상
          }

          // 사용자의 가방에 캐슬기습공격권🔥(10%)가 있는지 확인
          let item10 = '캐슬기습공격권🔥(10%)';
          let item20 = '캐슬기습공격권🔥(20%)';

          if (data.member[sender].bag[item10] && data.member[sender].bag[item10] >= 2 * count) {
            // 캐슬기습공격권🔥(10%) 2개당 캐슬기습공격권🔥(20%) 1개 조합
            data.member[sender].bag[item10] -= 2 * count; // 10% 아이템 개수 차감

            if (data.member[sender].bag[item10] === 0) {
              delete data.member[sender].bag[item10];
            }

            if (data.member[sender].bag[item20]) {
              data.member[sender].bag[item20] += count; // 20% 아이템 추가
            } else {
              data.member[sender].bag[item20] = count; // 20% 아이템 신규 추가
            }

            // 결과 메시지 생성
            let responseMessage = "축하합니다! 캐슬기습공격권🔥(10%) " + (2 * count) + "개를 조합하여\n캐슬기습공격권🔥(20%) " + count + "개를 획득했습니다!";
            replier.reply(responseMessage);
          } else {
            // 캐슬기습공격권🔥(10%)가 부족할 때 메시지 출력
            replier.reply("캐슬기습공격권🔥(10%)이 부족합니다.");
          }
        } else if (msg.startsWith('/캐슬방어조합')) {
          var args = msg.split(' ');

          // 몇 개 조합할지 결정 (기본은 1개)
          var count = 1;
          if (args.length > 1) {
            count = Math.max(1, parseInt(args[1])); // 최소 1개 이상
          }

          // 사용자의 가방에 캐슬절대방어권🛡(5%)가 있는지 확인
          let item5 = '캐슬절대방어권🛡(5%)';
          let item25 = '캐슬절대방어권🛡(25%)';

          if (data.member[sender].bag[item5] && data.member[sender].bag[item5] >= 2 * count) {
            // 캐슬절대방어권🛡(5%) 5개당 캐슬절대방어권🛡(25%) 1개 조합
            data.member[sender].bag[item5] -= 2 * count; // 5% 아이템 개수 차감

            if (data.member[sender].bag[item5] === 0) {
              delete data.member[sender].bag[item5];
            }

            if (data.member[sender].bag[item25]) {
              data.member[sender].bag[item25] += count; // 25% 아이템 추가
            } else {
              data.member[sender].bag[item25] = count; // 25% 아이템 신규 추가
            }

            // 결과 메시지 생성
            let responseMessage = "축하합니다! 캐슬절대방어권🛡(5%) " + (2 * count) + "개를 조합하여\n캐슬절대방어권🛡(25%) " + count + "개를 획득했습니다!";
            replier.reply(responseMessage);
          } else {
            // 캐슬절대방어권🛡(5%)가 부족할 때 메시지 출력
            replier.reply("캐슬절대방어권🛡(5%)이 부족합니다.");
          }
        } else if (msg === '/공성전시작' && (sender === '오픈채팅봇' || sender === '호이 남' || sender === '거품 남')) {
          castleSiegeFlag = true;
          let petInfo = data.member[data.HoiCastle.lord].pet;
          let castleExp = numberWithCommas(calculateCastleItem(data.HoiCastle.lord, data) + calculateGearItem(data.HoiCastle.lord, data).battleExp + petInfo.petexp);
          noticeMsg('[⚔공성전시작⚔]\n공성전이 시작되었습니다!\n[' + checkRank(data, data.HoiCastle.lord) + '] [' + petInfo.petimg + petInfo.petname + '](' + castleExp + '💕)의\n호랜캐슬🏰을 점령하세요!');
        } else if (msg === '/공성전종료' && (sender === '오픈채팅봇' || sender === '호이 남' || sender === '거품 남')) {
          castleSiegeFlag = false;
          noticeMsg('[🛡공성전종료🛡]\n최종 공성전 승리✌\n[' + checkRank(data, data.HoiCastle.lord) + '] 님이 영주가 되었습니다.\n하루동안 호랜캐슬🏰을 지배합니다.');

        } else if (msg.startsWith('/캐슬공격조합')) {
          var cArgs = msg.split(' ');

          // 몇 개 조합할지 결정 (기본은 1개)
          var numToCraft = 1;
          if (cArgs.length > 1) {
            numToCraft = Math.max(1, parseInt(cArgs[1])); // 최소 1개 이상
          }

          // 필요한 재료 및 포인트 계산
          var requiredMaterials = 2 * numToCraft;
          var requiredCurrency = 300000 * numToCraft;

          // 사용자의 가방에 잡템☠️이 충분히 있는지 확인
          if (data.member[sender].bag['잡템☠️'] && data.member[sender].bag['잡템☠️'] >= requiredMaterials) {
            // 사용자의 포인트가 충분히 있는지 확인
            if (data.member[sender].point && data.member[sender].point >= requiredCurrency) {
              // 재료 및 포인트 차감
              data.member[sender].bag['잡템☠️'] -= requiredMaterials;
              data.member[sender].point -= requiredCurrency;

              // 캐슬공격권⚔ 추가
              if (!data.member[sender].bag['캐슬공격권⚔']) {
                data.member[sender].bag['캐슬공격권⚔'] = numToCraft;
              } else {
                data.member[sender].bag['캐슬공격권⚔'] += numToCraft;
              }

              // 결과 메시지 출력
              let responseMessage = "[" + checkRank(data, sender) + "] 님\n🏰호랜캐슬🏰 함락을 부탁드려요!\n캐슬공격권⚔ " + numToCraft + "개를 받았습니다.";
              replier.reply(responseMessage);

              // 잡템☠️이 0개가 되면 삭제
              if (data.member[sender].bag['잡템☠️'] === 0) {
                delete data.member[sender].bag['잡템☠️'];
              }
            } else {
              replier.reply("🅟" + requiredCurrency.toLocaleString() + "가 필요해요!");
            }
          } else {
            replier.reply("잡템☠️ " + requiredMaterials + "개가 필요해요!");
          }
        } else if (msg.startsWith('/캐슬상자조합')) {
          var cArgs = msg.split(' ');

          // 몇 개 조합할지 결정 (기본은 1개)
          var numToCraft = 1;
          if (cArgs.length > 1) {
            numToCraft = Math.max(1, parseInt(cArgs[1])); // 최소 1개 이상
          }

          // 필요한 재료 및 포인트 계산
          var requiredMaterials = 10 * numToCraft;
          var requiredCurrency = 700000 * numToCraft;

          // 사용자의 가방에 잡템☠️이 충분히 있는지 확인
          if (data.member[sender].bag['잡템☠️'] && data.member[sender].bag['잡템☠️'] >= requiredMaterials) {
            // 사용자의 포인트가 충분히 있는지 확인
            if (data.member[sender].point && data.member[sender].point >= requiredCurrency) {
              // 재료 및 포인트 차감
              data.member[sender].bag['잡템☠️'] -= requiredMaterials;
              data.member[sender].point -= requiredCurrency;

              // 캐슬상자🏰 추가
              if (!data.member[sender].bag['캐슬상자🏰']) {
                data.member[sender].bag['캐슬상자🏰'] = numToCraft;
              } else {
                data.member[sender].bag['캐슬상자🏰'] += numToCraft;
              }

              // 결과 메시지 출력
              let responseMessage = "[" + checkRank(data, sender) + "] 님\n캐슬상자🏰 " + numToCraft + "개 조합이 완료되었습니다\n(/캐슬오픈)";
              replier.reply(responseMessage);

              // 잡템☠️이 0개가 되면 삭제
              if (data.member[sender].bag['잡템☠️'] === 0) {
                delete data.member[sender].bag['잡템☠️'];
              }
            } else {
              replier.reply("🅟" + requiredCurrency.toLocaleString() + "가 필요해요!");
            }
          } else {
            replier.reply("잡템☠️ " + requiredMaterials + "개가 필요해요!");
          }
        } else if (msg === '/우삼조합') {
          if (data.member[sender].bag['캐슬삼삼유닛💜(+33💕)'] && data.member[sender].bag['캐슬우니대장유닛🃏(+18💕)']) {
            if (data.member[sender].bag['캐슬삼삼유닛💜(+33💕)'] >= 1 && data.member[sender].bag['캐슬우니대장유닛🃏(+18💕)'] >= 1) {
              if (data.member[sender].point && data.member[sender].point >= 50000000) {
                // 아이템과 포인트 차감
                data.member[sender].bag['캐슬삼삼유닛💜(+33💕)'] -= 1;
                data.member[sender].bag['캐슬우니대장유닛🃏(+18💕)'] -= 1;
                data.member[sender].point -= 50000000;

                // 새 아이템 추가
                if (!data.member[sender].bag['캐슬대장졸렬우삼유닛👨‍❤‍👨(+1018💕)']) {
                  data.member[sender].bag['캐슬대장졸렬우삼유닛👨‍❤‍👨(+1018💕)'] = 1;
                } else {
                  data.member[sender].bag['캐슬대장졸렬우삼유닛👨‍❤‍👨(+1018💕)'] += 1;
                }

                // 메시지 전송
                let msg = "[" + checkRank(data, sender) + "] 님\n캐슬대장졸렬우삼유닛👨‍❤‍👨(+1018💕)\n조합이 완료되었습니다.";
                replier.reply(msg);

                // 아이템 개수가 0이 되면 삭제
                if (data.member[sender].bag['캐슬삼삼유닛💜(+33💕)'] === 0) {
                  delete data.member[sender].bag['캐슬삼삼유닛💜(+33💕)'];
                }
                if (data.member[sender].bag['캐슬우니대장유닛🃏(+18💕)'] === 0) {
                  delete data.member[sender].bag['캐슬우니대장유닛🃏(+18💕)'];
                }
              } else {
                replier.reply("포인트가 부족합니다! 🅟30,000,000 포인트가 필요해요.");
              }
            } else {
              replier.reply("캐슬삼삼유닛💜와 캐슬우니대장유닛🃏이 각각 1개씩 필요해요!");
            }
          } else {
            replier.reply("캐슬삼삼유닛💜와 캐슬우니대장유닛🃏이 각각 1개씩 필요해요!");
          }
        }



        if (msg === '/전설돌조합') {
          // 필요한 아이템과 그 수량
          const requiredItems = {
            '방패조각🛡': 3,
            '양념치킨🐔': 3,
            '금괴💰': 3,
            '잡템☠️': 3
          };
          // 모든 필요한 아이템이 충분한지 확인
          let hasAllItems = true;
          for (let item in requiredItems) {
            if (!data.member[sender].bag[item] || data.member[sender].bag[item] < requiredItems[item]) {
              hasAllItems = false;
              replier.reply('방패조각🛡 3개\n양념치킨🐔 3개\n금괴💰 3개\n잡템☠️ 3개가 필요합니다.');
              break;
            }
          }
          if (hasAllItems) {
            // 각 아이템을 필요한 수량만큼 차감
            for (let item in requiredItems) {
              data.member[sender].bag[item] -= requiredItems[item];
              if (data.member[sender].bag[item] === 0) {
                delete data.member[sender].bag[item];
              }
            }
            // '전설의 돌' 추가
            if (!data.member[sender].bag['전설의 돌맹이🗿']) {
              data.member[sender].bag['전설의 돌맹이🗿'] = 1;
            } else {
              data.member[sender].bag['전설의 돌맹이🗿'] += 1;
            }
            let msg = "[" + checkRank(data, sender) + "] 님\n전설의 돌맹이🗿을 획득하셨습니다!";
            replier.reply(msg);
          }
        }
        if (msg === '/통신기조합') {
          const requiredItem = '잡템☠️';
          const requiredQuantity = 10;
          const requiredPoints = 500000;

          // 잡템☠️의 수량을 확인
          if (data.member[sender].bag[requiredItem] && data.member[sender].bag[requiredItem] >= requiredQuantity) {
            // 포인트가 충분한지 확인
            if (data.member[sender].point && data.member[sender].point >= requiredPoints) {
              // 필요한 수량만큼 차감
              data.member[sender].bag[requiredItem] -= requiredQuantity;
              data.member[sender].point -= requiredPoints;

              // 잡템☠️가 0개가 되면 삭제
              if (data.member[sender].bag[requiredItem] === 0) {
                delete data.member[sender].bag[requiredItem];
              }

              // [펫]무제한통신기 지급
              if (!data.member[sender].bag['[펫]무제한통신기🐚']) {
                data.member[sender].bag['[펫]무제한통신기🐚'] = 1;
              } else {
                data.member[sender].bag['[펫]무제한통신기🐚'] += 1;
              }

              let msg = "[" + checkRank(data, sender) + "] 님\n[펫]무제한통신기🐚를 획득하셨습니다!";
              replier.reply(msg);
            } else {
              replier.reply("🅟500,000 가 필요해요!");
            }
          } else {
            replier.reply("잡템☠️ 10개가 필요해요!");
          }
        }

        if (msg === '/고급티켓조합') {
          if (data.member[sender].bag['티어 승급티켓🎟'] >= 2550) {
            if (data.member[sender].bag['티어 승급티켓🎟'] >= 50 && data.member[sender].bag['전설의 돌맹이🗿'] >= 1) {
              data.member[sender].bag['티어 승급티켓🎟'] -= 50;
              data.member[sender].bag['전설의 돌맹이🗿'] -= 1;
              if (!data.member[sender].bag['고급 티어 승급티켓🎫']) {
                data.member[sender].bag['고급 티어 승급티켓🎫'] = 1;
              } else {
                data.member[sender].bag['고급 티어 승급티켓🎫'] += 1;
              }
              let msg = "🔥불꽃과 함께🔥 티어 승급티켓🎟과 전설의 돌맹이🗿가\n융합되어 고급 티어 승급티켓이 완성되었습니다.\n[" + checkRank(data, sender) + "] 님 고급 티어 승급티켓 조합 성공!!";
              replier.reply(msg);
              if (data.member[sender].bag['티어 승급티켓🎟'] === 0) {
                delete data.member[sender].bag['티어 승급티켓'];
              }
              if (data.member[sender].bag['전설의 돌맹이🗿'] === 0) {
                delete data.member[sender].bag['전설의 돌맹이🗿'];
              }
            } else {
              replier.reply("티어 승급티켓🎟 50개와 전설의 돌맹이🗿 1개가 필요합니다.");
            }
          } else {
            replier.reply("고급 티어 승급티켓🎫을 조합을 하기 위해서는\n가방에 최소 2550개의 티어 승급티켓🎟이 필요합니다.");
          }
        }
        if (msg === '/금괴판매') {
          // 사용자 가방에 금괴가 있는지 확인
          if (data.member[sender].bag['금괴💰'] && data.member[sender].bag['금괴💰'] >= 1) {
            // 금괴가 있으면 1개 감소
            data.member[sender].bag['금괴💰'] -= 1;
            // 금괴 수량이 0이 되면 가방에서 금괴 항목 제거
            if (data.member[sender].bag['금괴💰'] === 0) {
              delete data.member[sender].bag['금괴💰'];
            }
            var sellChance = Math.random();          // 0부터 1 사이의 랜덤한 값 생성
            var giftAmount = 0;
            var grade = '';          // 금괴 등급을 저장할 변수
            var message3 = '';          // 출력할 메시지를 저장할 변수
            if (sellChance < 0.5) {
              // 65% 확률로 금괴를 판매 성공
              var randomValue = Math.random();
              if (randomValue < 0.6) {
                // 60% 확률로 150,000 포인트 받기
                giftAmount = 300000;
                grade = '이딴 걸 금이라고 갖고왔냐';
              } else if (randomValue < 0.9) {
                // 추가 30% 확률로 300,000 포인트 받기
                giftAmount = 700000;
                grade = '칼이나 갈때 쓰는';
              } else if (randomValue < 0.95) {
                // 추가 5% 확률로 1,000,000 포인트 받기
                giftAmount = 1500000;
                grade = '너 좀 친다?';
              } else if (randomValue < 0.98) {
                // 추가 3% 확률로 3,000,000 포인트 받기
                giftAmount = 5000000;
                grade = '빛이 나는';
              } else if (randomValue < 0.999) {
                // 추가 1.9% 확률로 5,000,000 포인트 받기
                giftAmount = 10000000;
                grade = '영광~ 영광~ 호렐루야!';
              } else if (randomValue < 1) {
                // 추가 0.1% 확률로 10,000,000 포인트 받기
                giftAmount = 30000000;
                grade = '호이도 부러워 하는';
              }
              message3 = "[" + checkRank(data, sender) + "] 님 축하합니다!\n'" + grade + "'\n등급의 금괴💰 로 판명되어\n🅟" + numberWithCommas(giftAmount.toFixed(0)) + " 를 받았습니다.";
              data.member[sender].point += giftAmount;
              replier.reply(message3);
            } else {
              // 35% 확률로 금괴 판매 실패 시 -100,000 포인트 차감
              giftAmount = -150000;
              data.member[sender].point += giftAmount;
              replier.reply("[" + checkRank(data, sender) + "] 동작그만!!\n에에에엥!!🚨 🚓끼익🚔끼익\n밀매된 금괴💰로 밝혀져\n벌금 🅟-150,000 을 고지 받았습니다\n👮👮‍♂👮‍");
            }
          } else {
            // 금괴가 없을 때 메시지 출력
            replier.reply("금괴💰가 없으면..\n구걸이라도 하던지\n호이한테 인사하라도 하던지\n여기가 어디라고 와? 앙???");
          }
        }

        if (msg.startsWith('/캐슬오픈')) {
          var args = msg.split(' ');

          // 몇 개 오픈할지 결정 (기본은 1개)
          var count = 1;
          if (args.length > 1) {
            count = Math.max(1, parseInt(args[1])); // 최소 1개 이상
          }

          // 사용자의 가방에 캐슬상자가 있는지 확인
          if (data.member[sender].bag['캐슬상자🏰'] && data.member[sender].bag['캐슬상자🏰'] >= count) {
            let itemCounts = {}; // 각 아이템의 개수를 저장할 객체
            let rank = checkRank(data, sender) || "Unknown Rank";  // checkRank 함수가 undefined를 반환하지 않도록 처리
            let responseMessage = '';

            for (var i = 0; i < count; i++) {
              var chance = Math.random();  // 0부터 1 사이의 랜덤한 값 생성
              var item = '';  // 아이템 이름을 저장할 변수

              if (chance < 0.001) {  // 0.1% 확률
                item = '호랜캐슬을 위하여!🏴‍☠(+1000💕)';
              } else if (chance < 0.02) {  // 1.9% 확률
                item = '캐슬유니크유닛👑(+200💕)';
              } else if (chance < 0.15) {  // 13% 확률
                item = '캐슬고급유닛🧙🏼‍♂(+50💕)';
              } else if (chance < 0.40) {  // 25% 확률
                item = '캐슬중급유닛🥷🏼(+10💕)';
              } else {  // 60% 확률
                item = '캐슬초급유닛💂(+1💕)';
              }

              // 아이템이 이미 존재하면 수량을 추가, 없으면 새로 추가
              if (itemCounts[item]) {
                itemCounts[item] += 1;
              } else {
                itemCounts[item] = 1;
              }

              // 단일 오픈 시, 유닛 메시지를 바로 출력
              if (count === 1) {
                let message5 = '';

                if (item === '호랜캐슬을 위하여!🏴‍☠(+1000💕)') {
                  message5 = "호랜캐슬을 위하여!🏴‍☠(+1000💕)\n호랜캐슬🏰로 돌격하십시오!";
                } else if (item === '캐슬유니크유닛👑(+200💕)') {
                  message5 = "캐슬유니크유닛👑(+200💕):\n[" + rank + "] 님 당신을 믿고 따르겠습니다.";
                } else if (item === '캐슬고급유닛🧙🏼‍♂(+50💕)') {
                  message5 = "캐슬고급유닛🧙🏼‍♂(+50💕):\n내 목숨을 [" + rank + "] 에게!";
                } else if (item === '캐슬중급유닛🥷🏼(+10💕)') {
                  message5 = "캐슬중급유닛🥷🏼(+10💕):\n제 상대가 누구죠?⚔";
                } else if (item === '캐슬초급유닛💂(+1💕)') {
                  message5 = '캐슬초급유닛💂(+1💕):\n호랜캐슬🏰을 위하여!';
                }

                replier.reply(message5); // 단일 오픈 시 코멘트 출력
              }
            }

            // 캐슬상자 개수 차감
            data.member[sender].bag['캐슬상자🏰'] -= count;
            if (data.member[sender].bag['캐슬상자🏰'] === 0) {
              delete data.member[sender].bag['캐슬상자🏰'];
            }

            // 아이템을 가방에 추가
            for (let item in itemCounts) {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += itemCounts[item];
              } else {
                data.member[sender].bag[item] = itemCounts[item];
              }
            }

            // 여러 개를 오픈했을 경우, 결과 요약만 출력
            if (count > 1) {
              responseMessage += "획득한 유닛들:\n";
              for (let item in itemCounts) {
                responseMessage += item + " " + itemCounts[item] + "개\n";
              }
              responseMessage = '[' + rank + ']님 캐슬상자🏰(' + count + '회)\n오픈결과:\n\n' + responseMessage;
              replier.reply(responseMessage.trim());
            }
          } else {
            // 캐슬상자가 없거나 부족할 때 메시지 출력
            replier.reply("[" + checkRank(data, sender) + "]님, 캐슬상자🏰가 부족합니다.");
          }
        }
        if (msg === '/꼬츈쿠키') {
          // 사용자의 가방에 꼬츈쿠키가 있는지 확인
          if (data.member[sender].bag['꼬츈쿠키🐢'] && data.member[sender].bag['꼬츈쿠키🐢'] >= 1) {
            var chance = Math.random();  // 0부터 1 사이의 랜덤한 값 생성
            var item = '';  // 아이템 이름을 저장할 변수
            var message5 = '';  // 출력할 메시지를 저장할 변수
            var rank = checkRank(data, sender) || "Unknown Rank";  // checkRank 함수가 undefined를 반환하지 않도록 처리

            if (chance < 0.000023) {  // 0.0023% 확률
              item = '집행검👑';
              message5 = "[" + rank + "] 님, 호이가 한숨을 쉽니다..나 불러 내가게,,후\n집행검👑 떳다";
            } else if (chance < 0.000123) {  // 0.01% 확률
              item = '불멸🪬';
              message5 = "[" + rank + "] 님, 불타오르네! 꼬북이🐢에게\n뒷통수🦲를 후려 맞았습니다.\n\n불멸🪬 아이템 획득!";
            } else if (chance < 0.030123) {  // 3% 확률
              item = '펫 강화석⭐';
              message5 = "[" + rank + "] 님, 사나이 꼬북이🐢에게\n물대포🌊를 쳐맞았습니다.\n\n펫 강화석⭐ 1개 획득!";
            } else if (chance < 0.080123) {  // 5% 확률
              item = '금괴상자💰';
              message5 = "[" + rank + "] 님, 머리가 빛나는 꼬북이🐢에게\n꿀밤✊을 맞았습니다.\n\n금괴상자💰 1개 획득!";
            } else if (chance < 0.160123) {  // 8% 확률
              item = '혼자레이드리셋권😝';
              message5 = "[" + rank + "] 님, 외로운 꼬북이🐢이가\n당신에게 엉금엉금 다가옵니다.\n\n혼레리😝 1개 획득!";
            } else if (chance < 0.275123) {  // 11.5% 확률
              item = '잡템상자☠';
              message5 = "[" + rank + "] 님, 해적🏴‍☠ 꼬북이🐢가 \n당신에게 귀싸대기✋를 날립니다.\n\n잡템상자☠ 1개 획득!";
            } else {  // 70% 확률
              item = '꼬북이🐢';
              message5 = "[" + rank + "] 님, 귀여운 꼬북이🐢에게\n주먹질👊을 당하였습니다.\n\n꼬북! 꼬북! 🐢 3개 획득!";
            }

            // 꼬츈쿠키를 사용했으므로 가방에서 삭제
            if (data.member[sender].bag['꼬츈쿠키🐢'] > 0) {
              data.member[sender].bag['꼬츈쿠키🐢'] -= 1;
              if (data.member[sender].bag['꼬츈쿠키🐢'] === 0) {
                delete data.member[sender].bag['꼬츈쿠키🐢'];
              }
            }

            // 사용자의 가방에 아이템 추가
            if (item === '꼬북이🐢') {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += 3;  // 꼬북이는 5개씩 추가
              } else {
                data.member[sender].bag[item] = 3;  // 가방에 꼬북이가 없으면 5개 추가
              }
            } else {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += 1;  // 다른 아이템은 1개씩 추가
              } else {
                data.member[sender].bag[item] = 1;  // 가방에 없으면 1개 추가
              }
            }

            replier.reply(message5);
          } else {
            // 꼬츈쿠키가 없을 때 메시지 출력
            replier.reply("[" + checkRank(data, sender) + "]님 호이는 배부른 것을 모릅니다..\n도와주세요..살려주세요.. 지금 후원하세요\n  /후원");
          }
        }


        if (msg == '/백신추가' && (sender == "젤리 남" || sender == "호이 남")) {
          addhealer = true;
          replier.reply('백신추가 준비완료');
        }
        if (msg.startsWith('/좀비추가') && (sender == "젤리 남" || sender == "호이 남")) {
          var numZombies = parseInt(msg.split(' ')[1]);
          var usersWithPets = Object.keys(data.member).filter(user => data.member[user].pet && data.member[user].pet.petname && data.member[user].pet.petexp > 50);
          var shuffledUsers = usersWithPets.sort(() => Math.random() - 0.5);
          for (let i = 0; i < numZombies && i < shuffledUsers.length; i++) {
            var randomUser = shuffledUsers[i];
            var randomZombieEmoji = zombieEmojis[Math.floor(Math.random() * zombieEmojis.length)];
            data.member[randomUser].pet.newimg = randomZombieEmoji;
          }
          replier.reply('변환완료');
        }
        if (msg == '/숙주추가' && (sender == "젤리 남" || sender == "호이 남")) {
          addfirstZB = true;
          replier.reply('숙주추가 준비완료');
          for (let user in data.member) {
            data.member[user].cntlike = 0;
          }
          replier.reply('모든유저 좋아요 횟수 리셋.');
        }
        if (msg.startsWith('/숙주설정 ') && (sender == "젤리 남" || sender == "호이 남")) {
          const regexzombie = /^\/숙주설정\s+([^]+)/;
          const matchzombie = msg.match(regexzombie);
          if (matchzombie) {
            const targetZombie = matchzombie[1];
            if (data.member[targetZombie]) {
              var randomZombieEmojiz = zombieEmojis[Math.floor(Math.random() * zombieEmojis.length)];
              data.member[targetZombie].pet.newimg0 = 1;
              data.member[targetZombie].pet.newimg = randomZombieEmojiz;
              replier.reply('변환완료');
            } else {
              replier.reply('유저명 오류');
            }
          } else {
            replier.reply('커멘드오류 /숙주설정 [유저명]');
          }
        }
        if (msg === '/좀비원복' && (sender == "젤리 남" || sender == "호이 남")) {
          for (let user in data.member) {
            if (data.member[user].pet && data.member[user].pet.newimg) {
              delete data.member[user].pet.newimg;
            }
            if (data.member[user].pet && data.member[user].pet.newimg2) {
              delete data.member[user].pet.newimg2;
            }
            if (data.member[user].pet && data.member[user].pet.newimg0) {
              delete data.member[user].pet.newimg0;
            }
            zombieadd = false;
            addfirstZB = false;
            addhealer = false;
          }
          replier.reply('좀비백신적용 완');
        }
        if (msg === '/좀비현황' && (sender == "젤리 남" || sender == "호이 남")) {
          var zombieList = [];
          var healerList = [];
          var replyMessage0 = '';
          for (let user in data.member) {
            if (data.member[user].pet && data.member[user].pet.newimg0) {
              replyMessage0 += '주인: ' + user + ' - 펫이름: ' + data.member[user].pet.petname + '\n';
            }
            if (data.member[user].pet && data.member[user].pet.newimg) {
              var owner = user;
              var petName = data.member[user].pet.petname;
              zombieList.push('주인: ' + owner + ' - 펫이름: ' + petName);
            }
            if (data.member[user].pet && data.member[user].pet.newimg2) {
              var owner2 = user;
              var petName2 = data.member[user].pet.petname;
              healerList.push('주인: ' + owner2 + ' - 펫이름: ' + petName2);
            }
          }
          var replyMessage = zombieList.length > 0 ? zombieList.join('\n') : '좀비로 변한 펫이 없습니다.';
          var replyMessage2 = healerList.length > 0 ? healerList.join('\n') : '백신보유 펫이 없습니다.';
          replier.reply('☠️숙주좀비☠️\n' + replyMessage0 + '\n💀좀비펫 리스트💀\n' + replyMessage + '\n\n💉백신펫 리스트💉\n' + replyMessage2);
        }
        if (msg === '/좀비숫자') {
          let zombieCount = 0;
          let healCount = 0;
          let firstZB = 0;
          for (let user in data.member) {
            if (data.member[user].pet && data.member[user].pet.newimg) {
              zombieCount++;
            }
            if (data.member[user].pet && data.member[user].pet.newimg2) {
              healCount++;
            }
            if (data.member[user].pet && data.member[user].pet.newimg0) {
              firstZB++;
            }
          }
          var replyMessageZB = '☠️숙주좀비☠️ :' + firstZB + '마리\n💀좀비펫💀 : ' + zombieCount + '마리\n💉백신펫💉 : ' + healCount + '마리';
          replier.reply(replyMessageZB);
        }
        if (msg.startsWith('/펫이름 ')) {
          var newPetname = msg.substring('/펫이름 '.length);
          if (data.member[sender].bag['펫 이름변경권🎫']) {
            if (newPetname.length <= 6) {
              data.member[sender].pet.petname = newPetname;

              // '펫 이름변경권' 개수를 1개 차감
              data.member[sender].bag['펫 이름변경권🎫'] -= 1;

              // 남은 개수가 0이면 아이템을 삭제
              if (data.member[sender].bag['펫 이름변경권🎫'] <= 0) {
                delete data.member[sender].bag['펫 이름변경권🎫'];
              }

              replier.reply("펫이름 변경이 완료되었습니다.");
            } else {
              replier.reply('펫 이름은 6글자 이하로 설정해주세요.');
            }
          } else {
            replier.reply('펫 이름변경권🎫이 없습니다.');
          }
        }

        if (msg.startsWith('/부스터 ') && (sender == "호이 남" || sender == "젤리 남")) {
          const regexb = /\/부스터\s+([^]+)\s+(\d+)/;
          const matchb = msg.match(regexb);
          if (matchb) {
            const targetUserb = matchb[1];
            const addboostcnts = matchb[2];
            if (data.member[targetUserb].boostercnt) {
              data.member[targetUserb].boostercnt += parseInt(addboostcnts);
            } else {
              data.member[targetUserb].boostercnt = parseInt(addboostcnts);
            }
            replier.reply('[' + checkRank(data, targetUserb) + '] 님의\n경험치부스터 횟수가\n' + numberWithCommas(addboostcnts) + ' 추가되었습니다.');
          }
        }

        if (msg.startsWith('/이체')) {
          const regexTransfer = /\/이체\s+([^]+)\s+(\d+)\s*$/;
          const matchTransfer = msg.match(regexTransfer);
          if (matchTransfer) {
            const targetUser = matchTransfer[1];
            const transferAmount = parseInt(matchTransfer[2]);
            if (!data.member[targetUser]) {
              replier.reply('[' + targetUser + '] 이름을 가진 멤버가 존재하지 않습니다.');
            } else if (sender === targetUser) {
              replier.reply('장난해?😤');
            } else if (transferAmount === 0) {
              replier.reply('장난치면 혼난다😤');
            } else if (data.member[sender].point < transferAmount + 100) {
              replier.reply('보유하신 포인트가 부족합니다.\n지금은 마음만 받을게요😂');
            } else if (msg.startsWith("/이체 호이랜드")) {
              var amount = parseInt(msg.substring("/이체 호이랜드".length + 1));            // /이체 호이 남 이후의 숫자 추출
              var totalHoilandAmount = calculateTotalHoilandAmount(data, sender, replier);
              if (amount > 6000000) {
                replier.reply("600만포 이상은 배팅불가합니다. 해피근절 캠페인😝");
                return;
              } else if (totalHoilandAmount + amount > 6000000) {
                replier.reply("추가 배팅으로 600만포를 초과할 수 없습니다.");
                return;
              } else if (data.member[sender].pet.petchar.startsWith("도박을 증오하는")) {
                replier.reply('도박을 증오하는 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n배팅을 시도하는 주인을 째려봅니다.\n배팅액을 회수했습니다.');
                return;
              } else {
                if (amount > 99 && data.member[sender].pet.petchar.startsWith("배팅중독")) {
                  let addbet = parseInt((amount * 0.01 * (Math.floor(Math.random() * 3) + 10)).toFixed(0)); // 10~12% 추가 배팅
                  amount += addbet;
                  replier.reply('배팅 중독인 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n숨겨둔 비상금 🅟' + numberWithCommas(addbet) + '를\n추가로 배팅합니다.');
                }
                let isFirstTransfer = Object.keys(data.hoiland).every(arrayKey => data.hoiland[arrayKey].every(entry => entry.user !== sender));
                if (isFirstTransfer) {
                  data.hoiland.NA.push({
                    user: sender,
                    amount: amount
                  });
                } else {
                  for (let arrayKey in data.hoiland) {
                    let existingEntry = data.hoiland[arrayKey].find(entry => entry.user === sender);
                    if (existingEntry) {
                      existingEntry.amount += amount;
                    }
                  }
                }
                data.member[sender].point -= transferAmount + 100;
                data.member[targetUser].point += transferAmount;
                replier.reply('[' + checkRank(data, sender) + '] 님이 \n[' + checkRank(data, targetUser) + '] 님에게\n🅟' + numberWithCommas(transferAmount) + '를 이체했습니다.');
              }
            } else {
              if (data.member[sender].pet.petname && data.member[targetUser].pet.newimg && !data.member[sender].pet.newimg2) {
                data.member[sender].pet.newimg = data.member[targetUser].pet.newimg;
                let ZBCount = 0;
                for (let user in data.member) {
                  if (data.member[user].pet && data.member[user].pet.newimg) {
                    ZBCount++;
                  }
                }
                if (ZBCount > 19) {
                  Api.replyRoom(room1, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                  Api.replyRoom(room2, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                  Api.replyRoom(room3, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                  Api.replyRoom(room4, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 ' + numberWithCommas(zombiewinreward) + ' 획득');
                  for (let user in data.member) {
                    if (data.member[user].pet && data.member[user].pet.newimg) {
                      data.member[user].point += parseInt(zombiewinreward);
                      delete data.member[user].pet.newimg;
                    }
                    if (data.member[user].pet && data.member[user].pet.newimg2) {
                      Api.replyRoom(room1, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                      Api.replyRoom(room2, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                      Api.replyRoom(room3, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                      Api.replyRoom(room4, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                      delete data.member[user].pet.newimg2;
                    }
                    if (data.member[user].pet && data.member[user].pet.newimg0) {
                      if (data.member[user].bag[zombieRewards1] === undefined) {
                        data.member[user].bag[zombieRewards1] = 1;                      // 상품을 bag에 추가
                      } else {
                        data.member[user].bag[zombieRewards1]++;
                      }
                      Api.replyRoom(room1, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room2, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room3, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room4, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      delete data.member[user].pet.newimg0;
                    }
                    zombieadd = false;
                    addfirstZB = false;
                    addhealer = false;
                  }
                }
              }
              if (data.member[sender].pet.newimg2 && data.member[targetUser].pet.newimg) {
                delete data.member[targetUser].pet.newimg;
              }
              data.member[sender].point -= transferAmount + 100;
              data.member[targetUser].point += transferAmount;
              replier.reply('[' + checkRank(data, sender) + '] 님이 \n[' + checkRank(data, targetUser) + '] 님에게\n🅟' + numberWithCommas(transferAmount) + '를 이체했습니다.');
            }
          } else {
            replier.reply('올바른 형식으로 이체해주세요.\n예: /이체 [유저] [숫자]');
          }
        }
        if (msg === 'ㅊㅊ') {
          if (!data.attend_list.includes(sender)) {
            data.attend_list.push(sender);          //출석목록에 저장
            if (data.member[sender].yesterday === 1) {
              data.member[sender].straight += 1;            // 연속 출석 횟수 증가
            } else {
              data.member[sender].straight = 1;            // 연속 출석이 아니면 1로 초기화
            }
            data.member[sender].cnt++;          //출석일 증가
            data.member[sender].today++;          //금일 출석 여부 증가
            data.member[sender].recent = getCurrentDate();          // 최근출석일에 등록
            data.member[sender].point += attendBonusPoint;          //포인트 출석비
            data.member[sender].exp += attendBonusExp;          //경험치 출석비
            replier.reply('[' + checkRank(data, sender) + '] 님 출첵👏\n\n💰포인트 🅟' + attendBonusPoint + ' 획득\n⚡️경험치  ' + attendBonusExp + 'exp 획득');
            var multi = rollAndCalculateMultiplier();          // 주사위를 굴려 배율을 계산하는 함수 호출
            var result = parseInt((attendBonusPoint * multi).toFixed(0));          //보너스 ㅊㅊ포인트
            var diceMsg = '[' + checkRank(data, sender) + ']님의 출첵 응모가 굴러갑니다!\n' + multi + '배 당첨!💸\n' + '🅟' + numberWithCommas(result) + ' 추가적립 되었습니다.';
            data.member[sender].point += result;          // ㅊㅊ 주사위 포인트 추가
            replier.reply(diceMsg);
            var Bonus = RankBonus(data, sender);          //랭크 ㅊㅊ 보너스
            var BonusResult = parseInt((attendBonusPoint * Bonus.BonusM).toFixed(0));
            if (Bonus.BonusM !== 0) {
              Bonus.Bonusmsg += '🎊\n🅟' + numberWithCommas(BonusResult) + ' 추가적립 되었습니다.';
              data.member[sender].point += BonusResult;            //랭크추가 ㅊㅊ 주사위 포인트 추가
              replier.reply(Bonus.Bonusmsg);
            }
          } else {
            replier.reply('[' + checkRank(data, sender) + '] 님 이미 출첵 하셨습니다.');
          }
        }
        if (msg.startsWith('/구매')) {
          let isBuyFlag = false;
          const regexPurchase = /\/구매\s+(\d+)(?:\s+(\d+))?$/;
          const matchPurchase = msg.match(regexPurchase);
          if (matchPurchase) {
            let itemList = Object.keys(data.shop);
            var itemNumber = parseInt(matchPurchase[1], 10);
            var purchaseQuantity = parseInt(matchPurchase[2], 10) || 1;
            if (itemNumber > 0 && itemNumber <= itemList.length) {
              var itemNameToBuy = itemList[itemNumber - 1];
              var itemPriceToBuy = data.shop[itemNameToBuy] * purchaseQuantity;
              let originitemPrice = itemPriceToBuy;
              if (data.member[sender].pet.petchar.startsWith("쇼핑광")) {
                itemPriceToBuy = itemPriceToBuy * 0.85;
                replier.reply('쇼핑광 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\nVIP카드를 제시합니다.\n상품가 15%할인 적용.');
              }
              if (data.member[sender].point >= itemPriceToBuy) {

                itemPriceToBuy = applyTax(itemPriceToBuy, data); // 세율적용

                if (itemNameToBuy == "펫 매력포션💊(900이하)") {
                  if (data.member[sender].pet.petname) {
                    if ((data.member[sender].pet.petexp + purchaseQuantity) < 901) {
                      isBuyFlag = true;
                      data.member[sender].pet.petexp += purchaseQuantity;
                      replier.reply(itemNameToBuy + ' x' + purchaseQuantity + '개를\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                      replier.reply(data.member[sender].pet.petimg + data.member[sender].pet.petname + ": 꿈틀 꿈틀..🍼\n 매력💕 " + purchaseQuantity + "pt 상승!!");
                      if (data.member[sender].pet.petexp === requiredpoint) {
                        updateEmoji(data.member[sender].pet, replier);
                      }
                    } else {
                      replier.reply("이미 충분히 성장하여\n초급포션💊 x" + purchaseQuantity + "개를\n 먹일 수 없습니다.");
                    }
                  } else {
                    replier.reply("펫을 먼저 생성해 주세요");
                  }
                } else if (itemNameToBuy == "펫 아이템 뽑기👜") {
                  if (data.member[sender].pet.petname) {
                    if (purchaseQuantity > 1) {
                      replier.reply("펫 아이템 뽑기👜는 다량 구매 불가 합니다.");
                    } else {
                      isBuyFlag = true;
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                      let selectedGear = getRandomGear(data.member[sender].pet, replier, data.member[sender].bag);
                      let gearUpmsg = '';
                      if (data.member[sender].pet.petgear.gearUp) {
                        gearUpmsg = '(+' + data.member[sender].pet.petgear.gearUp + ')';
                      }
                      data.member[sender].pet.petgear.gearRank = selectedGear.gearRank;
                      data.member[sender].pet.petgear.gearName = selectedGear.gearName;
                      replier.reply(data.member[sender].pet.petimg + data.member[sender].pet.petname + "에게\n[" + data.member[sender].pet.petgear.gearName + "]" + gearUpmsg + "(을)를 주었습니다.");
                    }
                  } else {
                    replier.reply("펫을 먼저 생성해 주세요");
                  }
                } else if (itemNameToBuy == "펫 성격 뽑기😣") {
                  if (data.member[sender].pet.petname) {
                    if (purchaseQuantity > 1) {
                      replier.reply("펫 성격 뽑기😣는 다량 구매 불가 합니다.");
                    } else {
                      isBuyFlag = true;
                      data.member[sender].pet.pettitle = getRandomCharacter();
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                      replier.reply(data.member[sender].pet.petimg + data.member[sender].pet.petname + '의 성격이\n' + data.member[sender].pet.pettitle + '으로 변경되었습니다.');
                    }
                  } else {
                    replier.reply("펫을 먼저 생성해 주세요");
                  }
                } else if (itemNameToBuy == "펫 성형권🌟") {
                  if (data.member[sender].pet.petname) {
                    if (purchaseQuantity > 2) {
                      replier.reply("펫 성형권🌟은 다량 구매 불가 합니다.");
                    } else {
                      isBuyFlag = true;
                      const selectedType = petTypes1[Math.floor(Math.random() * petTypes1.length)];
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                      data.member[sender].pet.pettype = selectedType.name;
                      updateEmoji(data.member[sender].pet, replier);
                    }
                  } else {
                    replier.reply("펫을 먼저 생성해 주세요");
                  }
                } else if (itemNameToBuy == "자동배팅😝🤖(1일)") {
                  if (purchaseQuantity > 1) {
                    replier.reply("자동배팅😝🤖(1일)은 다량 구매 불가 합니다.");
                  } else {
                    if (data.member[sender].bag[itemNameToBuy]) {
                      replier.reply("이미 [자동배팅😝🤖(1일)] 을 보유 중입니다.");
                    } else {
                      isBuyFlag = true;
                      data.member[sender].bag[itemNameToBuy] = 1;                    // 상품을 bag에 추가
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    }
                  }
                } else if (itemNameToBuy == "자동대깨호😝(1일)") {
                  if (purchaseQuantity > 1) {
                    replier.reply("자동대깨호😝(1일)은 다량 구매 불가 합니다.");
                  } else {
                    if (data.member[sender].bag[itemNameToBuy]) {
                      replier.reply("이미 [자동대깨호😝(1일)] 을 보유 중입니다.");
                    } else {
                      isBuyFlag = true;
                      data.member[sender].bag[itemNameToBuy] = 1;                    // 상품을 bag에 추가
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    }
                  }
                } else if (itemNameToBuy == "자동대깨무🐔 패스이용권") {
                  if (purchaseQuantity > 1) {
                    replier.reply("자동대깨무🐔 패스이용권은 다량 구매 불가 합니다.");
                  } else {
                    if (data.member[sender].bag[itemNameToBuy]) {
                      replier.reply("이미 [자동대깨무🐔 패스이용권] 을 보유 중입니다.");
                    } else {
                      isBuyFlag = true;
                      data.member[sender].bag[itemNameToBuy] = 1;                    // 상품을 bag에 추가
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    }
                  }
                } else if (itemNameToBuy == "자동대깨봇🤖(1일)") {
                  if (purchaseQuantity > 1) {
                    replier.reply("자동대깨봇🤖(1일)은 다량 구매 불가 합니다.");
                  } else {
                    if (data.member[sender].bag[itemNameToBuy]) {
                      replier.reply("이미 [자동대깨봇🤖(1일)] 을 보유 중입니다.");
                    } else {
                      isBuyFlag = true;
                      data.member[sender].bag[itemNameToBuy] = 1;                    // 상품을 bag에 추가
                      replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    }
                  }
                } else if (itemNameToBuy == "슬롯코인🪙") {
                  if (!data.member[sender].coincount) {
                    data.member[sender].coincount = 0;
                  }
                  // 기본 최대 구매 한도는 10개
                  var maxPurchaseLimit = 10;

                  // 사용자의 가방에 '슈퍼슬롯' 아이템이 있는 경우 최대 구매 한도를 15개로 설정
                  if (data.member[sender].bag['슬롯가방🎒(+5)']) {
                    maxPurchaseLimit = 15;
                  }

                  // 사용자의 가방에 '슈퍼슈퍼슬롯' 아이템이 있는 경우 최대 구매 한도를 20개로 설정
                  if (data.member[sender].bag['슬롯가방👜(+10)']) {
                    maxPurchaseLimit = 20;
                  }

                  if (data.member[sender].bag['슬롯가방💼(+20)']) {
                    maxPurchaseLimit = 30;
                  }

                  var coincheck = data.member[sender].coincount + purchaseQuantity;
                  if (coincheck > maxPurchaseLimit) {
                    var remainingCoin = maxPurchaseLimit - data.member[sender].coincount;
                    replier.reply('슬롯코인🪙 하루 구매 제한\n[' + checkRank(data, sender) + '] 님의 남은 구매 가능수량: ' + remainingCoin);
                  } else {
                    data.member[sender].coincount += purchaseQuantity;
                    if (data.member[sender].bag[itemNameToBuy] === undefined) {
                      data.member[sender].bag[itemNameToBuy] = purchaseQuantity;  // 상품을 bag에 추가
                    } else {
                      data.member[sender].bag[itemNameToBuy] += purchaseQuantity;
                    }
                    replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    isBuyFlag = true;
                  }
                } else if (itemNameToBuy == "펫 속성리롤🔄") {
                  if (!data.member[sender].pet.petname) {
                    replier.reply("펫을 먼저 생성해 주세요");
                    return
                  }
                  if (purchaseQuantity > 1) {
                    replier.reply("펫 속성리롤🔄은 다량 구매 불가 합니다.");
                  } else {
                    isBuyFlag = true;
                    data.member[sender].pet.pettype = getRandomPetType();
                    replier.reply(itemNameToBuy + '을(를)\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                    replier.reply(data.member[sender].pet.petimg + data.member[sender].pet.petname + '의속성이\n' + data.member[sender].pet.pettype + '(으)로 변경되었습니다.\n하늘>땅>바다>하늘 오른쪽 상성 기준\n1.3배💕 매력 적용');
                  }
                } else {
                  if (data.member[sender].bag[itemNameToBuy] === undefined) {
                    data.member[sender].bag[itemNameToBuy] = purchaseQuantity;  // 상품을 bag에 추가
                  } else {
                    data.member[sender].bag[itemNameToBuy] += purchaseQuantity;
                  }
                  replier.reply(itemNameToBuy + ' x' + purchaseQuantity + '개를\n🅟' + numberWithCommas(itemPriceToBuy) + '에 구매하셨습니다.');
                  isBuyFlag = true;
                }

                if (isBuyFlag) {
                  data.member[sender].point -= itemPriceToBuy; // 상품가격 point 차감
                  let taxAmount = Math.round((originitemPrice * (data.HoiCastle.taxRate / 100)) / 2);
                  data.member[data.HoiCastle.lord].point += taxAmount; // 영주에게 세금 증여
                  data.HoiCastle.earnings += taxAmount; // 호랜캐슬 세금에 추가
                }
              } else {
                replier.reply('포인트가 부족하여\n' + itemNameToBuy + ' x' + purchaseQuantity + '개를 구매할 수 없습니다.');
              }
            } else {
              replier.reply('유효하지 않은 상품 번호입니다.\n다시 확인해주세요.');
            }
          } else {
            replier.reply('올바른 구매 명령어 형식을 사용해주세요.\n예: /구매 [번호] 또는 /구매 [번호] [수량]');
          }
        }

        if (msg.startsWith('/외형 ') && (sender == "젤리 남" || sender == "호이 남")) {
          const regexap = /\/외형\s+([^]+)/;
          const matchap = msg.match(regexap);
          if (matchap) {
            const newpetimg = matchap[1];
            if (data.member[sender].pet.petname) {
              data.member[sender].pet.petimg = newpetimg;
              replier.reply('완');
            } else {
              replier.reply(sender + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }
        if (msg.startsWith('/타이틀삭제')) {
          const regexTitleRemove = /\/타이틀삭제\s+(\d+)\s*$/;
          const matchTitleRemove = msg.match(regexTitleRemove);
          if (matchTitleRemove) {
            let titleList = data.member[sender].title.list;
            const titleNumber = parseInt(matchTitleRemove[1], 10);
            if (titleList && titleList.length >= titleNumber) {
              const removedTitle = titleList.splice(titleNumber - 1, 1)[0];
              replier.reply('[' + checkRank(data, sender) + '] 님의 [' + removedTitle + '] 타이틀이 제거되었습니다.');
            } else {
              replier.reply('해당 번호의 타이틀이 존재하지 않습니다.');
            }
          } else {
            replier.reply('올바른 타이틀 삭제 명령어 형식을 사용해주세요. 예: /타이틀삭제 [번호]');
          }
        }
        if (msg.startsWith('/타이틀 ')) {
          const regexSetTitle = /\/타이틀\s+(\d+)\s*$/;
          const matchSetTitle = msg.match(regexSetTitle);
          if (matchSetTitle) {
            const newActiveTitleIndex = parseInt(matchSetTitle[1], 10);
            if (data.member[sender]) {
              const usert = data.member[sender];
              if (usert.title.list && usert.title.list.length >= newActiveTitleIndex) {
                const newActiveTitle = usert.title.list[newActiveTitleIndex - 1];
                usert.active = newActiveTitleIndex;
                replier.reply('[' + checkRank(data, sender) + '] 님의 타이틀이\n[' + newActiveTitle + '] (으)로 적용되었습니다.');
              } else {
                replier.reply('해당 번호의 타이틀이 존재하지 않습니다.');
              }
            } else {
              replier.reply(sender + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 타이틀 설정 명령어 형식을 사용해주세요. 예: /타이틀 [번호]');
          }
        }
        if (msg.startsWith('/좋아요 ')) {
          const regexlike = /^\/좋아요\s+([^]+)/;
          const matchlike = msg.match(regexlike);
          if (matchlike) {
            const targetUserl = matchlike[1];
            if (data.member[targetUserl]) {
              if (targetUserl == sender) {
                replier.reply("셀프💕 고만...");
              } else {
                if (!data.member[sender].cntlike) {
                  data.member[sender].cntlike = 1;
                } else {
                  data.member[sender].cntlike++;
                }
                if (data.member[sender].cntlike > 3) {
                  replier.reply("좋아요는 하루에 3번까지만 가능합니다. 😅");
                  return;
                }
                if (data.member[sender].point >= 8) {
                  data.member[sender].point -= 8;
                  data.member[targetUserl].like++;
                  replier.reply("💕");
                  if (data.member[sender].pet.petname && data.member[targetUserl].pet.newimg && !data.member[sender].pet.newimg2) {
                    data.member[sender].pet.newimg = data.member[targetUserl].pet.newimg;
                    let ZBCount = 0;
                    for (let user in data.member) {
                      if (data.member[user].pet && data.member[user].pet.newimg) {
                        ZBCount++;
                      }
                    }
                    if (ZBCount > 19) {
                      Api.replyRoom(room1, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room2, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room3, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room4, '좀비바이러스에 감염된 펫이\n총 20마리를 넘어섰습니다.\n좀비세상 Ending.\n모든 좀비 ' + numberWithCommas(zombiewinreward) + ' 획득');
                      for (let user in data.member) {
                        if (data.member[user].pet && data.member[user].pet.newimg) {
                          data.member[user].point += parseInt(zombiewinreward);
                          delete data.member[user].pet.newimg;
                        }
                        if (data.member[user].pet && data.member[user].pet.newimg2) {
                          Api.replyRoom(room1, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                          Api.replyRoom(room2, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                          Api.replyRoom(room3, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                          Api.replyRoom(room4, '[' + user + '] 님은\n백신펫 소유자 였습니다.');
                          delete data.member[user].pet.newimg2;
                        }
                        if (data.member[user].pet && data.member[user].pet.newimg0) {
                          if (data.member[user].bag[zombieRewards1] === undefined) {
                            data.member[user].bag[zombieRewards1] = 1;                          // 상품을 bag에 추가
                          } else {
                            data.member[user].bag[zombieRewards1]++;
                          }
                          Api.replyRoom(room1, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                          Api.replyRoom(room2, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                          Api.replyRoom(room3, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                          Api.replyRoom(room4, '[' + user + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                          delete data.member[user].pet.newimg0;
                        }
                        zombieadd = false;
                        addfirstZB = false;
                        addhealer = false;
                      }
                    }
                  }
                  if (data.member[sender].pet.newimg2 && data.member[targetUserl].pet.petname) {
                    data.member[targetUserl].pet.newimg2 = data.member[sender].pet.newimg2;
                    delete data.member[targetUserl].pet.newimg;
                    if (data.member[targetUserl].pet.newimg0) {
                      delete data.member[targetUserl].pet.newimg0;
                      var randomZombieRewards = zombieRewards[Math.floor(Math.random() * zombieRewards.length)];
                      if (data.member[sender].bag[randomZombieRewards] === undefined) {
                        data.member[sender].bag[randomZombieRewards] = 1;                      // 상품을 bag에 추가
                      } else {
                        data.member[sender].bag[randomZombieRewards]++;
                      }
                      Api.replyRoom(room1, '백신펫을 보유중인 [' + sender + '] 이(가) \n숙주 [' + targetUserl + '] 을(를) 잡았습니다.\n[' + randomZombieRewards + '] 을(를)\n' + '보상으로 획득하였습니다.');
                      Api.replyRoom(room2, '백신펫을 보유중인 [' + sender + '] 이(가) \n숙주 [' + targetUserl + '] 을(를) 잡았습니다.\n[' + randomZombieRewards + '] 을(를)\n' + '보상으로 획득하였습니다.');
                      Api.replyRoom(room3, '백신펫을 보유중인 [' + sender + '] 이(가) \n숙주 [' + targetUserl + '] 을(를) 잡았습니다.\n[' + randomZombieRewards + '] 을(를)\n' + '보상으로 획득하였습니다.');
                      Api.replyRoom(room4, '백신펫을 보유중인 [' + sender + '] 이(가) \n숙주 [' + targetUserl + '] 을(를) 잡았습니다.\n[' + randomZombieRewards + '] 을(를)\n' + '보상으로 획득하였습니다.');
                      let firstZBCount = 0;
                      for (let user in data.member) {
                        if (data.member[user].pet && data.member[user].pet.newimg0) {
                          firstZBCount++;
                        }
                      }
                      if (firstZBCount == 0) {
                        Api.replyRoom(room1, '모든 숙주좀비가 처리되었습니다.\n백신 Ending.\n모든유저 🅟' + numberWithCommas(healwinreweward) + ' 획득');
                        Api.replyRoom(room2, '모든 숙주좀비가 처리되었습니다.\n백신 Ending.\n모든유저 🅟' + numberWithCommas(healwinreweward) + ' 획득');
                        Api.replyRoom(room3, '모든 숙주좀비가 처리되었습니다.\n백신 Ending.\n모든유저 🅟' + numberWithCommas(healwinreweward) + ' 획득');
                        Api.replyRoom(room4, '모든 숙주좀비가 처리되었습니다.\n백신 Ending.\n모든유저 ' + numberWithCommas(healwinreweward) + ' 획득');
                        for (let user in data.member) {
                          data.member[user].point += parseInt(healwinreweward);
                          if (data.member[user].pet && data.member[user].pet.newimg) {
                            delete data.member[user].pet.newimg;
                          }
                          if (data.member[user].pet && data.member[user].pet.newimg2) {
                            delete data.member[user].pet.newimg2;
                          }
                          if (data.member[user].pet && data.member[user].pet.newimg0) {
                            delete data.member[user].pet.newimg0;
                          }
                          zombieadd = false;
                          addfirstZB = false;
                          addhealer = false;
                        }
                      }
                    }
                  }
                  if (data.member[sender].pet.newimg0 && data.member[targetUserl].pet.newimg2) {
                    delete data.member[targetUserl].pet.newimg2;
                    data.member[sender].cntlike = 1;
                    let healCount = 0;
                    for (let user in data.member) {
                      if (data.member[user].pet && data.member[user].pet.newimg2) {
                        healCount++;
                      }
                    }
                    if (healCount == 0) {
                      Api.replyRoom(room1, '좀비 숙주펫을 보유중인 [' + sender + '] 이(가)\n마지막 남은 백신펫을 잡았습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room2, '좀비 숙주펫을 보유중인 [' + sender + '] 이(가)\n마지막 남은 백신펫을 잡았습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room3, '좀비 숙주펫을 보유중인 [' + sender + '] 이(가)\n마지막 남은 백신펫을 잡았습니다.\n좀비세상 Ending.\n모든 좀비 🅟' + numberWithCommas(zombiewinreward) + ' 획득');
                      Api.replyRoom(room4, '좀비 숙주펫을 보유중인 [' + sender + '] 이(가)\n마지막 남은 백신펫을 잡았습니다.\n좀비세상 Ending.\n모든 좀비 ' + numberWithCommas(zombiewinreward) + ' 획득');
                      if (data.member[sender].bag[zombieRewards1] === undefined) {
                        data.member[sender].bag[zombieRewards1] = 1;                      // 상품을 bag에 추가
                      } else {
                        data.member[sender].bag[zombieRewards1]++;
                      }
                      Api.replyRoom(room1, '[' + sender + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room2, '[' + sender + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room3, '[' + sender + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      Api.replyRoom(room4, '[' + sender + '] 님은\n좀비숙주펫 소유자 였습니다.\n[' + zombieRewards1 + '] 을(를) 획득하였습니다.');
                      for (let user in data.member) {
                        if (data.member[user].pet && data.member[user].pet.newimg) {
                          data.member[user].point += parseInt(zombiewinreward);
                          delete data.member[user].pet.newimg;
                        }
                        if (data.member[user].pet && data.member[user].pet.newimg2) {
                          delete data.member[user].pet.newimg2;
                        }
                        if (data.member[user].pet && data.member[user].pet.newimg0) {
                          delete data.member[user].pet.newimg0;
                        }
                        zombieadd = false;
                        addfirstZB = false;
                        addhealer = false;
                      }
                    }
                  }
                  if (data.member[targetUserl].pet && data.member[targetUserl].pet.petchar.startsWith('주인을 동정하는')) {
                    replier.reply('주인을 동정하는 [' + data.member[targetUserl].pet.petimg + data.member[targetUserl].pet.petname + '] 이(가)\n못난주인을 잘부탁한다며\n숨겨둔 🅟50,000를 전달합니다.');
                    data.member[sender].point += 50000;
                  }
                } else {
                  replier.reply('포인트가 부족하여 좋아요를 보낼 수 없습니다. 😥');
                }
              }
            } else {
              replier.reply(targetUserl + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply("올바른 좋아요 명령어 형식을 사용해 주세요. /좋아요 [유저명]");
          }
        }

        if (msg == '/게임' && isAdmin(sender)) {
          var game = loadgametxtFromFile();
          var gamemsg = "언더바(_) 제거 후 띄어쓰기를 한 문장을 먼저 발송하는 멤버에게는 경험치와 포인트가 주어집니다.\n\n";
          gamemsg += game;
          gameAnswer = game.replace(/_/g, " ");
          //  Api.replyRoom(room1, gamemsg);
          Api.replyRoom(room2, gamemsg);
          //  Api.replyRoom(room4, gamemsg);
          Api.replyRoom(room3, gamemsg);
          Api.replyRoom(room5, gamemsg);
        }
        if (msg == gameAnswer) {
          var gameresult = '[' + checkRank(data, sender) + '] 님 정답!\n경험치 ' + gameExp + 'exp\n포인트 🅟' + gamePoint + ' 획득!\n게임이 종료되었습니다.';
          data.member[sender].minigamecnt++;
          data.member[sender].point += gamePoint;
          data.member[sender].exp += gameExp;
          gameAnswer = Math.floor(Math.random() * 9000) + 1000;        //정답후 답 섞기
          // Api.replyRoom(room1, gameresult);
          Api.replyRoom(room2, gameresult);
          Api.replyRoom(room3, gameresult);
          Api.replyRoom(room5, gameresult);
        }
        if (msg.startsWith('/정답') && isAdmin(sender)) {
          quizpreAnswer = msg.replace('/정답', '').trim();
          replier.reply("퀴즈 답이 " + quizpreAnswer + "로 설정되었습니다.");
        }
        if (msg.startsWith("/노래퀴즈정답 ") && (sender == "호이 남" || sender == "젤리 남")) {
          var songm = msg.substr(8);
          var songurl = org.jsoup.Jsoup.connect("https://search.naver.com/search.naver?sm=mtp_hty.top&where=m&query=+" + songm + "+가사").get();
          var music = songurl.select("div.title_area._title_area > h2 > span > strong").text();
          musicquizpreAnswer = music;
          var musiclyrics = songurl.select(".intro_box");
          var songresult = String(musiclyrics).replace(/<br>/gim, "\n").replace(/<[^>]+>/g, "");
          songhint = songresult;
          if (songresult == "") {
            replier.reply(songm + "에 대한 노래 검색 결과가 없습니다.");
          } else {
            var songartist = songurl.select("div:nth-child(1) > dd > a").text();
            replier.reply('[' + musicquizpreAnswer + '] by ' + songartist + '(이)가 노래퀴즈 정답으로 설정되었습니다.');
            musicquizresultmsg = "\n정답 : " + music + " by " + songartist + "\n가사 더보기" + allsee + "\n" + songresult;
          }
        }
        if (songhint != '' && msg == "/노래퀴즈" && (sender == "호이 남" || sender == "젤리 남")) {
          musicquiznow = true;
          Api.replyRoom(room1, "노래 퀴즈 시작!\n가사를 보고 노래 제목을 맞춰주세요.");
          Api.replyRoom(room2, "노래 퀴즈 시작!\n가사를 보고 노래 제목을 맞춰주세요.");
          Api.replyRoom(room3, "노래 퀴즈 시작!\n가사를 보고 노래 제목을 맞춰주세요.");
          Api.replyRoom(room4, "노래 퀴즈 시작!\n가사를 보고 노래 제목을 맞춰주세요.");
          var randomsonglyricline = '';
          musicquizAnswer = musicquizpreAnswer;
          var lines = songhint.split('\n');
          var randomIndex = Math.floor(Math.random() * lines.length);
          randomsonglyricline = lines[randomIndex];
          Api.replyRoom(room1, '노래퀴즈 가사: ' + randomsonglyricline + '🎶');
          Api.replyRoom(room2, '노래퀴즈 가사: ' + randomsonglyricline + '🎶');
          Api.replyRoom(room3, '노래퀴즈 가사: ' + randomsonglyricline + '🎶');
          Api.replyRoom(room4, '노래퀴즈 가사: ' + randomsonglyricline + '🎶');
        }
        if (musicquiznow && msg == "/가사추가" && isAdmin(sender)) {
          var addrandomsonglyricline = '';
          musicquizAnswer = musicquizpreAnswer;
          var liness = songhint.split('\n');
          var randomIndexss = Math.floor(Math.random() * liness.length);
          addrandomsonglyricline = liness[randomIndexss];
          Api.replyRoom(room1, '노래퀴즈 가사: ' + addrandomsonglyricline + '🎶');
          Api.replyRoom(room2, '노래퀴즈 가사: ' + addrandomsonglyricline + '🎶');
          Api.replyRoom(room3, '노래퀴즈 가사: ' + addrandomsonglyricline + '🎶');
          Api.replyRoom(room4, '노래퀴즈 가사: ' + addrandomsonglyricline + '🎶');
        }
        if (musicquiznow && msg == musicquizAnswer) {
          var musicquizresult = '[' + checkRank(data, sender) + '] 님이 맞췄습니다.\n경험치 ' + gameExp + 'exp\n포인트 🅟' + gamePoint + ' \n슬롯코인🪙 x1 획득!\n게임이 종료되었습니다.\n';
          data.member[sender].minigamecnt++;
          data.member[sender].point += gamePoint;
          data.member[sender].exp += gameExp;
          if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
            data.member[sender].bag['슬롯코인🪙'] = 1;          // 상품을 bag에 추가
          } else {
            data.member[sender].bag['슬롯코인🪙']++;
          }
          musicquizpreAnswer = Math.floor(Math.random() * 9000) + 1000;        //퀴즈 정답 섞기 
          musicquizAnswer = Math.floor(Math.random() * 9000) + 1000;        //퀴즈 정답 섞기
          Api.replyRoom(room1, musicquizresult + musicquizresultmsg);
          Api.replyRoom(room2, musicquizresult + musicquizresultmsg);
          Api.replyRoom(room3, musicquizresult + musicquizresultmsg);
          musicquiznow = false;
          songhint = '';
          if (data.member[sender].pet.petchar.startsWith("퀴즈를 사랑하는")) {
            data.member[sender].point += 10000;
            replier.reply('퀴즈를 사랑하는 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n퀴즈를 맞춘 주인에게 감명하여\n숨겨둔 🅟5,000를 전달합니다.');
          }
        }
        if (msg == "/퀴즈" && isAdmin(sender)) {
          replier.reply("퀴즈 시작!");
          quizAnswer = quizpreAnswer;
        }
        if (msg == quizAnswer) {
          var quizresult = '[' + checkRank(data, sender) + '] 님 정답!\n경험치 ' + gameExp + 'exp\n포인트 🅟' + gamePoint + ' 획득!\n게임이 종료되었습니다.';
          data.member[sender].minigamecnt++;
          data.member[sender].point += gamePoint;
          data.member[sender].exp += gameExp;
          quizpreAnswer = Math.floor(Math.random() * 9000) + 1000;        //퀴즈 정답 섞기 
          quizAnswer = Math.floor(Math.random() * 9000) + 1000;        //퀴즈 정답 섞기
          replier.reply(quizresult);
          if (data.member[sender].pet.petchar.startsWith("퀴즈를 사랑하는")) {
            data.member[sender].point += 5000;
            replier.reply('퀴즈를 사랑하는 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n퀴즈를 맞춘 주인에게 감명하여\n숨겨둔 🅟5,000를 전달합니다.');
          }
        }
        if (msg === "/넌센스" && isAdmin(sender)) {
          if (!quiznow) {
            newQuestionInfo = QuizBot.setNewQuestion();          // Assign to newQuestionInfo
            quiznow = true;
            Api.replyRoom(room1, "[문제] " + newQuestionInfo.question);
            Api.replyRoom(room2, "[문제] " + newQuestionInfo.question);
            Api.replyRoom(room3, "[문제] " + newQuestionInfo.question);
            Api.replyRoom(room5, "[문제] " + newQuestionInfo.question);
          } else {
            replier.reply("이미 퀴즈가 진행 중입니다.\n[문제] " + newQuestionInfo.question);
          }
        }
        if (msg === "/힌트") {
          if (quiznow) {
            Api.replyRoom(room1, "[힌트]: " + newQuestionInfo.hint);
            Api.replyRoom(room2, "[힌트]: " + newQuestionInfo.hint);
            Api.replyRoom(room3, "[힌트]: " + newQuestionInfo.hint);
            Api.replyRoom(room5, "[힌트]: " + newQuestionInfo.hint);
          } else {
            replier.reply("퀴즈가 진행되지 않았습니다.");
          }
        }
        if (msg === "/패스") {
          if (quiznow) {
            if (!passCounts[sender] && !passedUsers.includes(sender)) {
              passCounts[sender] = 1;
              passedUsers.push(sender);
            } else {
              replier.reply("한 퀴즈에 대해 한 번만 패스할 수 있습니다.");
              return;
            }
            replier.reply("퀴즈 패스 요청 횟수 (" + passedUsers.length + "/3)");
            if (passedUsers.length === 3) {
              Api.replyRoom(room1, "퀴즈가 3명에게 패스되었습니다.\n[정답] " + newQuestionInfo.answer + "\n[이유] " + newQuestionInfo.why);
              Api.replyRoom(room2, "퀴즈가 3명에게 패스되었습니다.\n[정답] " + newQuestionInfo.answer + "\n[이유] " + newQuestionInfo.why);
              Api.replyRoom(room3, "퀴즈가 3명에게 패스되었습니다.\n[정답] " + newQuestionInfo.answer + "\n[이유] " + newQuestionInfo.why);
              Api.replyRoom(room5, "퀴즈가 3명에게 패스되었습니다.\n[정답] " + newQuestionInfo.answer + "\n[이유] " + newQuestionInfo.why);
              quiznow = false;
              passedUsers = [];
              passCounts = {};
            }
          } else {
            replier.reply("퀴즈가 진행되지 않았습니다.");
          }
        }
        if (quiznow && msg === newQuestionInfo.answer) {
          Api.replyRoom(room1, '[' + checkRank(data, sender) + "] 님 정답! ==> {" + newQuestionInfo.answer + "}\n[이유] " + newQuestionInfo.why);
          Api.replyRoom(room2, '[' + checkRank(data, sender) + "] 님 정답! ==> {" + newQuestionInfo.answer + "}\n[이유] " + newQuestionInfo.why);
          Api.replyRoom(room3, '[' + checkRank(data, sender) + "] 님 정답! ==> {" + newQuestionInfo.answer + "}\n[이유] " + newQuestionInfo.why);
          Api.replyRoom(room5, '[' + checkRank(data, sender) + "] 님 정답! ==> {" + newQuestionInfo.answer + "}\n[이유] " + newQuestionInfo.why);
          quiznow = false;
          passedUsers = [];
          passCounts = {};
          var quizresult2 = '[' + checkRank(data, sender) + '] 님\n경험치 ' + gameExp + 'exp\n포인트 🅟' + gamePoint + ' 획득!';
          data.member[sender].minigamecnt++;
          data.member[sender].point += gamePoint;
          data.member[sender].exp += gameExp;
          passedUsers.splice(0, passedUsers.length);
          replier.reply(quizresult2);
          if (data.member[sender].pet.petchar.startsWith("퀴즈를 사랑하는")) {
            data.member[sender].point += 10000;
            replier.reply('퀴즈를 사랑하는 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n퀴즈를 맞춘 주인에게 감명하여\n숨겨둔 🅟10,000를 전달합니다.');
          }
        }
        if (msg.startsWith('/상점추가') && sender == Master) {
          const regex = /\/상점추가\s+(.+)\s+(\d+)\s*$/;
          const match = msg.match(regex);
          if (match) {
            const itemName = match[1];
            const itemPrice = parseInt(match[2], 10);
            data.shop[itemName] = itemPrice;
            replier.reply('상점에 ' + itemName + '이(가) 🅟' + numberWithCommas(itemPrice) + '로 추가되었습니다.');
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /상점추가 [물건] [가격]');
          }
        }
        if (msg.startsWith('/상점삭제') && sender == "호이 남") {
          const regexShop = /\/상점삭제\s+(\d+)\s*$/;
          const matchShop = msg.match(regexShop);
          if (matchShop) {
            const itemNumberToDelete = parseInt(matchShop[1]);
            let itemList = Object.keys(data.shop);
            if (itemNumberToDelete > 0 && itemNumberToDelete <= itemList.length) {
              let targetItem = itemList[itemNumberToDelete - 1];
              delete data.shop[targetItem];
              replier.reply(targetItem + '이(가) 상점에서 삭제되었습니다.');
            } else {
              replier.reply('유효한 상점 아이템 번호를 입력해주세요.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /상점삭제 [물건번호]');
          }
        }
        if (msg.startsWith('/타이틀추가') && (sender == Master || sender == "젤리 남")) {
          const regexAddTitle = /\/타이틀추가\s+([^]+)\s*,\s+([^]+)/;
          const matchAddTitle = msg.match(regexAddTitle);
          if (matchAddTitle) {
            const targetUserT = matchAddTitle[1];
            const newTitle = matchAddTitle[2];
            if (data.member[targetUserT]) {
              const targetMember = data.member[targetUserT];
              if (!targetMember.title.list) {
                targetMember.title.list = [];
              }
              targetMember.title.list.push(newTitle);
              replier.reply('[' + checkRank(data, targetUserT) + '] 님에게\n[' + newTitle + '] 타이틀이 부여되었습니다.');
            } else {
              replier.reply(targetUserT + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /타이틀추가 [유저명], [타이틀명]');
          }
        }
        if (msg.startsWith('/타이틀제거') && (sender == Master || sender == "젤리 남")) {
          const regexx = /\/타이틀제거\s+(.+)\s+(\d+)\s*$/;
          const matchx = msg.match(regexx);
          if (matchx) {
            const targetUsers = matchx[1];
            const titleIndex = parseInt(matchx[2], 10);
            if (data.member[targetUsers]) {
              const targetMembers = data.member[targetUsers];
              if (targetMembers.title.list && targetMembers.title.list.length >= titleIndex) {
                const removedTitles = targetMembers.title.list.splice(titleIndex - 1, 1)[0];
                targetMembers.title.num--;
                replier.reply('[' + checkRank(data, targetUsers) + '] 님의\n[' + removedTitles + '] 타이틀이 제거되었습니다.');
              } else {
                replier.reply('해당 번호의 타이틀이 존재하지 않습니다.');
              }
            } else {
              replier.reply(targetUsers + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /타이틀제거 [유저명] [타이틀번호]');
          }
        }
        if (msg.startsWith('/가방속성') && (sender == Master || sender == "젤리 남")) {
          const regexBag = /\/가방속성\s+([^]+)\s+(\d+)\s+(\d+)\s*$/;
          const matchBag = msg.match(regexBag);
          if (matchBag) {
            const targetUser1 = matchBag[1];
            const itemNumber1 = parseInt(matchBag[2]);
            const itemCount = parseInt(matchBag[3]);
            if (data.member[targetUser1]) {
              const targetMember1 = data.member[targetUser1];
              let bagItems = targetMember1.bag;
              let itemList = generateBagOutput(bagItems).sortedItemList;
              if (itemNumber1 > 0 && itemNumber1 <= itemList.length) {
                let targetItem = itemList[itemNumber1 - 1];
                if (itemCount <= 0) {
                  delete bagItems[targetItem];
                  replier.reply('[' + checkRank(data, targetUser1) + '] 님의 가방에서 ' + targetItem + '이(가) 삭제되었습니다.');
                } else {
                  bagItems[targetItem] = Math.max(0, itemCount);
                  replier.reply('[' + checkRank(data, targetUser1) + '] 님의 가방에서 ' + targetItem + '의 수량이 ' + itemCount + '개로 변경되었습니다.');
                }
              } else {
                replier.reply('유효한 아이템 번호를 입력해주세요.');
              }
            } else {
              replier.reply(targetUser1 + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /가방속성 [유저명] [아이템번호] [갯수]');
          }
        }
        if (msg.startsWith('/가방추가') && (sender == Master || sender == "오픈채팅봇" || sender == "젤리 남")) {
          const regexAddItem = /\/가방추가\s+([^,]+),\s+([^,]+)\s+(\d+)\s*$/;
          const matchAddItem = msg.match(regexAddItem);
          if (matchAddItem) {
            const targetUserAddItem = matchAddItem[1];
            const itemNameToAdd = matchAddItem[2];
            const itemCountToAdd = parseInt(matchAddItem[3]);
            if (data.member[targetUserAddItem]) {
              const targetMemberAddItem = data.member[targetUserAddItem];
              targetMemberAddItem.bag[itemNameToAdd] = (targetMemberAddItem.bag[itemNameToAdd] || 0) + itemCountToAdd;
              replier.reply(checkRank(data, targetUserAddItem) + '님의 가방에 ' + itemNameToAdd + '을(를) ' + itemCountToAdd + '개 추가했습니다.');
            } else {
              replier.reply(checkRank(data, targetUserAddItem) + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /가방추가 [유저명], [아이템명] [갯수]');
          }
        }
        if ((msg.startsWith('/속성증가') || msg.startsWith('/속성감소')) && (sender == Master || sender == "젤리 남")) {
          const regexAttribute = /\/속성(?:증가|감소)\s+([^]+)\s+(lv|point)\s+(\d+)\s*$/;
          const matchAttribute = msg.match(regexAttribute);
          if (matchAttribute) {
            const targetUserAttr = matchAttribute[1];
            const attributeType = matchAttribute[2];
            const attributeChange = parseInt(matchAttribute[3]);
            if (data.member[targetUserAttr]) {
              const user2 = data.member[targetUserAttr];
              if (attributeType === 'lv') {
                user2.lv += (msg.startsWith('/속성증가')) ? attributeChange : -attributeChange;
              } else if (attributeType === 'point') {
                user2.point += (msg.startsWith('/속성증가')) ? attributeChange : -attributeChange;
              }
              replier.reply('[' + checkRank(data, targetUserAttr) + '] 님의 ' + attributeType + '가 ' + attributeChange + '만큼 ' + ((msg.startsWith('/속성증가')) ? '증가' : '감소') + '했습니다.');
            } else {
              replier.reply(targetUserAttr + '는(은) 존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /속성증가|감소 [유저명] (lv|point) [숫자]');
          }
        }
        if (msg.startsWith('/삭제') && (sender == Master || sender == "젤리 남")) {
          const targetUserToDelete = msg.replace('/삭제', '').trim();
          if (data.member[targetUserToDelete]) {
            delete data.member[targetUserToDelete];
            replier.reply(targetUserToDelete + '의 기록이 삭제되었습니다.');
          } else {
            replier.reply(targetUserToDelete + '의 기록이 존재하지 않습니다.');
          }
        }
        if (msg.startsWith('/관리자추가') && sender == Master) {
          const regexad = /^\/관리자추가\s+([^]+)/;
          const matchad = msg.match(regexad);
          if (matchad) {
            const targetUserz = matchad[1];
            if (data.member[targetUserz]) {
              const targetMemberz = data.member[targetUserz];
              var img = "";            //현재 프로필 이미지 가져오는거 오류인듯
              if (data.admin.hasOwnProperty(targetUserz)) {
                data.admin[targetUserz] = img;
                replier.reply(targetUserz + '님의 프로필 이미지가 업데이트되었습니다.');
                Admins = Object.keys(data.admin);
              } else {
                data.admin[targetUserz] = img;
                replier.reply('[' + targetUserz + '] 님이 어드민으로 추가되었습니다.');
                Admins = Object.keys(data.admin);
              }
            } else {
              replier.reply(targetUserz + '는(은) 존재하지 않는 사용자입니다.');
            }
          }
        }
        if (msg.startsWith('/관리자삭제') && sender == Master) {
          const regexadx = /^\/관리자삭제\s+([^]+)/;
          const matchadx = msg.match(regexadx);
          if (matchadx) {
            const targetUserzx = matchadx[1];
            if (data.member[targetUserzx]) {
              const targetMemberzx = data.member[targetUserzx];
              if (data.admin.hasOwnProperty(targetUserzx)) {
                delete data.admin[targetUserzx];
                replier.reply('[' + targetUserzx + '] 님이 관리자에서 삭제되었습니다.');
                Admins = Object.keys(data.admin);
              } else {
                replier.reply('[' + targetUserzx + '] 님은 관리자가 아닙니다.');
                Admins = Object.keys(data.admin);
              }
            } else {
              replier.reply(targetUserzx + '는(은) 존재하지 않는 사용자입니다.');
            }
          }
        }
        if (msg.startsWith('/관리자명단') && sender == Master) {
          const adminList = Object.keys(data.admin);
          if (adminList.length > 0) {
            var adminListString = adminList.join(', ');
            replier.reply('현재 관리자 리스트: ' + adminListString);
          } else {
            replier.reply('현재 관리자가 없습니다.');
          }
        }
        if (msg.startsWith('/관리자일당')) {
          // 권한을 가진 사용자 목록에 '오픈채팅봇' 추가
          const authorizedUsers = ['호이 남', '오픈채팅봇'];
          if (authorizedUsers.includes(sender)) {
            // 포인트를 받을 사용자 목록
            const allowedUsers = ['호이 남', '진주 여', '꼬북 남', '튜브 여', '거품 남', '우니 남', '삼삼 남', '베라 여', '레온 남', '삼오 남', '콘트 남', '빔빔 여', '콩두 여'];
            allowedUsers.forEach((username) => {
              if (data.member[username]) {
                // 사용자가 존재하는지 확인
                data.member[username].point += 2000000;    // 해당 사용자에게 2,000,000 포인트 추가
              }
            });
            replier.reply('호이 남: 일당 받아가라 노예들아\n🅟2,000,000 포인트를 던졌습니다.');
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }
        if (msg.startsWith('/신입정착금 ')) {
          const authorizedUsers3 = ['호이 남', '오픈채팅봇', '진주 여', '꼬북 남', '튜브 여', '초코 여', '삼삼 남', '우니 남', '베라 여', '거품 남', '레온 남', '벨라/95/여', '삼오 남', '콘트 남', '빔빔 여', '콩두 여']; // 권한을 가진 사용자 목록
          if (authorizedUsers3.includes(sender)) {
            // 정규 표현식: 이름과 성별을 포함하고, 공백 다음에 이름을 분리. 추가 공백 허용.
            const pattern = /^\/신입정착금\s+(.+)\s*$/;
            const match3 = msg.match(pattern);
            if (match3) {
              const targetUsername = match3[1].trim(); // 사용자 이름의 앞뒤 공백 제거
              if (data.member[targetUsername]) {
                // 대상 사용자 확인
                data.member[targetUsername].point += 5000000; // 포인트 추가
                const itemsToAdd2 = [{
                  name: '슬롯코인🪙',
                  count: 20
                }, {
                  name: '펫 강화석⭐',
                  count: 3
                }, {
                  name: '혼자레이드리셋권😝',
                  count: 1
                }, {
                  name: '신입지원금',
                  count: 100
                }];
                itemsToAdd2.forEach(item => {
                  if (data.member[targetUsername].bag[item.name]) {
                    data.member[targetUsername].bag[item.name] += item.count;
                  } else {
                    data.member[targetUsername].bag[item.name] = item.count;
                  }
                });
                const rewardMessage = targetUsername + ' 님에게 신입정착금으로\n\n🅟5,000,000\n슬롯코인🪙20개\n혼자레이드리셋권😝 1개\n신입지원금 100개\n펫 강화석⭐ 3개 지급완료\n🎆어서와 뉴비 여긴 처음이지?🎆\n하악!! 뉴비다';

                // rewardMessage 전송
                const allRooms = [room1, room2, room3, room5];
                allRooms.forEach(room => {
                  Api.replyRoom(room, rewardMessage);
                });

                // 성공적인 지급 후, 코멘트 전송
                replier.reply(targetUsername + ' 님에게 신입정착금이 성공적으로 지급되었습니다!');
              } else {
                replier.reply('지정된 사용자를 찾을 수 없습니다.');
              }
            } else {
              replier.reply('올바른 명령어 형식을 사용해주세요. 예: /신입정착금 이름');
            }
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }


        if (!data.allowedUsers2) {
          data.allowedUsers2 = ['호이 남'];
        }
        if (!data.allowedUsers4) {
          data.allowedUsers4 = ['호이 남'];
        }
        if (!data.allowedUsers6) {
          data.allowedUsers6 = ['호이 남'];
        }
        if (!data.allowedUsersHoipass) {
          data.allowedUsersHoipass = ['호이 남'];
        }
        if (!board.memo) {
          board.memo = [];
          saveJsonFile(board, boardPath);
        }
        if (msg.startsWith('/후원펫혼패키지')) {
          const authorizedUsers2 = ['호이 남', '오픈채팅봇']; // 권한을 가진 사용자 목록
          if (authorizedUsers2.includes(sender)) {
            const itemsToAdd = [{
              name: '하트💝',
              count: 5
            }, {
              name: '펫 장비드랍방지권🛡',
              count: 2
            }, {
              name: '혼자레이드리셋권😝',
              count: 2
            }, {
              name: '슬롯상자🧳',
              count: 1
            }];
            // 추가할 아이템 목록
            let responseMessage = '팻혼레리 패키지가 후원 지급 완료되었습니다.';
            data.allowedUsers2.forEach((username) => {
              if (data.member[username]) {
                // 사용자가 존재하는지 확인
                itemsToAdd.forEach(item => {
                  if (data.member[username].bag[item.name]) {
                    data.member[username].bag[item.name] += item.count;
                  } else {
                    data.member[username].bag[item.name] = item.count;
                  }
                });
              }
            });
            replier.reply(responseMessage);
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }
        if (msg.startsWith('/후원슬롯패키지')) {
          const authorizedUsers4 = ['호이 남', '오픈채팅봇']; // 권한을 가진 사용자 목록
          if (authorizedUsers4.includes(sender)) {
            const itemsToAdd4 = [{
              name: '하트💝',
              count: 1
            }, {
              name: '슬롯코인🪙',
              count: 3
            }, {
              name: '슬롯상자🧳',
              count: 1
            }, {
              name: '슬롯 지원금',
              count: 5
            }];
            let responseMessage = '슬롯 패키지가 후원 지급 완료되었습니다.';
            data.allowedUsers4.forEach((username) => {
              if (data.member[username]) {
                // 사용자가 존재하는지 확인
                itemsToAdd4.forEach(item => {
                  if (data.member[username].bag[item.name]) {
                    data.member[username].bag[item.name] += item.count;
                  } else {
                    data.member[username].bag[item.name] = item.count;
                  }
                });
              }
            });
            replier.reply(responseMessage);
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }
        if (msg.startsWith('/펫강화패키지')) {
          const authorizedUsers6 = ['호이 남', '오픈채팅봇']; // 권한을 가진 사용자 목록
          if (authorizedUsers6.includes(sender)) {
            const itemsToAdd6 = [{
              name: '하트💝',
              count: 2
            }, {
              name: '펫강화 지원금',
              count: 10
            }, {
              name: '펫강화상자⭐',
              count: 1
            }];
            let responseMessage = '펫 강화 패키지가 후원 지급 완료되었습니다.';
            data.allowedUsers6.forEach((username) => {
              if (data.member[username]) {
                // 사용자가 존재하는지 확인
                itemsToAdd6.forEach(item => {
                  if (data.member[username].bag[item.name]) {
                    data.member[username].bag[item.name] += item.count;
                  } else {
                    data.member[username].bag[item.name] = item.count;
                  }
                });
              }
            });
            replier.reply(responseMessage);
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }
        if (msg.startsWith('/호이패스구독')) {
          const authorizedUsersHoipass = ['호이 남', '오픈채팅봇']; // 권한을 가진 사용자 목록
          if (authorizedUsersHoipass.includes(sender)) {
            const itemsToAddHoipass = [{
              name: '자동배팅권(🅟50만)😣🤖🐔',
              count: 1
            }, {
              name: '펫 장비드랍방지권🛡',
              count: 2
            }, {
              name: '혼자레이드리셋권😝',
              count: 2
            }, {
              name: '슬롯상자🧳',
              count: 2
            }, {
              name: '펫 강화석⭐',
              count: 5
            }, {
              name: '잡템☠️',
              count: 5
            }, {
              name: '후원 지원금👌',
              count: 20
            }, {
              name: '캐슬대전리셋권🐶',
              count: 1
            }, {
              name: '하트💝',
              count: 10
            }];
            let responseMessage = '호이 패스 패키지가 후원 지급 완료되었습니다.';
            data.allowedUsersHoipass.forEach((username) => {
              if (data.member[username]) {
                // 사용자가 존재하는지 확인
                itemsToAddHoipass.forEach(item => {
                  if (data.member[username].bag[item.name]) {
                    data.member[username].bag[item.name] += item.count;
                  } else {
                    data.member[username].bag[item.name] = item.count;
                  }
                });
              }
            });
            replier.reply(responseMessage);
          } else {
            replier.reply('이 기능은 관리자만 사용할 수 있습니다.');
          }
        }

        // 메모 추가 기능
        if (msg.startsWith("/후원메모 ")) {
          var memoContent = msg.substring(5).trim(); // "/메모 " 다음의 내용을 정확히 추출
          if (!data.member[sender]) {
            data.member[sender] = { memo: [] }; // 사용자 데이터 초기화
          } else if (!data.member[sender].memo) {
            data.member[sender].memo = []; // 메모 데이터 초기화
          }
          data.member[sender].memo.push(memoContent);
          replier.reply("메모가 저장되었습니다.");
        }

        // 메모 확인 기능
        if (msg === "/후원확인") {
          if (data.member[sender] && data.member[sender].memo && data.member[sender].memo.length > 0) {
            var memos = "저장된 메모:\n\n";
            data.member[sender].memo.forEach(function (content, index) {
              memos += (index + 1) + ': ' + content + '\n';
            });
            replier.reply(memos);
          } else {
            replier.reply("저장된 메모가 없습니다.");
          }
        }

        // 메모 삭제 기능
        if (msg === "/후원삭제") {
          if (data.member[sender] && data.member[sender].memo && data.member[sender].memo.length > 0) {
            data.member[sender].memo = []; // 모든 메모 데이터 삭제
            replier.reply("모든 메모가 삭제되었습니다.");
          } else {
            replier.reply("삭제할 메모가 없습니다.");
          }
        }
        if (msg === '/혼레릿고오픈') {
          if (data.member[sender].bag["혼레릿고상자😝(/혼레릿고오픈)"] !== undefined && data.member[sender].bag["혼레릿고상자😝(/혼레릿고오픈)"] > 0) {
            // 혼레릿고 상자😝 개수 감소
            if (data.member[sender].bag["혼레릿고상자😝(/혼레릿고오픈)"] > 1) {
              data.member[sender].bag["혼레릿고상자😝(/혼레릿고오픈)"]--;
            } else {
              delete data.member[sender].bag["혼레릿고상자😝(/혼레릿고오픈)"];
            }

            // 혼자레이드리셋권😝 개수 랜덤 생성 (20 ~ 40)
            var soloRaidResetQty = Math.floor(Math.random() * 21) + 20;


            if (data.member[sender].bag['혼자레이드리셋권😝'] === undefined) {
              data.member[sender].bag['혼자레이드리셋권😝'] = soloRaidResetQty;
            } else {
              data.member[sender].bag['혼자레이드리셋권😝'] += soloRaidResetQty;
            }

            let openMsg = "혼레릿고상자😝를 오픈합니다!\n\n" +
              "혼자레이드리셋권😝 " + soloRaidResetQty + "개";


            replier.reply(openMsg);
          } else {
            replier.reply("혼레릿고상자😝가 없습니다. 후원해 주세요.");
          }
        }

        if (msg.startsWith('/혼레릿고,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["혼레릿고상자😝(/혼레릿고오픈)"] === undefined) {
              data.member[userId].bag["혼레릿고상자😝(/혼레릿고오픈)"] = 1;
            } else {
              data.member[userId].bag["혼레릿고상자😝(/혼레릿고오픈)"]++;
            }
            replier.reply(userId + "님에게 혼레릿고상자😝(/혼레릿고오픈)를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }

        if (msg === '/시즌오픈') {
          if (data.member[sender].bag["정규시즌ONE패키지🎁"] !== undefined && data.member[sender].bag["정규시즌ONE패키지🎁"] > 0) {
            // 정규시즌ONE패키지🎁 개수 감소
            if (data.member[sender].bag["정규시즌ONE패키지🎁"] > 1) {
              data.member[sender].bag["정규시즌ONE패키지🎁"]--;
            } else {
              delete data.member[sender].bag["정규시즌ONE패키지🎁"];
            }

            // 아이템 수량 설정
            var 시즌Items = {
              '슬롯코인🪙': 100,
              '캐슬상자🏰': 30,
              '캐슬뽑기권♟': 20,
              '캐슬대전리셋권🐶': 50
            };

            // 아이템을 유저 가방에 추가
            for (var item in 시즌Items) {
              if (data.member[sender].bag[item] === undefined) {
                data.member[sender].bag[item] = 시즌Items[item];
              } else {
                data.member[sender].bag[item] += 시즌Items[item];
              }
            }

            // 오픈 결과 메시지 생성
            let openMsg = "정규시즌ONE패키지🎁를 오픈합니다!\n\n" +
              "슬롯코인🪙 100개\n" +
              "캐슬상자🏰 30개\n" +
              "캐슬뽑기권♟ 20개\n" +
              "캐슬대전리셋권🐶 50개";

            replier.reply(openMsg);
          } else {
            replier.reply("정규시즌ONE패키지🎁가 없습니다.");
          }
        }

        if (msg.startsWith('/시즌,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["정규시즌ONE패키지🎁"] === undefined) {
              data.member[userId].bag["정규시즌ONE패키지🎁"] = 1;
            } else {
              data.member[userId].bag["정규시즌ONE패키지🎁"]++;
            }
            replier.reply(userId + "님에게 정규시즌ONE패키지🎁를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }

        if (msg === '/진짜좋아해') {
          if (data.member[sender].bag['캐슬리리유닛👥(+125💕)'] && data.member[sender].bag['캐슬댕청유닛👥(+125💕)']) {
            if (data.member[sender].bag['캐슬리리유닛👥(+125💕)'] >= 1 && data.member[sender].bag['캐슬댕청유닛👥(+125💕)'] >= 1) {
              if (data.member[sender].point && data.member[sender].point >= 48600000) {
                // 아이템과 포인트 차감
                data.member[sender].bag['캐슬리리유닛👥(+125💕)'] -= 1;
                data.member[sender].bag['캐슬댕청유닛👥(+125💕)'] -= 1;
                data.member[sender].point -= 48600000;

                // 새 아이템 추가
                if (!data.member[sender].bag['캐슬진짜유닛👫(+801💕)']) {
                  data.member[sender].bag['캐슬진짜유닛👫(+801💕)'] = 1;
                } else {
                  data.member[sender].bag['캐슬진짜유닛👫(+801💕)'] += 1;
                }

                // 메시지 전송
                let msg = "[" + checkRank(data, sender) + "] 님\n캐슬진짜유닛👫(+801💕)\n조합이 완료되었습니다.";
                replier.reply(msg);

                // 아이템 개수가 0이 되면 삭제
                if (data.member[sender].bag['캐슬리리유닛👥(+125💕)'] === 0) {
                  delete data.member[sender].bag['캐슬리리유닛👥(+125💕)'];
                }
                if (data.member[sender].bag['캐슬댕청유닛👥(+125💕)'] === 0) {
                  delete data.member[sender].bag['캐슬댕청유닛👥(+125💕)'];
                }
              } else {
                replier.reply("포인트가 부족합니다! 🅟48,600,000 포인트가 필요해요.");
              }
            } else {
              replier.reply("캐슬리리유닛👥💜와 캐슬댕청유닛👥(+125💕)이 각각 1개씩 필요해요!");
            }
          } else {
            replier.reply("캐슬리리유닛👥와 캐슬댕청유닛👥(+125💕)이 각각 1개씩 필요해요!");
          }
        }
        if (msg === '/니보기가역거워가실때에는말없이후려보리우리다오톡에약빤빌런꽃아름따다내보내는길에멀리안나가보리오리다') {
          if (data.member[sender].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"] !== undefined && data.member[sender].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"] > 0) {
            // 너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶 개수 감소
            if (data.member[sender].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"] > 1) {
              data.member[sender].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"]--;
            } else {
              delete data.member[sender].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"];
            }

            // 아이템 수량 설정
            var items2 = {
              '혼자레이드리셋권😝': 3,
              '티어 승급티켓🎟': 1,
              '고급 티어 승급티켓🎫': 2,
              '펫 장비드랍방지권🛡': 11,
              '캐슬공격권⚔': 18,
              '지원금': 100,
              '캐슬절대방어권🛡(50%)': 1,
              '캐슬기습공격권🔥(40%)': 1,
              '캐슬뽑기권♟': 18,
              '잡템상자☠': 1,
              '치킨상자🐔': 1,
              '랜덤박스💝': 1,
              '금괴상자💰': 1,
              '도깨비가면👹': 1,
              '에프킬라💦': 1,
              '하리보🪼': 1,
              '트롤심장💓': 1
            };

            // 아이템을 유저 가방에 추가
            for (var item in items2) {
              if (data.member[sender].bag[item] === undefined) {
                data.member[sender].bag[item] = items2[item];
              } else {
                data.member[sender].bag[item] += items2[item];
              }
            }

            // 오픈 결과 메시지 생성
            let openMsg = "ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ\nㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ\nㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ\nㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ\n\n" +
              "혼자레이드리셋권😝 3개\n" +
              "티어 승급티켓🎟 1개\n" +
              "고급 티어 승급티켓🎫 2개\n" +
              "펫 장비드랍방지권🛡 11개\n" +
              "캐슬공격권⚔ 18개\n" +
              "지원금 100개\n" +
              "캐슬절대방어권🛡(50%) 1개\n" +
              "캐슬기습공격권🔥(40%) 1개\n" +
              "캐슬뽑기권♟ 18개\n" +
              "잡템상자☠ 1개\n" +
              "치킨상자🐔 1개\n" +
              "랜덤박스💝 1개\n" +
              "금괴상자💰 1개\n" +
              "도깨비가면👹 1개\n" +
              "에프킬라💦 1개\n" +
              "하리보🪼 1개\n" +
              "트롤심장💓 1개";

            replier.reply(openMsg);
          } else {
            replier.reply("너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶가 없습니다.");
          }
        }

        if (msg.startsWith('/니가,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"] === undefined) {
              data.member[userId].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"] = 1;
            } else {
              data.member[userId].bag["너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶"]++;
            }
            replier.reply(userId + "님에게 너희들이뭘좋아할지몰라서눈감고발가락으로집었어🦶를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }

        if (msg.startsWith('/복주머니')) {
          var args = msg.split(' ');

          // 몇 개 사용할지 결정 (기본은 1개, 최대는 10개)
          var count = 1;
          if (args.length > 1) {
            count = Math.min(parseInt(args[1]), 10000); // 최대 100개까지
          }

          // 사용자의 가방에 복주머니🧧가 있는지 확인
          if (data.member[sender].bag['복주머니🧧'] && data.member[sender].bag['복주머니🧧'] >= count) {
            let itemCounts = {}; // 각 아이템의 개수를 저장할 객체
            let rank = checkRank(data, sender) || "Unknown Rank";  // checkRank 함수가 undefined를 반환하지 않도록 처리

            for (var i = 0; i < count; i++) {
              var chance = Math.random();  // 0부터 1 사이의 랜덤한 값 생성
              var item = '';  // 아이템 이름을 저장할 변수

              if (chance < 0.000023) {  // 0.0023% 확률
                item = '집행검👑';
              } else if (chance < 0.000123) {  // 0.01% 확률
                item = '불멸🪬';
              } else if (chance < 0.030123) {  // 3% 확률
                item = '캐슬상자🏰';
              } else if (chance < 0.080123) {  // 5% 확률
                item = '펫 강화석⭐';
              } else if (chance < 0.160123) {  // 8% 확률
                item = '펫 장비드랍방지권🛡';
              } else if (chance < 0.275123) {  // 11.5% 확률
                item = '잡템상자☠';
              } else {  // 70% 확률
                item = '용돈💸';
                if (itemCounts[item]) {
                  itemCounts[item] += 3;  // 세뱃돈은 3개씩 추가
                } else {
                  itemCounts[item] = 3;  // 가방에 세뱃돈이 없으면 3개 추가
                }
                continue;
              }

              // 아이템이 이미 존재하면 수량을 추가, 없으면 새로 추가
              if (itemCounts[item]) {
                itemCounts[item] += 1;
              } else {
                itemCounts[item] = 1;
              }
            }
            // 복주머니🧧 개수 차감
            data.member[sender].bag['복주머니🧧'] -= count;
            if (data.member[sender].bag['복주머니🧧'] === 0) {
              delete data.member[sender].bag['복주머니🧧'];
            }
            // 아이템을 가방에 추가
            for (let item in itemCounts) {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += itemCounts[item];
              } else {
                data.member[sender].bag[item] = itemCounts[item];
              }
            }

            // 결과 메시지 생성
            let responseMessage = '[' + rank + ']의 복주머니🧧(' + count + '회)\n\n오픈결과:\n\n';
            for (let item in itemCounts) {
              responseMessage += item + " " + itemCounts[item] + "개\n";
            }
            responseMessage += "\n축하해요 복받으세용 데헷! 🎉";
            replier.reply(responseMessage);
          } else {
            // 복주머니🧧가 없거나 부족할 때 메시지 출력
            replier.reply("[" + checkRank(data, sender) + "]님 복주머니🧧가 부족합니다.");
          }
        }
        if (msg.startsWith('/복,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag['복주머니🧧'] === undefined) {
              data.member[userId].bag['복주머니🧧'] = 100;
            } else {
              data.member[userId].bag['복주머니🧧'] += 100;
            }
            replier.reply(userId + "님에게 복주머니🧧 100개를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }
        // /레이드, 아이디 명령어로 레이드패키지 지급
        if (msg.startsWith('/레이드,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag['레이드패키지👾'] === undefined) {
              data.member[userId].bag['레이드패키지👾'] = 1;
            } else {
              data.member[userId].bag['레이드패키지👾']++;
            }
            replier.reply(userId + "님에게 레이드패키지👾 1개를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }

        // /레이드오픈 명령어로 레이드패키지 오픈
        if (msg === '/레이드오픈') {
          if (data.member[sender].bag['레이드패키지👾'] !== undefined && data.member[sender].bag['레이드패키지👾'] > 0) {
            // 레이드패키지👾 개수 감소
            if (data.member[sender].bag['레이드패키지👾'] > 1) {
              data.member[sender].bag['레이드패키지👾']--;
            } else {
              delete data.member[sender].bag['레이드패키지👾'];
            }

            // 레이드패키지 아이템 목록
            var raidPackageItems = {
              '항생제💊': 1,
              '마늘🧄': 1,
              '거울🪞': 1,
              '에프킬라💦': 1,
              '도깨비가면👹': 1,
              '곰팡이🍄': 1,
              '트롤심장💓': 1,
              '하리보🪼': 1,
              '레이드공격대인장🥇(+500👾)': 1,
              '캐슬세균맨유닛👾(+350💕)': 1,
              '혼자레이드리셋권😝': 30
            };

            // 아이템 지급
            for (var item in raidPackageItems) {
              if (data.member[sender].bag[item]) {
                data.member[sender].bag[item] += raidPackageItems[item];
              } else {
                data.member[sender].bag[item] = raidPackageItems[item];
              }
            }

            // 결과 메시지 생성
            let responseMessage = '[' + checkRank(data, sender) + ']님이 레이드패키지👾를 오픈했습니다!\n\n';
            for (let item in raidPackageItems) {
              responseMessage += item + " " + raidPackageItems[item] + "개\n";
            }

            responseMessage += "\n축하합니다! 레이드패키지를 성공적으로 오픈하셨습니다. 🎉";
            replier.reply(responseMessage);
          } else {
            replier.reply("레이드패키지👾가 없습니다. 후원해 주세요.");
          }
        }
        if (msg === '/추석오픈') {
          if (data.member[sender].bag["추석패키지🧧(/추석오픈)"] !== undefined && data.member[sender].bag["추석패키지🧧(/추석오픈)"] > 0) {
            // 추석패키지🧧 개수 감소
            if (data.member[sender].bag["추석패키지🧧(/추석오픈)"] > 1) {
              data.member[sender].bag["추석패키지🧧(/추석오픈)"]--;
            } else {
              delete data.member[sender].bag["추석패키지🧧(/추석오픈)"];
            }

            // 아이템 수량 설정
            var 추석Items = {
              '복주머니🧧': 100,
              '펫 강화석⭐': 20,
              '잡템상자☠': 10,
              '랜덤박스💝': 10,
              '캐슬대전리셋권🐶': 20,
              '캐슬절대방어권🛡(50%)': 10,
              '캐슬기습공격권🔥(40%)': 5,
              '캐슬송편유닛🍡(+200💕)': 1,
              '캐슬만둣국유닛🥟(+200💕)': 1
            };

            // 아이템을 유저 가방에 추가
            for (var item in 추석Items) {
              if (data.member[sender].bag[item] === undefined) {
                data.member[sender].bag[item] = 추석Items[item];
              } else {
                data.member[sender].bag[item] += 추석Items[item];
              }
            }

            // 오픈 결과 메시지 생성
            let openMsg = "추석패키지🧧를 오픈합니다!\n\n" +
              "복주머니🧧 100개\n" +
              "펫 강화석⭐ 20개\n" +
              "잡템상자☠ 10개\n" +
              "랜덤박스💝 10개\n" +
              "캐슬대전리셋권🐶 20개\n" +
              "캐슬절대방어권🛡(50%) 10개\n" +
              "캐슬기습공격권🔥(40%) 5개\n" +
              "캐슬송편유닛🍡(+200💕) 1개\n" +
              "캐슬만두유닛🥟(+200💕) 1개";

            replier.reply(openMsg);
          } else {
            replier.reply("추석패키지(/추석오픈)🧧가 없습니다.");
          }
        }

        if (msg.startsWith('/추석,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["추석패키지🧧(/추석오픈)"] === undefined) {
              data.member[userId].bag["추석패키지🧧(/추석오픈)"] = 1;
            } else {
              data.member[userId].bag["추석패키지🧧(/추석오픈)"]++;
            }
            replier.reply(userId + "님에게 추석패키지(/추석오픈)🧧를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }
        if (msg === '/친구들복받아') {
          if (data.member[sender].bag["한가위패키지🙇‍♂🙇‍♀"] !== undefined && data.member[sender].bag["한가위패키지🙇‍♂🙇‍♀"] > 0) {
            // 한가위패키지🙇‍♂🙇‍♀ 개수 감소
            if (data.member[sender].bag["한가위패키지🙇‍♂🙇‍♀"] > 1) {
              data.member[sender].bag["한가위패키지🙇‍♂🙇‍♀"]--;
            } else {
              delete data.member[sender].bag["한가위패키지🙇‍♂🙇‍♀"];
            }

            // 아이템 수량 설정
            var 한가위Items = {
              '추석뽀찌💴': 100,
              '펫 강화석⭐': 3,
              '혼자레이드리셋권😝': 10,
              '불멸 강화석🪬': 5,
              '금괴상자💰': 20
            };

            // 아이템을 유저 가방에 추가
            for (var item in 한가위Items) {
              if (data.member[sender].bag[item] === undefined) {
                data.member[sender].bag[item] = 한가위Items[item];
              } else {
                data.member[sender].bag[item] += 한가위Items[item];
              }
            }

            // 오픈 결과 메시지 생성
            let openMsg = "한가위패키지🙇‍♂🙇‍♀를 오픈합니다!\n\n" +
              "추석뽀찌💴 100개\n" +
              "펫 강화석⭐ 3개\n" +
              "혼자레이드리셋권😝 10개\n" +
              "불멸 강화석🪬 5개\n" +
              "금괴상자💰 20개";

            replier.reply(openMsg);
          } else {
            replier.reply("한가위패키지🙇‍♂🙇‍♀가 없습니다.");
          }
        }

        if (msg.startsWith('/한가위,')) {
          var userId = msg.split(',')[1].trim();
          if (data.member[userId] !== undefined) {
            if (data.member[userId].bag["한가위패키지🙇‍♂🙇‍♀"] === undefined) {
              data.member[userId].bag["한가위패키지🙇‍♂🙇‍♀"] = 1;
            } else {
              data.member[userId].bag["한가위패키지🙇‍♂🙇‍♀"]++;
            }
            replier.reply(userId + "님에게 한가위패키지🙇‍♂🙇‍♀를 지급했습니다.");
          } else {
            replier.reply("유저 아이디를 확인해 주세요.");
          }
        }



        if (sender === "호이 남" && (msg.startsWith("/슬롯패키지추가,") || msg.startsWith("/슬롯패키지삭제,"))) {
          let result = processUserIDCommand(msg, data);
          replier.reply(result);
        }
        if (sender === "호이 남" && (msg.startsWith("/장비혼레추가,") || msg.startsWith("/장비혼레삭제,"))) {
          let result = processUserIDCommand(msg, data);
          replier.reply(result);
        }
        if (sender === "호이 남" && (msg.startsWith("/펫패키지추가,") || msg.startsWith("/펫패키지삭제,"))) {
          let result = processUserIDCommand(msg, data);
          replier.reply(result);
        }
        if (sender === "호이 남" && (msg.startsWith("/호이패스추가,") || msg.startsWith("/호이패스삭제,"))) {
          let result = processUserIDCommand(msg, data);
          replier.reply(result);
        }
        if (msg === "/후원패키지명단") {
          if (data.allowedUsers2.length > 0) {
            let userList = data.allowedUsers2.join(", ");
            replier.reply("현재 후원 패키지 목록에 있는 사용자들: " + userList);
          } else {
            replier.reply("후원 패키지 목록이 비어 있습니다.");
          }
        }
        if (msg === "/슬롯패키지명단") {
          if (data.allowedUsers4.length > 0) {
            let userList = data.allowedUsers4.join(", ");
            replier.reply("현재 슬롯 패키지 목록에 있는 사용자들: " + userList);
          } else {
            replier.reply("슬롯 패키지 목록이 비어 있습니다.");
          }
        }
        if (msg === "/펫패키지명단") {
          if (data.allowedUsers6.length > 0) {
            let userList = data.allowedUsers6.join(", ");
            replier.reply("현재 펫 강화 패키지 목록에 있는 사용자들: " + userList);
          } else {
            replier.reply("펫 강화 패키지 목록이 비어 있습니다.");
          }
        }
        if (msg === "/호이패스명단") {
          if (data.allowedUsersHoipass.length > 0) {
            let userList = data.allowedUsersHoipass.join(", ");
            replier.reply("현재 호이 패스 목록에 있는 사용자들: " + userList);
          } else {
            replier.reply("호이 패스 목록이 비어 있습니다.");
          }
        }
        if (msg === '/랭크적용') {
          applyRanksBasedOnTickets(data, replier);
          replier.reply('랭크가 적용되었습니다.');
        }
        if (msg.startsWith('/잠수명단') && isAdmin(sender)) {
          const regexsleep = /\/잠수명단\s+(\d+)\s*$/;
          const matchsleep = msg.match(regexsleep);
          if (matchsleep) {
            var sleeplvl = matchsleep[1];
            var Userlists = Object.keys(data.member) || [];
            var currentDate = getCurrentDate();
            var candidateToRemove = Userlists.filter((userName) => {
              if (userName === '호이랜드') {
                return false;
              }
              var lastAttendanceDate = data.member[userName] && data.member[userName].recent || '';
              var chatcnt0Value = data.member[userName] && data.member[userName].chatcnt0;
              var lvValue = data.member[userName] && data.member[userName].lv;
              return lvValue <= sleeplvl && ((chatcnt0Value < 101 || chatcnt0Value === '') && lastAttendanceDate < currentDate - 5);
            });
            var numCandidateToRemove = candidateToRemove.length;
            replier.reply('잠수조건\n(' + data.checkcnt + ' 리셋 부터, 레벨 ' + sleeplvl + ' 이하)\n+ 채팅 100회 이하 + 미출석 5일\n 해당 사용자 수: ' + numCandidateToRemove + '명');
            var replyMsgToRemove = '잠수 명단 \n\n' + candidateToRemove.join(', ');
            replier.reply(replyMsgToRemove);
          }
        }
        if (msg.startsWith('/잠수삭제') && sender == Master) {
          const regexsleep2 = /\/잠수삭제\s+(\d+)\s*$/;
          const matchsleep2 = msg.match(regexsleep2);
          if (matchsleep2) {
            var sleeplvl2 = matchsleep2[1];
            var Userlistsx = Object.keys(data.member) || [];
            var currentDate0 = getCurrentDate();
            var candidatesToRemove = Userlistsx.filter((userName) => {
              if (userName === '호이랜드') {
                return false;
              }
              var lastAttendanceDate = data.member[userName] && data.member[userName].recent || '';
              var chatcnt0Value = data.member[userName] && data.member[userName].chatcnt0;
              var lvValue = data.member[userName] && data.member[userName].lv;
              return lvValue <= sleeplvl2 && ((chatcnt0Value < 101 || chatcnt0Value === '') && lastAttendanceDate < currentDate0 - 5);
            });
            var numCandidatesToRemove = candidatesToRemove.length;
            replier.reply('잠수조건\n(' + data.checkcnt + ' 리셋 부터, 레벨 ' + sleeplvl2 + ' 이하)\n+ 채팅 100회 이하 + 미출석 5일\n 해당 사용자 수: ' + numCandidatesToRemove + '명');
            var replyMessageToRemove = '잠수삭제 명단 \n\n' + candidatesToRemove.join(', ');
            replier.reply(replyMessageToRemove);
            candidatesToRemove.forEach((targetUserToDelete) => {
              if (data.member[targetUserToDelete]) {
                delete data.member[targetUserToDelete];
              }
            });
            replier.reply("삭제완료");
            data.checkcnt = getCurrentDate();
            for (let userc in data.member) {
              data.member[userc].chatcnt0 = 0;
            }
          }
        }
        if (msg.startsWith('/펫생성 ')) {
          var Petname = msg.substring('/펫생성 '.length);
          if (Petname.length <= 6) {
            if (!data.member[sender].pet.petname) {
              createPet(data.member[sender].pet);
              data.member[sender].pet.petname = Petname;
              replier.reply('[' + checkRank(data, sender) + '] 님의 펫이 생성되었습니다!');
            } else {
              replier.reply('[' + checkRank(data, sender) + '] 님은 이미 펫이 있습니다.');
            }
          } else {
            replier.reply('펫 이름은 6글자 이하로 설정해주세요.');
          }
        }
        if (msg === '/펫강화') {
          /* 강화 
          확률 = 55%. (1강당 0.5% 감소)
          비용 = 300만 포인트 + 펫 강화석 (도전하는 강화수치 동일)
          최대 100강.
          */
          let user = data.member[sender];
          const baseUpgradeCost = 5000000; // 포인트 고정 비용
          const maxUpgrade = 100; // 최대 강화 레벨

          // 펫이 있는지 확인
          if (user.pet) {
            // 강화 레벨 초기화
            if (!user.pet.upgrade) {
              user.pet.upgrade = 0;
            }

            let upgradeLevel = user.pet.upgrade; // 현재 강화 레벨
            let upgradeProbability = 0.55 - (upgradeLevel * 0.005); // 현재 강화 레벨에 따른 확률 계산

            // 최대 강화 레벨 체크
            if (upgradeLevel >= maxUpgrade) {
              replier.reply('펫이 최대 강화 레벨에 도달했습니다.');
              return;
            }

            // 포인트가 충분한지 체크
            if (user.point < baseUpgradeCost) {
              let shortfall = baseUpgradeCost - user.point; // 부족한 포인트 계산
              replier.reply('포인트가 부족합니다.\n현재 포인트: ' + numberWithCommas(user.point) + '\n필요한 포인트: ' + numberWithCommas(baseUpgradeCost) + '. \n포인트 ' + numberWithCommas(shortfall) + '가 더 필요합니다.');
              return;
            }

            // 강화석이 충분한지 체크
            if (!user.bag['펫 강화석⭐'] || user.bag['펫 강화석⭐'] < upgradeLevel + 1) {
              replier.reply('펫 강화석⭐이 부족합니다.\n필요한 펫 강화석⭐: ' + (upgradeLevel + 1) + '개');
              return;
            }

            // 강화 시도
            if (Math.random() < upgradeProbability) {
              // 강화 성공

              user.pet.upgrade++; // 강화 레벨 증가
              user.pet.upgradeDateTime = new Date(); // 강화 성공 시간 저장
              let critChanceAfter = getCritChance(user.pet.upgrade); // 강화 후 치명타 확률 계산
              replier.reply('펫 강화 성공⭐\n[' + checkRank(data, sender) + '] 님의 [' + user.pet.petimg + user.pet.petname + ']이(가)\n강화에 성공하였습니다.\n[강화 ' + user.pet.upgrade + '⭐] [치명타 확률 ' + critChanceAfter + '%]');

              // 10강마다 공고 메시지 출력
              if (user.pet.upgrade % 5 === 0) {
                let noticeMsg = '[알림] [' + checkRank(data, sender) + '] 님의 [' + user.pet.petimg + user.pet.petname + ']이(가)\n[' + user.pet.upgrade + '강⭐]에 성공 하였습니다.모두 축하해주세요!';
                Api.replyRoom(room1, noticeMsg);
                Api.replyRoom(room2, noticeMsg);
                Api.replyRoom(room3, noticeMsg);
                Api.replyRoom(room5, noticeMsg);
              }
            } else {
              // 강화 실패
              replier.reply('하,, 펫 강화석⭐이 소멸하였습니다...\n[' + checkRank(data, sender) + '] 님의 [' + user.pet.petimg + user.pet.petname + '] 이(가)\n강화에 실패하였습니다.');
            }

            // 포인트와 강화석 차감 (성공/실패 모두 해당)
            user.point -= baseUpgradeCost; // 포인트 차감
            user.bag['펫 강화석⭐'] -= (upgradeLevel + 1); // 강화석 차감
            // 강화석이 0개가 되면 삭제
            if (user.bag['펫 강화석⭐'] <= 0) {
              delete user.bag['펫 강화석⭐'];
            }
          } else {
            replier.reply('펫이 없습니다.');
          }
        }
        if (msg.startsWith('/매력') && (sender == "호이 남" || sender == "젤리 남")) {
          const regexpet = /\/매력\s+([^]+)\s+(\d+)/;
          const matchpet = msg.match(regexpet);
          if (matchpet) {
            const targetUserpet = matchpet[1];
            const PetExpUp = parseInt(matchpet[2]);
            if (data.member[targetUserpet]) {
              data.member[targetUserpet].pet.petexp = PetExpUp;
              replier.reply('수정완료!');
              if (data.member[targetUserpet].pet.petexp === requiredpoint) {
                updateEmoji(data.member[targetUserpet].pet, replier);
              }
            } else {
              replier.reply('펫이 없습니다..');
            }
          } else {
            replier.reply('/매력 [유저명] [숫자]로 입력해주세요.');
          }
        }
        if (msg.startsWith('/펫제거 ') && (sender == "젤리 남" || sender == "호이 남")) {
          const regexd = /\/펫제거\s+([^]+)/;
          const matchd = msg.match(regexd);
          if (matchd) {
            const targetUserd = matchd[1];
            if (data.member[targetUserd].pet.petname) {
              delete data.member[targetUserd].pet;
              initializePet(targetUserd, data);
              replier.reply('[' + checkRank(data, targetUserd) + '] 님의 펫 정보가 제거되었습니다.');
            } else {
              replier.reply(targetUserd + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }
        if (msg === '/좋아요순위') {
          let likeRanking = generatelikeRanking(data.member);
          let resultMsg = '💓 좋아요 순위 💓\n\n';
          resultMsg += likeRanking.rankingMsg1 + allsee + likeRanking.rankingMsg2;
          replier.reply(resultMsg);
          let topUser = getTopUser(data.member);
          data.star = topUser.username;
        } if (msg === '/채팅순위') {
          let chatRanking = generatechatRanking(data.member);
          let resultMsg = '🏆 채팅 순위 🏆\n[' + formatDate2(data.checkcnt) + ' 이후 채팅 이력 기준]\n';
          resultMsg += chatRanking.rankingMsg1 + allsee + chatRanking.rankingMsg2;
          replier.reply(resultMsg);
          let topchatUser = getTopchatUser(data.member);
          data.mc = topchatUser.username;
        } if (msg === '/레벨순위') {
          let UsrRanking = generateRanking(data.member);
          let resultMsg = '🏆 레벨 순위 🏆\n\n';
          resultMsg += UsrRanking.rankingMsg1 + allsee + UsrRanking.rankingMsg2;
          replier.reply(resultMsg);
          let toplvUser = getToplvUser(data.member);
          data.toplv = toplvUser.username;
        } if (msg === '/게임순위') {
          let UsrRanking = generategameRanking(data.member);
          let resultMsg = '🎮 미니게임 순위 🎮\n(넌센스,타자게임,퀴즈 우승 합산 기준)\n';
          resultMsg += UsrRanking.rankingMsg1 + allsee + UsrRanking.rankingMsg2;
          replier.reply(resultMsg);
          let topgameUser = getTopgameUser(data.member);
          data.topgame = topgameUser.username;
        }
        if (msg.startsWith('/이름') && (sender == "호이 남" || sender == "젤리 남")) {
          const regexpetn = /\/이름\s+([^]+)\s*,\s+([^]+)/;
          const matchpetn = msg.match(regexpetn);
          if (matchpetn) {
            const targetUserpetn = matchpetn[1];
            const Petnewname = matchpetn[2];
            if (data.member[targetUserpetn]) {
              data.member[targetUserpetn].pet.petname = Petnewname;
              replier.reply('수정완료!');
            } else {
              replier.reply('펫이 없습니다..');
            }
          } else {
            replier.reply('/이름 [유저명], [펫이름]로 입력해주세요.');
          }
        }
        if (msg.startsWith('/장비집행관') && sender == "호이 남") {
          const regexg = /\/장비집행관\s+([^]+)/;
          const matchg = msg.match(regexg);
          if (matchg) {
            const targetUserg = matchg[1];
            if (data.member[targetUserg].pet.petname) {
              data.member[targetUserg].pet.petgear.gearRank = '집행관';
              data.member[targetUserg].pet.petgear.gearName = Xgears[Math.floor(Math.random() * Xgears.length)];
              replier.reply(targetUserg + '님의 펫 장비가 집행관 등급으로 변경되었습니다.');
            } else {
              replier.reply(targetUserg + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }
        if (msg.startsWith('/장비불멸') && sender === "호이 남") {
          const regexg7 = /\/장비불멸\s+([^]+)/;
          const matchg7 = msg.match(regexg7); // 정규식 변수 이름을 regexg7로 수정

          if (matchg7) {
            const targetUserg7 = matchg7[1].trim(); // 사용자명에서 공백 제거

            if (data.member[targetUserg7] && data.member[targetUserg7].pet && data.member[targetUserg7].pet.petname) {
              data.member[targetUserg7].pet.petgear.gearRank = '불멸';
              data.member[targetUserg7].pet.petgear.gearName = Zgears[Math.floor(Math.random() * Zgears.length)];
              replier.reply(targetUserg7 + '님의 펫 장비가 불멸 등급으로 변경되었습니다.');
            } else {
              replier.reply(targetUserg7 + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }


        if (msg.startsWith('/장비이벤트') && sender === "호이 남") {
          const regexg8 = /\/장비이벤트\s+([^]+)/;
          const matchg8 = msg.match(regexg8); // 정규식 변수 이름을 regexg8로 수정

          if (matchg8) {
            const targetUserg8 = matchg8[1].trim(); // 사용자명에서 공백 제거

            if (data.member[targetUserg8] && data.member[targetUserg8].pet && data.member[targetUserg8].pet.petname) {
              data.member[targetUserg8].pet.petgear.gearRank = '이벤트';
              data.member[targetUserg8].pet.petgear.gearName = Tgears[Math.floor(Math.random() * Tgears.length)];
              replier.reply(targetUserg8 + '님의 펫 장비가 이벤트 등급으로 변경되었습니다.');
            } else {
              replier.reply(targetUserg8 + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }

        if (msg.startsWith('/불멸수치수정') && sender === "호이 남") {
          const bulsuRegex = /\/불멸수치수정\s+(.+?),\s*(\d+)/;
          const bulsuMatch = msg.match(bulsuRegex);
          if (bulsuMatch && bulsuMatch.length === 3) {
            const bulsuTargetUser = bulsuMatch[1].trim(); // 대상 사용자의 공백 제거
            const newGearUp = parseInt(bulsuMatch[2]); // 설정할 불멸 강화 수치
            if (data.member[bulsuTargetUser]) {
              // 사용자 존재 여부 확인
              if (!isNaN(newGearUp) && newGearUp >= 0) {
                // 유효한 숫자 확인
                data.member[bulsuTargetUser].pet.petgear.gearUp = newGearUp; // 불멸 강화 수치 직접 설정
                replier.reply(bulsuTargetUser + '님의 불멸 강화 수치가 ' + newGearUp + '으로 설정되었습니다.');
              } else {
                replier.reply('올바른 강화 수치를 입력해주세요. (0 이상의 정수)');
              }
            } else {
              replier.reply('존재하지 않는 사용자입니다.');
            }
          } else {
            replier.reply('올바른 명령어 형식을 사용해주세요. 예: /불멸수치수정 [대상 사용자], [설정할 수치]');
          }
        }

        if (msg.startsWith('/특성 ') && (sender == Master || sender == "젤리 남")) {
          const regexc = /\/특성\s+([^]+)/;
          const matchc = msg.match(regexc);
          if (matchc) {
            const targetUserc = matchc[1];
            if (data.member[targetUserc].pet.petname) {
              data.member[targetUserc].pet.petchar = getRandomSpecialCharacter();
              replier.reply('[' + checkRank(data, targetUserc) + '] 님의 펫 특성이 ' + data.member[targetUserc].pet.petchar + '으로 리롤되었습니다.');
            } else {
              replier.reply(targetUserc + '님은 펫을 가지고 있지 않습니다.');
            }
          }
        }
        if (msg === '/펫대전' && (sender == "오픈채팅봇" || sender == "호이 남" || sender == "산타 남")) {
          let userArray = Object.keys(data.member);
          let battleResults = [];
          for (let user of userArray) {
            let pet = data.member[user].pet;
            if (pet.petexp > 49) {
              let dice1 = Math.floor(Math.random() * 6) + 1;
              let dice2 = Math.floor(Math.random() * 6) + 1;
              let result = dice1 * dice2 * pet.petexp;
              battleResults.push({
                user: user,
                result: result,
                dice1: dice1,
                dice2: dice2
              });
            }
          }
          battleResults.sort((a, b) => b.result - a.result);
          let resultMsg = '🏆 펫 대전 예선 결과 🏆\n [매력도 x 주사위 x 주사위]\n (4등까지 강 진출💫)\n\n';
          let resultMsg2 = '';
          let numberOfResultsToShow = Math.min(battleResults.length, 6);
          for (let i = 0; i < numberOfResultsToShow; i++) {
            let {
              user: user,
              result: result,
              dice1: dice1,
              dice2: dice2 } = battleResults[i];
            let petInfo = data.member[user].pet;
            let rank = i + 1;
            let rankText = rank <= 4 ? '💫' : (rank <= 6) ? '😭' : '';          //4등진출 및 6등까지 이모티콘 추가
            resultMsg += rankText + (i + 1) + '. ' + petInfo.petimg + ' ' + petInfo.petname + '\n  - ' + '💕' + petInfo.petexp + '\xd7' + getDiceEmoji(dice1) + '\xd7' + getDiceEmoji(dice2) + '= ' + result + '점\n';
          }
          resultMsg += "\n[나머지 순위 전체보기 클릭]\n";
          for (let i = numberOfResultsToShow; i < battleResults.length; i++) {
            let {
              user: user,
              result: result,
              dice1: dice1,
              dice2: dice2 } = battleResults[i];
            let petInfo = data.member[user].pet;
            resultMsg2 += '# ' + (i + 1) + '. ' + petInfo.petimg + ' ' + petInfo.petname + ' - ' + '💕' + petInfo.petexp + '\xd7' + getDiceEmoji(dice1) + '\xd7' + getDiceEmoji(dice2) + '= ' + result + '\n';
          }
          Api.replyRoom(room1, resultMsg + allsee + resultMsg2);
          Api.replyRoom(room2, resultMsg + allsee + resultMsg2);
          Api.replyRoom(room3, resultMsg + allsee + resultMsg2);
          Api.replyRoom(room5, resultMsg + allsee + resultMsg2);
          var resultpoint1 = "\n펫 예선 결과 순차 포인트 지급\n";
          resultpoint1 += '1. ' + battleResults[0].user + ': 🅟700000\n' + '2. ' + battleResults[1].user + ': 🅟650000\n' + '3. ' + battleResults[2].user + ': 🅟600000\n' + '4. ' + battleResults[3].user + ': 🅟500000\n';
          if (battleResults[4]) {
            resultpoint1 += '5. ' + battleResults[4].user + ': 🅟500000\n';
          }
          if (battleResults[5]) {
            resultpoint1 += '6. ' + battleResults[5].user + ': 🅟450000\n';
          }
          if (battleResults[6]) {
            resultpoint1 += '7. ' + battleResults[6].user + ': 🅟400000\n';
          }
          if (battleResults[7]) {
            resultpoint1 += '8. ' + battleResults[7].user + ': 🅟390000\n';
          }
          if (battleResults[8]) {
            resultpoint1 += '9. ' + battleResults[8].user + ': 🅟360000\n';
          }
          if (battleResults[9]) {
            resultpoint1 += '10. ' + battleResults[9].user + ': 🅟350000';
          }
          resultpoint1 = resultpoint1.trim();
          Api.replyRoom(room1, resultpoint1);
          Api.replyRoom(room2, resultpoint1);
          Api.replyRoom(room3, resultpoint1);
          Api.replyRoom(room5, resultpoint1);
          let regey = /(\d+\.\s?|\d+)(.+): 🅟(\d+)/g;
          let matchy;
          while ((matchy = regey.exec(resultpoint1)) !== null) {
            let username = matchy[2].trim();
            let points = parseInt(matchy[3], 10);
            data.member[username].point += parseInt(points);
          }
          let top4Results = battleResults.slice(0, 4);
          let r1user = data.member[top4Results[0].user].pet;
          let r2user = data.member[top4Results[1].user].pet;
          let r3user = data.member[top4Results[2].user].pet;
          let r4user = data.member[top4Results[3].user].pet;

          let r1userGear = calculateGearItem(top4Results[0].user, data);
          let r2userGear = calculateGearItem(top4Results[1].user, data);
          let r3userGear = calculateGearItem(top4Results[2].user, data);
          let r4userGear = calculateGearItem(top4Results[3].user, data);

          var typeBuff1 = difftypeBuff(r1user, r4user);
          var typeBuff2 = difftypeBuff(r2user, r3user);
          let buffmsg1 = '';
          let buffmsg2 = '';
          let buffmsg3 = '';
          let buffmsg4 = '';
          var newexp1 = (r1user.petexp * typeBuff1.buff1).toFixed(0);
          if (typeBuff1.buff1 == 1.3) {
            buffmsg1 = '(' + r1user.petexp + '⬆)';
          }
          var newexp2 = (r2user.petexp * typeBuff2.buff1).toFixed(0);
          if (typeBuff2.buff1 == 1.3) {
            buffmsg2 = '(' + r2user.petexp + '⬆)';
          }
          var newexp3 = (r3user.petexp * typeBuff2.buff2).toFixed(0);
          if (typeBuff2.buff2 == 1.3) {
            buffmsg3 = '(' + r3user.petexp + '⬆)';
          }
          var newexp4 = (r4user.petexp * typeBuff1.buff2).toFixed(0);
          if (typeBuff1.buff2 == 1.3) {
            buffmsg4 = '(' + r4user.petexp + '⬆)';
          }
          var gearbuff1 = r1userGear.battleExp;
          var gearbuff2 = r2userGear.battleExp;
          var gearbuff3 = r3userGear.battleExp;
          var gearbuff4 = r4userGear.battleExp;
          let gearmsg1 = r1userGear.msg;
          let gearmsg2 = r2userGear.msg;
          let gearmsg3 = r3userGear.msg;
          let gearmsg4 = r4userGear.msg;

          var newerexp1 = calculateCriticalDamage(data.member[top4Results[0].user], (parseInt(newexp1) + parseInt(gearbuff1)).toFixed(0));
          var newerexp2 = calculateCriticalDamage(data.member[top4Results[1].user], (parseInt(newexp2) + parseInt(gearbuff2)).toFixed(0));
          var newerexp3 = calculateCriticalDamage(data.member[top4Results[2].user], (parseInt(newexp3) + parseInt(gearbuff3)).toFixed(0));
          var newerexp4 = calculateCriticalDamage(data.member[top4Results[3].user], (parseInt(newexp4) + parseInt(gearbuff4)).toFixed(0));
          var playresult1 = petgameplay(newerexp1, newerexp4, replier);
          var playresult2 = petgameplay(newerexp2, newerexp3, replier);

          var resultpoint2 = "축하합니다. 결승전에 진출하셨습니다.\n추가 포인트 지급됩니다.\n";
          let winmsg1 = '';
          let winmsg2 = '';
          let winmsg3 = '';
          let winmsg4 = '';
          let finalplayer1 = '';
          let finalowner1 = '';
          let finalplayer2 = '';
          let finalowner2 = '';
          if (playresult1.winner == 1) {
            winmsg1 = "💫";
            finalplayer1 = r1user;
            finalowner1 = top4Results[0].user;
            resultpoint2 += top4Results[0].user + ': 🅟500000\n';
          } else {
            winmsg1 = "😭";
          }
          if (playresult1.winner == 2) {
            winmsg4 = "💫";
            finalplayer1 = r4user;
            finalowner1 = top4Results[3].user;
            resultpoint2 += top4Results[3].user + ': 🅟500000\n';
          } else {
            winmsg4 = "😭";
          }
          if (playresult2.winner == 1) {
            winmsg2 = "💫";
            finalplayer2 = r2user;
            finalowner2 = top4Results[1].user;
            resultpoint2 += top4Results[1].user + ': 🅟500000';
          } else {
            winmsg2 = "😭";
          }
          if (playresult2.winner == 2) {
            winmsg3 = "💫";
            finalplayer2 = r3user;
            finalowner2 = top4Results[2].user;
            resultpoint2 += top4Results[2].user + ': 🅟500000';
          } else {
            winmsg3 = "😭";
          }
          var semifinalMsg1 = '🔥 펫대전 4강 결과 🔥\n (펫장비🔅 및 상성⬆30% 버프 적용)\n\n';
          semifinalMsg1 += '------------🔸️1경기🔸️------------\n' + winmsg1 + '[1] ' + r1user.petimg + r1user.petname + ': 💕' + newerexp1 + buffmsg1 + gearmsg1 + '\n\n' + winmsg4 + '[4] ' + r4user.petimg + r4user.petname + ': 💕' + newerexp4 + buffmsg4 + gearmsg4 + '\n------------🔹️2경기🔹️------------\n' + winmsg2 + '[2] ' + r2user.petimg + r2user.petname + ': 💕' + newerexp2 + buffmsg2 + gearmsg2 + '\n\n' + winmsg3 + '[3] ' + r3user.petimg + r3user.petname + ': 💕' + newerexp3 + buffmsg3 + gearmsg3;
          var semifinalMsg2 = '🔸️1경기(상세이력)🔸️\n' + r1user.petimg + r1user.petname + '\n💕 : ' + newerexp1 + ' / 최종 남은 💕 :' + playresult1.remainExp1 + ' \n' + r4user.petimg + r4user.petname + '\n💕 : ' + newerexp4 + ' / 최종 남은 💕 :' + playresult1.remainExp2 + '\n\n\n🔹️2경기(상세이력)🔹️\n' + r2user.petimg + r2user.petname + '\n💕 : ' + newerexp2 + ' / 최종 남은 💕 :' + playresult2.remainExp1 + ' \n' + r3user.petimg + r3user.petname + '\n💕 : ' + newerexp3 + ' / 최종 남은 💕 :' + playresult2.remainExp2;
          var finaltypeBuff = difftypeBuff(finalplayer1, finalplayer2);
          let finalbuffmsg1 = '';
          let finalbuffmsg2 = '';
          var finalnewexp1 = (finalplayer1.petexp * finaltypeBuff.buff1).toFixed(0);
          if (finaltypeBuff.buff1 == 1.3) {
            finalbuffmsg1 = '(' + finalplayer1.petexp + '⬆)';
          }
          var finalnewexp2 = (finalplayer2.petexp * finaltypeBuff.buff2).toFixed(0);
          if (finaltypeBuff.buff2 == 1.3) {
            finalbuffmsg2 = '(' + finalplayer2.petexp + '⬆)';
          }
          let gear1 = calculateGearItem(finalowner1, data);
          let gear2 = calculateGearItem(finalowner2, data);
          var fgearbuff1 = gear1.battleExp;
          var fgearbuff2 = gear2.battleExp;
          let fgearmsg1 = gear1.msg;
          let fgearmsg2 = gear2.msg;

          var finalnewerexp1 = calculateCriticalDamageWithPet(finalplayer1, (parseInt(finalnewexp1) + parseInt(fgearbuff1)).toFixed(0));
          var finalnewerexp2 = calculateCriticalDamageWithPet(finalplayer1, (parseInt(finalnewexp2) + parseInt(fgearbuff2)).toFixed(0));
          var finalplayresult = petgameplay(finalnewerexp1, finalnewerexp2, replier);

          var resultpoint3 = "축하합니다. 우승하셨습니다.\n추가 포인트 지급됩니다.\n";
          let finalwinmsg1 = '';
          let finalwinmsg2 = '';
          let finalwinmsg11 = '';
          let finalwinmsg22 = '';
          if (finalplayresult.winner == 1) {
            finalwinmsg1 = "💫";
            finalwinmsg11 = "🎊🎊🎊";
            resultpoint3 += finalowner1 + ': 🅟1000000';
          } else {
            finalwinmsg1 = "😭";
          }
          if (finalplayresult.winner == 2) {
            finalwinmsg2 = "💫";
            finalwinmsg22 = "🎊🎊🎊";
            resultpoint3 += finalowner2 + ': 🅟1000000';
          } else {
            finalwinmsg2 = "😭";
          }
          var finalMsg1 = '💠 펫대전 결승 결과 💠 \n (펫장비🔅 및 상성⬆30% 버프 적용)\n\n';
          finalMsg1 += finalwinmsg1 + finalplayer1.petimg + finalplayer1.petname + ': 💕' + finalnewerexp1 + finalbuffmsg1 + fgearmsg1 + '\n[' + checkRank(data, finalowner1) + '] ' + finalwinmsg11 + '\n\n' + finalwinmsg2 + finalplayer2.petimg + finalplayer2.petname + ': 💕' + finalnewerexp2 + finalbuffmsg2 + fgearmsg2 + '\n[' + checkRank(data, finalowner2) + '] ' + finalwinmsg22;
          var finalMsg2 = '💠결승전💠(상세이력)\n' + finalplayer1.petimg + finalplayer1.petname + '\n💕 : ' + finalnewerexp1 + ' / 최종 남은 💕 :' + finalplayresult.remainExp1 + ' \n' + finalplayer2.petimg + finalplayer2.petname + '\n💕 : ' + finalnewerexp2 + ' / 최종 남은 💕 :' + finalplayresult.remainExp2;
          java.lang.Thread.sleep(8000);
          Api.replyRoom(room1, semifinalMsg1 + allsee + semifinalMsg2);
          Api.replyRoom(room2, semifinalMsg1 + allsee + semifinalMsg2);
          Api.replyRoom(room3, semifinalMsg1 + allsee + semifinalMsg2);
          Api.replyRoom(room5, semifinalMsg1 + allsee + semifinalMsg2);
          semifinalMsg1 = "";
          semifinalMsg2 = "";
          Api.replyRoom(room1, resultpoint2);
          Api.replyRoom(room2, resultpoint2);
          Api.replyRoom(room3, resultpoint2);
          Api.replyRoom(room5, resultpoint2);
          let regesf = /(.+): 🅟(\d+)/g;
          let matchsf;
          while ((matchsf = regesf.exec(resultpoint2)) !== null) {
            let username = matchsf[1].trim();
            let points = parseInt(matchsf[2], 10);
            data.member[username].point += parseInt(points);
          }
          resultpoint2 = "";
          java.lang.Thread.sleep(11000);
          Api.replyRoom(room1, finalMsg1 + allsee + finalMsg2);
          Api.replyRoom(room2, finalMsg1 + allsee + finalMsg2);
          Api.replyRoom(room3, finalMsg1 + allsee + finalMsg2);
          Api.replyRoom(room5, finalMsg1 + allsee + finalMsg2);
          finalMsg1 = "";
          finalMsg2 = "";
          Api.replyRoom(room1, resultpoint3);
          Api.replyRoom(room2, resultpoint3);
          Api.replyRoom(room3, resultpoint3);
          Api.replyRoom(room5, resultpoint3);
          let regef = /(.+): 🅟(\d+)/g;
          let matchf;
          while ((matchf = regef.exec(resultpoint3)) !== null) {
            let username = matchf[1].trim();
            let points = parseInt(matchf[2], 10);
            data.member[username].point += parseInt(points);
            data.petbattlewinner = username;
            if (!data.member[username].pet.petwin) {
              data.member[username].pet.petwin = 1;
            } else {
              data.member[username].pet.petwin++;
            }
          }
          resultpoint3 = "";
        }

        if (msg === "/주기리셋" && (sender == "오픈채팅봇" || sender == "호이 남" || sender == "진주 여")) {
          try {
            stopAllIntervals(data);
            replier.reply('주기리셋완');
            data.previnterval = 0;
          } catch (error) {
            data.previnterval = 0;
            data.intervalIDs = [];
            replier.reply('주기리셋');
          }
        }
        if (msg.startsWith("/배팅")) {
          var bettingMessage;
          bettingMessage = msg.substring("/배팅".length + 1).trim();        // '/배팅' 이후의 메시지 추출
          if (!Object.keys(data.hoiland).some(arrayKey => data.hoiland[arrayKey].some(entry => entry.user === sender))) {
            replier.reply("먼저 ''/이체 호이랜드 [포인트]'를 통해 등록하세요.");
          } else if (data.member[sender].pet.petchar.startsWith("대깨무")) {
            replier.reply('대깨무🐔 신봉자 [' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n 노려보고 있습니다.');
          } else {
            let userR = checkRank(data, sender);
            switch (bettingMessage) {
              case "호이":
                moveBetToSelectedArray("Hoi", sender, data);
                replier.reply('[' + userR + "] 님 호이승😝에 배팅 완료하였습니다!");
                break;
              case "봇":
                moveBetToSelectedArray("Bot", sender, data);
                replier.reply('[' + userR + "] 님 봇승🤖에 배팅 완료하였습니다!");
                break;
              case "무승부":
                moveBetToSelectedArray("Tie", sender, data);
                replier.reply('[' + userR + "] 님 무승부☠에 배팅 완료하였습니다!");
                break;
              default:
                replier.reply(" 배팅 오류❗\n/배팅 [호이,봇,무승부] 중 하나를 선택하세요.");
                break;
            }
          }
        }
        if (msg.startsWith("/수정") && (sender == "젤리 남" || sender == "호이 남")) {
          var args = msg.substring("/수정".length + 1).split(" ");        // '/수정' 이후의 내용 추출
          if (args.length >= 3 && /^\d+$/.test(args[args.length - 1])) {
            var editUser = args.slice(0, -1).join(" ").trim();          // 마지막 요소를 제외한 모든 요소를 합쳐 닉네임으로 사용
            var newPoint = parseInt(args[args.length - 1]);
            if (data.member[editUser]) {
              for (let key in data.hoiland) {
                if (Array.isArray(data.hoiland[key])) {
                  let existingEntry = data.hoiland[key].find(entry => entry.user === editUser);
                  if (existingEntry) {
                    existingEntry.amount = newPoint;
                    replier.reply('[' + checkRank(data, editUser) + "] 님의 배팅 포인트가 변경되었습니다.");
                  }
                }
              }
            } else {
              replier.reply(editUser + "은(는) 등록되어 있지 않습니다.");
            }
          }
        }

        // /편지 명령어 처리
        if (msg.startsWith("/편지")) {
          var memoCommand = msg.split(" ");
          if (memoCommand.length >= 2) {
            if (!hasLetterInBag(data, sender)) {
              replier.reply("우표💌가 없습니다\n상점에서 구매해주세요!");
              return;
            }

            var memoContent = msg.substring(4); // 메시지 추출
            var currentDate = new Date();
            var month = ('0' + (currentDate.getMonth() + 1)).slice(-2);
            var day = ('0' + currentDate.getDate()).slice(-2);
            var hour = ('0' + currentDate.getHours()).slice(-2);
            var minute = ('0' + currentDate.getMinutes()).slice(-2);

            var formattedDate = month + "/" + day + " " + hour + ":" + minute;

            // 메모를 맨 위에 추가
            board.memo.unshift({
              user: sender,
              content: memoContent,
              date: formattedDate
            });

            // 메모가 20개를 초과하면 가장 오래된 메모 삭제
            if (board.memo.length > 10) {
              board.memo.pop();
            }

            if (useLetterInBag(data, sender)) {
              replier.reply("편지💌가 전달되었습니다.");
            } else {
              replier.reply("우표💌사용에 문제가 발생했습니다. 다시 시도해주세요.");
            }
            saveJsonFile(board, boardPath);
          }
        }

        // /게시글확인 명령어 처리
        if (msg === "/게시판") {
          var allMemos = "🎈호이서버🐶벨라서버🐰 게시판🎈\n\n게시판규칙: 상호존중\n각 방의 규칙대로 경고 및 강퇴입니다.\n\n";
          for (let entry of board.memo) {
            allMemos += '[' + checkRank(data, entry.user) + "] : " + entry.content + " (" + entry.date + ")\n";
          }
          replier.reply(allMemos);
        }
        // 데이터 마이그용
        if (msg === '/편지데이터이전') {
          board.memo = data.memo;
          delete data.memo;
          replier.reply("데이터 이전 완료");
        }
        // /편지삭제 명령어 처리
        if (msg === "/편지삭제" && sender === "호이 남") {
          board.memo = [];
          replier.reply("마음이 박살났습니다\n쓸데 없는 의견을 불에 태웁니다.");
          saveJsonFile(board, boardPath);
        }

        if (msg.startsWith("/광고") && sender == Master) {
          var adCommand = msg.split(" ");
          if (adCommand.length >= 2) {
            var adContent = msg.substring(4);
          }
          data.adv = adContent;
          replier.reply("광고가 등록되었습니다.");
        }

        if (msg === "/이력") {
          var groupHoi = "\n------😝호이승(배율 : x" + Winx + ")--------\n";
          var groupBot = "------🤖봇승🤖(배율 : x" + Losex + ")--------\n";
          var groupTie = "------☠무승부☠(배율 : x" + Tiex + ")------\n";
          var groupOther = "---------💩배팅 미완료💩--------\n";
          var interval = getNextIntervalTime(data, setint);
          var resulti = "";
          if (data.HoiCastle.lord) {
            resulti += '호랜캐슬은  [🏰' + data.HoiCastle.lord + ']\n영주의 지배를 받고 있습니다.\n\n';
          }


          if (board.memo.length != 0) {
            resulti += '<<🐶서버게시판🐰: ' + board.memo.length + '개💟>> \n';
          }
          resulti += interval + '\n\n(광고)' + data.adv + "\n\n";
          resulti += "🎲호이랜드 참여수🎲: \n";
          let groupCounts = {
            Hoi: 0,
            Bot: 0,
            Tie: 0,
            NA: 0
          };
          for (let key in data.hoiland) {
            if (Array.isArray(data.hoiland[key])) {
              let group = "";
              for (let entry of data.hoiland[key]) {
                if (entry.user == data.petbattlewinner) {
                  group += '[' + checkRank(data, entry.user) + ']  🅟' + numberWithCommas(entry.amount) + '\n';
                } else {
                  group += '[' + checkRank(data, entry.user) + ']         🅟' + numberWithCommas(entry.amount) + '\n';
                }
                groupCounts[key]++;
              }
              switch (key) {
                case "Hoi":
                  groupHoi += group;
                  break;
                case "Bot":
                  groupBot += group;
                  break;
                case "Tie":
                  groupTie += group;
                  break;
                case "NA":
                  groupOther += group;
                  break;
              }
            }
          }
          let babo = "";
          if (groupCounts['NA'] != 0) {
            babo = "•미완💩: " + groupCounts['NA'] + "명";
          }
          var summ = "•호이승😣 (\xd7" + Winx + "): " + groupCounts['Hoi'] + "명\n•봇승🤖 (\xd7" + Losex + "): " + groupCounts['Bot'] + "명\n•무승부☠ (\xd7" + Tiex + "): " + groupCounts['Tie'] + "명\n" + babo + "\n(상세이력)";
          resulti += summ;
          var resulti2 = groupHoi + '\n' + groupBot + '\n' + groupTie + '\n' + groupOther;
          replier.reply(resulti + allsee + resulti2);
        }
        if (msg.startsWith("/배율 호이") && sender == Master && /^\d+$/.test(msg.substring("/배율 호이".length + 1))) {
          Winx = parseInt(msg.substring("/배율 호이".length + 1));
          replier.reply("호이승 배율이 " + Winx + "배로 설정되었습니다.");
        }
        if (msg.startsWith("/배율 봇") && sender == Master && /^\d+$/.test(msg.substring("/배율 봇".length + 1))) {
          Losex = parseInt(msg.substring("/배율 봇".length + 1));
          replier.reply("봇승 배율이 " + Losex + "배로 설정되었습니다.");
        }
        if (msg.startsWith("/배율 무승부") && sender == Master && /^\d+$/.test(msg.substring("/배율 무승부".length + 1))) {
          Tiex = parseInt(msg.substring("/배율 무승부".length + 1));
          replier.reply("무승부 배율이 " + Tiex + "배로 설정되었습니다.");
        }
        if (diceinterval == true || (msg == "/다이스" && sender == "호이 남")) {
          diceinterval = false;
          let earnings = 0; // 영주수익
          let lh = 0;
          let lb = 0;
          for (let entry of data.hoiland.Hoi) {
            data.member[entry.user].bet.DiceCnt++;
            data.member[entry.user].bet.TotalBet += parseInt(entry.amount);
          }
          for (let entry of data.hoiland.Bot) {
            data.member[entry.user].bet.DiceCnt++;
            data.member[entry.user].bet.TotalBet += parseInt(entry.amount);
          }
          for (let entry of data.hoiland.Tie) {
            if (data.member[entry.user].bet.lI) {
              lh = 0;
              lb = 0;
            }
            data.member[entry.user].bet.DiceCnt++;
            data.member[entry.user].bet.TotalBet += parseInt(entry.amount);
          }
          var hoiDice = Math.floor(Math.random() * parseInt(6 - lb)) + 1;
          var botDice = Math.floor(Math.random() * parseInt(6 - lh)) + 1;
          var resultMessage = "주사위 결과:\n";
          resultMessage += "호이: " + getDiceEmojix(hoiDice) + "\n";
          resultMessage += "봇: " + getDiceEmojix(botDice) + "\n";
          var finalResultmsg = "🎉최종 배팅 승자🎉\n";
          var finalResult = "";
          var finalResultdata = "";
          if (hoiDice > botDice) {
            data.dice.Hoi++;
            data.dice.recent.push("호이승");
            if (data.dice.recent.length > 5) {
              data.dice.recent.shift();
            }
            resultMessage += "호이 이겼습니다!";
            finalResultmsg += "😝호이승😝(포인트 " + Winx + "배)\n🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲";
            for (let entry of data.hoiland.Hoi) {
              var RankFeea = checkFee(data, entry.user);
              var resultPa = parseInt(entry.amount) * Winx;
              if (resultPa >= stan) {
                resultPa = stan * RankFeea.LowFeeR + (resultPa - stan) * RankFeea.HighFeeR;
                resultPa = resultPa.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPa) + '\n';
              } else {
                resultPa = resultPa * RankFeea.LowFeeR;
                resultPa = resultPa.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPa) + '\n';
              }
              data.member[entry.user].bet.WinCnt++;
              data.member[entry.user].bet.TotalWin += parseInt(resultPa);
              data.member[entry.user].point += parseInt(resultPa);
              data.member[entry.user].pet.petexp++;
              earnings += Math.round(resultPa * 0.01);
            }
          } else if (botDice > hoiDice) {
            data.dice.Bot++;
            data.dice.recent.push("봇승");
            if (data.dice.recent.length > 5) {
              data.dice.recent.shift();
            }
            resultMessage += "봇이 이겼습니다!";
            finalResultmsg += "🤖봇승🤖(포인트 " + Losex + "배)\n🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲";
            for (let entry of data.hoiland.Bot) {
              var RankFeeb = checkFee(data, entry.user);
              var resultPb = parseInt(entry.amount) * Losex;
              if (resultPb >= stan) {
                resultPb = stan * RankFeeb.LowFeeR + (resultPb - stan) * RankFeeb.HighFeeR;
                resultPb = resultPb.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPb) + '\n';
              } else {
                resultPb = resultPb * RankFeeb.LowFeeR;
                resultPb = resultPb.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPb) + '\n';
              }
              data.member[entry.user].bet.WinCnt++;
              data.member[entry.user].bet.TotalWin += parseInt(resultPb);
              data.member[entry.user].point += parseInt(resultPb);
              data.member[entry.user].pet.petexp++;
              earnings += Math.round(resultPb * 0.01);
            }
          } else {
            data.dice.Tie++;
            data.dice.recent.push("무승부");
            if (data.dice.recent.length > 5) {
              data.dice.recent.shift();
            }
            resultMessage += "무승부 입니다!";
            finalResultmsg += "☠️무승부☠️(포인트 " + Tiex + "배)\n🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲";
            for (let entry of data.hoiland.Tie) {
              var RankFeec = checkFee(data, entry.user);
              var resultPc = parseInt(entry.amount) * Tiex;
              if (resultPc >= stan) {
                resultPc = stan * RankFeec.LowFeeR + (resultPc - stan) * RankFeec.HighFeeR;
                resultPc = resultPc.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPc) + '\n';
              } else {
                resultPc = resultPc * RankFeec.LowFeeR;
                resultPc = resultPc.toFixed(0);
                finalResult += entry.user + " +🅟" + numberWithCommas(resultPc) + '\n';
              }
              data.member[entry.user].bet.WinCnt++;
              data.member[entry.user].bet.TotalWin += parseInt(resultPc);
              data.member[entry.user].point += parseInt(resultPc);
              data.member[entry.user].pet.petexp++;
              earnings += Math.round(resultPc * 0.01);
              if (data.member[entry.user].pet.petchar && data.member[entry.user].pet.petchar.startsWith('대깨무')) {
                data.member[entry.user].pet.petexp++;
              }
            }
          }
          Api.replyRoom(room1, resultMessage);
          Api.replyRoom(room1, finalResultmsg);
          Api.replyRoom(room2, resultMessage);
          Api.replyRoom(room2, finalResultmsg);
          Api.replyRoom(room3, resultMessage);
          Api.replyRoom(room3, finalResultmsg);
          Api.replyRoom(room5, resultMessage);
          Api.replyRoom(room5, finalResultmsg);
          if (finalResult) {
            if (data.HoiCastle && data.HoiCastle.lord) {
              data.HoiCastle.earnings += earnings;
              data.member[data.HoiCastle.lord].point += earnings;
              finalResult += '\n[' + checkRank(data, data.HoiCastle.lord) + "] 영주의 수익(1%) +🅟" + numberWithCommas(earnings) + '\n';
            }

            if (finalResult.match(/🅟/g).length >= 5) {
              finalResult = allsee + finalResult
            }

            Api.replyRoom(room1, "[호구 탈출을 위하여!]\n" + finalResult);
            Api.replyRoom(room2, "[호구 탈출을 위하여!]\n" + finalResult);
            Api.replyRoom(room3, "[호구 탈출을 위하여!]\n" + finalResult);
            Api.replyRoom(room5, "[호구 탈출을 위하여!]\n" + finalResult);
          }
          data.hoiland = {
            Hoi: [],
            Bot: [],
            Tie: [],
            NA: []
          };
          Winx = 2;
          Losex = 2;
          Tiex = 5;
          diceinterval = false;
          if (msg != "/다이스") {
            data.previnterval = new Date().getTime();
          }
          var tiemsg = "";
          for (let user in data.member) {
            if (data.member[user].bag['자동배팅😝🤖(1일)']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                let HoiBot = Math.random() < 0.5;
                if (HoiBot) {
                  data.hoiland.Hoi.push({
                    user: user,
                    amount: 1000
                  });
                } else {
                  data.hoiland.Bot.push({
                    user: user,
                    amount: 1000
                  });
                }
              }
            } else if (data.member[user].bag['자동대깨호😝(1일)']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                data.hoiland.Hoi.push({
                  user: user,
                  amount: 1000
                });
              }
            } else if (data.member[user].bag['자동배팅😝🤖 패스이용권']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                let HoiBot = Math.random() < 0.5;
                if (HoiBot) {
                  data.hoiland.Hoi.push({
                    user: user,
                    amount: 500000
                  });

                } else {
                  data.hoiland.Bot.push({
                    user: user,
                    amount: 500000
                  });
                }
              }
            } else if (data.member[user].bag['자동대깨봇🤖(1일)']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                data.hoiland.Bot.push({
                  user: user,
                  amount: 1000
                });
              }
            } else if (data.member[user].bag['자동대깨호😣 패스이용권']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                data.hoiland.Hoi.push({
                  user: user,
                  amount: 250000
                });
              }
            } else if (data.member[user].bag['자동대깨무🐔 패스이용권']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              } else {
                data.hoiland.Tie.push({
                  user: user,
                  amount: 500000
                });
              }
            }
            else if (data.member[user].bag['자동배팅권(🅟50만)😣🤖🐔']) {
              if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
                // 대깨무 관련 로직이 있다면 여기에 추가
              } else {
                let randomValue = Math.random();
                if (randomValue < 0.4) {
                  data.hoiland.Hoi.push({
                    user: user,
                    amount: 500000
                  });
                } else if (randomValue < 0.8) {
                  data.hoiland.Bot.push({
                    user: user,
                    amount: 500000
                  });
                } else {
                  data.hoiland.Tie.push({
                    user: user,
                    amount: 500000
                  });
                }
              }
            }

            if (data.member[user].pet.petchar && data.member[user].pet.petchar.startsWith('대깨무')) {
              tiemsg += '[' + data.member[user].pet.petimg + data.member[user].pet.petname + '] ';
              data.hoiland.Tie.push({
                user: user,
                amount: 100000
              });
            }
          }
          //  Api.replyRoom(room1, '대깨무를 신봉하는\n' + tiemsg + ' 이(가)\n무승부에 비상금 🅟100,000를\n배팅합니다.');
          //  Api.replyRoom(room2, '대깨무를 신봉하는\n' + tiemsg + ' 이(가)\n무승부에 비상금 🅟100,000를\n배팅합니다.');
          //    Api.replyRoom(room3, '대깨무를 신봉하는\n' + tiemsg + ' 이(가)\n무승부에 비상금 🅟100,000를\n배팅합니다.');
          //  Api.replyRoom(room4, '대깨무를 신봉하는\n' + tiemsg + ' 이(가)\n무승부에 비상금 🅟100,000를\n배팅합니다.');
        }
        if (msg == "/다이스시작" && (sender == "오픈채팅봇" || sender == "진주 여" || sender == "호이 남")) {
          diceinterval = true;
          replier.reply("/다이스");
          startInterval(data, replier, setint);
        }
        if (msg === '/몬스터소환' && (sender == "오픈채팅봇" || sender == "호이 남" || sender == "진주 여")) {
          const monsters = [{
            //     name: '잡초',
            //   emojis: '🌱'
            //   }];
            name: '세균맨',
            emojis: '👾'
          }, {
            name: '호이',
            emojis: '🤬'
          }, {
            name: '바퀴',
            emojis: '🪳'
          }, {
            name: '드라큘라',
            emojis: '🧛‍♂️'
          }, {
            name: '멍충오거',
            emojis: '🧌'
          }, {
            name: '버섯커',
            emojis: '🍄'
          }, {
            name: '대깨무',
            emojis: '🐔'
          }, {
            name: '특성트롤',
            emojis: '🪅'
          }, {
            name: '젤리코인',
            emojis: '🌝'
          }];
          const types = ['하늘', '땅', '바다'];
          data.monster = {};
          var monsterType = monsters[Math.floor(Math.random() * monsters.length)];
          data.monster.petname = monsterType.name;
          data.monster.petimg = monsterType.emojis;
          data.monster.pettype = types[Math.floor(Math.random() * types.length)];
          //   data.monster.petexp = 250000 * (Math.floor(Math.random() * 1) + 10);
          data.monster.petexp = 300000 * (Math.floor(Math.random() * 1) + 10);
          var monstermsg1 = "👾레이드가 등장했습니다. '/펫공격' 으로 처치해주세요.";
          var monstermsg2 = data.monster.petimg;
          var monstermsg3 = "이름 : " + data.monster.petname + " \n타입 : " + data.monster.pettype + "\n체력 : " + data.monster.petexp;
          Api.replyRoom(room1, monstermsg1);
          Api.replyRoom(room1, monstermsg2);
          Api.replyRoom(room1, monstermsg3);
          Api.replyRoom(room2, monstermsg1);
          Api.replyRoom(room2, monstermsg2);
          Api.replyRoom(room2, monstermsg3);
          Api.replyRoom(room3, monstermsg1);
          Api.replyRoom(room3, monstermsg2);
          Api.replyRoom(room3, monstermsg3);
          Api.replyRoom(room5, monstermsg1);
          Api.replyRoom(room5, monstermsg2);
          Api.replyRoom(room5, monstermsg3);
          if (data.monster.petname == '특성트롤') {
            Api.replyRoom(room1, '특성트롤의 경우 펫공격시\n펫특성이 바뀔 확률이 있으니\n조심하세요.');
            Api.replyRoom(room2, '특성트롤의 경우 펫공격시\n펫특성이 바뀔 확률이 있으니\n조심하세요.');
            Api.replyRoom(room3, '특성트롤의 경우 펫공격시\n펫특성이 바뀔 확률이 있으니\n조심하세요.');
            Api.replyRoom(room5, '특성트롤의 경우 펫공격시\n펫특성이 바뀔 확률이 있으니\n조심하세요.');
          }
          if (data.monster.petname == '젤리코인') {
            Api.replyRoom(room1, '젤리코인을 공격하면\n슬롯코인이 나올수 있어요.');
            Api.replyRoom(room2, '젤리코인을 공격하면\n슬롯코인이 나올수 있어요.');
            Api.replyRoom(room3, '젤리코인을 공격하면\n슬롯코인이 나올수 있어요.');
            Api.replyRoom(room5, '젤리코인을 공격하면\n슬롯코인이 나올수 있어요.');
          }
          if (data.monster.petname == '버섯커') {
            Api.replyRoom(room1, '버섯커을 공격하면\n환생버섯이 나올수 있어요.');
            Api.replyRoom(room2, '버섯커을 공격하면\n환생버섯이 나올수 있어요.');
            Api.replyRoom(room3, '버섯커을 공격하면\n환생버섯이 나올수 있어요.');
            Api.replyRoom(room5, '버섯커을 공격하면\n환생버섯이 나올수 있어요.');
          }
          if (data.monster.petname == '대깨무') {
            Api.replyRoom(room1, '대깨무를 공격하면\n양념치킨🐔이 나온다 임마');
            Api.replyRoom(room2, '대깨무를 공격하면\n양념치킨🐔이 나온다 임마');
            Api.replyRoom(room3, '대깨무를 공격하면\n양념치킨🐔이 나온다 임마');
            Api.replyRoom(room5, '대깨무를 공격하면\n양념치킨🐔이 나온다 임마');
          }

          if (data.monster.petname == '잡초') {
            Api.replyRoom(room1, '👾레이드 이벤트 시작👾\n어마무시한 잡초🌱 등장\n이벤트보스를 공격하면 풀때기🌱 드랍\n막타시 나뭇가지🌳(+1000🌰)[이벤트] 드랍\n화이또!');
            Api.replyRoom(room2, '👾레이드 이벤트 시작👾\n어마무시한 잡초🌱 등장\n이벤트보스를 공격하면 풀때기🌱 드랍\n막타시 나뭇가지🌳(+1000🌰)[이벤트] 드랍\n화이또!');
            Api.replyRoom(room3, '👾레이드 이벤트 시작👾\n어마무시한 잡초🌱 등장\n이벤트보스를 공격하면 풀때기🌱 드랍\n막타시 나뭇가지🌳(+1000🌰)[이벤트] 드랍\n화이또!');
            Api.replyRoom(room4, '👾레이드 이벤트 시작👾\n어마무시한 잡초🌱 등장\n이벤트보스를 공격하면 풀때기🌱 드랍\n막타시 나뭇가지🌳(+1000🌰)[이벤트] 드랍\n화이또!');
          }
          for (let user in data.member) {
            data.member[user].pet.petraid = 0;
          }
        }
        if (msg === '/레이드') {
          if (data.monster.petname) {
            replier.reply(data.monster.petimg);
            replier.reply("이름 : " + data.monster.petname + " \n타입 : " + data.monster.pettype + "\n남은체력 : " + data.monster.petexp);
          } else {
            replier.reply("현재 토벌중인 레이드보스가 없습니다.\n14시 20시 03시에 소환됩니다.");
          }
        }
        if (msg === '/펫공격') {
          if (data.member[sender].pet.petname) {
            if (data.monster.petname) {
              if (data.member[sender].pet.petraid == 0) {
                let raiduser = data.member[sender].pet;
                let raidboss = data.monster;
                let changeskill = Math.random() < 0.03;
                if (changeskill && data.monster.petname == '특성트롤') {
                  data.member[sender].pet.petchar = getRandomSpecialCharacter();
                  replier.reply('[' + checkRank(data, sender) + '] 님의 펫 특성이 ' + data.member[sender].pet.petchar + '으로 리롤되었습니다.');
                }
                let coindrop = Math.random() < 0.3;
                if (coindrop && data.monster.petname == '젤리코인') {
                  if (data.member[sender].bag['슬롯코인🪙'] === undefined) {
                    data.member[sender].bag['슬롯코인🪙'] = 1;                  // 상품을 bag에 추가
                  } else {
                    data.member[sender].bag['슬롯코인🪙']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 슬롯코인🪙을 획득하였습니다.');
                }
                let bsdrop = Math.random() < 0.0009;
                if (bsdrop && data.monster.petname == '버섯커') {
                  if (data.member[sender].bag['환생버섯🍄'] === undefined) {
                    data.member[sender].bag['환생버섯🍄'] = 1;                  // 상품을 bag에 추가
                  } else {
                    data.member[sender].bag['환생버섯🍄']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 환생버섯🍄을 획득하였격습니다.');
                }
                let tidrop = Math.random() < 0.3;
                if (tidrop && data.monster.petname == '대깨무') {
                  if (data.member[sender].bag['양념치킨🐔'] === undefined) {
                    data.member[sender].bag['양념치킨🐔'] = 1;                  // 상품을 bag에 추가
                  } else {
                    data.member[sender].bag['양념치킨🐔']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 양념치킨🐔을 획득하였습니다.');
                }
                let tsdrop = Math.random() < 0.4;
                if (tsdrop && (data.monster.petname == '드라큘라' || data.monster.petname == '세균맨' || data.monster.petname == '멍충오거' || data.monster.petname == '바퀴')) {
                  if (data.member[sender].bag['잡템☠️'] === undefined) {
                    data.member[sender].bag['잡템☠️'] = 1;                  // 상품을 bag에 추가
                  } else {
                    data.member[sender].bag['잡템☠️']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 잡템☠️을 획득하였습니다.');
                }
                let thdrop = Math.random() < 0.2;
                if (thdrop && data.monster.petname == '호이') {
                  if (data.member[sender].bag['방패조각🛡'] === undefined) {
                    data.member[sender].bag['방패조각🛡'] = 1;                  // 잡템을 bag에 추가
                  } else {
                    data.member[sender].bag['방패조각🛡']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 방패조각🛡을 획득하였습니다.');
                }
                let evdrop = Math.random() < 0.9;
                if (evdrop && data.monster.petname == '잡초') {
                  if (data.member[sender].bag['풀때기🌱'] == undefined) {
                    data.member[sender].bag['풀때기🌱'] = 1;
                  } else {
                    data.member[sender].bag['풀때기🌱']++;
                  }
                  replier.reply('[' + checkRank(data, sender) + '] 님이 풀때기🌱를 뽑았습니다.\n뿌직! 뿌직!');
                }

                let crit = Math.random() < 0.1;
                if (crit && raidboss.petexp < 120000) {
                  let KillMsg = '크리티컬 발동❗️\n' + raiduser.petimg + raiduser.petname + "(이)가 혼신의 일격을 가합니다.💥💥";
                  Api.replyRoom(room1, KillMsg);
                  Api.replyRoom(room2, KillMsg);
                  Api.replyRoom(room3, KillMsg);
                  Api.replyRoom(room5, KillMsg);
                  let randomRewards = ['캐슬기습공격권🔥(40%)', '캐슬절대방어권🛡(50%)'];
                  //  let randomRewards = ['나뭇가지🌳(+1000🌰) 당첨💕'];
                  let randomReward = randomRewards[Math.floor(Math.random() * randomRewards.length)];
                  Api.replyRoom(room1, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100,000 지급됩니다.\n");
                  Api.replyRoom(room2, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100,000 지급됩니다.\n");
                  Api.replyRoom(room3, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100,000 지급됩니다.\n");
                  Api.replyRoom(room5, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100,000 지급됩니다.\n");
                  let rewardmsg = '';
                  if (randomReward == '경험치 2배 부스터(소)') {
                    rewardmsg = "[" + checkRank(data, sender) + "] 님 레이드 막타 성공!!\n'" + randomReward + "'을(를)\n획득하였습니다.\n부스터카운트가 1000 상승합니다.";
                    data.member[sender].boostercnt += 1000;
                  } else {
                    if (data.member[sender].bag[randomReward] === undefined) {
                      data.member[sender].bag[randomReward] = 1;                    // 상품을 bag에 추가
                    } else {
                      data.member[sender].bag[randomReward]++;
                    }
                    rewardmsg = "[" + checkRank(data, sender) + "] 님 레이드 막타 성공!!\n'" + randomReward + "'을(를)\n획득하였습니다.";
                  }
                  Api.replyRoom(room1, rewardmsg);
                  Api.replyRoom(room2, rewardmsg);
                  Api.replyRoom(room3, rewardmsg);
                  Api.replyRoom(room5, rewardmsg);
                  data.monster = {};
                  for (let user in data.member) {
                    data.member[user].point += parseInt(100000);
                  }
                } else {
                  var raidtypeBuff = difftypeBuff(raiduser, raidboss);
                  let raidbuffmsg = '';
                  var usernewexp = (raiduser.petexp * raidtypeBuff.buff1).toFixed(0);
                  if (raidtypeBuff.buff1 == 1.3) {
                    raidbuffmsg = '(' + raiduser.petexp + '⬆)';
                  }

                  // 장비 매력 계산
                  let gearObj = calculateGearItem(sender, data);

                  var rgearbuff = gearObj.raidExp;
                  let rgearmsg = gearObj.msg;

                  //
                  let raid = 0;
                  let counterItem = "";
                  let extra = '';
                  if (data.monster.petname == "세균맨") {
                    counterItem = "항생제💊";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //      replier.reply('[' + counterItem + extra + ']를 보유 중입니다.\n[' + data.monster.petname + ']이 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "호이") {
                    counterItem = "거울🪞";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //     replier.reply('[' + counterItem + extra + ']을 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "바퀴") {
                    counterItem = "에프킬라💦";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //    replier.reply('[' + counterItem + extra + ']를 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "젤리코인") {
                    counterItem = "하리보🪼";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //    replier.reply('[' + counterItem + extra + ']를 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "특성트롤") {
                    counterItem = "트롤심장💓";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //    replier.reply('[' + counterItem + extra + ']를 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "버섯커") {
                    counterItem = "곰팡이🍄";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //    replier.reply('[' + counterItem + extra + ']를 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "드라큘라") {
                    counterItem = "마늘🧄";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //    replier.reply('[' + counterItem + extra + ']을 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "멍충오거") {
                    counterItem = "도깨비가면👹";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 50).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //   replier.reply('[' + counterItem + extra + ']을 보유 중입니다.\n[' + data.monster.petname + ']가 주눅듭니다. 펫 매력💕 + ' + raid);
                    } else {
                      raid = 0;
                    }
                  } else if (data.monster.petname == "대깨무") {
                    counterItem = "양념치킨🐔";
                    if (data.member[sender].bag[counterItem]) {
                      let count = data.member[sender].bag[counterItem];
                      raid = parseInt((count * 10).toFixed(0));
                      extra += '(+' + (count) + ')';
                      //  replier.reply('[' + counterItem + extra + ']을 보유 중입니다.\n[' + data.monster.petname + ']가 양념치킨을 보고 화들짝 놀랩니다 펫 매력💕+ ' + raid);
                    } else {
                      raid = 0;
                    }
                  }

                  var usernewerexp = Math.round(parseInt(raid) + parseInt(usernewexp) + parseInt(rgearbuff));
                  // 크리티컬 적용
                  let originexp = parseInt(usernewerexp); // 크리여부 비교용 
                  usernewerexp = calculateCriticalDamage(data.member[sender], parseInt(usernewerexp));
                  if (originexp != usernewerexp) {
                    replier.reply('치명타 발동⭐ [' + usernewerexp + '💕]\n[ ' + raiduser.petimg + raiduser.petname + ' ] 이(가)\n[ ' + raidboss.petimg + raidboss.petname + ' ] 의 대가리를 후립니다!!');
                  }

                  let resultMessage;
                  var raidplayresult = petgameplay(usernewerexp, raidboss.petexp, replier);

                  let userwinmsg1 = '';
                  let bosswinmsg1 = '';
                  let userwinmsg2 = '';
                  let bosswinmsg2 = '';
                  if (raidplayresult.winner == 1) {
                    userwinmsg1 = "💫";
                    userwinmsg2 = "🎊🎊🎊";
                  } else {
                    userwinmsg1 = "😭";
                  }
                  if (raidplayresult.winner == 2) {
                    bosswinmsg1 = "💫";
                    bosswinmsg2 = "🎊🎊🎊";
                  } else {
                    bosswinmsg1 = "😭";
                  }
                  var damagedealt = 0;
                  damagedealt = raidboss.petexp - parseInt(raidplayresult.remainExp2);
                  var RaidBonus = 100000 + (parseInt(damagedealt) * 100);
                  let RaidMsg = "\n";
                  RaidMsg += '💠레이드💠(상세이력)\n\n' + userwinmsg1 + raiduser.petimg + raiduser.petname + ': 💕' + usernewerexp + raidbuffmsg + rgearmsg + userwinmsg2 + '\n' + bosswinmsg1 + raidboss.petimg + raidboss.petname + ': 💕' + raidboss.petexp + bosswinmsg2;
                  RaidMsg += raiduser.petimg + raiduser.petname + '\n💕 : ' + usernewerexp + '\n' + ' / 최종 남은 💕 :' + raidplayresult.remainExp1 + '\n\n' + raidboss.petimg + raidboss.petname + '\n💕 : ' + raidboss.petexp + '\n' + ' / 최종 남은 💕 :' + raidplayresult.remainExp2;
                  raidboss.petexp = parseInt(raidplayresult.remainExp2);
                  if (raidplayresult.remainExp2 == '기절') {
                    let randomRewards = ['캐슬기습공격권🔥(40%)', '캐슬절대방어권🛡(50%)'];
                    //  let randomRewards = ['나뭇가지🌳(+1000🌰) 당첨💕'];
                    let randomReward = randomRewards[Math.floor(Math.random() * randomRewards.length)];
                    noticeMsg("☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100000 지급됩니다.\n" + allsee + RaidMsg)
                    // Api.replyRoom(room1, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100000 지급됩니다.\n" + allsee + RaidMsg);
                    // Api.replyRoom(room2, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100000 지급됩니다.\n" + allsee + RaidMsg);
                    // Api.replyRoom(room3, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100000 지급됩니다.\n" + allsee + RaidMsg);
                    // Api.replyRoom(room5, "☠️" + raidboss.petimg + "☠️\n 축하합니다. [ " + raidboss.petname + " ] 토벌에 성공하였습니다. \n 전원 🅟100000 지급됩니다.\n" + allsee + RaidMsg);
                    let rewardmsg = '';
                    if (randomReward == '경험치 2배 부스터(소)') {
                      rewardmsg = "[" + checkRank(data, sender) + "] 님 레이드 막타 성공!!\n'" + randomReward + "'을(를)\n획득하였습니다.\n부스터카운트가 1000상승합니다.";
                      data.member[sender].boostercnt += 1000;
                    } else {
                      if (data.member[sender].bag[randomReward] === undefined) {
                        data.member[sender].bag[randomReward] = 1;                      // 상품을 bag에 추가
                      } else {
                        data.member[sender].bag[randomReward]++;
                      }
                      rewardmsg = "[" + checkRank(data, sender) + "] 님 레이드 막타 성공!!\n'" + randomReward + "'을(를)\n획득하였습니다.";
                    }
                    noticeMsg(rewardmsg)
                    data.monster = {};
                    for (let user in data.member) {
                      data.member[user].point += parseInt(100000);
                    }
                  } else {
                    // @@
                    resultMessage += "👾레이드보너스 획득👾: 🅟" + numberWithCommas(RaidBonus) + "\n\n[ " + raiduser.petimg + raiduser.petname + " ]의 공격으로 \n[ " + raidboss.petimg + raidboss.petname + " ]의 체력이 " + numberWithCommas(raidplayresult.remainExp2) + " 남았습니다.\n" + allsee + RaidMsg;
                    replier.reply("👾레이드보너스 획득👾: 🅟" + numberWithCommas(RaidBonus) + "\n\n[ " + raiduser.petimg + raiduser.petname + " ]의 공격으로 \n[ " + raidboss.petimg + raidboss.petname + " ]의 체력이 " + numberWithCommas(raidplayresult.remainExp2) + " 남았습니다.\n" + allsee + RaidMsg);
                    data.member[sender].point += parseInt(RaidBonus);
                    data.member[sender].pet.petraid = 1;
                    if (data.member[sender].pet.petchar.startsWith("베테랑헌터")) {
                      var isExtraAttBonus = Math.random() < 0.8;                    //80%로 보너스공격포인트 획득
                      if (isExtraAttBonus) {
                        data.member[sender].point += 150000;
                        resultMessage += "\n\n" + '베테랑헌터✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n 👾레이드보너스👾를 \n🅟150,000 획득하였습니다.'
                        replier.reply('베테랑헌터✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n 👾레이드보너스👾를 \n🅟150,000 획득하였습니다.');
                      }
                    }
                  }
                  if (data.member[sender].pet.petchar.startsWith("호전적인")) {
                    var isExtraAtt = Math.random() < 0.35;                  //35%로 혼자리셋 획득
                    if (isExtraAtt) {
                      data.member[sender].pet.petraid = 0;
                      resultMessage += "\n\n" + '호전적인✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n다시 공격할 준비를 합니다.\n혼자레이드 리셋 발동'
                      replier.reply('호전적인✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n다시 공격할 준비를 합니다.\n혼자레이드 리셋 발동');
                    }
                  }
                }
                var isExpUp = true;
                var raidbonusexp = 0;
                if (data.member[sender].pet.petexp > 5000) {
                  isExpUp = Math.random() < 0.2;                //20%로 매력+1  
                  raidbonusexp = 1;
                } else if (data.member[sender].pet.petexp > 4000) {
                  isExpUp = Math.random() < 0.9;                //90%로 매력+1  
                  raidbonusexp = 1;
                } else if (data.member[sender].pet.petexp > 2500) {
                  raidbonusexp = Math.floor(Math.random() * 3) + 1;                //100% 1 ~ 3
                } else {
                  raidbonusexp = Math.floor(Math.random() * 4) + 2;                //100% 매력 + 3~5
                }
                if (isExpUp) {
                  data.member[sender].pet.petexp += parseInt(raidbonusexp);
                  resultMessage += "\n\n" + "[ " + raiduser.petimg + raiduser.petname + " ] (이)가 레이드를 통해\n깨달음을 얻었습니다.\n매력💕" + raidbonusexp + " 상승💝"
                  replier.reply("[ " + raiduser.petimg + raiduser.petname + " ] (이)가 레이드를 통해\n깨달음을 얻었습니다.\n매력💕" + raidbonusexp + " 상승💝");
                }
                if (data.member[sender].pet.petchar.startsWith("습득력이 좋은")) {
                  if (Math.random() <= 0.50) {  // 60% 확률로 실행
                    data.member[sender].pet.petexp++;
                    resultMessage += "\n\n" + '습득력이 좋은✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n추가로 매력을 1💕 획득합니다.'
                    replier.reply('습득력이 좋은✨[' + data.member[sender].pet.petimg + data.member[sender].pet.petname + '] 이(가)\n추가로 매력을 1💕 획득합니다.');
                  }
                }

              } else {
                replier.reply("금일 레이드 횟수를 이미 소모하였습니다.");
                if (data.member[sender].bag['혼자레이드리셋권😝']) {
                  data.member[sender].pet.petraid = 0;
                  if (data.member[sender].bag['혼자레이드리셋권😝'] > 1) {
                    data.member[sender].bag['혼자레이드리셋권😝']--;
                  } else {
                    delete data.member[sender].bag['혼자레이드리셋권😝'];
                  }
                  replier.reply("혼레리😝를 사용하였습니다.\n/펫공격 을 진행해주세요!");
                }
              }
            } else {
              replier.reply("현재 토벌중인 레이드보스가 없습니다.\n14시 20시 03시에 소환됩니다.");
            }
          } else {
            replier.reply("펫이 없습니다. 먼저 펫을 생성해주세요.");
          }
        }
        // 호이캐슬 추가
        if (msg === '/캐슬초기화' && sender == "호이 남") {

          data.HoiCastle = {
            lord: '호이 남' // 성주
            , taxRate: 0 // 세율
            , earnings: 0 // 수익
            , defenseCount: 0  // 방어횟수
          }

        } else if (msg.startsWith('/세금 ') && data.HoiCastle && sender === data.HoiCastle.lord) {
          let hoiCastle = data.HoiCastle;
          let command = msg.split(' ');
          if (command.length === 2 && command[1].match(/^\d+$/)) {
            let newTaxRate = parseInt(command[1]); // '/세금 숫자' 형식으로 받음
            if (newTaxRate >= 10 && newTaxRate <= 20) {
              let oldTaxRate = hoiCastle.taxRate;
              hoiCastle.taxRate = newTaxRate.toString(); // 세금 업데이트

              noticeMsg('[세금💲]\n[' + checkRank(data, hoiCastle.lord) + '] 영주가 세율을\n[💰' + oldTaxRate + '%]⏩[💰' + newTaxRate + '%]로 조정하였습니다.')
            } else {
              // 세금 값이 유효하지 않을 때 처리
              noticeMsg("세금은 10~20% 사이로 조정 할수 있습니다.");
            }
          }
        } else if (msg === '/호랜캐슬') {

          if (data.HoiCastle) {

            let petInfo = data.member[data.HoiCastle.lord].pet;
            let castleExp = numberWithCommas(calculateCastleItem(data.HoiCastle.lord, data) + calculateGearItem(data.HoiCastle.lord, data).battleExp + petInfo.petexp);
            let castleInfo = '🏰호랜캐슬🏰\n';
            castleInfo += '영주: ' + checkRank(data, data.HoiCastle.lord) + '\n';
            castleInfo += '펫: ' + petInfo.petimg + petInfo.petname + '(' + castleExp + '💕)\n';
            castleInfo += '세율: ' + data.HoiCastle.taxRate + '%\n';
            castleInfo += '수익: ' + numberWithCommas(data.HoiCastle.earnings) + '원\n';
            castleInfo += '방어 성공횟수: ' + data.HoiCastle.defenseCount + '회';

            replier.reply(castleInfo);
          } else {
            replier.reply('호랜캐슬 정보가 존재하지 않습니다.');
          }
        } else if (msg == '/영주수익순위초기화' && sender == Master) {
          Object.keys(data.member).forEach(member => {
            if (data.member[member]) {
              data.member[member].earnings = 0;
            }
          });
          replier.reply('영주수익순위가 초기화되었습니다.');
        } else if (msg === '/캐슬공격') {
          if (!castleSiegeFlag) {
            replier.reply("현재 공성전 진행중이 아닙니다.\n매일 밤 11시10분~11시20분 진행");
            return;
          }

          // 유저 
          let HoiCastle = data.HoiCastle;
          let lord = data.member[data.HoiCastle.lord]; // 영주
          let challenger = data.member[sender]; // 도전자

          // 유효성 검사
          if (HoiCastle && sender == HoiCastle.lord) {
            return;
          }

          if (!challenger.pet) {
            replier.reply("펫이 없습니다. 먼저 펫을 생성해주세요.");
            return;
          }
          if (!challenger.bag['캐슬공격권⚔'] || challenger.bag['캐슬공격권⚔'] < 1) {
            replier.reply("캐슬공격권⚔이 없습니다.\n'/캐슬공격조합'을 통하여 제작하세요!");
            return;
          } else {
            data.member[sender].bag['캐슬공격권⚔']--;
            if (data.member[sender].bag['캐슬공격권⚔'] == 0) {
              delete challenger.bag['캐슬공격권⚔'];
            }
          }

          let isDefenseFlag = false; // 방어 결과 플래그
          let isOffenseFlag = false; // 공격 결과 플래그

          noticeMsg('[공격⚔]\n[' + checkRank(data, sender) + ']님의\n[' + challenger.pet.petimg + challenger.pet.petname + ']이(가) 호랜캐슬을 공격합니다!');

          // 방어 아이템 검사 및 사용
          for (let key in castlePremiumItem.defense) {
            let item = castlePremiumItem.defense[key];
            if (lord.bag[item.name]) {
              isDefenseFlag = Math.random() <= item.successRate; // 방어 성공 확률
              if (isDefenseFlag) {
                // 방어 성공
                data.member[data.HoiCastle.lord].bag[item.name] -= 1;
                if (data.member[data.HoiCastle.lord].bag[item.name] <= 0) {
                  delete data.member[data.HoiCastle.lord].bag[item.name];
                }
                data.HoiCastle.defenseCount += 1;

                // 80% 확률로 캐슬코인🥇 지급
                if (Math.random() <= 0.80) {
                  if (!data.member[data.HoiCastle.lord].bag['캐슬코인🥇']) {
                    data.member[data.HoiCastle.lord].bag['캐슬코인🥇'] = 0;
                  }
                  data.member[data.HoiCastle.lord].bag['캐슬코인🥇'] += 1;
                  noticeMsg(lord.pet.petimg + lord.pet.petname + '이(가) 캐슬코인🥇을 획득했습니다!');
                }

                noticeMsg(item.name + '발동!\n' + checkRank(data, data.HoiCastle.lord) + ' 님의\n[' + lord.pet.petimg + lord.pet.petname + ']이(가) 절대방어에 성공합니다!!');
                break;
              } else {
                break;
              }
            }
          }

          if (!isDefenseFlag) {
            // 공격 아이템 검사 및 사용
            for (let key in castlePremiumItem.offense) {
              let item = castlePremiumItem.offense[key];
              if (data.member[sender].bag[item.name]) {
                isOffenseFlag = Math.random() <= item.successRate; // 공격 성공 여부
                if (isOffenseFlag) {
                  // 공격 성공
                  data.member[sender].bag[item.name] -= 1;
                  if (data.member[sender].bag[item.name] <= 0) {
                    delete data.member[sender].bag[item.name];
                  }

                  // 영주 세금 저장
                  if (!data.member[data.HoiCastle.lord].earnings) {
                    data.member[data.HoiCastle.lord].earnings = 0;
                  }
                  data.member[data.HoiCastle.lord].earnings += HoiCastle.earnings;

                  // 영주 교체
                  HoiCastle.lord = sender;
                  HoiCastle.earnings = 0;
                  HoiCastle.defenseCount = 0;
                  noticeMsg(item.name + '발동!\n' + checkRank(data, sender) + ' 님의\n[' + challenger.pet.petimg + challenger.pet.petname + ']이(가) 기습공격하여 호랜캐슬을 함락합니다!!');
                }
                break;
              }
            }
          }

          if (!isDefenseFlag && !isOffenseFlag) {


            // 병사 계산 로직
            let lordItemExp = calculateCastleItem(data.HoiCastle.lord, data);
            let challengerItemExp = calculateCastleItem(sender, data);

            // 펫 장비 계산 로직 
            let lordGearExp = calculateGearItem(data.HoiCastle.lord, data).battleExp;
            let challengerGearExp = calculateGearItem(sender, data).battleExp;

            // 펫 매력 계산
            let lordPetExp_origin = parseInt(Math.round(lord.pet.petexp) + Math.round(lordItemExp) + Math.round(lordGearExp));
            let challengerPetExp_origin = parseInt(Math.round(challenger.pet.petexp) + Math.round(challengerItemExp) + Math.round(challengerGearExp));

            // 상성 버프 적용
            let petTypeBuff = difftypeBuff(lord.pet, challenger.pet);
            lordPetExp_origin = lordPetExp_origin * petTypeBuff.buff1;
            challengerPetExp_origin = challengerPetExp_origin * petTypeBuff.buff2;

            // 크리티컬 적용
            lordPetExp_origin = Math.round(calculateCriticalDamage(lord, lordPetExp_origin));
            challengerPetExp_origin = Math.round(calculateCriticalDamage(challenger, challengerPetExp_origin));

            // 전투 
            var gameResult = petgameplay(lordPetExp_origin, challengerPetExp_origin, replier);

            // 승부 결과
            if (gameResult.winner == 1) {
              // 방어 성공
              HoiCastle.defenseCount += 1;

              // 20% 확률로 캐슬코인🥇 지급
              if (Math.random() <= 0.20) {
                if (!data.member[data.HoiCastle.lord].bag['캐슬코인🥇']) {
                  data.member[data.HoiCastle.lord].bag['캐슬코인🥇'] = 0;
                }
                data.member[data.HoiCastle.lord].bag['캐슬코인🥇'] += 1;
                noticeMsg(lord.pet.petimg + lord.pet.petname + '이(가) 캐슬코인🥇을 획득했습니다!');
              }

              noticeMsg('[방어🛡]\n[🏰' + HoiCastle.lord + '] 영주가 방어에\n성공하였습니다!');
            } else if (gameResult.winner == 2) {
              // 공격 성공
              if (!data.member[data.HoiCastle.lord].earnings) {
                data.member[data.HoiCastle.lord].earnings = 0;
              }
              data.member[data.HoiCastle.lord].earnings += HoiCastle.earnings;

              // 영주 교체
              HoiCastle.lord = sender;
              HoiCastle.earnings = 0;
              HoiCastle.defenseCount = 0;
              noticeMsg('[점령🔥]\n[' + checkRank(data, sender) + ']님의 [' + challenger.pet.petimg + challenger.pet.petname + ']이(가)\n호랜캐슬🏰을 점령하여\n새로운 영주가 되었습니다.\n모두 경배하십시오🙇‍♂🙇‍♀');
            }

            // 공격 성공 또는 실패 시 35% 확률로 캐슬코인 지급
            if (Math.random() <= 0.35) {
              if (!data.member[sender].bag['캐슬코인🥇']) {
                data.member[sender].bag['캐슬코인🥇'] = 0;
              }
              data.member[sender].bag['캐슬코인🥇'] += 1;
              noticeMsg('[' + checkRank(data, sender) + ']님이 캐슬코인🥇을 획득했습니다!');
            }

            let firstMsg = '💠 캐슬공격 결과 💠 \n\n';

            let secondMsg = '🔸️캐슬공격(상세이력)🔸️\n'
              + lord.pet.petimg + lord.pet.petname + '\n💕 : ' + lordPetExp_origin + ' / 최종 남은 💕 :' + gameResult.remainExp1 + ' \n'
              + challenger.pet.petimg + challenger.pet.petname + '\n💕 : ' + challengerPetExp_origin + ' / 최종 남은 💕 :' + gameResult.remainExp2;

            noticeMsg(firstMsg + allsee + secondMsg);
          }
        } else if (msg === '/캐슬대전시즌시작' && (sender === '오픈채팅봇' || sender === '호이 남')) {
          castleBattleData.flag = true;
          saveJsonFile(castleBattleData, castleBattlePath);
          noticeMsg('🏆제 1회 캐슬대전 정규시즌🏆\n시즌이 시작되었습니다.\n"/캐슬대전"을하여 CP를 획득해보세요!');
        } else if (msg === '/캐슬대전시즌종료' && (sender === '오픈채팅봇' || sender === '호이 남')) {
          castleBattleData.flag = false;
          saveJsonFile(castleBattleData, castleBattlePath);
          noticeMsg('🏆제 1회 캐슬대전 정규시즌🏆\n시즌이 종료되었습니다.\n각 등급에 따라 차등 보상이 진행중입니다.');


          //보상지급
          let rewardMembers = sortCastleBattle(data); // 보상 대상자
          let rankInfo = castleBattleData.rank; // 등급 정보

          Object.keys(rankInfo).forEach(rankName => {
            let rankObj = rankInfo[rankName]; // 등급 정보 객체
            rewardMembers.forEach(member => {
              let memberRankName = getCastleBattleRankEmoji(member.score, castleBattleData);

              if (memberRankName == rankObj.name) {
                let rewards = rankObj.rewards;
                rewards.items.forEach(item => {
                  if (data.member[member.name].bag[item.name]) {
                    data.member[member.name].bag[item.name] += item.count;
                  } else {
                    data.member[member.name].bag[item.name] = item.count;
                  }
                  debuggerLog('아이템 ' + item.name + ' / ' + item.count + '개 지급 : ' + member.name);
                });

                if (rewards.point && rewards.point.length > 0) {
                  data.member[member.name].point += rewards.point;

                }
              }
            });
          });
          noticeMsg('시즌 보상 지급이 완료 되었습니다. 가방에서 보상을 확인하세요!');

        } else if (msg === '/캐슬대전초기화' && (sender === '오픈채팅봇' || sender === '호이 남')) {
          Object.keys(data.member).forEach(memberName => {
            data.member[memberName].battle = {
              win: 0,
              score: 0,
              lose: 0,
              ticket: 0
            };
          });
        } else if (msg.startsWith('/캐슬스코어 ') && sender === '호이 남') {
          // 메시지에서 아이디와 점수 추출
          let msgParts = msg.split(' ');
          if (msgParts.length >= 3) {
            let targetName = msgParts.slice(1, -1).join(' '); // 이름
            let score = parseInt(msgParts[msgParts.length - 1]); // 점수

            if (!isNaN(score)) {
              if (data.member[targetName]) {
                data.member[targetName].battle.score = score;
                data.member[targetName].battle.lastBattleDateTime = new Date();
                replier.reply(targetName + '의 CP를 ' + score + '로 변경 완료!');
              } else {
                replier.reply('존재하지 않는 사용자입니다.');
              }
            } else {
              replier.reply('점수는 숫자로 입력해야 합니다.');
            }
          } else {
            replier.reply('잘못된 형식입니다. /캐슬스코어 아이디 점수 형식으로 입력해주세요.');
          }


        } else if (msg === '/캐슬대전') {
          if (!castleBattleData.flag) {
            replier.reply('현재 캐슬대전시즌이 아닙니다.');
            return;
          }

          if (data.member[sender].pet.petexp <= 499) {
            replier.reply('펫 매력💕 500이상 부터 캐슬대전이 가능합니다.');
            return
          }

          let resetTicketName = '캐슬대전리셋권🐶';
          if (data.member[sender].battle.ticket == 1) {
            if (data.member[sender].bag[resetTicketName] > 0) {
              data.member[sender].bag[resetTicketName] -= 1;
              if (data.member[sender].bag[resetTicketName] == 0) {
                delete data.member[sender].bag[resetTicketName]
              }
              // TODO : 임시 메시지
              replier.reply(resetTicketName + '을 사용하였습니다.'); // 리세권사용 메시지
            } else {
              replier.reply('금일 캐슬대전 횟수를 이미 소모하였습니다.\n캐슬대전리셋권🐶 이 필요합니다.');
              return
            }
          }
          // 기본 보상 및 횟수 차감
          data.member[sender].battle.ticket = 1; // 횟수 증가
          data.member[sender].battle.lastBattleDateTime = new Date();
          data.member[sender].point += 500000; // 포인트 지급

          // 5000 이상의 point를 가진 멤버들을 필터링
          let memberList = Object.keys(data.member).filter(member => data.member[member].pet.petexp >= 500);
          let randomMemberName = memberList[Math.floor(Math.random() * memberList.length)];

          // 대전로직
          let attackerName = sender;// 공격자명
          let defenderName = randomMemberName; // 방어자명
          let attackerObj = data.member[attackerName];
          let defenderObj = data.member[defenderName];
          // 병사 계산 로직
          let attackerCastleItemExp = Math.round(calculateCastleItem(attackerName, data));
          let defenderCastleItemExp = Math.round(calculateCastleItem(defenderName, data));

          // 펫 장비 계산 로직 
          let attackerGearExp = Math.round(calculateGearItem(attackerName, data).battleExp);
          let defenderGearExp = Math.round(calculateGearItem(defenderName, data).battleExp);

          // 펫 매력 계산
          let attackerPetExp_origin = parseInt(Math.round(attackerObj.pet.petexp) + attackerCastleItemExp + attackerGearExp);
          let defenderPetExp_origin = parseInt(Math.round(defenderObj.pet.petexp) + defenderCastleItemExp + defenderGearExp);

          // 상성 버프 적용
          let petTypeBuff = difftypeBuff(attackerObj.pet, defenderObj.pet);
          let attackerPetExp = attackerPetExp_origin * petTypeBuff.buff1;
          let defenderPetExp = defenderPetExp_origin * petTypeBuff.buff2;

          // 크리티컬 적용
          attackerPetExp = Math.round(calculateCriticalDamage(attackerObj, attackerPetExp));
          defenderPetExp = Math.round(calculateCriticalDamage(defenderObj, defenderPetExp));

          // 전투
          let gameResult = petgameplay(attackerPetExp, defenderPetExp);
          let isWinFlag = (gameResult.winner == 1);  // 공격자의 승리 여부
          let winnerName = isWinFlag ? attackerName : defenderName;
          let loseName = isWinFlag ? defenderName : attackerName;
          let winnerScore = getRandomScore(true, castleBattleData);
          let loseScore = getRandomScore(false, castleBattleData);

          // 결과 로직
          let beforeScore = data.member[attackerName].battle.score;
          data.member[winnerName].battle.win += 1;
          data.member[winnerName].battle.score += winnerScore;
          data.member[loseName].battle.lose += 1;
          data.member[loseName].battle.score -= loseScore;
          if (data.member[loseName].battle.score < 0) {
            data.member[loseName].battle.score = 0;
          }
          let afterScore = data.member[attackerName].battle.score;

          // 전투메세지 
          let result = '🏆제 1회 캐슬대전 정규시즌🏆\n\n[ ' + (isWinFlag ? ('🥇승리 +' + winnerScore) : ('❌패배 -' + loseScore)) + '🏆 ]'
          result += '[누적 CP ' + numberWithCommas(data.member[sender].battle.score) + '🏆]' + '\n\n'
          result += '[' + checkRank(data, attackerName) + '] 님의\n[' + attackerObj.pet.petimg + attackerObj.pet.petname + '] ' + numberWithCommas(attackerPetExp) + '💕 ' + (isWinFlag ? '승리' : '패배') + '\n\n';
          result += '[' + checkRank(data, defenderName) + '] 님의\n[' + defenderObj.pet.petimg + defenderObj.pet.petname + '] ' + numberWithCommas(defenderPetExp) + '💕 ' + (isWinFlag ? '패배' : '승리') + '\n';
          result += allsee;//상세보기

          result += '\n🔸️캐슬대전(상세이력)🔸️\n'
            + attackerObj.pet.petimg + attackerObj.pet.petname + '\n💕 : ' + numberWithCommas(attackerPetExp) + ' / 최종 남은 💕 :' + numberWithCommas(gameResult.remainExp1) + ' \n'
            + defenderObj.pet.petimg + defenderObj.pet.petname + '\n💕 : ' + numberWithCommas(defenderPetExp) + ' / 최종 남은 💕 :' + numberWithCommas(gameResult.remainExp2);

          result += '\n\n' + checkRank(data, winnerName) + ' 캐슬포인트(CP): +' + numberWithCommas(winnerScore) + 'pt🏆';
          result += '\n' + checkRank(data, loseName) + ' 캐슬포인트(CP): -' + numberWithCommas(loseScore) + 'pt🏆';
          replier.reply(result);

          // 강등,승급 메시지
          let beforeRankName = getCastleBattleRankEmoji(beforeScore, castleBattleData);
          let afterRankName = getCastleBattleRankEmoji(afterScore, castleBattleData);

          let gradeUpDownMessage = '[' + checkRank(data, attackerName) + '] 님의 캐슬대전🏆 등급이\n';
          if (beforeRankName !== afterRankName) {
            gradeUpDownMessage += '[' + beforeRankName + '] -> [' + afterRankName + '] 으로 ' + (beforeScore < afterScore ? '\n🥇승급' : '\n〽강등') + '하였습니다.';
            replier.reply(gradeUpDownMessage);
          }

          // history
          let castleBattleHistory = {
            castleBattleDateTime: new Date(),
            attackerName: attackerName,
            attackerPetName: attackerObj.pet.petname,
            attackerPetImg: attackerObj.pet.petimg,
            attackerPetExp: attackerPetExp,
            defenderName: defenderName,
            defenderPetName: defenderObj.pet.petname,
            defenderPetImg: defenderObj.pet.petimg,
            defenderPetExp: defenderPetExp,
            winnerName: winnerName,
            winnerScore: winnerScore,
            loseName: loseName,
            loseScore: loseScore
          }
          castleBattleData.history.push(castleBattleHistory);
          // 최대 20개의 히스토리만 유지
          if (castleBattleData.history.length > 20) {
            castleBattleData.history.shift(); // 가장 오래된 히스토리 삭제
          }
          saveJsonFile(castleBattleData, castleBattlePath);
        } else if (msg == '/디버깅모드' && (sender == '호이 남' || sender == '찰리 봇')) {
          let debugMode = debuggerToggle();
          replier.reply('디버깅 모드 : ' + (debugMode ? 'ON' : 'OFF'));
        }
        if (msg === "/로또참가") {
          if (data.member[sender].point > Pot) {
            data.member[sender].point -= parseInt(Pot);
            if (!data.lotto) {
              data.lotto = {};
            }
            if (!data.lottoPot) {
              data.lottoPot = MinPot;
            }
            if (data.lotto.hasOwnProperty(sender)) {
              var userNumbers = data.lotto[sender].slice(1);            // 유저의 로또 번호 추출
              replier.reply("[" + checkRank(data, sender) + "] 님은 이미 참여했습니다.\n당신의 로또 번호는 " + getDiceEmoji(userNumbers[0]) + getDiceEmoji(userNumbers[1]) + getDiceEmoji(userNumbers[2]) + "입니다.");
              data.member[sender].point += parseInt(Pot);
            } else {
              var diceone = Math.floor(Math.random() * 6) + 1;
              var dicetwo = Math.floor(Math.random() * 6) + 1;
              var dicethree = Math.floor(Math.random() * 6) + 1;
              data.lotto[sender] = [sender, diceone, dicetwo, dicethree];            // 새로운 사용자의 경우 배열 생성
              data.lottoPot += Pot;
              replier.reply("[" + checkRank(data, sender) + "] 님 로또 참여되었습니다.\n현재 누적 당첨 포인트: 🅟" + numberWithCommas(data.lottoPot));
            }
          } else {
            replier.reply("참가포인트가 부족합니다.\n🅟1000 필요(거지냐?)");
          }
        } else if (msg === "/로또") {
          if (!data.lottoPot) {
            data.lottoPot = MinPot;
          }
          var premsg = "[현재 누적 당첨금: 🅟" + numberWithCommas(data.lottoPot) + "]\n참가방법: /로또참가\n" + "번호수동설정: /번호변경 # # #\n🧧매일 저녁 8시 30분 추첨\n🎉로또 참가자List 및 번호\n";
          var lotoresult = "";
          for (var user in data.lotto) {
            var Log = data.lotto[user];
            Log[0] = checkRank(data, Log[0]);          //랭크 반영
            var lotouserInfo = "[" + Log[0] + "]        " + getDiceEmoji(Log[1]) + getDiceEmoji(Log[2]) + getDiceEmoji(Log[3]);          // sender와 dice1,2,3 정보
            lotoresult += lotouserInfo + "\n";
          }
          replier.reply(premsg + allsee + lotoresult);
        }
        if (msg.startsWith("/번호변경")) {
          if (!data.lotto) {
            data.lotto = {};          // 객체가 비어있으면 초기화
          }
          if (!data.lotto.hasOwnProperty(sender)) {
            replier.reply("로또 참여 먼저 해주세요.");
            return;
          }
          var messageParts = msg.split(" ");        // 메시지를 띄어쓰기로 나눕니다.
          if (messageParts.length !== 4 || !isAllDigits(messageParts.slice(1))) {
            replier.reply("'/번호변경 # # #' 형태로 입력해주세요. (#은 1부터 6까지의 숫자)");
            return;
          }
          var newdiceone = messageParts[1];
          var newdicetwo = messageParts[2];
          var newdicethree = messageParts[3];
          var resultmsgg = "로또번호가";
          resultmsgg += getDiceEmoji(messageParts[1]);
          resultmsgg += getDiceEmoji(messageParts[2]);
          resultmsgg += getDiceEmoji(messageParts[3]);
          resultmsgg += "로 변경 되었습니다.";
          if (newdiceone > 6 || newdicetwo > 6 || newdicethree > 6 || newdiceone < 1 || newdicetwo < 1 || newdicethree < 1) {
            replier.reply("'/번호변경 # # #' # = 1 ~ 6 숫자");
          } else {
            data.lotto[sender] = [sender, newdiceone, newdicetwo, newdicethree];
            replier.reply(resultmsgg);
          }
        }
        else if (msg === "/로또마감" && (sender == Master || sender == "산타 남" || sender == "오픈채팅봇")) {
          if (!data.lottoPot) {
            data.lottoPot = MinPot;
          }
          var ltdiceone = Math.floor(Math.random() * 6) + 1;
          var ltdicetwo = Math.floor(Math.random() * 6) + 1;
          var ltdicethree = Math.floor(Math.random() * 6) + 1;
          var lotoresultMessage = "로또 결과:\n";
          lotoresultMessage += getDiceEmoji(ltdiceone);
          lotoresultMessage += getDiceEmoji(ltdicetwo);
          lotoresultMessage += getDiceEmoji(ltdicethree);
          var finalMessage = "로또 당첨축하! 행복하세용!:\n";
          var lotofinalResult = [];
          var fail = "당첨자가 없어 상금이 다음회차로 누적이월됩니다.\n현재 누적 포인트 : 🅟" + numberWithCommas(data.lottoPot);
          for (var userss in data.lotto) {
            var Logs = data.lotto[userss];
            if (ltdiceone == Logs[1] && ltdicetwo == Logs[2] && ltdicethree == Logs[3]) {
              lotofinalResult.push(userss);            // 모든 당첨자를 배열에 저장
            }
          }
          Api.replyRoom(room1, lotoresultMessage);        // 결과 메시지 출력
          Api.replyRoom(room2, lotoresultMessage);
          Api.replyRoom(room3, lotoresultMessage);
          Api.replyRoom(room5, lotoresultMessage);
          if (lotofinalResult.length > 0) {
            var prizePerWinner = Math.floor(data.lottoPot / lotofinalResult.length) * fee;
            var winnersMessage = lotofinalResult.map(winner => "[" + checkRank(data, winner) + "]").join(', ');
            var transfermsg = "";
            Api.replyRoom(room1, finalMessage + winnersMessage + "님 당첨🎉!!\n최종 당첨 포인트는 🅟" + numberWithCommas(prizePerWinner) + "입니다.");
            Api.replyRoom(room2, finalMessage + winnersMessage + "님 당첨🎉!!\n최종 당첨 포인트는 🅟" + numberWithCommas(prizePerWinner) + "입니다.");
            Api.replyRoom(room3, finalMessage + winnersMessage + "님 당첨🎉!!\n최종 당첨 포인트는 🅟" + numberWithCommas(prizePerWinner) + "입니다.");
            Api.replyRoom(room5, finalMessage + winnersMessage + "님 당첨🎉!!\n최종 당첨 포인트는 🅟" + numberWithCommas(prizePerWinner) + "입니다.");
            for (var s = 0; s < lotofinalResult.length; s++) {
              var winnerName = lotofinalResult[s];
              data.member[winnerName].point += parseInt(prizePerWinner);
              transfermsg += "최종 당첨금이 이체되었습니다.\n";
            }
            transfermsg = transfermsg.trim();
            Api.replyRoom(room1, transfermsg);
            Api.replyRoom(room2, transfermsg);
            Api.replyRoom(room3, transfermsg);
            Api.replyRoom(room5, transfermsg);
            data.lottoPot = MinPot;          // 상금 초기화
          } else {
            Api.replyRoom(room1, fail);
            Api.replyRoom(room2, fail);
            Api.replyRoom(room3, fail);
            Api.replyRoom(room5, fail);
          }
          data.lotto = {};        //이력 비우기
        }
        if (msg.startsWith("/상금추가") && sender == Master) {
          var addPot = parseInt(msg.substring("/상금추가".length + 1));
          data.lottoPot += addPot;
          replier.reply("최종 로또 상금이 🅟" + numberWithCommas(data.lottoPot) + "으로 증가했습니다.");
        }
        if (msg.startsWith('/경매등록 ') && (sender == Master || sender == "젤리 남" || sender == "오픈채팅봇")) {
          const regexBid = /\/경매등록\s+([^]+)\s+(\d+)\s*$/;
          const matchBid = msg.match(regexBid);
          if (!matchBid) {
            replier.reply('커멘드 확인해주세요. /경매등록 [아이템명] [분단위시간]');
            return;
          }
          var biditemName = matchBid[1];
          var intervalMinutes = parseInt(matchBid[2], 10);
          if (isItemAlreadyRegistered(data, biditemName)) {
            replier.reply('이미 등록된 아이템입니다.');
            return;
          }
          if (!data.auction) {
            data.auction = [];
          }
          let auctionEndTime = Date.now() + intervalMinutes * 60 * 1000;
          data.auction.push({
            biditemName: biditemName,
            highestBidder: '',
            highestBid: 0,
            endTime: auctionEndTime,
            timeoutID: 0
          });
          bidItems.push({
            biditemName: biditemName,
            isBid: false
          });
          let lastAuctionIndex = data.auction.length - 1;
          Api.replyRoom(room1, '[' + biditemName + '] 이(가) ' + intervalMinutes + '분 후 마감으로 경매에 등록되었습니다.');
          Api.replyRoom(room2, '[' + biditemName + '] 이(가) ' + intervalMinutes + '분 후 마감으로 경매에 등록되었습니다.');
          Api.replyRoom(room3, '[' + biditemName + '] 이(가) ' + intervalMinutes + '분 후 마감으로 경매에 등록되었습니다.');
          Api.replyRoom(room5, '[' + biditemName + '] 이(가) ' + intervalMinutes + '분 후 마감으로 경매에 등록되었습니다.');
        } else if (msg === '/호이상점') {
          if (!data.auction || data.auction.length === 0) {
            replier.reply('호이상점에 등록된 상품이 없습니다.');
          } else {
            let resultMsg = '🔔호이 경매상점🔔\n[ /입찰 [아이템번호] [포인트] 로 입찰 ]\n(입찰 수수료🤑 : 🅟5000)\n\n';
            let validAuctionItems = 0;
            data.auction.forEach((item, index) => {
              let remainingTime = item.endTime - Date.now();
              if (remainingTime <= 0) {
                sellAuctionItem(data, index, replier);
              } else {
                validAuctionItems++;
                let remainingHours = Math.floor(remainingTime / (1000 * 60 * 60));
                let remainingMinutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
                let remainingSeconds = Math.floor((remainingTime % (1000 * 60)) / 1000);
                let formattedRemainingTime = formatRemainingTime(remainingHours, remainingMinutes, remainingSeconds);
                resultMsg += validAuctionItems + '. ' + item.biditemName + ' (마감: ' + formattedRemainingTime + ')\n';
                if (item.highestBidder !== '') {
                  resultMsg += '   - 입찰자: [' + checkRank(data, item.highestBidder) + '] / 🅟: ' + numberWithCommas(item.highestBid) + '\n';
                } else {
                  resultMsg += '   - 입찰자: ' + '-' + ' / 🅟: ' + '-' + '\n';
                }
              }
            });
            data.auction = data.auction.filter(item => item.endTime - Date.now() > 0);
            resultMsg = resultMsg.trim();
            replier.reply(resultMsg);
          }
        } if (msg.startsWith('/입찰')) {
          let args = msg.split(' ');
          if (args.length !== 3) {
            replier.reply('명령어 오류, /입찰 [아이템번호] [포인트]');
            return;
          }
          let biditemNumber = parseInt(args[1], 10);
          let bidAmount = parseInt(args[2], 10);
          if (isNaN(biditemNumber) || isNaN(bidAmount) || biditemNumber <= 0 || bidAmount <= 0) {
            replier.reply('올바른 번호와 금액을 입력하세요.');
            return;
          }
          if (biditemNumber > data.auction.length) {
            replier.reply('유효하지 않은 아이템 번호입니다.');
            return;
          }
          let auctionItem = data.auction[biditemNumber - 1];
          let highestBid = auctionItem.highestBid;
          let remainingTime = auctionItem.endTime - Date.now();
          if (remainingTime <= 0) {
            replier.reply('[' + auctionItem.biditemName + '] 경매 시간이 이미 마감되었습니다.');
            return;
          }
          if (sender === auctionItem.highestBidder) {
            replier.reply('자신이 이미 최상위 입찰자입니다.');
          } else if ((bidAmount + 5000) > data.member[sender].point) {
            replier.reply('포인트가 부족하여 입찰할 수 없습니다.');
          } else if (bidAmount <= highestBid) {
            replier.reply('더 높은 포인트로 입찰해야 합니다.');
          } else if ((auctionItem.biditemName == '도깨비가면👹' || auctionItem.biditemName == '마늘🧄' || auctionItem.biditemName == '에프킬라💦' || auctionItem.biditemName == '거울🪞' || auctionItem.biditemName == '항생제💊') && data.member[sender].bag[auctionItem.biditemName] > 49) {
            replier.reply('이미 해당 레이드장비를\nMax치 만큼 보유 중입니다.');
          } else {
            if (auctionItem.highestBidder !== '' && data.member[auctionItem.highestBidder]) {
              data.member[auctionItem.highestBidder].point += highestBid;
            }
            data.member[sender].point -= bidAmount;
            data.member[sender].point -= 5000;
            auctionItem.highestBid = bidAmount;
            auctionItem.highestBidder = sender;
            Api.replyRoom(room1, '[' + auctionItem.biditemName + '] 의\n최고 입찰자가 갱신되었습니다.\n현재입찰가 : 🅟' + numberWithCommas(bidAmount));
            Api.replyRoom(room2, '[' + auctionItem.biditemName + '] 의\n최고 입찰자가 갱신되었습니다.\n현재입찰가 : 🅟' + numberWithCommas(bidAmount));
            Api.replyRoom(room3, '[' + auctionItem.biditemName + '] 의\n최고 입찰자가 갱신되었습니다.\n현재입찰가 : 🅟' + numberWithCommas(bidAmount));
            Api.replyRoom(room5, '[' + auctionItem.biditemName + '] 의\n최고 입찰자가 갱신되었습니다.\n현재입찰가 : 🅟' + numberWithCommas(bidAmount));
            if (remainingTime <= 60000) {
              auctionItem.endTime += 60000;
              Api.replyRoom(room1, '[' + auctionItem.biditemName + '] 의\n최고입찰자 갱신으로\n마감시간 1분 추가됩니다.');
              Api.replyRoom(room2, '[' + auctionItem.biditemName + '] 의\n최고입찰자 갱신으로\n마감시간 1분 추가됩니다.');
              Api.replyRoom(room3, '[' + auctionItem.biditemName + '] 의\n최고입찰자 갱신으로\n마감시간 1분 추가됩니다.');
              Api.replyRoom(room5, '[' + auctionItem.biditemName + '] 의\n최고입찰자 갱신으로\n마감시간 1분 추가됩니다.');
            }
          }
        } else if (msg.includes('/백업') && (sender == Master || sender == "젤리 남" || sender == "오픈채팅봇")) {
          savebackupJsonFile(filePath, data);
          savebackupJsonFile(boardPath, board);
          replier.reply('백업 완료');
        } else if (msg === "/호랜수익순위초기화" && sender == "호이 남") {
          data.dice = {}
          data.dice.Hoi = 0
          data.dice.Bot = 0
          data.dice.Tie = 0
          data.dice.recent = []

          Object.keys(data.member).forEach(member => {
            if (data.member[member]) {
              data.member[member].bet = {};
              data.member[member].bet.WinCnt = 0;
              data.member[member].bet.DiceCnt = 0;
              data.member[member].bet.TotalWin = 0;
              data.member[member].bet.TotalBet = 0;
            }
          });
          replier.reply('호랜수익순위 데이터가 초기화되었습니다.');
        }
        saveJsonFile(data, filePath);
      }
    }
  } catch (error) {
    let errorData = new java.io.File(errorLogPath);
    let errorObj = { system: 'main', error: error, msg: msg, room: room, sender: sender }
    FileStream.write(errorLogPath, JSON.stringify(errorObj), "utf-8");  // 명시적으로 UTF-8 인코딩 사용
  }
}
// JSON 파일 로드 함수
function loadJsonFile(path) {
  try {
    let file = new java.io.File(path);
    if (file.exists()) {
      let fileContent = FileStream.read(path, "utf-8");      // 명시적으로 UTF-8 인코딩 사용
      return JSON.parse(fileContent);
    }
  } catch (error) {
    // const randomNumber = Math.floor(Math.random() * 90 + 10);
    // save("호이랜드/로그", "Log_Load_" + randomNumber + ".txt", "Error while saving JSON file: " + error.message);
    // replier.reply(error.message);
  }
}
// JSON 파일 저장 함수
function saveJsonFile(data, path) {
  if (!(data instanceof Object)) {
    replier.reply('[Error] 데이터 저장 에러발생, 관리자 호출바람.');
  } else {
    isSaving = true;
    FileStream.write(path, JSON.stringify(data), "utf-8");  // 명시적으로 UTF-8 인코딩 사용
    isSaving = false;
  }
}
// 출석 리셋 함수
function resetAttendance(data, replier) {
  for (let user in data.member) {
    if (data.member[user].today === 0) {
      data.member[user].straight = 0;      // 결석자의 연속 출석 초기화
    }
    data.member[user].yesterday = 0;    // 모든 사용자에 대해 어제 출석 초기화
    data.member[user].pet.petraid = 0;
    data.member[user].battle.ticket = 0;
    data.member[user].cntlike = 0;
    data.member[user].coincount = 0;
    if (data.member[user].bag['자동대깨호😝(1일)']) {
      delete data.member[user].bag['자동대깨호😝(1일)'];
    }
    if (data.member[user].bag['자동대깨봇🤖(1일)']) {
      delete data.member[user].bag['자동대깨봇🤖(1일)'];
    }
    if (data.member[user].bag['자동배팅😝🤖(1일)']) {
      delete data.member[user].bag['자동배팅😝🤖(1일)'];
    }
  }

  // 여기서 data.attend_list에 있는 유저가 data.member에 있는지 확인
  for (let user of data.attend_list) {
    if (data.member.hasOwnProperty(user)) {
      data.member[user].yesterday = data.member[user].today;      // 어제 출석을 오늘로 갱신
      data.member[user].today = 0;      // 오늘 출석 초기화
    }
  }
  data.attend_list = [];  // 오늘 출석 목록 초기화
  replier.reply("출첵시작! 리셋 완료");

  const rooms = [room1, room2, room3, room4];
  const checkinMessage = "출석체크가 시작 되었습니다!\n모두 외쳐 ㅊㅊ 말고 영~차!";
  rooms.forEach(room => Api.replyRoom(room, checkinMessage));
}
// 캐슬대전 랜덤점수
function getRandomScore(isWinFlag, castleBattleData) {
  let min = null;
  let max = null;
  if (isWinFlag) {
    max = castleBattleData.score.win.max || null;
    min = castleBattleData.score.win.min || null;
  } else {
    max = castleBattleData.score.lose.max || null;
    min = castleBattleData.score.lose.min || null;
  }
  if (min !== null && max !== null) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  } else if (min !== null) {
    return min;
  } else if (max !== null) {
    return max;
  }
  return 0; // 기본값은 0
}

// 이름입력 시 등수 리턴
function getCastleBattleRank(memberName, data) {
  let sortedMembers = sortCastleBattle(data);
  for (let i = 0; i < sortedMembers.length; i++) {
    if (sortedMembers[i].name === memberName) {
      return i + 1; // 인덱스를 등수로 변환 (1부터 시작)
    }
  }
  return null;
}

// 점수 별 등급 이름+이모지 리턴
function getCastleBattleRankEmoji(score, castleBattleData) {
  let ranks = castleBattleData.rank;
  for (let rankKey in ranks) {
    if (score >= ranks[rankKey].scoreRequirement) {
      return ranks[rankKey].name;
    }
  }
}

// 사용자의 점수와 최근 전투 날짜를 기준으로 정렬
function sortCastleBattle(data) {
  let memberData = data.member;

  let sortedMembers = Object.keys(memberData)
    .filter(memberName => memberData[memberName].battle.score > 0) // score = 0 제외
    .map(memberName => ({
      name: memberName,
      score: memberData[memberName].battle.score,
      lastBattleDateTime: memberData[memberName].battle.lastBattleDateTime
    }));

  sortedMembers.sort((a, b) => {
    // 점수(score)가 높은 순서로 정렬, 동일한 경우 최근 전투 날짜(lastBattleDateTime)가 더 최근인 순서로 정렬
    if (a.score !== b.score) {
      return b.score - a.score; // 점수가 높은 순서
    } else {
      return new Date(b.lastBattleDateTime) - new Date(a.lastBattleDateTime); // 최근 전투 날짜가 더 최근인 순서
    }
  });

  return sortedMembers;
}

// 신임멤버 초기세팅 함수
function initializeMember(sender, data) {
  // 현재 날짜 가져오기
  let currentDate = getCurrentDate();
  data.member[sender] = {
    join: currentDate,
    lv: 1,
    lv0: 0,
    rebirthcnt: 1,
    exp: 0,
    point: 0,
    spend: 0,
    boostercnt: 0,
    chatcnt0: 0,
    cnt: 0,
    recent: 0,
    today: 0,
    yesterday: 0,
    straight: 0,
    lottery: 0,
    minigamecnt: 0,
    active: 0,
    like: 0,
    bag: {},
    title: {
      num: 0,
      list: []
    },
    rank: {
      tier: "UnRanked",
      emoji: "🌱"
    },
    bet: {
      DiceCnt: 0,
      TotalBet: 0,
      WinCnt: 0,
      TotalWin: 0
    },
    pet: {
      petname: "",
      pettype: "",
      petimg: "",
      petjoin: "",
      petexp: 0,
      petchar: "-",
      pettitle: "",
      petgear: {
        gearRank: '일반',
        gearName: '-'
      },
      petraid: 0
    },
    battle: {
      ticket: 0
      , score: 0
    }
  };
}


////////////////////save Log.txt, load game.txt////////////////////////

function read(folderName, fileName) {
  //파일 읽기 함수 제작
  var b = new java.io.File(sdcard + "/" + folderName + "/" + fileName);
  if (!(b.exists()))
    return null;
  var c = new java.io.FileInputStream(b);
  var d = new java.io.InputStreamReader(c);
  var e = new java.io.BufferedReader(d);
  var f = e.readLine();
  var g = "";
  while ((g = e.readLine()) != null) {
    f += "\n" + g;    //\ = 역슬래쉬 → 줄바꿈 표시
  }
  c.close();
  d.close();
  e.close();
  return String(f);
}


////////////////////ㅊㅊ보너스내용////////////////////////
function RankBonus(data, user) {
  var bonusP = 0;  // 랭크별 보너스 발생 확률
  var Bonusmsg = "";
  var BonusM = 0;  //보너스 배율 재설정
  if (data.member[user].rank.tier == "Almighty") {
    bonusP = 0.7;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🪬보너스(" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Emperor") {
    bonusP = 0.5;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🪽보너스(" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  }
  if (data.member[user].rank.tier == "King") {
    bonusP = 0.4;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "👑보너스(" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Challenger") {
    bonusP = 0.3;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🏆보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "GrandMaster") {
    bonusP = 0.25;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "⚜️보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Master") {
    bonusP = 0.23;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🔮보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Diamond") {
    bonusP = 0.20;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "💎보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Emerald") {
    bonusP = 0.18;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "💠보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Platinum") {
    bonusP = 0.15;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🔰보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Gold") {
    bonusP = 0.10;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🥇보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Silver") {
    bonusP = 0.07;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🥈보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Bronze") {
    bonusP = 0.05;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🥉보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "Ranked") {
    bonusP = 0.21;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "✨️보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  } else if (data.member[user].rank.tier == "UnRanked") {
    bonusP = 0.02;
    if (Math.random() < bonusP) {
      BonusM = rollAndCalculateMultiplier();
      Bonusmsg += "🌱보너스 (" + (bonusP * 100).toFixed(0) + "%) 발동! 다시 굴리기~" + BonusM + '배 당첨!';
    }
  }
  return {
    BonusM: BonusM,
    Bonusmsg: Bonusmsg
  };
}
// 주사위를 굴려 배율을 계산하는 외부 함수
function rollAndCalculateMultiplier() {
  // 주사위 눈금에 따른 배율 설정
  var diceRoll = rollWeightedDie();
  switch (diceRoll) {
    case 1:
      return 30;
    case 2:
      return 70;
    case 3:
      return 100;
    case 4:
      return 150;
    case 5:
      return 500;
    case 6:
      return 1000;
    default:
      return 1;
  }
}
// 가중치가 적용된 주사위 굴리기 함수
function rollWeightedDie() {
  // 확률에 따라 주사위 눈금 결정
  var probabilities = [0.35, 0.25, 0.2, 0.10, 0.07, 0.03];  // 각 눈금에 대한 확률
  var randomValue = Math.random();
  var cumulativeProbability = 0;
  for (var i = 0; i < probabilities.length; i++) {
    cumulativeProbability += probabilities[i];
    if (randomValue <= cumulativeProbability) {
      return i + 1;
    }
  }
  return 1;
}
////////////////////게임내용////////////////////////
function loadgametxtFromFile() {
  var gameData = read("호이랜드", "game.txt");
  if (gameData) {
    var gametxts = gameData.split(',');
    var game = gametxts[Math.floor(Math.random() * gametxts.length)].slice(1, -1);
  }
  return game;
}
// JSON 파일백업 저장 함수
function savebackupJsonFile(path, data) {
  try {
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString().slice(0, 10);    // YYYY-MM-DD 형식의 날짜
    const randomSuffix = Math.floor(Math.random() * 100);    // 랜덤한 숫자 (0부터 99까지)
    const backupFilePath = path.replace(/\.json$/, '_' + formattedDate + '_' + randomSuffix + '.json');
    FileStream.write(backupFilePath, JSON.stringify(data));
  } catch (error) {
    const randomNumber = Math.floor(Math.random() * 90 + 10);
    save("호이랜드/로그", "Log3_" + randomNumber + ".txt", "Error while saving JSON file: " + error.message);
  }
}
function addUserToRank(data, rank, user, replier) {
  if (rank == 0) {
    data.member[user].rank.tier = "UnRanked";
    data.member[user].rank.emoji = "🌱";
  } else if (rank == 1) {
    data.member[user].rank.tier = "King";
    data.member[user].rank.emoji = "👑";
  } else if (rank == 2) {
    data.member[user].rank.tier = "Challenger";
    data.member[user].rank.emoji = "🏆";
  } else if (rank == 3) {
    data.member[user].rank.tier = "GrandMaster";
    data.member[user].rank.emoji = "⚜️";
  } else if (rank == 4) {
    data.member[user].rank.tier = "Master";
    data.member[user].rank.emoji = "🔮";
  } else if (rank == 5) {
    data.member[user].rank.tier = "Diamond";
    data.member[user].rank.emoji = "💎";
  } else if (rank == 6) {
    data.member[user].rank.tier = "Emerald";
    data.member[user].rank.emoji = "💠";
  } else if (rank == 7) {
    data.member[user].rank.tier = "Platinum";
    data.member[user].rank.emoji = "🔰";
  } else if (rank == 8) {
    data.member[user].rank.tier = "Gold";
    data.member[user].rank.emoji = "🥇";
  } else if (rank == 9) {
    data.member[user].rank.tier = "Silver";
    data.member[user].rank.emoji = "🥈";
  } else if (rank == 10) {
    data.member[user].rank.tier = "Bronze";
    data.member[user].rank.emoji = "🥉";
  } else if (rank == 11) {
    data.member[user].rank.tier = "Emperor";
    data.member[user].rank.emoji = "🪽";
  } else if (rank == 12) {
    data.member[user].rank.tier = "Almighty";
    data.member[user].rank.emoji = "🪬";
  } else {
    replier.reply("등급숫자 확인해주세요.\n1~12순이며 언랭은 0입니다.");
  }
}
//////////////펫 내용///////////////////
// 펫 생성
function createPet(pet) {
  const selectedType = petTypes1[Math.floor(Math.random() * petTypes1.length)];
  pet.petjoin = getCurrentDate();
  pet.pettype = selectedType.name;
  pet.petimg = selectedType.emojis;
  pet.pettitle = getRandomCharacter();
}
// 성격 랜덤 설정 함수
function getRandomCharacter() {
  const characters = ['성실한', '외로운', '고집스러운', '개구쟁이', '용감한', '대담한', '장난꾸러기', '촐랑이', '무사태평', '조심스러운', '의젓한', '덜렁이', '냉정한', '차분한', '얌전한', '신중한', '건방진', '겁쟁이', '성급한', '명랑한', '천진난만한', '바보스러운', '가소로운', '멍청한', '호이스러운', '소시오패스', '나르시스트', '똘끼가 있는', '온화한', '산만한', '감성 있는', '마음이 따듯한', '주사위 굴리는', '도박중독', '냉철한', '멋쟁이', '존예여신', '희생적인', '절제하는', '개척적인', '기꺼이 하는', '논쟁을 좋아하는', '공손한', '설득력 있는', '신중한', '인기 있는', '변화가 많은', '체계적인', '엄격한', '호의적인', '참신한', '지도력 있는', '일관성 있는', '참을성 없는', '경쟁심이 있는', '포옹력 있는', '강력한', '활기 있는', '사교적인', '회의적인', '독립심이 강한', '겸손한', '충동적인', '친절한', '변덕스러운', '꼼꼼한', '논리적인', '느린', '쾌활한', '눕기 좋아하는', '무서움을 모르는', '완고한', '인내심이 좋은', '느긋한', '사려 깊은', '완벽주의자', '전통적인', '충성스러운', '단호한', '마초적인', '슈퍼맨같은', '사이코패스', '깡패같은', '행복을 주는', '달달한', '빠가스러운', '천재적인', '야한', '밝히는', '졸렬한', '월급루팡', '월급쿠팡', '맞고다니는', '매력이 넘치는', '귀여운', '혓 바닥이 긴', '얼굴 짱 큰', '운이 좋은', '주정뱅이', '담배 맛을 아는', '입냄새 나는', '애인이 없는', '현타온', '폭주하는', '변비 있는', '진료가 필요한', '약먹을 시간이 지난', '패드립퍼', '오타쿠', '아이시떼루!', '맛집을 좋아하는', '명품백을 좋아하는', '무신사를 사랑하는', '주인을 좋아하는', '주인을 사랑하는', '주인을 싫어하는', '주인을 극혐하는', '약골..'];
  return characters[Math.floor(Math.random() * characters.length)];
}
// 속성 랜덤 설정 함수
function getRandomPetType() {
  const petType = ['하늘', '땅', '바다'];
  return petType[Math.floor(Math.random() * petType.length)];
}
// 장비 랜덤 설정 함수
function getRandomGear(PetInfo, replier, Bag) {
  var isZG = Math.random() < 0;  // 불멸 0%  
  var isKG = Math.random() < 0; // 고대 0%  
  var isGG = Math.random() < 0;  // 신화 0%
  var isAG = Math.random() < 0;  // 유물 0%
  var isLG = Math.random() < 0;  //전설 0%
  var isUG = Math.random() < 0.01;  //유니크 확률 1%
  var isRG = Math.random() < 0.1;  //레어확률 10%
  let hasDropProtection = "펫 장비드랍방지권🛡" in Bag;
  let hadDropProtection = "불멸 강화석🪬" in Bag;
  let petgearRank = PetInfo.petgear.gearRank;
  if (petgearRank == '레어') {
    let isRankDrop = Math.random() < 0.1;    //10% 확률로 일반으로 랭크드랍
    if (isRankDrop) {
      replier.reply('똥손ㅠㅠ 장비등급다운😢');
      if (!hasDropProtection) {
        isRG = false;
      } else {
        isRG = true;        //90%확률로 레어 유지
        isUG = Math.random() < 0.05;        // 5%확률로 유니크 승급  
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isRG = true;      //90%확률로 레어 유지
      isUG = Math.random() < 0.05;      // 5%확률로 유니크 승급
    }
  } else if (petgearRank == '유니크') {
    let isRankDrop = Math.random() < 0.2;    //20%로 레어로 랭크드랍
    if (isRankDrop) {
      replier.reply('으아악ㅠㅠ 장비등급다운😭');
      if (!hasDropProtection) {
        isRG = true;
        isUG = false;
      } else {
        isUG = true;        //80%확률로 유니크 유지 
        isLG = Math.random() < 0.03;        // 3%확률로 전설 승급
        //   isAG = Math.random() < 0.005;        // 0.5% 확률로 유물 승급
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isUG = true;      //80%확률로 유니크 유지 
      isLG = Math.random() < 0.03;      // 3%확률로 전설 승급
      //  isAG = Math.random() < 0.003;      // 0.3% 확률로 유물 승급
      // isGG = Math.random() < 0.005;      // 0.5% 확률로 신화 승급
    }
  } else if (petgearRank == '전설') {
    let isRankDrop = Math.random() < 0.25;    //25%로 유니크로 랭크드랍
    if (isRankDrop) {
      replier.reply('허걱ㅠㅠ 장비등급다운😱');
      if (!hasDropProtection) {
        isUG = true;
        isLG = false;
      } else {
        isLG = true;        // 75%확률로 전설 유지
        isAG = Math.random() < 0.02;        // 2% 확률로 유물 승급
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isLG = true;      // 75%확률로 전설 유지
      isAG = Math.random() < 0.02;      // 2% 확률로 유물 승급
    }
  } else if (petgearRank == '유물') {
    let isRankDrop = Math.random() < 0.35;    //35%로 전설로 랭크드랍
    if (isRankDrop) {
      replier.reply('우아악ㅠㅠ 장비등급다운💀');
      if (!hasDropProtection) {
        isLG = true;
        isAG = false;
      } else {
        isAG = true;        // 65%확률로 유물 유지
        isGG = Math.random() < 0.007;        // 0.7% 확률로 신화 승급    
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isAG = true;      // 65%확률로 유물 유지
      isGG = Math.random() < 0.007;      // 0.7% 확률로 신화 승급  
    }
  } else if (petgearRank == '신화') {
    let isRankDrop = Math.random() < 0.45;    //45%로 유물로 랭크드랍
    if (isRankDrop) {
      replier.reply('💩ㅠㅠ 장비등급다운😇');
      if (!hasDropProtection) {
        isAG = true;
        isGG = false;
      } else {
        isGG = true;        // 55%확률로 신화 유지
        isKG = Math.random() < 0.005;        // 0.5% 확률로 고대 승급      
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isGG = true;      // 55%확률로 신화 유지
      isKG = Math.random() < 0.005;      // 0.3% 확률로 고대 승급      
    }
  } else if (petgearRank == '고대') {
    let isRankDrop = Math.random() < 0.50;    //50%로 신화로 랭크드랍
    if (isRankDrop) {
      replier.reply('💩ㅠㅠ 장비등급다운😇');
      if (!hasDropProtection) {
        isGG = true;
        isKG = false;
      } else {
        isKG = true;        // 50%확률로 고대 유지
        isZG = Math.random() < 0.003;        // 0.3% 확률로 불멸 승급      
        if (Bag["펫 장비드랍방지권🛡"] > 1) {
          Bag["펫 장비드랍방지권🛡"]--;
        } else {
          delete Bag["펫 장비드랍방지권🛡"];
        }
        replier.reply('[펫 장비드랍방지권🛡]을 소모합니다. 장비랭크 복구!!');
      }
    } else {
      isKG = true;      // 50%확률로 고대 유지
      isZG = Math.random() < 0.003;      // 0.3% 확률로 불멸 승급      
    }
  } else if (petgearRank == '불멸') {
    isZG = true;    // 100%확률로 불멸 유지
    if (!hadDropProtection) {
      replier.reply('불멸강화석🪬이 없습니다.');
    } else {
      if (Bag["불멸 강화석🪬"] > 1) {
        Bag["불멸 강화석🪬"]--;
      } else {
        delete Bag["불멸 강화석🪬"];
      }
      let isGearUp = Math.random() < 0.03;      //3%로 불멸 강화시도
      if (!isGearUp) {
        replier.reply('[불멸 강화석🪬]으로 강화를 시도합니다.\n강화 실패 뀨?');
      } else {
        // 펫 장비 강화수치를 MAX 100으로 제한
        if (PetInfo.petgear.gearUp < 100) {
          PetInfo.petgear.gearUp++;
        }
        replier.reply('[불멸 강화석🪬]으로 강화를 시도합니다.\n축하합니다!\n불멸🪬 강화 성공!!');
      }
    }
  }
  let gearUpmsg = '';
  if (PetInfo.petgear.gearUp) {
    // gearUpmsg 에 수치 문자열 MAX를 100으로 설정
    gearUpmsg = '(+' + Math.min(PetInfo.petgear.gearUp, 100) + ')';
  }
  const selectedGear = isZG ? {
    gearRank: '불멸',
    gearName: Zgears[Math.floor(Math.random() * Zgears.length)]
  } : (isKG ? {
    gearRank: '고대',
    gearName: Kgears[Math.floor(Math.random() * Kgears.length)]
  } : (isGG ? {
    gearRank: '신화',
    gearName: Ggears[Math.floor(Math.random() * Ggears.length)]
  } : (isAG ? {
    gearRank: '유물',
    gearName: Agears[Math.floor(Math.random() * Agears.length)]
  } : (isLG ? {
    gearRank: '전설',
    gearName: Lgears[Math.floor(Math.random() * Lgears.length)]
  } : (isUG ? {
    gearRank: '유니크',
    gearName: Ugears[Math.floor(Math.random() * Ugears.length)]
  } : (isRG ? {
    gearRank: '레어',
    gearName: Rgears[Math.floor(Math.random() * Rgears.length)]
  } : {
    gearRank: '일반',
    gearName: Ngears[Math.floor(Math.random() * Ngears.length)]
  }))))));
  if (isZG) {
    replier.reply('🪬불멸(不滅)\n없어지거나 사라지지 아니한다.\n영혼의 불멸을 믿는다.\n\n🔱' + selectedGear.gearRank + gearUpmsg + '🔱 등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isKG) {
    replier.reply('세상엔🌏 우리가 모르는\n오래된물건들이 존재합니다\n그것을 우린 고대에서 부터\n라고 말 하기 시작했습니다.\n\n🔱' + selectedGear.gearRank + '🔱등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isGG) {
    replier.reply('아무도 범접할 수 없습니다.\n이 무기 앞에선 모두가 무릎을 꿇을 것입니다🔆\n\n🪩' + selectedGear.gearRank + '🪩등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isAG) {
    replier.reply('무엇으로도 이것을 판단할 수 없습니다🌠\n\n🔮' + selectedGear.gearRank + '🔮등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isLG) {
    replier.reply('하늘에서 🪽장비상자🪽가\n빛이 비추며 내려옵니다...🌒\n세상에 이런 일이 놀랍습니다!!!\n\n🌟' + selectedGear.gearRank + '🌟등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isUG) {
    replier.reply('무언가 영롱하게 빛이 납니다🌟..!\n⚜장비상자⚜ 에서\n\n❤️‍🔥' + selectedGear.gearRank + '❤️‍🔥등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else if (isRG) {
    replier.reply('찰칵🔑.. 찰칵🔑.. 끼이익!!\n장비상자🧳에서\n\n✨️' + selectedGear.gearRank + '✨️등급 장비\n[' + selectedGear.gearName + '] 이(가)\n나왔습니다.🎉');
  } else {
    replier.reply('찰칵🗝.. 끼익..! \n장비상자🧳 에서\n[' + selectedGear.gearName + '] 이(가) 나왔습니다.');
  }
  return selectedGear;
}
// 이모지 업데이트 함수
function updateEmoji(pet, replier) {
  const typeIndex = petTypes2.findIndex(type => type.name === pet.pettype);
  if (typeIndex !== -1) {
    const isUnique = Math.random() < 0.1;
    const randomEmoji = isUnique ? getRandomEmojiFromType(petTypes3, pet.pettype) : getRandomEmojiFromType(petTypes2, pet.pettype);
    pet.petimg = randomEmoji;
    if (pet.petexp < 50) {
      replier.reply('펫이 탄생했습니다!');
    } else {
      replier.reply("수술 완료되었습니다.. 마음에 드셨으면 좋겠네요.");
    }
    if (isUnique && petTypes3.some(type => type.name === pet.pettype)) {
      if (pet.petexp < 50) {
        replier.reply('축하합니다!!\n🎉유니크 펫이 탄생했습니다🎉');
      } else {
        replier.reply("대성공!!! 🎉 이런 기적이...!");
      }
    }
  }
}

// 특정 종족에서 무작위 이모지 가져오기
function getRandomEmojiFromType(types, petType) {
  const typeIndex = types.findIndex(type => type.name === petType);
  if (typeIndex !== -1) {
    const emojis = types[typeIndex].emojis;
    return emojis[Math.floor(Math.random() * emojis.length)];
  }
  return null;
}

function difftypeBuff(r1user, r2user) {
  if (r1user.pettype == r2user.pettype) {
    return {
      buff1: 1,
      buff2: 1
    };
  } else if ((r1user.pettype == '하늘' && r2user.pettype == '땅') || (r1user.pettype == '땅' && r2user.pettype == '바다') || (r1user.pettype == '바다' && r2user.pettype == '하늘')) {
    return {
      buff1: 1.3,
      buff2: 1
    };
  } else {
    return {
      buff1: 1,
      buff2: 1.3
    };
  }
}
function petgameplay(newexp1, newexp2, replier) {
  var result1 = newexp1;
  var result2 = newexp2;
  while (result1 > 0 && result2 > 0) {
    var user1Roll = Math.floor(Math.random() * 10) + 1;
    var user2Roll = Math.floor(Math.random() * 10) + 1;
    result1 -= user2Roll;
    result2 -= user1Roll;

  }
  if (result1 <= 0 && result1 < result2) {
    return {
      winner: 2,
      remainExp1: "기절",
      remainExp2: result2
    };
  } else if (result2 <= 0 && result2 < newexp1) {
    return {
      winner: 1,
      remainExp1: result1,
      remainExp2: "기절"
    };
  } else {
    return petgameplay(newexp1, newexp2);
  }
}
function getDiceEmojix(number) {
  var diceEmojis = ["1️⃣ https://me2.do/54kDYTfg", "2️⃣ https://me2.do/FAQym3p9", "3️⃣ https://me2.do/FIYnIkBq", "4️⃣ https://me2.do/GRzC96vA", "5️⃣ https://me2.do/GBliMP0W", "6️⃣ https://me2.do/x3iBo1KF"];
  return diceEmojis[number - 1];
}

// 특정 채팅에 배팅 이동하는 함수
function moveBetToSelectedArray(arrayKey, sender, data) {
  // 모든 배열에서 해당 유저 정보 찾아서 이동
  for (let key in data.hoiland) {
    if (Array.isArray(data.hoiland[key])) {
      let existingEntry = data.hoiland[key].find(entry => entry.user === sender);
      if (existingEntry) {
        data.hoiland[key] = data.hoiland[key].filter(entry => entry.user !== sender);
        data.hoiland[arrayKey].push(existingEntry);
      }
    }
  }
}
// 펫 초기세팅 함수
function initializePet(sender, data) {
  // 현재 날짜 가져오기
  let currentDate = getCurrentDate();
  data.member[sender].pet = {
    petname: '',
    pettype: '',
    petimg: '',
    petjoin: currentDate,
    petexp: 0,
    petchar: '-',
    pettitle: '',
    petupgrade: 0,
    petgear: {
      gearRank: '일반',
      gearname: '-'
    },
    petraid: 0
  };
}
function calculateTotalHoilandAmount(data, sender) {
  let total = 0;
  for (let arrayKey in data.hoiland) {
    if (Array.isArray(data.hoiland[arrayKey])) {
      let existingEntry = data.hoiland[arrayKey].find(entry => entry.user === sender);
      if (existingEntry) {
        total += existingEntry.amount;
      }
    }
  }
  return total;
}
function isAllDigits(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (!(/^\d+$/.test(arr[i]))) {
      return false;
    }
  }
  return true;
}
function interval(time, func) {
  return setInterval(func, time);
}
function stopInterval(inte) {
  clearInterval(inte);
}
//n초마다 실행
function intervalWithSeconds(seconds, func) {
  return interval(1000 * seconds, func);
}
//n분마다 실행
function intervalWithMinutes(minute, func) {
  return intervalWithSeconds(60 * minute, func);
}
//n시간마다 실행
function intervalWithHours(hour, func) {
  return intervalWithMinutes(60 * hour, func);
}
function startInterval(data, replier, intervalMinutes) {
  const previousValTime = new Date().getTime();
  if (!data.previnterval) {
    data.previnterval = previousValTime;
  }
  let newInterval = intervalWithMinutes(intervalMinutes, function () {
    replier.reply('/다이스');
    diceinterval = true;
  });
  if (!data.intervalIDs) {
    data.intervalIDs = [];
  }
  data.intervalIDs.push(newInterval);
}
function stopAllIntervals(data) {
  if (Array.isArray(data.intervalIDs) && data.intervalIDs.length > 0) {
    for (let i = 0; i < data.intervalIDs.length; i++) {
      stopInterval(data.intervalIDs[i]);
    }
    data.intervalIDs = [];
  }
}
function getNextIntervalTime(data, intervalMinutes) {
  if (!data.previnterval) {
    return "🎲주사위 시간: 10AM ~ 12AM / 정각";
  } else {
    const nextIntervalStart = data.previnterval + (intervalMinutes * 60 * 1000);
    const timeDiff = nextIntervalStart - new Date().getTime();
    if (isNaN(timeDiff) || timeDiff <= 0) {
      return "🎲주사위 시간: 10AM ~ 12AM / 정각";
    }
    const remainingMinutes = Math.floor(timeDiff / (1000 * 60));
    const remainingSeconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
    return "🎲주사위 시간: " + remainingMinutes.toString().padStart(2, '0') + '분 ' + remainingSeconds.toString().padStart(2, '0') + '초 후';
  }
}
// 랭크 적용 함수
function applyRanksBasedOnTickets(data, replier) {
  let changedUsers = [];
  Object.keys(data.member).forEach((userName) => {
    let ticketCount = data.member[userName].bag['티어 승급티켓🎟'] || 0;
    let highticketCount = data.member[userName].bag['고급 티어 승급티켓🎫'] || 0;
    let rank = getRankByTicketCount(ticketCount, highticketCount, userName);  // userName을 전달
    let originalRank = data.member[userName].rank.tier;
    // 랭크 업데이트
    addUserToRank(data, rank, userName, replier);
    // 랭크 변경 확인
    if (originalRank !== data.member[userName].rank.tier) {
      changedUsers.push({
        userName: userName,
        originalRank: originalRank,
        newRank: data.member[userName].rank.tier
      });
    }
  });
  // 랭크 변경이 있을 경우에만 변경된 유저 목록 출력
  if (changedUsers.length > 0) {
    let resultMsg = '🔔 랭크 변경 확인 🔔\n';
    let rankupbonuspetexp = 0;
    changedUsers.forEach((user) => {
      resultMsg += user.userName + ' - 이전 랭크: ' + user.originalRank + ', 새로운 랭크: ' + user.newRank + '\n';
      if (user.newRank == "Bronze") {
        rankupbonuspetexp = 50;
      } else if (user.newRank == "Silver") {
        rankupbonuspetexp = 50;
      } else if (user.newRank == "Gold") {
        rankupbonuspetexp = 50;
      } else if (user.newRank == "Platinum") {
        rankupbonuspetexp = 50;
      } else if (user.newRank == "Emerald") {
        rankupbonuspetexp = 50;
      } else if (user.newRank == "Diamond") {
        rankupbonuspetexp = 100;
      } else if (user.newRank == "Master") {
        rankupbonuspetexp = 300;
      } else if (user.newRank == "GrandMaster") {
        rankupbonuspetexp = 900;
      } else if (user.newRank == "Challenger") {
        rankupbonuspetexp = 1500;
      } else if (user.newRank == "King") {
        rankupbonuspetexp = 3000;
      } else if (user.newRank == "Emperor") {
        rankupbonuspetexp = 10000;
      } else if (user.newRank == "Almighty") {
        rankupbonuspetexp = 15000;
      }
      data.member[user.userName].pet.petexp += parseInt(rankupbonuspetexp);
      replier.reply(user.userName + '님 티어 승급을 축하드립니다.\n랭크업 보너스 매력💕을 획득합니다!\n펫매력💕 +' + rankupbonuspetexp);
      rankupbonuspetexp = 0;



    });
  }
}
function getRankByTicketCount(ticketCount, highticketCount, user) {
  // user를 매개변수로 추가
  // 함수 내용은 그대로 유지
}
//  티켓 수량에 따른 랭크 결정 함수
function getRankByTicketCount(ticketCount, highticketCount, user) {
  if (ticketCount >= 15000 && highticketCount >= 1000) {
    return 12;
  } else if (ticketCount >= 10000 && highticketCount >= 200) {
    return 11;
  } else if (ticketCount >= 6000 && highticketCount >= 50) {
    return 1;
  } else if (ticketCount >= 2500) {
    return 2;
  } else if (ticketCount >= 1200) {
    return 3;
  } else if (ticketCount >= 700) {
    return 4;
  } else if (ticketCount >= 300) {
    return 5;
  } else if (ticketCount >= 150) {
    return 6;
  } else if (ticketCount >= 70) {
    return 7;
  } else if (ticketCount >= 30) {
    return 8;
  } else if (ticketCount >= 10) {
    return 9;
  } else if (ticketCount >= 1) {
    return 10;
  } else {
    return 0;
  }
}
function sellAuctionItem(data, itemIndex, replier) {
  let auctionItem = data.auction[itemIndex];
  if (auctionItem) {
    if (auctionItem.highestBidder !== '') {
      let highestBidder = auctionItem.highestBidder;
      let auctionedItem = auctionItem.biditemName;
      // Check if the auctioned item starts with '[타이틀]'
      if (auctionedItem.startsWith('[타이틀]')) {
        let titleWithoutPrefix = auctionedItem.substring('[타이틀]'.length);
        if (!data.member[highestBidder].title || !data.member[highestBidder].title.list) {
          data.member[highestBidder].title = {
            list: []
          };
        }
        data.member[highestBidder].title.list.push(titleWithoutPrefix);
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem.startsWith('[펫외형]')) {
        let petimgWithoutPrefix = auctionedItem.substring('[펫외형]'.length);
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petimg = petimgWithoutPrefix;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem.startsWith('[펫성격]')) {
        let petcharWithoutPrefix = auctionedItem.substring('[펫성격]'.length);
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.pettitle = petcharWithoutPrefix;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room4, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '펫 속성리롤🔄') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.pettype = petTypes1[Math.floor(Math.random() * petTypes1.length)].name;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room4, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]성격리롤🔄') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.pettitle = getRandomCharacter();
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]✨특성리롤🔄') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petchar = getRandomSpecialCharacter();
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]초급 매력포션💕+1') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petexp++;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]중급 매력포션💕+3') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petexp += 3;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]고급 매력포션💕+7') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petexp += 7;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == '[펫]최고급 매력포션💕+15') {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petexp += 15;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.');
      } else if (auctionedItem == ('경험치 2배 부스터(소)')) {
        data.member[highestBidder].boostercnt += 1000;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 1000회 추가.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 1000회 추가.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 1000회 추가.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 1000회 추가.');
      } else if (auctionedItem == ('경험치 2배 부스터(중)')) {
        data.member[highestBidder].boostercnt += 2500;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 2500회 추가.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 2500회 추가.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 2500회 추가.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 2500회 추가.');
      } else if (auctionedItem == ('경험치 2배 부스터(대)')) {
        data.member[highestBidder].boostercnt += 5000;
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 5000회 추가.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 5000회 추가.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 5000회 추가.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 님이\n[' + auctionedItem + '] 을(를)\n낙찰받았습니다.\n경험치부스터 5000회 추가.');
      } else if (auctionedItem == ('[펫장비]유니크 확정권')) {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petgear.gearRank = '유니크';
        data.member[highestBidder].pet.petgear.gearName = Ugears[Math.floor(Math.random() * Ugears.length)];
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else if (auctionedItem == ('[펫장비]전설 확정권')) {
        if (!data.member[highestBidder].pet.petname) {
          replier.reply("펫생성 먼저 하세요.");
          return;
        }
        data.member[highestBidder].pet.petgear.gearRank = '전설';
        data.member[highestBidder].pet.petgear.gearName = Lgears[Math.floor(Math.random() * Lgears.length)];
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
      } else {
        Api.replyRoom(room1, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room2, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room3, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        Api.replyRoom(room5, '[' + checkRank(data, highestBidder) + '] 이 [' + auctionedItem + '] 을(를) 낙찰받았습니다.');
        if (!data.member[highestBidder].bag) {
          data.member[highestBidder].bag = {};
        }
        if (data.member[highestBidder].bag[auctionedItem]) {
          data.member[highestBidder].bag[auctionedItem]++;
        } else {
          data.member[highestBidder].bag[auctionedItem] = 1;
        }
      }
    } else {
      replier.reply('[' + auctionItem.biditemName + ']의 입찰자가 없어 사라집니다.');
      Api.replyRoom(room1, '[' + auctionItem.biditemName + ']의 입찰자가 없어 사라집니다.');
      Api.replyRoom(room2, '[' + auctionItem.biditemName + ']의 입찰자가 없어 사라집니다.');
      Api.replyRoom(room3, '[' + auctionItem.biditemName + ']의 입찰자가 없어 사라집니다.');
      Api.replyRoom(room5, '[' + auctionItem.biditemName + ']의 입찰자가 없어 사라집니다.');
    }
  } else {
    replier.reply('경매 아이템이 유효하지 않습니다.');
  }
}
function stopAuctionTimeouts(data, replier) {
  if (data.auction) {
    // 역순으로 순회
    for (let index = data.auction.length - 1; index >= 0; index--) {
      const item = data.auction[index];
      clearTimeout(item.timeoutID);
      sellAuctionItem(data, index, replier);
    }
    delete data.auction;
  }
}
function formatRemainingTime(hours, minutes, seconds) {
  const formattedHours = ('0' + hours).slice(-2);
  const formattedMinutes = ('0' + minutes).slice(-2);
  const formattedSeconds = ('0' + seconds).slice(-2);
  return formattedHours + ':' + formattedMinutes + ':' + formattedSeconds;
}
function isItemAlreadyRegistered(data, biditemName) {
  if (data.auction) {
    for (let i = 0; i < data.auction.length; i++) {
      if (data.auction[i].biditemName === biditemName) {
        return true;
      }
    }
  }
  return false;
}

// 사용자의 가방에 보상 추가하는 함수
function addRewards(data, sender, rewardType, quantity) {
  if (data.member[sender].bag[rewardType]) {
    data.member[sender].bag[rewardType] += quantity;
  } else {
    data.member[sender].bag[rewardType] = quantity;
  }
}
// 특수 성격 랜덤 설정 함수
function getRandomSpecialCharacter() {
  const specialcharacters = ["주인을 동정하는✨️", "배팅중독✨", "퀴즈를 사랑하는✨", "베테랑헌터✨", "습득력이 좋은✨", "쇼핑광✨", "호전적인✨"];
  return specialcharacters[Math.floor(Math.random() * specialcharacters.length)];
}
/**
 * 펫의 강화 레벨에 따른 치명타 확률 계산 함수
 * @param {number} upgradeLevel - 펫의 현재 강화 레벨
 * @returns {string} - 계산된 치명타 확률 (소수점 형태, % 기호 제외)
 */
function getCritChance(upgradeLevel) {
  const critChance = BASE_CRIT_CHANCE + (upgradeLevel * CRIT_CHANCE_PER_UPGRADE);
  return (critChance * 100).toFixed(2);
}

/**
 * 펫의 강화 레벨에 따른 치명타 확률 계산 함수
 * @param {number} upgradeLevel - 펫의 현재 강화 레벨
 * @returns {string} - 계산된 치명타 확률 (소수점 형태, % 기호 제외)
 */
function calculateCritChance(upgradeLevel) {
  return BASE_CRIT_CHANCE + (upgradeLevel * CRIT_CHANCE_PER_UPGRADE);
}

/**
* 크리티컬 데미지 계산 함수
* @param {object} userObj - 유저 정보
* @param {number} damage - 기본 데미지
* @returns {number} - 크리티컬이 적용된 최종 데미지
*/
function calculateCriticalDamage(userObj, damage) {
  let upgradeLevel = (userObj && userObj.pet && userObj.pet.upgrade) || 0; // 펫 강화 레벨, 기본값 0
  let critChance = calculateCritChance(upgradeLevel); // 치명타 확률 계산
  let isCritical = Math.random() < critChance; // 크리티컬 여부 결정

  if (isCritical) {
    return Math.round(damage * BASE_CRIT_DAMAGE_MULTIPLIER); // 크리티컬 데미지 적용
  }
  return damage; // 크리티컬이 아닐 경우 원래 데미지 반환
}

/**
* 크리티컬 데미지 계산 함수
* @param {object} pet - 펫 정보
* @param {number} damage - 기본 데미지
* @returns {number} - 크리티컬이 적용된 최종 데미지
*/
function calculateCriticalDamageWithPet(pet, damage) {
  let upgradeLevel = (pet && pet.upgrade) || 0; // 펫 강화 레벨, 기본값 0
  let critChance = calculateCritChance(upgradeLevel); // 치명타 확률 계산
  let isCritical = Math.random() < critChance; // 크리티컬 여부 결정

  if (isCritical) {
    return Math.round(damage * BASE_CRIT_DAMAGE_MULTIPLIER); // 크리티컬 데미지 적용
  }
  return damage; // 크리티컬이 아닐 경우 원래 데미지 반환
}
/**
* 모든 방 공지 함수
* @param {String} msg - 공지 메시지
*/
function noticeMsg(msg) {
  if (isDebuggerFlag) {
    Api.replyRoom(room4, msg);
  } else {
    Api.replyRoom(room1, msg);
    Api.replyRoom(room2, msg);
    Api.replyRoom(room3, msg);
    Api.replyRoom(room5, msg);
  }
}
/**
* 모든 방 공지 함수
* @param {String} msg - 공지 메시지
* @return {String} reply - 디버깅 상태
*/
function debuggerToggle() {
  if (isDebuggerFlag) {
    isDebuggerFlag = false;
  } else {
    isDebuggerFlag = true;
  }
  return isDebuggerFlag;
}




/**
 * 세율을 적용하고 성주에게 포인트를 추가하는 함수
 * @param {number} point - 세율이 적용될 포인트
 * @returns {number} - 세금이 적용된 후의 포인트
 */
function applyTax(point, data) {

  // 세율과 성주 정보가 있는지 확인
  if (data.HoiCastle && data.HoiCastle.taxRate && data.HoiCastle.lord) {
    let taxRate = data.HoiCastle.taxRate; // 세율
    let lord = data.HoiCastle.lord; // 성주 

    // 세금 계산
    let taxAmount = Math.round(point * (taxRate / 100));
    let taxedPoint = point + taxAmount;

    // 성주에게 포인트 추가 (세금의 절반만)
    // data.member[lord].point += Math.round(taxAmount / 2);
    // data.HoiCastle.earnings += Math.round(taxAmount / 2);
    // 세금이 적용된 금액을 반환
    return taxedPoint;
  } else {
    return point;
  }
}

function debuggerLog(msg) {
  if (isDebuggerFlag && msg) {
    Api.replyRoom(room4, JSON.stringify(msg))
  }
};

// 상자 오픈과 관련된 아이템들을 사용자의 가방에 추가하는 함수
function addItemToBag(bag, item, quantity) {
  if (bag[item]) {
    bag[item] += quantity;
  } else {
    bag[item] = quantity;
  }
}

// 상자를 사용하는 함수
function openBox(data, memberName, boxType) {
  if (data.member[memberName].bag[boxType] > 0) {
    data.member[memberName].bag[boxType] -= 1; // 상자 하나를 사용합니다
    if (data.member[memberName].bag[boxType] === 0) {
      delete data.member[memberName].bag[boxType]; // 상자가 0개면 삭제
    }

    // 각 상자에 따라 아이템을 추가
    if (boxType === '캐슬벨라상자🦄(/벨라오픈)') {
      addItemToBag(data.member[memberName].bag, '캐슬벨라유닛🦄(+250💕)', 1);
      addItemToBag(data.member[memberName].bag, '캐슬뽑기권♟', 30);
      addItemToBag(data.member[memberName].bag, '캐슬상자🏰', 20);
      addItemToBag(data.member[memberName].bag, '슬롯코인🪙', 100);
    }

    return true; // 상자가 성공적으로 열렸음
  }
  return false; // 가방에 상자가 없음
}

// 가방에 편지가 있는지 확인하는 함수 추가
function hasLetterInBag(data, memberName) {
  return data.member[memberName] && data.member[memberName].bag && data.member[memberName].bag['우표💌'];
}

// 우표를 사용하고 가방에서 하나 줄이거나 삭제하는 함수 추가
function useLetterInBag(data, memberName) {
  if (hasLetterInBag(data, memberName)) {
    let currentCount = data.member[memberName].bag['우표💌'];
    if (currentCount > 1) {
      data.member[memberName].bag['우표💌'] -= 1;
    } else {
      delete data.member[memberName].bag['우표💌'];
    }
    return true;
  }
  return false;
}

function processUserIDCommand(msg, data) {
  let returnMsg = null;
  // 명령어에 따라 사용되는 데이터 배열과 정규 표현식을 설정
  let dataArr, pattern;
  if (msg.startsWith("/장비혼레")) {
    dataArr = data.allowedUsers2;
    pattern = /^\/장비혼레(추가|삭제),\s*(.+)$/;
  } else if (msg.startsWith("/슬롯패키지")) {
    dataArr = data.allowedUsers4;
    pattern = /^\/슬롯패키지(추가|삭제),\s*(.+)$/;
  } else if (msg.startsWith("/펫패키지")) { // 추가된 부분
    dataArr = data.allowedUsers6;
    pattern = /^\/펫패키지(추가|삭제),\s*(.+)$/;
  } else if (msg.startsWith("/호이패스")) {
    dataArr = data.allowedUsersHoipass;
    pattern = /^\/호이패스(추가|삭제),\s*(.+)$/;
  } else {
    returnMsg = "알 수 없는 명령어입니다.";
    return;
  }
  const match = msg.match(pattern);
  if (!match) {
    returnMsg = "명령어 형식이 잘못되었습니다. 올바른 형식: " + msg.split(',')[0] + " 추가 또는 삭제, 아이디 (예: 호이 남)";
    return;
  }
  const actionType = match[1]; // 추가 또는 삭제
  const userID = match[2].trim();
  if (actionType === "추가") {
    if (!dataArr.includes(userID)) {
      dataArr.push(userID);
      returnMsg = userID + " 사용자가 목록에 추가되었습니다.";
    } else {
      returnMsg = userID + "는 이미 목록에 있습니다.";
    }
  } else if (actionType === "삭제") {
    const index = dataArr.indexOf(userID);
    if (index > -1) {
      dataArr.splice(index, 1);
      returnMsg = userID + " 사용자가 목록에서 삭제되었습니다.";
    } else {
      returnMsg = userID + " 사용자를 찾을 수 없습니다.";
    }
  }
  return returnMsg;
}
//////////////////////////////////////////////////////////////////////
// 이 아래는 info.js와 같은 함수를 사용하므로 수정 시 싱크맞춰야합니다.//
//////////////////////////////////////////////////////////////////////
function loadJsonFile(path) {
  try {
    let file = new java.io.File(path);
    if (file.exists()) {
      let fileContent = FileStream.read(path, "utf-8");      // 명시적으로 UTF-8 인코딩 사용
      return JSON.parse(fileContent);
    }
  } catch (error) {
    // const randomNumber = Math.floor(Math.random() * 90 + 10);
    // save("호이랜드/로그", "Log_Load_" + randomNumber + ".txt", "Error while saving JSON file: " + error.message);
    // replier.reply(error.message);
  }
}
function save(folderName, fileName, str) {
  var c = new java.io.File(sdcard + "/" + folderName + "/" + fileName);
  var d = new java.io.FileOutputStream(c);
  var e = new java.lang.String(str);
  d.write(e.getBytes());
  d.close();
}
function getDiceEmoji(number) {
  var diceEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return diceEmojis[number - 1];
}

function formatDate2(dateString) {
  if (!dateString) {
    return '-';
  } else {
    let month = dateString.substr(4, 2);
    let day = dateString.substr(6, 2);
    return month + '월 ' + day + '일';
  }
}
// 숫자 3자리마다 쉼표 추가 함수
function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 현재 날짜 문자열 반환 함수
function getCurrentDate() {
  let now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  // 월과 일이 한 자리 숫자인 경우 앞에 0을 붙여 두 자리로 만듭니다.
  month = month < 10 ? '0' + month : month;
  day = day < 10 ? '0' + day : day;
  return year + '' + month + '' + day;
}

function checkFee(data, user) {
  var LowFeeR = 0;
  var HighFeeR = 0;
  var FeeInfo = "";
  if (data.member[user].rank.tier == "Challenger") {
    LowFeeR = 1;
    HighFeeR = 1.15;
    FeeInfo = "(🏆수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "GrandMaster") {
    LowFeeR = 1;
    HighFeeR = 1.1;
    FeeInfo = "(⚜️수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Master") {
    LowFeeR = 1;
    HighFeeR = 1.05;
    FeeInfo = "(🔮수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Diamond") {
    LowFeeR = 1;
    HighFeeR = 1.01;
    FeeInfo = "(💎수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Emerald") {
    LowFeeR = 1;
    HighFeeR = 0.97;
    FeeInfo = "(💠수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Platinum") {
    LowFeeR = 0.95;
    HighFeeR = 0.95;
    FeeInfo = "(🔰수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Gold") {
    LowFeeR = 0.95;
    HighFeeR = 0.88;
    FeeInfo = "(🥇수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Silver") {
    LowFeeR = 0.95;
    HighFeeR = 0.82;
    FeeInfo = "(🥈수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Bronze") {
    LowFeeR = 0.95;
    HighFeeR = 0.75;
    FeeInfo = "(🥉수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "King") {
    LowFeeR = 1;
    HighFeeR = 1.2;
    FeeInfo = "(👑수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Emperor") {
    LowFeeR = 1;
    HighFeeR = 1.35;
    FeeInfo = "(🪽수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "Almighty") {
    LowFeeR = 1;
    HighFeeR = 1.5;
    FeeInfo = "(🪬수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  } else if (data.member[user].rank.tier == "UnRanked") {
    LowFeeR = 0.95;
    HighFeeR = 0.7;
    FeeInfo = "(수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";
  }
  return {
    FeeInfo: FeeInfo,
    LowFeeR: LowFeeR,
    HighFeeR: HighFeeR
  };
}
// 순위에 따른 이모지 반환 함수
function getRankEmoji(rank) {
  switch (rank) {
    case 1:
      return '🥇. ';
    case 2:
      return '🥈. ';
    case 3:
      return '🥉. ';
    default:
      return addsingle(rank) + '. ';
  }
}




// 숫자가 1자리 수면 앞에 띄어쓰기를 추가하는 함수
function addsingle(number) {
  return number < 10 ? '  ' + number : ' ' + number;
}
function checkRank(data, user) {
  let userwithrank = user;
  if (data.member[user]) {
    if (user == data.HoiCastle.lord) {
      userwithrank = '🏰' + userwithrank;
    } else if (user == data.star) {
      userwithrank = '💞' + userwithrank;
    } else if (user == data.toplv) {
      userwithrank = '🌟' + userwithrank;
    } else if (user == data.mc) {
      userwithrank = '💬' + userwithrank;
    } else if (user == data.topgame) {
      userwithrank = '🍭' + userwithrank;
    } else {
      userwithrank = data.member[user].rank.emoji + userwithrank;
    }
    if (user == data.petbattlewinner) {
      userwithrank += ('_' + data.member[user].pet.petimg);
    }
    return userwithrank;
  } else
    return userwithrank;
}
/**
 * 펫의 강화 레벨에 따른 치명타 확률 계산 함수
 * @param {number} upgradeLevel - 펫의 현재 강화 레벨
 * @returns {string} - 계산된 치명타 확률 (소수점 형태, % 기호 제외)
 */
function getCritChance(upgradeLevel) {
  const critChance = BASE_CRIT_CHANCE + (upgradeLevel * CRIT_CHANCE_PER_UPGRADE);
  return (critChance * 100).toFixed(2);
}

/**
 * 가방의 아이템 목록을 정렬하고 출력 형식으로 변환하는 함수
 * @param {Object} bagItems - 가방에 있는 아이템 객체
 * @returns {Object} - 정렬된 아이템 목록과 출력 문자열
 */
function generateBagOutput(bagItems) {
  let bagOutput = '';
  let sortedItemList = [];
  if (bagItems && Object.keys(bagItems).length > 0) {
    bagOutput = '​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​(팁)호이랜드 배팅승리를 하면 매력💕 1증가!\n';

    // 우선 처리할 특수 아이템 목록
    const specialItems = ['티어 승급티켓🎟', '고급 티어 승급티켓🎫', '혼자레이드리셋권😝', '펫 장비드랍방지권🛡', '펫 강화석⭐', '불멸 강화석🪬', '슬롯상자🧳', '슬롯코인🪙', '하트💝', '후원 지원금👌', '자동배팅권(🅟50만)😣🤖🐔', '잡템☠️', '잡템상자☠', '방패조각🛡', '방패상자⚔', '양념치킨🐔', '치킨상자🐔', '금괴💰', '금괴상자💰', '랜덤박스💝', '극락상자👹', '나락상자👹', '선물상자🎁', '미니상자🎁', '우표💌', '레이드타격대인장👑(+600👾)', '레이드공격대인장🥇(+500👾)', '항생제💊', '도깨비가면👹', '트롤심장💓', '에프킬라💦', '하리보🪼', '곰팡이🍄', '마늘🧄', '거울🪞', '캐슬대전리셋권🐶', '캐슬코인🥇', '캐슬공격권⚔', '캐슬상자🏰', '캐슬뽑기권♟', '캐슬기습공격권🔥(10%)', '캐슬기습공격권🔥(20%)', '캐슬기습공격권🔥(40%)', '캐슬절대방어권🛡(5%)', '캐슬절대방어권🛡(25%)', '캐슬절대방어권🛡(50%)'];
    // 가방에서 특수 아이템만 필터링
    let specialItemsSorted = specialItems.filter(item => bagItems[item]);
    // 나머지 아이템 필터링
    let otherItems = Object.keys(bagItems).filter(item => !specialItems.includes(item));

    // 한글과 영어 아이템으로 구분하여 정렬
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    let koreanItems = otherItems.filter(item => koreanRegex.test(item)).sort();
    let englishItems = otherItems.filter(item => !koreanRegex.test(item)).sort();

    let index = 0;

    // 특수 아이템을 먼저 추가
    specialItemsSorted.forEach((item) => {
      bagOutput += '   ' + (++index) + '. ' + item + ' x ' + bagItems[item] + '\n';
      sortedItemList.push(item);
    });

    // 한글 아이템 추가
    koreanItems.forEach((item) => {
      bagOutput += '   ' + (++index) + '. ' + item + ' x ' + bagItems[item] + '\n';
      sortedItemList.push(item);
    });

    // 영어 아이템 추가
    englishItems.forEach((item) => {
      bagOutput += '   ' + (++index) + '. ' + item + ' x ' + bagItems[item] + '\n';
      sortedItemList.push(item);
    });

    // 마지막에 추가된 줄바꿈 제거
    bagOutput = bagOutput.trim();
  }
  return {
    bagOutput: bagOutput
    , sortedItemList: sortedItemList
  };
}


/**
* 장비공격 아이템 계산 함수
노말 0 💕
레어 100 💕
유니크 250 💕
전설 500 💕
유물 800 💕
신화 1200 💕
고대 1600 💕(레이드+2000) 
불멸 2000 💕(레이드+4500) 
집행관 3500💕(레이드+12000) 
* @param {String} member - 회원
* @return {String} exp - 장비 아이템 매력 합산치
*/
function calculateGearItem(memberName, data) {
  let pet = data.member[memberName].pet;// 펫
  let gearRank = pet.petgear.gearRank; // 등급

  var battleExp = 0; // 펫대전 매력치
  var raidExp = 0; // 레이드 매력치
  let msg = '';// 반환할 메시지

  //레이드공격대인장
  for (let key in raidSpecialItem.dept2) {
    let item = raidSpecialItem.dept2[key];
    if (data.member[memberName].bag[item.name]) {
      let count = data.member[memberName].bag[item.name];
      raidExp += count * item.exp;
    }
  }

  // 펫장비
  if (gearRank === '불멸' || gearRank === '집행관') {
    msg = '[' + (gearRank === '불멸' ? '🪬' : (gearRank === '집행관' ? '👑' : '')) + ']';
    if (gearRank === '불멸') {
      battleExp += 2000;
      raidExp += 5500;
    } else if (gearRank === '집행관') {
      battleExp += 3500;                    // '집행관' 랭크의 추가 힘
      raidExp += 20000;
    }
    if (pet.petgear.gearUp) {
      raidExp += parseInt(pet.petgear.gearUp) * 50;
      msg += '(' + pet.petgear.gearUp + ')';
    }

  } else if (gearRank == '고대') {
    // todo msg추가
    msg = '[⚜️]';
    battleExp += 1600;
    raidExp += 4000;
  } else if (gearRank == '신화') {
    msg = '[🔆]';
    battleExp += 1200;
    raidExp += 3000;
  } else if (gearRank == '유물') {
    msg = '[🔮]';
    battleExp += 800;
    raidExp += 2000;
  } else if (gearRank == '전설') {
    msg = '[🌟]';
    battleExp += 500;
    raidExp += 1000;
  } else if (gearRank == '유니크') {
    msg = '[❤️‍🔥]';
    battleExp += 250;
    raidExp += 500;
  } else if (gearRank == '레어') {
    msg = '[✨️]';
    battleExp += 100;
    raidExp += 300;
  } else if (gearRank == '이벤트') {
    msg = '[🌳]';
    battleExp += 5000;
    raidExp += 50000;
  }

  return { battleExp: battleExp, msg: msg, raidExp: raidExp }
}

/** info.js와동일
* 캐슬공격 아이템 계산 함수
* @param {String} member - 회원
* @return {String} exp - 캐슬공격 아이템 매력 합산치
*/
function calculateCastleItem(memberName, data) {

  let returnExp = 0; // 반환할 매력
  let bag = data.member[memberName].bag; // 회원가방

  if (bag[castleItem.item_1.name]) {
    returnExp += bag[castleItem.item_1.name] * castleItem.item_1.exp;
  }
  if (bag[castleItem.item_2.name]) {
    returnExp += bag[castleItem.item_2.name] * castleItem.item_2.exp;
  }
  if (bag[castleItem.item_3.name]) {
    returnExp += bag[castleItem.item_3.name] * castleItem.item_3.exp;
  }
  if (bag[castleItem.item_4.name]) {
    returnExp += bag[castleItem.item_4.name] * castleItem.item_4.exp;
  }
  if (bag[castleItem.item_5.name]) {
    returnExp += bag[castleItem.item_5.name] * castleItem.item_5.exp;
  }
  if (bag[castleItem.item_6.name]) {
    returnExp += bag[castleItem.item_6.name] * castleItem.item_6.exp;
  }
  if (bag[castleItem.item_7.name]) {
    returnExp += bag[castleItem.item_7.name] * castleItem.item_7.exp;
  }
  if (bag[castleItem.item_8.name]) {
    returnExp += bag[castleItem.item_8.name] * castleItem.item_8.exp;
  }
  if (bag[castleItem.item_9.name]) {
    returnExp += bag[castleItem.item_9.name] * castleItem.item_9.exp;
  }
  if (bag[castleItem.item_10.name]) {
    returnExp += bag[castleItem.item_10.name] * castleItem.item_10.exp;
  }
  if (bag[castleItem.item_11.name]) {
    returnExp += bag[castleItem.item_11.name] * castleItem.item_11.exp;
  }
  if (bag[castleItem.item_12.name]) {
    returnExp += bag[castleItem.item_12.name] * castleItem.item_12.exp;
  }
  if (bag[castleItem.item_13.name]) {
    returnExp += bag[castleItem.item_13.name] * castleItem.item_13.exp;
  }
  if (bag[castleItem.item_14.name]) {
    returnExp += bag[castleItem.item_14.name] * castleItem.item_14.exp;
  }
  if (bag[castleItem.item_15.name]) {
    returnExp += bag[castleItem.item_15.name] * castleItem.item_15.exp;
  }
  if (bag[castleItem.item_16.name]) {
    returnExp += bag[castleItem.item_16.name] * castleItem.item_16.exp;
  }
  if (bag[castleItem.item_17.name]) {
    returnExp += bag[castleItem.item_17.name] * castleItem.item_17.exp;
  }
  if (bag[castleItem.item_18.name]) {
    returnExp += bag[castleItem.item_18.name] * castleItem.item_18.exp;
  }
  if (bag[castleItem.item_19.name]) {
    returnExp += bag[castleItem.item_19.name] * castleItem.item_19.exp;
  }
  if (bag[castleItem.item_20.name]) {
    returnExp += bag[castleItem.item_20.name] * castleItem.item_20.exp;
  }
  if (bag[castleItem.item_21.name]) {
    returnExp += bag[castleItem.item_21.name] * castleItem.item_21.exp;
  }
  if (bag[castleItem.item_22.name]) {
    returnExp += bag[castleItem.item_22.name] * castleItem.item_22.exp;
  }
  if (bag[castleItem.item_23.name]) {
    returnExp += bag[castleItem.item_23.name] * castleItem.item_23.exp;
  }
  if (bag[castleItem.item_24.name]) {
    returnExp += bag[castleItem.item_24.name] * castleItem.item_24.exp;
  }
  if (bag[castleItem.item_25.name]) {
    returnExp += bag[castleItem.item_25.name] * castleItem.item_25.exp;
  }
  if (bag[castleItem.item_26.name]) {
    returnExp += bag[castleItem.item_26.name] * castleItem.item_26.exp;
  }
  if (bag[castleItem.item_27.name]) {
    returnExp += bag[castleItem.item_27.name] * castleItem.item_27.exp;
  }
  if (bag[castleItem.item_28.name]) {
    returnExp += bag[castleItem.item_28.name] * castleItem.item_28.exp;
  }
  if (bag[castleItem.item_29.name]) {
    returnExp += bag[castleItem.item_29.name] * castleItem.item_29.exp;
  }
  if (bag[castleItem.item_30.name]) {
    returnExp += bag[castleItem.item_30.name] * castleItem.item_30.exp;
  }
  if (bag[castleItem.item_31.name]) {
    returnExp += bag[castleItem.item_31.name] * castleItem.item_31.exp;
  }
  if (bag[castleItem.item_32.name]) {
    returnExp += bag[castleItem.item_32.name] * castleItem.item_32.exp;
  }
  if (bag[castleItem.item_33.name]) {
    returnExp += bag[castleItem.item_33.name] * castleItem.item_33.exp;
  }
  if (bag[castleItem.item_34.name]) {
    returnExp += bag[castleItem.item_34.name] * castleItem.item_34.exp;
  }
  if (bag[castleItem.item_35.name]) {
    returnExp += bag[castleItem.item_35.name] * castleItem.item_35.exp;
  }
  if (bag[castleItem.item_36.name]) {
    returnExp += bag[castleItem.item_36.name] * castleItem.item_36.exp;
  }
  if (bag[castleItem.item_37.name]) {
    returnExp += bag[castleItem.item_37.name] * castleItem.item_37.exp;
  }
  if (bag[castleItem.item_38.name]) {
    returnExp += bag[castleItem.item_38.name] * castleItem.item_38.exp;
  }
  if (bag[castleItem.item_39.name]) {
    returnExp += bag[castleItem.item_39.name] * castleItem.item_39.exp;
  }
  if (bag[castleItem.item_40.name]) {
    returnExp += bag[castleItem.item_40.name] * castleItem.item_40.exp;
  }
  if (bag[castleItem.item_41.name]) {
    returnExp += bag[castleItem.item_41.name] * castleItem.item_41.exp;
  }
  if (bag[castleItem.item_42.name]) {
    returnExp += bag[castleItem.item_42.name] * castleItem.item_42.exp;
  }
  if (bag[castleItem.item_43.name]) {
    returnExp += bag[castleItem.item_43.name] * castleItem.item_43.exp;
  }
  if (bag[castleItem.item_44.name]) {
    returnExp += bag[castleItem.item_44.name] * castleItem.item_44.exp;
  }
  if (bag[castleItem.item_45.name]) {
    returnExp += bag[castleItem.item_45.name] * castleItem.item_45.exp;
  }
  if (bag[castleItem.item_46.name]) {
    returnExp += bag[castleItem.item_46.name] * castleItem.item_46.exp;
  }
  if (bag[castleItem.item_47.name]) {
    returnExp += bag[castleItem.item_47.name] * castleItem.item_47.exp;
  }
  if (bag[castleItem.item_48.name]) {
    returnExp += bag[castleItem.item_48.name] * castleItem.item_48.exp;
  }
  if (bag[castleItem.item_49.name]) {
    returnExp += bag[castleItem.item_49.name] * castleItem.item_49.exp;
  }
  if (bag[castleItem.item_50.name]) {
    returnExp += bag[castleItem.item_50.name] * castleItem.item_50.exp;
  }
  if (bag[castleItem.item_51.name]) {
    returnExp += bag[castleItem.item_51.name] * castleItem.item_51.exp;
  }
  if (bag[castleItem.item_52.name]) {
    returnExp += bag[castleItem.item_52.name] * castleItem.item_52.exp;
  }
  if (bag[castleItem.item_53.name]) {
    returnExp += bag[castleItem.item_53.name] * castleItem.item_53.exp;
  }
  if (bag[castleItem.item_54.name]) {
    returnExp += bag[castleItem.item_54.name] * castleItem.item_54.exp;
  }
  if (bag[castleItem.item_55.name]) {
    returnExp += bag[castleItem.item_55.name] * castleItem.item_55.exp;
  }
  if (bag[castleItem.item_56.name]) {
    returnExp += bag[castleItem.item_56.name] * castleItem.item_56.exp;
  }
  if (bag[castleItem.item_57.name]) {
    returnExp += bag[castleItem.item_57.name] * castleItem.item_57.exp;
  }
  if (bag[castleItem.item_58.name]) {
    returnExp += bag[castleItem.item_58.name] * castleItem.item_58.exp;
  }
  if (bag[castleItem.item_59.name]) {
    returnExp += bag[castleItem.item_59.name] * castleItem.item_59.exp;
  }
  if (bag[castleItem.item_60.name]) {
    returnExp += bag[castleItem.item_60.name] * castleItem.item_60.exp;
  }
  if (bag[castleItem.item_61.name]) {
    returnExp += bag[castleItem.item_61.name] * castleItem.item_61.exp;
  }
  if (bag[castleItem.item_62.name]) {
    returnExp += bag[castleItem.item_62.name] * castleItem.item_62.exp;
  }
  if (bag[castleItem.item_63.name]) {
    returnExp += bag[castleItem.item_63.name] * castleItem.item_63.exp;
  }
  if (bag[castleItem.item_64.name]) {
    returnExp += bag[castleItem.item_64.name] * castleItem.item_64.exp;
  }
  if (bag[castleItem.item_65.name]) {
    returnExp += bag[castleItem.item_65.name] * castleItem.item_65.exp;
  }
  if (bag[castleItem.item_66.name]) {
    returnExp += bag[castleItem.item_66.name] * castleItem.item_66.exp;
  }
  if (bag[castleItem.item_67.name]) {
    returnExp += bag[castleItem.item_67.name] * castleItem.item_67.exp;
  }
  if (bag[castleItem.item_68.name]) {
    returnExp += bag[castleItem.item_68.name] * castleItem.item_68.exp;
  }
  if (bag[castleItem.item_69.name]) {
    returnExp += bag[castleItem.item_69.name] * castleItem.item_69.exp;
  }
  if (bag[castleItem.item_70.name]) {
    returnExp += bag[castleItem.item_70.name] * castleItem.item_70.exp;
  }
  if (bag[castleItem.item_71.name]) {
    returnExp += bag[castleItem.item_71.name] * castleItem.item_71.exp;
  }
  if (bag[castleItem.item_72.name]) {
    returnExp += bag[castleItem.item_72.name] * castleItem.item_72.exp;
  }
  if (bag[castleItem.item_73.name]) {
    returnExp += bag[castleItem.item_73.name] * castleItem.item_73.exp;
  }
  if (bag[castleItem.item_74.name]) {
    returnExp += bag[castleItem.item_74.name] * castleItem.item_74.exp;
  }
  if (bag[castleItem.item_75.name]) {
    returnExp += bag[castleItem.item_75.name] * castleItem.item_75.exp;
  }
  if (bag[castleItem.item_76.name]) {
    returnExp += bag[castleItem.item_76.name] * castleItem.item_76.exp;
  }
  if (bag[castleItem.item_77.name]) {
    returnExp += bag[castleItem.item_77.name] * castleItem.item_77.exp;
  }
  if (bag[castleItem.item_78.name]) {
    returnExp += bag[castleItem.item_78.name] * castleItem.item_78.exp;
  }
  if (bag[castleItem.item_79.name]) {
    returnExp += bag[castleItem.item_79.name] * castleItem.item_79.exp;
  }
  if (bag[castleItem.item_80.name]) {
    returnExp += bag[castleItem.item_80.name] * castleItem.item_80.exp;
  }
  if (bag[castleItem.item_81.name]) {
    returnExp += bag[castleItem.item_81.name] * castleItem.item_81.exp;
  }
  if (bag[castleItem.item_82.name]) {
    returnExp += bag[castleItem.item_82.name] * castleItem.item_82.exp;
  }
  if (bag[castleItem.item_83.name]) {
    returnExp += bag[castleItem.item_83.name] * castleItem.item_83.exp;
  }
  if (bag[castleItem.item_84.name]) {
    returnExp += bag[castleItem.item_84.name] * castleItem.item_84.exp;
  }
  if (bag[castleItem.item_85.name]) {
    returnExp += bag[castleItem.item_85.name] * castleItem.item_85.exp;
  }
  if (bag[castleItem.item_86.name]) {
    returnExp += bag[castleItem.item_86.name] * castleItem.item_86.exp;
  }
  if (bag[castleItem.item_87.name]) {
    returnExp += bag[castleItem.item_87.name] * castleItem.item_87.exp;
  }
  if (bag[castleItem.item_88.name]) {
    returnExp += bag[castleItem.item_88.name] * castleItem.item_88.exp;
  }
  if (bag[castleItem.item_89.name]) {
    returnExp += bag[castleItem.item_89.name] * castleItem.item_89.exp;
  }
  if (bag[castleItem.item_90.name]) {
    returnExp += bag[castleItem.item_90.name] * castleItem.item_90.exp;
  }
  if (bag[castleItem.item_91.name]) {
    returnExp += bag[castleItem.item_91.name] * castleItem.item_91.exp;
  }
  if (bag[castleItem.item_92.name]) {
    returnExp += bag[castleItem.item_92.name] * castleItem.item_92.exp;
  }
  if (bag[castleItem.item_93.name]) {
    returnExp += bag[castleItem.item_93.name] * castleItem.item_93.exp;
  }
  if (bag[castleItem.item_94.name]) {
    returnExp += bag[castleItem.item_94.name] * castleItem.item_94.exp;
  }
  if (bag[castleItem.item_95.name]) {
    returnExp += bag[castleItem.item_95.name] * castleItem.item_95.exp;
  }
  if (bag[castleItem.item_96.name]) {
    returnExp += bag[castleItem.item_96.name] * castleItem.item_96.exp;
  }
  return returnExp;
}


// 순위관련
//좋아요순위
function generatelikeRanking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => data[b].like - data[a].like);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10; i++) {
    let username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 💕: ' + numberWithCommas(UsrInfo1.like) + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    let username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 💕: ' + numberWithCommas(UsrInfo2.like) + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}
//좋아요 1등 추출
function getTopUser(data) {
  let topUser = Object.keys(data).reduce((a, b) => data[b].like > data[a].like ? b : a);
  return {
    username: topUser,
    likes: data[topUser].like
  };
}

//채팅 1등 추출
function getTopchatUser(data) {
  let topUser = Object.keys(data).reduce((a, b) => data[b].chatcnt0 > data[a].chatcnt0 ? b : a);
  return {
    username: topUser,
    chats: data[topUser].chatcnt0
  };
}

// 레벨1등 추출
function getToplvUser(data) {
  let topUser = Object.keys(data).reduce((a, b) => data[b].lv > data[a].lv ? b : a);
  return {
    username: topUser,
    chats: data[topUser].lv
  };
}

// 채팅순위
function generatechatRanking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => data[b].chatcnt0 - data[a].chatcnt0);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10; i++) {
    let username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 채팅수: ' + numberWithCommas(UsrInfo1.chatcnt0) + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    let username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 채팅수: ' + numberWithCommas(UsrInfo2.chatcnt0) + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}

// 레벨 순위 생성 함수
function generateRanking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => data[b].lv - data[a].lv);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10; i++) {
    var username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji ^ (i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - LV.' + UsrInfo1.lv + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    var username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - LV.' + UsrInfo2.lv + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}

// 게임 순위 생성 함수
function generategameRanking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => data[b].minigamecnt - data[a].minigamecnt);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10; i++) {
    var username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 우승횟수: ' + UsrInfo1.minigamecnt + '회\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    var username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 우승횟수: ' + UsrInfo2.minigamecnt + '회\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}
//게임 1등 추출
function getTopgameUser(data) {
  let topUser = Object.keys(data).reduce((a, b) => data[b].minigamecnt > data[a].minigamecnt ? b : a);
  return {
    username: topUser,
    chats: data[topUser].minigamecnt
  };
}
