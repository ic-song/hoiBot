
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
  item_83: { name: '캐슬새솔유닛🦋(+250💕)', exp: 250 },
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
// 크리티컬 정보
const BASE_CRIT_DAMAGE_MULTIPLIER = 1.4; // 크리티컬 데미지
const BASE_CRIT_CHANCE = 0; // 초기 크리티컬 확률 0%
const CRIT_CHANCE_PER_UPGRADE = 0.005; // 1강당 크리티컬 확률 0.5% 증가
//랭크.txt 로드, 오류로그 세이브용
var sdcard = android.os.Environment.getExternalStorageDirectory().getAbsolutePath();
var folder = new java.io.File(sdcard, "호이랜드");
//member.json 로드용
const filePath = "/sdcard/호이랜드/member.json";
const errorLogPath = "/sdcard/호이랜드/errorLog.json";
const castleBattlePath = "/sdcard/호이랜드/castleBattle.json";
var allsee = "​".repeat(500);
//진화 필요 매력치var
requiredpoint = 10;
var initData = loadJsonFile(filePath);
var Master = Object.keys(initData.master);
var Admins = Object.keys(initData.admin);
function isAdmin(sender) {
  return Admins.includes(sender);
}
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  try {
    let data = loadJsonFile(filePath);
    var castleBattleData = loadJsonFile(castleBattlePath);
    if (msg === '/소지품검사' && (sender == "호이 남" || sender == "젤리 남")) {

      let itemList = '모든 유저의 아이템:\n';
      for (let user in data.member) {
        let Ruser1 = data.member[user].rank.emoji + user;
        itemList += '▫️ [' + Ruser1 + '] 의 아이템: \n';
        let count = 1;
        let userItems = data.member[user].bag;
        for (let item in userItems) {
          itemList += '    ' + count + '. ' + item + ' : ' + userItems[item] + '개\n';
          count++;
        }
      }
      replier.reply(itemList);
    }
    if (msg.startsWith('/정보') && isAdmin(sender)) {

      const user1 = msg.substring('/정보'.length).trim();
      if (data.member[user1]) {
        let Ruser1 = data.member[user1].rank.emoji + user1;
        let memberInfo = data.member[user1];
        if (memberInfo) {
          let currentExp = memberInfo.exp;
          let nextLevelExp = 6 * memberInfo.lv + 84;
          let totallike = memberInfo.like;
          if (memberInfo.like0) {
            totallike += memberInfo.like0;
          }
          let totallv = memberInfo.lv;
          if (memberInfo.lv0) {
            totallv += memberInfo.lv0;
          }
          let activeTitle = getTitle(memberInfo);
          let bagItems = memberInfo.bag;
          let bagOutput = generateBagOutput(bagItems).bagOutput;

          let titleList = memberInfo.title.list;
          let titleOutput = '';
          if (titleList && titleList.length > 0) {
            titleOutput = '.\n';
            titleList.forEach((title, index) => {
              titleOutput += '   ' + (index + 1) + '. ' + title + '\n';
            });
            titleOutput = titleOutput.trim();
          }
          var resultmsg = "";
          if (activeTitle) {
            resultmsg = activeTitle + "\n";
          }
          if (memberInfo.pet.newimg) {
            memberInfo.pet.petimg = memberInfo.pet.newimg;
          }
          let voicecheck = '• 보룸인증: 미완료\n';
          if (memberInfo.voicecheck) {
            voicecheck = '';
          }
          resultmsg += '[' + checkRank(data, user1) + '] 님의 종합 정보\n' + voicecheck + '• 레벨: ' + memberInfo.lv + ' (누적 레벨 : ' + totallv + ')\n' + '• 가입일: ' + formatDate(memberInfo.join) + '\n' + '• 최근 출석일: ' + formatDate(memberInfo.recent) + '\n• 보유 포인트: 🅟' + numberWithCommas(memberInfo.point) + '\n' + allsee + '• 총 출석일: ' + memberInfo.cnt + '일\n' + '• 연속 출석일: ' + memberInfo.straight + '일\n' + '• 타이틀 개수: ' + memberInfo.title.list.length + '개\n' + '• 미니게임 우승: ' + memberInfo.minigamecnt + '회\n' + '• 경험치: ' + currentExp + ' / ' + nextLevelExp + ' (' + Math.floor((currentExp / nextLevelExp) * 100) + '%)\n' + '• ♥ x ' + memberInfo.like + ' (누적 : ' + totallike + ')\n' + '• 펫: ' + memberInfo.pet.petimg + memberInfo.pet.petname + ' 💕' + memberInfo.pet.petexp + '\n' + '• 가방: ' + bagOutput + '\n' + '• 타이틀: ' + titleOutput;
          replier.reply(resultmsg);
        }
      } else {
        replier.reply('[' + user1 + "] 님은 등록되지 않은 유저입니다.");
      }
    }
    if (msg === '/포인트') {

      if (data.member[sender]) {
        replier.reply('[' + checkRank(data, sender) + '] 님의 포인트\n🅟' + numberWithCommas(data.member[sender].point) + '');
      }
    }
    if (msg === '/레벨') {

      if (data.member[sender]) {
        let currentExp = data.member[sender].exp;
        let nextLevelExp = 6 * data.member[sender].lv + 84;
        let percentage = ((currentExp / nextLevelExp) * 100).toFixed(2);
        let expbooster = '';
        if (data.member[sender].boostercnt) {
          expbooster += '\n남은 경험치 부스터 횟수 : ' + numberWithCommas(data.member[sender].boostercnt);
        }
        replier.reply('[' + checkRank(data, sender) + '] 님의 현재 레벨은 ' + data.member[sender].lv + '입니다.\n(' + currentExp + ' / ' + nextLevelExp + ' [' + percentage + '%])' + expbooster);
      }
    }
    if (msg === '/내정보') {

      if (data.member[sender]) {
        let memberInfo = data.member[sender];
        if (memberInfo) {
          let currentExp = memberInfo.exp;
          let nextLevelExp = 6 * memberInfo.lv + 84;
          let totallike = memberInfo.like;
          if (memberInfo.like0) {
            totallike += memberInfo.like0;
          }
          let totallv = memberInfo.lv;
          if (memberInfo.lv0) {
            totallv += memberInfo.lv0;
          }
          let activeTitle = getTitle(memberInfo);
          var resultmsgs = "";
          if (activeTitle) {
            resultmsgs = activeTitle + "\n";
          }
          if (memberInfo.pet.newimg) {
            memberInfo.pet.petimg = memberInfo.pet.newimg;
          }
          resultmsgs += '[' + checkRank(data, sender) + '] 님의 종합 정보\n' + '• 인생 ' + memberInfo.rebirthcnt + '회차\n• 레벨: ' + memberInfo.lv + ' (누적 레벨 : ' + totallv + ')\n' + '• 가입일: ' + formatDate(memberInfo.join) + '\n' + '• 총 출석일: ' + memberInfo.cnt + '일\n' + '• 연속 출석일: ' + memberInfo.straight + '일\n' + '• 보유 포인트: 🅟' + numberWithCommas(memberInfo.point) + '\n' + '• 타이틀 개수: ' + memberInfo.title.list.length + '개\n' + '• 미니게임 우승: ' + memberInfo.minigamecnt + '회\n' + '• 경험치: ' + currentExp + ' / ' + nextLevelExp + ' (' + Math.floor((currentExp / nextLevelExp) * 100) + '%)\n' + '\n• ♥ x ' + memberInfo.like + ' (누적 : ' + totallike + ')\n• 펫: ' + memberInfo.pet.petimg + memberInfo.pet.petname + ' 💕' + memberInfo.pet.petexp;
          replier.reply(resultmsgs);
        }
      }
    }
    if (msg === '/타이틀목록') {

      if (data.member[sender]) {
        let memberInfo = data.member[sender];
        if (memberInfo) {
          let titleList = memberInfo.title.list;
          if (titleList && titleList.length > 0) {
            let titleOutput = '[' + checkRank(data, sender) + ']님의 타이틀 목록\n\n';
            if (titleList.length > 10) {
              titleOutput += '타이틀 10개 이상 보유자\n' + allsee;
            }
            titleList.forEach((title, index) => {
              titleOutput += (index + 1) + '. ' + title + '\n';
            });
            titleOutput = titleOutput.trim();
            replier.reply(titleOutput);
          } else {
            replier.reply('등록된 타이틀이 없습니다.');
          }
        }
      }
    }
    if (msg === '/가방') {
      if (data.member && data.member[sender]) {
        let memberInfo = data.member[sender];
        if (memberInfo) {
          let bagItems = memberInfo.bag;
          let bagOutput = generateBagOutput(bagItems).bagOutput;
          let sortedItemList = generateBagOutput(bagItems).sortedItemList
          if (bagOutput) {
            let responseMessage = '[' + checkRank(data, sender) + ']의 가방🧳\n\n';
            if (sortedItemList.length > 10) {
              responseMessage += '🎮후원디스코드 안내🎮\n/후원 을 입력하세요💝\n' + allsee;
            }
            responseMessage += bagOutput;
            replier.reply(responseMessage);
          } else {
            replier.reply('가방이 비어 있습니다.');
          }
        }
      }
    }
    if (msg === '/출석목록') {

      let userList = data.attend_list;
      let userListText1 = userList.length > 0 ? userList.slice(0, 10).map((user, index) => (index + 1) + '. [' + data.member[user].rank.emoji + user + ']').join('\n') : '출석한 유저가 없습니다.';
      let userListText2 = userList.length > 10 ? userList.slice(10).map((user, index) => (index + 11) + '. [' + data.member[user].rank.emoji + user + ']').join('\n') : '';
      replier.reply('출석한 유저 목록:\n' + userListText1 + allsee + '\n' + userListText2);
    }
    if (msg === '/상점') {

      let itemList = Object.keys(data.shop).map(function (itemName, index) {
        let itemDetails = data.shop[itemName];
        let itemPrice = numberWithCommas(itemDetails);
        let itemTax = ''; //  세금 
        if (data.HoiCastle && data.HoiCastle.taxRate) {
          // 세율이 존재하는 경우, 세금 계산 로직
          let taxRate = data.HoiCastle.taxRate; // 세율
          let taxAmount = itemDetails * (taxRate / 100); // 세금 계산   
          itemTax = '\n(세금: 🅟' + numberWithCommas(taxAmount.toFixed(0)) + ')'; // 소수점 이하 버림
        }
        return (index + 1) + '. ' + itemName + ' : 🅟' + numberWithCommas(itemPrice) + itemTax;
      });
      if (itemList.length > 0) {
        let taxRate = data.HoiCastle ? '\n(세금💲: ' + data.HoiCastle.taxRate + '%)' : null;
        let responseMessage = '🏰호랜캐슬🏰 포인트 상점🛍 ' + (taxRate ? taxRate : '') + '\n\n' + itemList.join('\n');
        replier.reply(responseMessage);
      } else {
        replier.reply('상점에 아이템이 없습니다.');
      }
    }
    if (msg.startsWith('/미출석 ') && isAdmin(sender)) {

      const regexAttend = /\/미출석\s+(\d+)\s*$/;
      const matchAttend = msg.match(regexAttend);
      if (matchAttend) {
        const daysAgo = parseInt(matchAttend[1], 10);
        const currentDate = getCurrentDate();
        const Userlist = Object.keys(data.member) || [];
        const totalUsers = Userlist.length;
        const inactiveUsers = Userlist.filter((userName) => {
          const lastAttendanceDate = data.member[userName] && data.member[userName].recent || '';
          return lastAttendanceDate < currentDate - (daysAgo - 1);
        });
        const numInactiveUsers = inactiveUsers.length;
        replier.reply('전체 등록인원 ' + totalUsers + '중 ' + numInactiveUsers + '명의 사용자가 최근' + daysAgo + '일 내에 ㅊㅊ하지 않았습니다.\n해당일자내 ㅊㅊ인원 : ' + (totalUsers - numInactiveUsers));
        const replyMessage2 = '미출첵 명단 \n\n' + inactiveUsers.join(', ');
        replier.reply(replyMessage2);
      }
    }

    if (msg === '/펫강화순위') {
      let petUpgradeRanking = generatePetUpgradeRanking(data.member);
      let resultMsg = '🐾 펫 강화 순위 🐾\n\n';
      resultMsg += petUpgradeRanking.rankingMsg1 + allsee + petUpgradeRanking.rankingMsg2;
      replier.reply(resultMsg);
    }

    else if (msg === '/누좋순위') {
      let like2Ranking = generatelike2Ranking(data.member);
      let resultMsg = '💓 누적 좋아요 순위 💓\n\n';
      resultMsg += like2Ranking.rankingMsg1 + allsee + like2Ranking.rankingMsg2;
      replier.reply(resultMsg);
    }

    else if (msg === '/누렙순위') {
      let Usr2Ranking = generate2Ranking(data.member);
      let resultMsg = '🏆 누적 레벨 순위 🏆\n\n';
      resultMsg += Usr2Ranking.rankingMsg1 + allsee + Usr2Ranking.rankingMsg2;
      replier.reply(resultMsg);
    }

    else if (msg === '/영주수익순위') {
      let rankdata = generateEarningsRanking(data.member);
      let resultMsg = '🏰 영주 수익 순위 🏰\n\n';
      resultMsg += rankdata.rankingMsg1 + allsee + rankdata.rankingMsg2;
      replier.reply(resultMsg);
    }
    if (msg == '/랭크확인') {

      var tierInfo = {
        'Almighty': [],
        'Emperor': [],
        'King': [],
        'Challenger': [],
        'GrandMaster': [],
        'Master': [],
        'Diamond': [],
        'Emerald': [],
        'Platinum': [],
        'Gold': [],
        'Silver': [],
        'Bronze': []
      };
      for (var user in data.member) {
        if (data.member.hasOwnProperty(user)) {
          if (data.member[user].rank && data.member[user].rank.tier) {
            var userTier = data.member[user].rank.tier.trim();
            if (tierInfo.hasOwnProperty(userTier)) {
              tierInfo[userTier].push(user);
            }
          } else {
            replier.reply(user + '님의 정보에 랭크데이터가 없습니다. ');
          }
        } else {
          replier.reply(user + '정보 내 데이터가 없습니다.');
        }
      }
      var rankList = '';
      var tierNumber = 1;
      var emojis = {
        'Almighty': '🪬',
        'Emperor': '🪽',
        'King': '👑',
        'Challenger': '🏆',
        'GrandMaster': '⚜️',
        'Master': '🔮',
        'Diamond': '💎',
        'Emerald': '💠',
        'Platinum': '🔰',
        'Gold': '🥇',
        'Silver': '🥈',
        'Bronze': '🥉'
      };
      for (var tier in tierInfo) {
        rankList += (2 + tierNumber) + '. ' + emojis[tier] + tier + ': ' + (tierInfo[tier].length > 0 ? tierInfo[tier].join(', ') : '-') + '\n';
        tierNumber++;
      }
      replier.reply('[랭크]\n현재 랭크 정보:\n' + rankList);
    }
    if (msg === '/주사위이력') {
      var recentR = data.dice.recent.join(', ');
      var wins = data.dice.Hoi;
      var losses = data.dice.Bot;
      var ties = data.dice.Tie;
      var totalGames = wins + losses + ties;
      var winProbability = (wins / totalGames) * 100;
      var lossProbability = (losses / totalGames) * 100;
      var tieProbability = (ties / totalGames) * 100;
      var diceresultMessage = '🎲주사위 이력🎲:\n';
      diceresultMessage += '호이😣: ' + wins + '회(' + winProbability.toFixed(2) + '%)\n';
      diceresultMessage += '봇승🤖: ' + losses + '회(' + lossProbability.toFixed(2) + '%)\n';
      diceresultMessage += '무승부☠: ' + ties + '회(' + tieProbability.toFixed(2) + '%)\n';
      diceresultMessage += '최근 5경기 결과(⬅️): \n' + recentR;
      replier.reply(diceresultMessage);
    }
    if (msg.startsWith('/호랜 ')) {

      var username = msg.substring('/호랜 '.length).trim(); // 입력된 아이디에서 양쪽 공백 제거

      if (data.member[username]) {
        let WinCnt = data.member[username].bet.WinCnt;
        let DiceCnt = data.member[username].bet.DiceCnt;
        let TotalWin = data.member[username].bet.TotalWin;
        let TotalBet = data.member[username].bet.TotalBet;
        var xresultR = parseInt(TotalWin) - parseInt(TotalBet);
        var IncomeRate = ((xresultR / parseInt(TotalBet)) * 100).toFixed(2);
        var RankFee = checkFee(data, username);
        var winratio = ((WinCnt / DiceCnt) * 100).toFixed(2);
        var finaluserR = (parseInt(TotalWin) - parseInt(TotalBet)).toFixed(0);

        // 총 배팅 포인트와 총 수익에 컴마 추가
        let formattedTotalBet = numberWithCommas(TotalBet);
        let formattedFinaluserR = numberWithCommas(Math.abs(finaluserR)); // 수익이 음수일 경우를 대비하여 절대값 취함

        var responseMessage = "";
        responseMessage += '[' + checkRank(data, username) + "] 님의 호랜이력 \n";
        responseMessage += "참가 횟수: " + DiceCnt + "회\n";
        responseMessage += "총 배팅 포인트:🅟" + formattedTotalBet + "\n";
        responseMessage += "승리 횟수: " + WinCnt + "회 (" + winratio + "%)\n";
        responseMessage += "총 수익: 🅟" + (finaluserR >= 0 ? "" : "-") + formattedFinaluserR + "(" + IncomeRate + "%)\n";
        responseMessage += RankFee.FeeInfo;

        replier.reply(responseMessage);
      } else {
        replier.reply("등록되지 않은 유저입니다.");
      }
    }



    if (msg === "/호랜정보") {

      var TotalResult = "";
      var TtotalBet = 0;
      var TtotalWin = 0;
      var userNames = Object.keys(data.member);
      for (var i = 0; i < userNames.length; i++) {
        TtotalBet += parseInt(data.member[userNames[i]].bet.TotalBet);
        TtotalWin += parseInt(data.member[userNames[i]].bet.TotalWin);
      }
      var totalRaw = TtotalBet - TtotalWin;
      TotalResult += "🎲호이랜드 업장🎲\n 총 매출 : " + numberWithCommas(TtotalBet) + "\n 총 지출 : " + numberWithCommas(TtotalWin) + "\n 총 수익 : " + numberWithCommas(totalRaw);
      replier.reply(TotalResult);
    }
    if (msg === "/호랜순위") {

      var userRankings = calculateUserRankings(data);
      var topRecords = "";
      var gameRecords = "";
      if (userRankings.length > 2) {
        for (var g = 0; g < 3; g++) {
          var userRank = userRankings[g];
          topRecords += (g + 1) + ". [" + checkRank(data, userRank.username) + "] ";
          topRecords += "총 수익: " + (userRank.xresultR >= 0 ? "🅟" : "-🅟") + numberWithCommas(Math.abs(userRank.xresultR)) + "\n";
        }
        for (var h = 3; h < userRankings.length; h++) {
          var userRanks = userRankings[h];
          gameRecords += (h + 1) + ". [" + checkRank(data, userRanks.username) + "] ";
          gameRecords += "총 수익: " + (userRanks.xresultR >= 0 ? "🅟" : "-🅟") + numberWithCommas(Math.abs(userRanks.xresultR)) + "\n";
        }
      } else {
        for (var f = 0; f < userRankings.length; f++) {
          var userRankz = userRankings[f];
          gameRecords += (f + 1) + ". [" + checkRank(data, userRankz.username) + "] ";
          gameRecords += "총 수익: " + (userRankz.xresultR >= 0 ? "🅟" : "-🅟") + numberWithCommas(Math.abs(userRankz.xresultR)) + "\n";
        }
      }
      replier.reply("📊 호이랜드 랭킹 📊\n\n" + topRecords + allsee + gameRecords);
    }
    if (msg === "/호랜수익순위") {

      var userRankings2 = calculateUserRankings2(data);
      var topRecords2 = "";
      var gameRecords2 = "";
      if (userRankings2.length > 2) {
        for (var w = 0; w < 3; w++) {
          var userRank2 = userRankings2[w];
          topRecords2 += (w + 1) + ". [" + checkRank(data, userRank2.username) + "] ";
          topRecords2 += "수익률: " + (userRank2.IncomeRate >= 0 ? "+" : "-") + Math.abs(userRank2.IncomeRate).toFixed(2) + "%\n";
        }
        for (var x = 3; x < userRankings2.length; x++) {
          var userRanks2 = userRankings2[x];
          gameRecords2 += (x + 1) + ". [" + checkRank(data, userRanks2.username) + "] ";
          gameRecords2 += "수익률: " + (userRanks2.IncomeRate >= 0 ? "+" : "-") + Math.abs(userRanks2.IncomeRate).toFixed(2) + "%\n";
        }
      } else {
        for (var y = 0; y < userRankings2.length; y++) {
          var userRankz2 = userRankings2[y];
          gameRecords2 += (y + 1) + ". [" + checkRank(data, userRankz2.username) + "] ";
          gameRecords2 += "총 수익: " + (userRankz2.IncomeRate >= 0 ? "+" : "-") + Math.abs(userRankz2.IncomeRate).toFixed(2) + "%\n";
        }
      }
      replier.reply("📊 호이랜드 수익률 랭킹 📊\n(50회 이상)\n" + topRecords2 + allsee + gameRecords2);
    }

    if (msg.startsWith("/승률")) {

      var topRankingz = Ranker(data);
      topRankingz = topRankingz.filter(function (user) {
        return user.Count > 10;
      });
      var userCountz = topRankingz.length;
      var inputNumber = parseInt(msg.split(" ")[1]);    // 숫자 추출
      if (isNaN(inputNumber)) {
        replier.reply("숫자를 입력해주세요.");
      } else if (inputNumber <= 0) {
        replier.reply("숫자는 1 이상이어야 합니다.");
      } else if (inputNumber <= userCountz) {
        var topRecordz = "";
        var user2 = topRankingz[inputNumber - 1];
        topRecordz += "[" + checkRank(data, user2.username) + "] ";
        topRecordz += user2.winrate + "% (판수: " + user2.Count + "회)\n";
        replier.reply("승률 " + inputNumber + "번째로 높은 유저: \n\n" + topRecordz);
      } else {
        replier.reply("현재 전체 명 수: " + userCountz + "명입니다.");
      }
    }
    if (msg === "/호랜승률") {

      var topRanking = Ranker(data);
      topRanking = topRanking.filter(function (user) {
        return user.Count > 50;
      });
      var userCount = topRanking.length;
      var topRecord = "";
      if (topRanking.length > 2) {
        for (var z = 0; z < 3; z++) {
          var topRank = topRanking[z];
          topRecord += (z + 1) + ". [" + checkRank(data, topRank.username) + "] ";
          topRecord += topRank.winrate + "% (" + topRank.Count + "회)\n";
        }
      }
      topRecord += ".\n.\n.\n";
      var topLoser = topRanking.sort(function (b, a) {
        return b.winrate - a.winrate;
      });
      if (topLoser.length > 2) {
        for (var t = 0; t < 3; t++) {
          var topLose = topLoser[2 - t];
          topRecord += (t + userCount) + ". [" + checkRank(data, topLose.username) + "] ";
          topRecord += topLose.winrate + "% (" + topLose.Count + "회)\n";
        }
      }
      replier.reply("📊 호이랜드 승률 랭킹 📊\n(30회 이상)\n\n" + topRecord);
    }
    if (msg === "/호랜참여율") {

      var topCount = Ranker(data);
      var CountR = "";
      topCount.sort(function (a, b) {
        return b.Count - a.Count;
      });
      if (topCount.length > 2) {
        for (var v = 0; v < 3; v++) {
          var CountRank = topCount[v];
          CountR += (v + 1) + ". [" + checkRank(data, CountRank.username) + "] ";
          CountR += CountRank.Count + "회 플레이\n";
        }
      }
      replier.reply("📊 호이랜드 고인물 랭킹 📊\n\n" + CountR);
    }
    if (msg === '/펫상태') {

      let petInfo = data.member[sender].pet;
      if (petInfo.petname) {
        if (petInfo.newimg) {
          petInfo.petimg = petInfo.newimg;
        }
        replier.reply(petInfo.petimg);
      }
    }
    if (msg === '/펫정보') {

      let petInfo = data.member[sender].pet;
      if (petInfo.petname) {
        let gearRankmsg = '';
        if (petInfo.petgear.gearRank !== '일반') {
          gearRankmsg = '[' + petInfo.petgear.gearRank + ']';
        }
        if (petInfo.petgear.gearUp) {
          gearRankmsg += '(+' + petInfo.petgear.gearUp + ')';
        }
        let petwinmsg = '';
        let petwin = 0;
        if (petInfo.petwin) {
          petwin = petInfo.petwin;
          petwinmsg = '\n펫대전우승횟수🏆: ' + petwin + '회';
        }
        if (petInfo.newimg) {
          petInfo.petimg = petInfo.newimg;
        }
        // 펫강화 업데이트로 인해 데이터 초기화.
        if (!petInfo.upgrade) {
          petInfo.upgrade = 0;
        }

        let critChance = getCritChance(petInfo.upgrade)
        let raidExp = numberWithCommas(calculateGearItem(sender, data).raidExp + petInfo.petexp);
        let castleExp = numberWithCommas(calculateCastleItem(sender, data) + calculateGearItem(sender, data).battleExp + petInfo.petexp);

        let resultMsg = "[" + checkRank(data, sender) + ']님의 펫 정보\n이름: ' + petInfo.petname + ' ' + petInfo.petimg + '(' + petInfo.upgrade + '⭐)\n타입: ' + petInfo.pettype + '\n성격: ' + petInfo.pettitle + '\n매력💕: ' + numberWithCommas(petInfo.petexp) + '\n레이드매력👾: ' + raidExp + '\n캐슬매력⚔️: ' + castleExp + '\n치명타확률: ' + critChance + '%' + '\n특성: ' + petInfo.petchar + '\n장비: ' + petInfo.petgear.gearName + gearRankmsg + petwinmsg;
        if (data.HoiCastle.lord == sender) {
          resultMsg += '\n칭호: 호랜캐슬 영주🤴'
        }
        replier.reply(petInfo.petimg);
        if (petInfo.petexp < requiredpoint) {
          resultMsg += "\n매력지수💕+" + (requiredpoint - petInfo.petexp) + " 이후 탄생합니다.";
        }
        replier.reply(resultMsg);
      } else {
        replier.reply('펫을 먼저 생성해주세요.');
      }
    }
    if (msg === '/펫순위') {

      let petRanking = generatePetRanking(data.member);
      let resultMsg = '🏆 펫 순위 🏆\n\n';
      resultMsg += petRanking.rankingMsg1 + allsee + petRanking.rankingMsg2;
      replier.reply(resultMsg);
    }
    if (msg === '/펫주인' && (sender == "호이 남" || sender == "젤리 남")) {

      let ownermsg = '🐶펫 주인확인🐱\n\n';
      for (let user in data.member) {
        if (data.member[user].pet && data.member[user].pet.petname) {
          if (data.member[user].pet.newimg) {
            data.member[user].pet.petimg = data.member[user].pet.newimg;
          }
          ownermsg += '[' + checkRank(data, user) + '] - ' + data.member[user].pet.petimg + data.member[user].pet.petname + '💕' + data.member[user].pet.petexp + '\n';
        }
      }
      replier.reply(ownermsg);
    }
    if (msg === '/포인트확인' && (sender == "호이 남" || sender == "젤리 남")) {

      let pointRank = pointRanking(data.member);
      let resultMsg = '🏆 포인트 잔액 순위 🏆\n\n';
      resultMsg += pointRank;
      replier.reply(resultMsg);
    }
    if (msg === '/캐슬전적') {
      let senderObj = data.member[sender];
      let totalGames = senderObj.battle.win + senderObj.battle.lose;
      let winRatio = totalGames > 0 ? (senderObj.battle.win / totalGames) * 100 : 0;

      let castleExp = numberWithCommas(calculateCastleItem(sender, data) + calculateGearItem(sender, data).battleExp + data.member[sender].pet.petexp);

      let message = '[' + checkRank(data, sender) + '] 님의 캐슬전적\n\n'
      message += '이름 : ' + senderObj.pet.petname + senderObj.pet.petimg + castleExp + '💕(' + (senderObj.pet.upgrade || 0) + '⭐)\n'
      message += '전적 : ' + senderObj.battle.win + '승 ' + senderObj.battle.lose + '패' + '(' + winRatio.toFixed(2) + '%)\n';
      message += '등급 : ' + getCastleBattleRankEmoji(senderObj.battle.score, castleBattleData) + '\n'
      message += '캐슬포인트(CP) : ' + numberWithCommas(senderObj.battle.score) + 'pt🏆';

      let rank = getCastleBattleRank(sender, data);
      if (rank) {
        message += '\n캐슬대전순위 : ' + numberWithCommas(rank) + '위';
      }

      replier.reply(message)
    } else if (msg === '/캐슬대전기록') {
      let history = castleBattleData.history.reverse();
      let message = '🏆캐슬대전기록🏆\n\n최근 20개의 대전기록\n(상세보기)\n' + allsee

      history.forEach((item, index) => {
        message += (index + 1) + '. ';
        message += (item.winnerName == item.attackerName ? '(🥇승)' : '(❌패)') + '[' + item.attackerName + ']의 [' + item.attackerPetName + item.attackerPetImg + item.attackerPetExp + '💕]';
        message += '\n vs ';
        message += (item.winnerName == item.defenderName ? '(🥇승)' : '(❌패)') + '[' + item.defenderName + ']의 [' + item.defenderPetName + item.defenderPetImg + item.defenderPetExp + '💕]\n\n';
      })
      replier.reply(message)
    } else if (msg === '/캐슬대전순위') {
      let sortedMembers = sortCastleBattle(data);
      let message = '🏆 캐슬대전 순위 🏆\n\n';

      // 순위 출력
      sortedMembers.forEach((member, index) => {
        let rank = index + 1;
        let rankEmoji = getCastleBattleRankEmoji(member.score, castleBattleData);
        message += getRankEmoji(rank) + '[' + checkRank(data, member.name) + '] ' + rankEmoji + ' : ' + member.score + 'pt\n';
        if (rank == 3) { message += allsee }
      });

      replier.reply(message);
    }

  } catch (error) {
    let errorObj = { system: 'info', error: error, msg: msg, room: room, sender: sender }
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
function save(folderName, fileName, str) {
  var c = new java.io.File(sdcard + "/" + folderName + "/" + fileName);
  var d = new java.io.FileOutputStream(c);
  var e = new java.lang.String(str);
  d.write(e.getBytes());
  d.close();
}

// 누적 좋아요 순위
function generatelike2Ranking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => {
    const totalLvA = (data[a].like + (data[a].like0 || 0));
    const totalLvB = (data[b].like + (data[b].like0 || 0));
    return totalLvB - totalLvA;
  });
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
    var username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    let totalLv1 = UsrInfo1.like + (UsrInfo1.like0 || 0);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 💕:' + totalLv1 + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    var username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    let totalLv2 = UsrInfo2.like + (UsrInfo2.like0 || 0);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 💕:' + totalLv2 + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}


// 누적렙순위
function generate2Ranking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => {
    const totalLvA = (data[a].lv + (data[a].lv0 || 0));
    const totalLvB = (data[b].lv + (data[b].lv0 || 0));
    return totalLvB - totalLvA;
  });
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
    var username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    let totalLv1 = UsrInfo1.lv + (UsrInfo1.lv0 || 0);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - LV.' + totalLv1 + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    var username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    let totalLv2 = UsrInfo2.lv + (UsrInfo2.lv0 || 0);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - LV.' + totalLv2 + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}

/**
 * 영주수익순위
 * @param  data 
 * @returns {String} 순위
 */
function generateEarningsRanking(data) {
  let sortedUsrs = Object.keys(data).sort((a, b) => data[b].earnings - data[a].earnings);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < 10; i++) {
    let username1 = sortedUsrs[i];
    let Rsender1 = data[username1].rank.emoji + username1;
    let UsrInfo1 = data[username1];
    if (!UsrInfo1.earnings) UsrInfo1.earnings = 0;
    let rankEmoji1 = getRankEmoji(i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 👑: ' + numberWithCommas(UsrInfo1.earnings) + '\n';
  }
  for (let i = 10; i < sortedUsrs.length; i++) {
    let username2 = sortedUsrs[i];
    let Rsender2 = data[username2].rank.emoji + username2;
    let UsrInfo2 = data[username2];
    if (!UsrInfo2.earnings) UsrInfo2.earnings = 0;
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 👑: ' + numberWithCommas(UsrInfo2.earnings) + '\n';
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}

// 펫강화순위 생성 함수
function generatePetUpgradeRanking(members) {
  // 필터링: 펫이 있고 강화 레벨이 1 이상인 사용자만 포함
  let sortedUsrs = Object.keys(members)
    .filter(key => members[key].pet && members[key].pet.upgrade && members[key].pet.upgrade > 0)
    .sort((a, b) => {
      if (members[b].pet.upgrade === members[a].pet.upgrade) {
        // 강화 레벨이 동일하면 강화 성공 시간을 비교
        return new Date(members[a].pet.upgradeDateTime) - new Date(members[b].pet.upgradeDateTime);
      }
      // 강화 레벨이 다르면 강화 레벨을 기준으로 정렬
      return members[b].pet.upgrade - members[a].pet.upgrade;
    });

  let rankingMsg1 = '';  // 상위 10명의 순위 메시지
  let rankingMsg2 = '';  // 나머지 사용자들의 순위 메시지

  // 상위 10명의 사용자 메시지
  for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
    let username1 = sortedUsrs[i];
    let Rsender1 = members[username1].rank.emoji + username1;
    let UsrInfo1 = members[username1];
    let rankEmoji1 = getRankEmoji(i + 1);
    rankingMsg1 += rankEmoji1 + Rsender1 + ' - 강화 레벨: ' + UsrInfo1.pet.upgrade + '⭐\n';
  }

  // 나머지 사용자들에 대해 순위 메시지를 작성합니다.
  for (let i = 10; i < sortedUsrs.length; i++) {
    let username2 = sortedUsrs[i];
    let Rsender2 = members[username2].rank.emoji + username2;
    let UsrInfo2 = members[username2];
    let rankEmoji2 = getRankEmoji(i + 1);
    rankingMsg2 += rankEmoji2 + Rsender2 + ' - 강화 레벨: ' + UsrInfo2.pet.upgrade + '⭐\n';
  }

  // 상위 10명과 나머지 사용자들의 순위 메시지를 반환합니다.
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}
// 펫 순위 생성 함수
function generatePetRanking(petData) {
  let sortedPets = Object.keys(petData).sort((a, b) => petData[b].pet.petexp - petData[a].pet.petexp);
  let rankingMsg1 = '';
  let rankingMsg2 = '';
  for (let i = 0; i < sortedPets.length; i++) {
    let username = sortedPets[i];
    let petInfo = petData[username].pet;
    //    let special = '✨️';
    if (petInfo.petexp > 5) {
      let rankEmoji = getRankEmoji(i + 1);
      //      if (petInfo.petchar == "-") {
      //        special = '';
      //      }
      let rankingMsg = rankEmoji + petInfo.petimg + petInfo.pettitle + ' ' + petInfo.petname + ' 💕 ' + numberWithCommas(petInfo.petexp) + '\n';
      //      let rankingMsg = rankEmoji + petInfo.petimg + special + petInfo.pettitle + ' ' + petInfo.petname + ' 💕 ' + numberWithCommas(petInfo.petexp) + '\n';

      if (i < 10) {
        rankingMsg1 += rankingMsg;
      } else {
        rankingMsg2 += rankingMsg;
      }
    }
  }
  return {
    rankingMsg1: rankingMsg1,
    rankingMsg2: rankingMsg2
  };
}
function getDiceEmoji(number) {
  var diceEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return diceEmojis[number - 1];
}
// 날짜 형식 변환 함수
function formatDate(dateString) {
  if (!dateString) {
    return '-';
  } else {
    let year = dateString.substr(0, 4);
    let month = dateString.substr(4, 2);
    let day = dateString.substr(6, 2);
    return year + '년 ' + month + '월 ' + day + '일';
  }
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
// active 값에 따라 해당하는 title 가져오기
function getTitle(memberInfo) {
  let activeTitleNum = memberInfo.active;
  let titleList = memberInfo.title.list;
  if (activeTitleNum > 0 && titleList && titleList[activeTitleNum - 1]) {
    return titleList[activeTitleNum - 1];
  } else {
    return '';
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
//////주사위관련함수///////////////////////////////////////////////
function calculateUserRankings(data) {
  var userRankings = [];
  var userNames = Object.keys(data.member);
  for (var i = 0; i < userNames.length; i++) {
    var WinCnt = data.member[userNames[i]].bet.WinCnt;
    var DiceCnt = data.member[userNames[i]].bet.DiceCnt;
    var TotalWin = parseInt(data.member[userNames[i]].bet.TotalWin);
    var TotalBet = parseInt(data.member[userNames[i]].bet.TotalBet);
    var xresultR = TotalWin - TotalBet;
    userRankings.push({
      username: userNames[i],
      xresultR: xresultR
    });
  }
  // 유저 수익순으로 순서변경
  userRankings.sort(function (a, b) {
    return b.xresultR - a.xresultR;
  });
  return userRankings;
}
function calculateUserRankings2(data) {
  var userRankings2 = [];
  var userNames = Object.keys(data.member);
  for (var i = 0; i < userNames.length; i++) {
    var WinCnt = data.member[userNames[i]].bet.WinCnt;
    var DiceCnt = data.member[userNames[i]].bet.DiceCnt;
    var TotalWin = data.member[userNames[i]].bet.TotalWin;
    var TotalBet = data.member[userNames[i]].bet.TotalBet;

    // TotalBet이 0인 경우 예외 처리
    var xresultR = parseInt(TotalWin) - parseInt(TotalBet);
    var IncomeRate = TotalBet !== 0 ? (xresultR / parseInt(TotalBet)) * 100 : 0;

    if (WinCnt > 50) {
      userRankings2.push({
        username: userNames[i],
        IncomeRate: IncomeRate
      });
    }
  }
  // IncomeRate 값을 기준으로 사용자 랭킹 정렬
  userRankings2.sort(function (a, b) {
    return b.IncomeRate - a.IncomeRate;
  });
  return userRankings2;
}

function Ranker(data) {
  var topRanker = [];
  var userRankings2 = [];
  var userNames = Object.keys(data.member);
  for (var i = 0; i < userNames.length; i++) {
    var WinCnt = data.member[userNames[i]].bet.WinCnt;
    var DiceCnt = data.member[userNames[i]].bet.DiceCnt;
    var winrate = (WinCnt / DiceCnt) * 100;
    winrate = winrate.toFixed(2);
    topRanker.push({
      username: userNames[i],
      winrate: winrate,
      Count: DiceCnt
    });
  }
  topRanker.sort(function (a, b) {
    return b.winrate - a.winrate;
  });
  return topRanker;
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
function pointRanking(data) {
  let sorted = Object.keys(data).sort((a, b) => data[b].point - data[a].point);
  let rankingMsg = '';
  for (let i = 0; i < sorted.length; i++) {
    let username = sorted[i];
    let Rsender = data[username].rank.emoji + username;
    let rankEmoji = getRankEmoji(i + 1);
    rankingMsg += rankEmoji + '[' + Rsender + ']' + ' 🅟' + numberWithCommas(data[username].point) + '\n';
  }
  return rankingMsg;
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

/** info.js동일
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