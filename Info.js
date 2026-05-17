const testRoom = "팻 테스트방";
const room90 = "호이월드 GM 관리자방";
const room91 = "통합스텝";

// 크리티컬 정보
const BASE_CRIT_DAMAGE_MULTIPLIER = 1.7; // 크리티컬 데미지
const BASE_CRIT_CHANCE = 0; // 초기 크리티컬 확률 0%
const CRIT_CHANCE_PER_UPGRADE = 0.005; // 1강당 크리티컬 확률 0.5% 증가
const PET_SKILL_MAX_EQUIP_SLOT = 20;
const PET_SKILL_BOOK_ITEM = "펫스킬북📙(/펫스킬오픈)";
const PET_SKILL_UNBIND_ITEM = "펫스킬귀속해제권🧙‍♂️(/펫스킬귀속해제 숫자)";
const GLOBAL_LIMITS = {
	display: {
		changeLogMax: 10 // 최근 수정 이력 표시 개수
	},
	daily: {
		trialTowerMax: 5, // 시련의탑 하루 최대 횟수
		castleBattleMax: 5, // 캐슬대전 하루 최대 횟수
		castleBattleFree: 1, // 캐슬대전 무료 횟수
		miniPetBattleMax: 5, // 미니펫대전 하루 최대 횟수
		miniPetBattleFree: 1, // 미니펫대전 무료 횟수
		petExploreMax: 10 // 펫탐험 일퀘 완료 횟수
	},
	command: {
		batchUseMax: 10 // 티켓/횟수형 명령어 1회 최대 사용 횟수
	},
	miniPet: {
		battleBagMin: 5, // 미니펫대전 최소 가방 보유 수
		battleBagMax: 13, // 미니펫대전 최대 가방 보유 수
		cleanupTriggerCount: 13, // 미니펫 가방 정리 대상 기준
		cleanupKeepCount: 12 // 미니펫 가방 정리 후 유지 수
	}
};
//랭크.txt 로드, 오류로그 세이브용
var sdcard = android.os.Environment.getExternalStorageDirectory().getAbsolutePath();
const DATA_ROOT_PATH = "/sdcard/호이랜드/";
const DEV_DATA_ROOT_PATH = "/sdcard/호이랜드_dev/";
var folder = new java.io.File(sdcard, "호이랜드");
//member.json 로드용
const filePath = "/sdcard/호이랜드/member.json";
const errorLogPath = "/sdcard/호이랜드/errorLog.json";
const castleBattlePath = "/sdcard/호이랜드/castleBattle2.json";
const memberTitlePath = "/sdcard/호이랜드/member_title.json";
const petTitlePath = "/sdcard/호이랜드/pet_title.json";
const itemInfoPath = "/sdcard/호이랜드/itemInfo.json";
const memberPetPath = "/sdcard/호이랜드/member_pet.json";
const petSkillDataPath = "/sdcard/호이랜드/petSkillData.json";

const trialTowerPath = "/sdcard/호이랜드/trialTower.json";
const miniPetPath = "/sdcard/호이랜드/miniPetData.json"; //미니펫
const homeDataFile = "/sdcard/호이랜드/petSweetHomeData.json"; // 펫스윗홈 데이터
const petExplorePath = "/sdcard/호이랜드/petExploreData.json"; // 펫탐험
const guildPath = "/sdcard/호이랜드/guildData.json"; // 길드 데이터
var allsee = "​".repeat(500);
//테스트데이터
const filePath2 = "/sdcard/호이랜드/member2.json";
const castleBattlePath2 = "/sdcard/호이랜드/castleBattle2.json";
var COMMON_DATA_FILE_MAP = {
	"itemInfo.json": true,
	"miniPetData.json": true,
	"trialTowerBoss.json": true,
	"petSweetHomeInfo.json": true
};
var commandContextThreadLocal = new java.lang.ThreadLocal();
//진화 필요 매력치var
requiredpoint = 10;
var initData = loadJsonFile(filePath);
var Master = Object.keys(initData.master);
var Admins = Object.keys(initData.admin);
function isAdmin(sender) {
	return Admins.includes(sender);
}
function isMaster(sender) {
	return Master.includes(sender);
}
//미니펫
var ELITE_MINIPET_MAX_LV = 30;
var MINIPET_MAX_LV = ELITE_MINIPET_MAX_LV - 1;

//티어티켓정보
const ticketTierData = {
	새싹: { emoji: "🌱", ticket: 0, highticket: 0, exp: 0, low: 0.95, high: 0.7, bonusP: 0.02 },
	브론즈: { emoji: "🥉", ticket: 1, highticket: 0, exp: 50, low: 0.95, high: 0.75, bonusP: 0.05 },
	실버: { emoji: "🥈", ticket: 10, highticket: 0, exp: 50, low: 0.95, high: 0.82, bonusP: 0.07 },
	골드: { emoji: "🥇", ticket: 30, highticket: 0, exp: 50, low: 0.95, high: 0.88, bonusP: 0.1 },
	플레티넘: { emoji: "🔰", ticket: 70, highticket: 0, exp: 50, low: 0.95, high: 0.95, bonusP: 0.15 },
	에메랄드: { emoji: "💠", ticket: 150, highticket: 0, exp: 50, low: 1.0, high: 0.97, bonusP: 0.18 },
	다이아: { emoji: "💎", ticket: 300, highticket: 0, exp: 100, low: 1.0, high: 1.01, bonusP: 0.2 },
	마스터: { emoji: "🔮", ticket: 700, highticket: 0, exp: 300, low: 1.0, high: 1.05, bonusP: 0.23 },
	그랜드마스터: { emoji: "⚜️", ticket: 1200, highticket: 0, exp: 900, low: 1.0, high: 1.1, bonusP: 0.25 },
	챌린저: { emoji: "🏆", ticket: 2500, highticket: 0, exp: 1500, low: 1.0, high: 1.15, bonusP: 0.3 },
	킹: { emoji: "👑", ticket: 6000, highticket: 50, exp: 3000, low: 1.0, high: 1.2, bonusP: 0.4 },
	엠퍼러: { emoji: "🪽", ticket: 11000, highticket: 100, exp: 10000, low: 1.0, high: 1.35, bonusP: 0.5 },
	올마이티: { emoji: "🪬", ticket: 15000, highticket: 200, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	하얀하트: { emoji: "🤍", ticket: 20000, highticket: 300, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	하늘하트: { emoji: "🩵", ticket: 25000, highticket: 400, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	노랑하트: { emoji: "💛", ticket: 30000, highticket: 500, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	보라하트: { emoji: "💜", ticket: 35000, highticket: 600, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	빨강하트: { emoji: "❤️", ticket: 40000, highticket: 750, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	블랙하트: { emoji: "🖤", ticket: 45000, highticket: 850, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	반짝하트: { emoji: "💖", ticket: 50000, highticket: 950, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	열정하트: { emoji: "❤️‍🔥", ticket: 60000, highticket: 1050, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	화살하트: { emoji: "💘", ticket: 70000, highticket: 1150, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	두근하트: { emoji: "💗", ticket: 80000, highticket: 1250, exp: 10000, low: 1.0, high: 1.5, bonusP: 0.7 },
	심장하트: { emoji: "❤️‍🩹", ticket: 90000, highticket: 1350, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	보라보라하트: { emoji: "💟", ticket: 100000, highticket: 1450, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	손하트: { emoji: "🫶", ticket: 120000, highticket: 1550, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	스페이드: { emoji: "♠️", ticket: 140000, highticket: 1650, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	하트: { emoji: "♥️", ticket: 160000, highticket: 1750, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	다이아몬드: { emoji: "♦️", ticket: 180000, highticket: 1850, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	클로바: { emoji: "♣️", ticket: 220000, highticket: 1950, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	풀하우스: { emoji: "🃏", ticket: 260000, highticket: 2150, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	곰찌: { emoji: "🧸", ticket: 300000, highticket: 2300, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	초심: { emoji: "🌱", ticket: 350000, highticket: 2450, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	벛꽃: { emoji: "🌸", ticket: 400000, highticket: 2550, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	해피왕: { emoji: "🎲", ticket: 500000, highticket: 2750, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	마왕: { emoji: "😈", ticket: 600000, highticket: 2850, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	페가수스: { emoji: "🦄", ticket: 700000, highticket: 3050, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	유령왕: { emoji: "👻", ticket: 800000, highticket: 3200, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	왕왕왕: { emoji: "🐶", ticket: 900000, highticket: 3350, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	용용용: { emoji: "🐉", ticket: 1000000, highticket: 3550, exp: 15000, low: 1.0, high: 1.5, bonusP: 0.7 },
	피닉스: { emoji: "🐦‍🔥", ticket: 2000000, highticket: 4050, exp: 30000, low: 1.0, high: 1.5, bonusP: 0.7 }
};

//아이템정보
var itemInfoData = loadJsonFile(itemInfoPath);
var productionItemInfoData = itemInfoData;
var raidSpecialItem = itemInfoData.raidSpecialItem;
var castlePremiumItem = itemInfoData.castlePremiumItem;
var castleItem = itemInfoData.castleItem;
function applyItemInfoContext(nextItemInfoData) {
	itemInfoData = nextItemInfoData || productionItemInfoData;
	raidSpecialItem = itemInfoData.raidSpecialItem;
	castlePremiumItem = itemInfoData.castlePremiumItem;
	castleItem = itemInfoData.castleItem;
}
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
	var ctx = createCommandContext(isDevCommandMessage(msg));
	var prevCtx = enterCommandContext(ctx);
	try {
		msg = String(msg || "").trim();
		if (ctx.isDev) {
			msg = stripDevCommandPrefix(msg);
			replier = createContextReplier(replier, ctx);
		}

		if (ctx.isDev) {
			var missingDevFiles = getMissingDevDataFiles();
			if (missingDevFiles.length > 0) {
				replier.reply("❌ DEV 데이터가 준비되지 않았습니다.\nMaster가 dev/데이터백업을 먼저 실행해 주세요.\n\n누락 파일:\n- " + missingDevFiles.join("\n- "));
				return;
			}
			applyItemInfoContext(loadJsonFile(itemInfoPath));
		}
		var plainCommands = ["ㅈㅈㅈ", "ㅍㅍㅍ", "ㅁㅁㅁ"];
		if (!msg.startsWith("/") && plainCommands.indexOf(msg) === -1) {
			return;
		}
		let data = loadJsonFile(filePath);
		if (data && data.member && data.member[sender] && data.member[sender].agree != true) {
			return;
		}
		var petData = loadJsonFile(memberPetPath);
		var petSkillData = loadJsonFile(petSkillDataPath) || {};
		var titleData = loadJsonFile(memberTitlePath);
		var petTitleData = loadJsonFile(petTitlePath);
		var guildData = loadJsonFile(guildPath);

		if (msg.startsWith("/정보") && (isAdmin(sender) || isMaster(sender))) {
			var targetUser = msg.substring("/정보".length).trim();
			if (data.member[targetUser]) {
				let memberInfo = data.member[targetUser];
				let titleInfo = titleData.member[targetUser];
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
					let activeTitle = getTitle(memberInfo, titleInfo);
					let bagItems = memberInfo.bag;
					let bagOutput = generateBagOutput(bagItems).bagOutput;

					let titleList = titleInfo ? titleInfo.title.list : [];
					let titleOutput = "";
					if (titleList && titleList.length > 0) {
						titleOutput = ".\n";
						titleList.forEach((title, index) => {
							if (titleInfo.title.num == index + 1) {
								titleOutput += "☞" + (index + 1) + ". " + title.name + "\n";
							} else {
								titleOutput += "   " + (index + 1) + ". " + title.name + "\n";
							}
						});
						titleOutput = titleOutput.trim();
					}
					var resultmsg = "";
					if (activeTitle) {
						resultmsg += "• " + activeTitle + "\n";
					}
					resultmsg += "• " + (data.member[targetUser].server ? data.member[targetUser].server + "\n" : "");
					if (petData[targetUser] && petData[targetUser].newimg) {
						petData[targetUser].petimg = petData[targetUser].newimg;
					}
					let voicecheck = "• 보룸인증: 미완료\n";
					if (memberInfo.voicecheck) {
						voicecheck = "";
					}

					var myGuildInfo = getMyGuildInfo(data, guildData, targetUser);
					if (data.member[targetUser] && data.member[targetUser].firstSponsor === true) {
						resultmsg += "• 🐹호이월드 후원자🐹\n";
					} else {
						resultmsg += "• 🐹호월 미후원자🐹\n";
					}
					resultmsg +=
						"• [" +
						checkRank(data, petData, guildData, targetUser) +
						"] 님의 종합 정보\n" +
						voicecheck +
						"• 길드: " +
						(myGuildInfo ? myGuildInfo.guild.name + "(" + myGuildInfo.guild.mark + ")" : " 없음") +
						"\n" +
						"• 레벨: " +
						memberInfo.lv +
						" (누적 레벨 : " +
						totallv +
						")\n" +
						"• 가입일: " +
						formatDate(memberInfo.join) +
						"\n" +
						"• 최근 출석일: " +
						formatDate(memberInfo.recent) +
						"\n• 보유 포인트: 🅟" +
						numberWithCommas(memberInfo.point) +
						"\n" +
						allsee +
						"• 총 출석일: " +
						memberInfo.cnt +
						"일\n" +
						"• 타이틀 개수: " +
						titleList.length +
						"개\n" +
						"• 경험치: " +
						currentExp +
						" / " +
						nextLevelExp +
						" (" +
						Math.floor((currentExp / nextLevelExp) * 100) +
						"%)\n" +
						"• ♥ x " +
						memberInfo.like +
						" (누적 : " +
						totallike +
						")\n" +
						"• 펫: " +
						(petData[targetUser] ? petData[targetUser].petimg + petData[targetUser].petname + " 💕" + petData[targetUser].petexp : "없음") +
						"\n" +
						"• 가방: " +
						bagOutput +
						"\n" +
						"• 타이틀: " +
						titleOutput;
					if (
						sender != "호이 남" &&
						sender != "희재 남" &&
						sender != "마라 여" &&
						sender != "콘트 남" &&
						sender != "나나 남" &&
						sender != "감자 여" &&
						sender != "반지 여" &&
						sender != "비쟈 남" &&
						sender != "리리 여" &&
						sender != "맹구 여" &&
						sender != "쟈기 여" &&
						sender != "벨라 여" &&
						sender != "반지 여" &&
						sender != "라면 남" &&
						sender != "베라 여"
					) {
						Api.replyRoom(room91, "- 정보조회자: " + sender + "\n- 검색: " + targetUser + "");
					}
					replier.reply(resultmsg);
				}
			} else {
				replier.reply("[" + targetUser + "] 님은 등록되지 않은 유저입니다.");
			}
		}
		if (msg === "/포인트" || msg === "ㅍㅍㅍ") {
			if (data.member && data.member[sender]) {
				replier.reply("[" + checkRank(data, petData, guildData, sender) + "] 님의 포인트\n🅟" + numberWithCommas(data.member[sender].point) + "");
			}
		}
		if (msg === "/레벨") {
			if (data.member[sender]) {
				let currentExp = data.member[sender].exp;
				let nextLevelExp = 6 * data.member[sender].lv + 84;
				let percentage = ((currentExp / nextLevelExp) * 100).toFixed(2);
				let expbooster = "";
				if (data.member[sender].boostercnt) {
					expbooster += "\n남은 경험치 부스터 횟수 : " + numberWithCommas(data.member[sender].boostercnt);
				}
				replier.reply(
					"[" +
						checkRank(data, petData, guildData, sender) +
						"] 님의 현재 레벨은 " +
						data.member[sender].lv +
						"입니다.\n(" +
						currentExp +
						" / " +
						nextLevelExp +
						" [" +
						percentage +
						"%])" +
						expbooster
				);
			}
		}
		if (msg === "/내정보") {
			if (!data.member || !data.member[sender]) {
				return;
			}

			let homeData = loadJsonFile(homeDataFile) || {};
			homeData = initSweetHomeUser(homeData, sender);

			let memberInfo = data.member[sender];
			let titleInfo = titleData && titleData.member ? titleData.member[sender] : null;

			if (!memberInfo) {
				return;
			}

			// 펫 데이터 예외처리
			var userPet = petData && petData[sender] ? petData[sender] : null;

			function hasValidPet(pet) {
				if (!pet || typeof pet !== "object") return false;

				var hasName = pet.petname && String(pet.petname).trim() !== "";
				var hasImg = pet.petimg && String(pet.petimg).trim() !== "";
				var hasNewImg = pet.newimg && String(pet.newimg).trim() !== "";
				var hasExp = pet.petexp !== undefined && pet.petexp !== null && String(pet.petexp).trim() !== "";

				// 이름 또는 이미지 중 하나라도 있고, exp 값이 있으면 펫 보유로 간주
				return (hasName || hasImg || hasNewImg) && hasExp;
			}

			function getPetInfoText(pet) {
				if (!hasValidPet(pet)) return "없음";

				var petImg = "";
				var petName = "";
				var petExp = 0;

				if (pet.newimg && String(pet.newimg).trim() !== "") {
					pet.petimg = pet.newimg;
				}

				petImg = pet.petimg ? String(pet.petimg) : "";
				petName = pet.petname ? String(pet.petname) : "";
				petExp = pet.petexp !== undefined && pet.petexp !== null ? pet.petexp : 0;

				return petImg + petName + " 💕" + petExp;
			}

			// 펫홈
			var homeTotalExp = getHomeTotalExp(homeData, sender);
			var userHome = homeData[sender] || {};
			let likeCnt = userHome.likeCnt || 0;

			let currentExp = memberInfo.exp || 0;
			let nextLevelExp = 6 * (memberInfo.lv || 0) + 84;
			let totallike = memberInfo.like || 0;
			if (memberInfo.like0) {
				totallike += memberInfo.like0;
			}

			let totallv = memberInfo.lv || 0;
			if (memberInfo.lv0) {
				totallv += memberInfo.lv0;
			}

			// 길드

			var myGuildInfo = getMyGuildInfo(data, guildData, sender);

			let resultMsg = "";
			let activeTitle = getTitle(memberInfo, titleInfo);
			if (activeTitle) {
				resultMsg += "• " + activeTitle + "\n";
			}

			resultMsg += memberInfo.server ? "• " + memberInfo.server + "\n" : "";

			if (memberInfo.firstSponsor === true) {
				resultMsg += "• 🐹호이월드 후원자🐹\n";
			} else {
				resultMsg += "• 🐹호월 미후원자🐹\n";
			}

			let titleList = titleInfo && titleInfo.title && titleInfo.title.list ? titleInfo.title.list : [];
			let petTitleList =
				petTitleData && petTitleData.member && petTitleData.member[sender] && petTitleData.member[sender].title && petTitleData.member[sender].title.list
					? petTitleData.member[sender].title.list
					: [];

			let expPercent = nextLevelExp > 0 ? Math.floor((currentExp / nextLevelExp) * 100) : 0;

			resultMsg +=
				"• [" +
				checkRank(data, petData, guildData, sender) +
				"] 님의 종합 정보\n" +
				"• 길드: " +
				(myGuildInfo ? myGuildInfo.guild.name + "(" + myGuildInfo.guild.mark + ")" : " 없음") +
				"\n" +
				"• 인생:" +
				(memberInfo.rebirthcnt || 0) +
				"회차\n" +
				"• 레벨: " +
				(memberInfo.lv || 0) +
				" (누적 레벨 : " +
				totallv +
				")\n" +
				"• 가입일: " +
				formatDate(memberInfo.join) +
				"\n" +
				"• 총 출석일: " +
				(memberInfo.cnt || 0) +
				"일\n" +
				"• 보유 포인트: 🅟" +
				numberWithCommas(memberInfo.point || 0) +
				"\n" +
				"• 타이틀 개수: " +
				titleList.length +
				"개\n" +
				"• 펫타이틀 개수: " +
				petTitleList.length +
				"개\n" +
				"• 경험치: " +
				currentExp +
				" / " +
				nextLevelExp +
				" (" +
				expPercent +
				"%)\n" +
				"\n• ━ ✦ 내정보 상세보기 ✦ ━​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​ ​" +
				allsee +
				" \n" +
				"\n• 💌 x " +
				likeCnt +
				" (순위 : " +
				getHomeLikeRank(sender, homeData) +
				"위)" +
				"\n• 💕 x " +
				(memberInfo.like || 0) +
				" (누적 : " +
				totallike +
				")" +
				"\n• 🥕 x " +
				(memberInfo.carrotGiven || 0) +
				" (순위 : " +
				getCarrotRank(sender, data) +
				")" +
				"\n• 🌡️ x " +
				(memberInfo.thermoPoints || 0) +
				" (순위 : " +
				getThermoRank(sender, data) +
				")" +
				"\n• 펫: " +
				getPetInfoText(userPet);

			if (userPet && userPet.miniPet) {
				resultMsg += "\n• 미니펫🐹: " + formatPetInfo(userPet.miniPet);
			}

			if (homeData[sender]) {
				resultMsg += "\n• 펫스윗홈🏡: " + (homeData[sender].houseName || "없음") + "(+" + numberWithCommas(homeTotalExp || 0) + "💕)" + "[+" + (homeData[sender].floor || 0) + "평]";
			}

			replier.reply(resultMsg);
		}

		if (msg === "/타이틀목록") {
			if (titleData.member[sender]) {
				let memberInfo = data.member[sender];
				if (memberInfo) {
					let titleList = titleData.member[sender].title.list;
					let titleNum = titleData.member[sender].title.num;
					if (titleList && titleList.length > 0) {
						let titleOutput = "[" + checkRank(data, petData, guildData, sender) + "]님의 타이틀 목록\n\n";
						if (titleList.length > 10) {
							titleOutput += "타이틀 10개 이상 보유자\n" + allsee;
						}
						titleList.forEach((title, index) => {
							if (index + 1 == titleNum) {
								titleOutput += "☞ ";
							}
							titleOutput += index + 1 + ". " + title.name + "\n";
						});
						titleOutput = titleOutput.trim();
						replier.reply(titleOutput);
					} else {
						replier.reply("보유 타이틀이 없습니다.");
					}
				}
			}
		} else if (msg.startsWith("/타이틀목록 ") && (isAdmin(sender) || sender == "쌍팔 남")) {
			let regexTitleList = /\/타이틀목록\s+([^]+)/;
			let matchTitleList = msg.match(regexTitleList);
			if (matchTitleList) {
				var targetUser = matchTitleList[1].substr(0, 4);
				let memberInfo = data.member[targetUser];
				if (memberInfo) {
					let titleList = titleData.member[targetUser].title.list;
					let titleNum = titleData.member[targetUser].title.num;
					if (titleList && titleList.length > 0) {
						let titleOutput = "[" + checkRank(data, petData, guildData, targetUser) + "]님의 타이틀 목록\n\n";
						if (titleList.length > 10) {
							titleOutput += "타이틀 10개 이상 보유자\n" + allsee;
						}
						titleList.forEach((title, index) => {
							if (index + 1 == titleNum) {
								titleOutput += "☞ ";
							}
							titleOutput += index + 1 + ". " + title.name + "/획득일:" + formatDateTime(title.inDate) + "/가격: 🅟" + numberWithCommas(title.price) + "\n";
						});
						titleOutput = titleOutput.trim();
						replier.reply(titleOutput);
					} else {
						replier.reply("보유 타이틀이 없습니다.");
					}
				} else {
					replier.reply(targetUser + "는(은) 존재하지 않는 사용자입니다.");
				}
			} else {
				replier.reply("올바른 사용법은 /타이틀목록 [유저명] 입니다.");
			}
		}
		if (msg === "/펫타이틀목록") {
			if (petTitleData.member[sender]) {
				let petTitleList = petTitleData.member[sender].title.list;
				let petTitleNum = petTitleData.member[sender].title.num;

				if (petTitleList && petTitleList.length > 0) {
					let titleOutput = "[" + checkRank(data, petData, guildData, sender) + "]님의 펫 타이틀 목록\n\n";
					if (petTitleList.length > 10) {
						titleOutput += "펫 타이틀 10개 이상 보유자\n" + allsee;
					}
					petTitleList.forEach((title, index) => {
						if (index + 1 == petTitleNum) {
							titleOutput += "☞ ";
						}
						titleOutput += index + 1 + ". " + title.name + "\n";
					});
					replier.reply(titleOutput.trim());
				} else {
					replier.reply("보유한 펫 타이틀이 없습니다.");
				}
			} else {
				replier.reply("펫 타이틀 정보가 없습니다.");
			}
		} else if (msg.startsWith("/펫타이틀목록 ") && (isAdmin(sender) || sender == "쌍팔 남")) {
			let regexPetTitleList = /\/펫타이틀목록\s+([^]+)/;
			let matchPetTitleList = msg.match(regexPetTitleList);
			if (matchPetTitleList) {
				var targetUser = matchPetTitleList[1].substr(0, 4);
				if (petTitleData.member[targetUser]) {
					let petTitleList = petTitleData.member[targetUser].title.list;
					let petTitleNum = petTitleData.member[targetUser].title.num;

					if (petTitleList && petTitleList.length > 0) {
						let titleOutput = "[" + checkRank(data, petData, guildData, targetUser) + "]님의 펫 타이틀 목록\n\n";
						if (petTitleList.length > 10) {
							titleOutput += "펫 타이틀 10개 이상 보유자\n" + allsee;
						}
						petTitleList.forEach((title, index) => {
							if (index + 1 == petTitleNum) {
								titleOutput += "☞ ";
							}
							titleOutput += index + 1 + ". " + title.name + "/획득일: " + formatDateTime(title.inDate) + "/가격: 🅟" + numberWithCommas(title.price) + "\n";
						});
						replier.reply(titleOutput.trim());
					} else {
						replier.reply("보유한 펫 타이틀이 없습니다.");
					}
				} else {
					replier.reply(targetUser + "님의 펫 타이틀 정보가 없습니다.");
				}
			} else {
				replier.reply("올바른 사용법은 /펫타이틀목록 [유저명] 입니다.");
			}
		}

		if (msg === "/출석목록") {
			let userList = data.attend_list;
			let userListText1 =
				userList.length > 0
					? userList
							.slice(0, 10)
							.map((user, index) => index + 1 + ". [" + data.member[user].rank.emoji + user + "]")
							.join("\n")
					: "출석한 유저가 없습니다.";
			let userListText2 =
				userList.length > 10
					? userList
							.slice(10)
							.map((user, index) => index + 11 + ". [" + data.member[user].rank.emoji + user + "]")
							.join("\n")
					: "";
			replier.reply("출석한 유저 목록:\n" + userListText1 + allsee + "\n" + userListText2);
		}
		if (msg === "/상점") {
			let itemList = Object.keys(data.shop).map(function (itemName, index) {
				let itemDetails = data.shop[itemName];
				let itemPrice = numberWithCommas(itemDetails);
				let itemTax = ""; //  세금
				if (data.HoiCastle && data.HoiCastle.taxRate) {
					// 세율이 존재하는 경우, 세금 계산 로직
					let taxRate = data.HoiCastle.taxRate; // 세율
					let taxAmount = itemDetails * (taxRate / 100); // 세금 계산
					itemTax = "\n(세금: 🅟" + numberWithCommas(taxAmount.toFixed(0)) + ")"; // 소수점 이하 버림
				}
				return index + 1 + ". " + itemName + " : 🅟" + numberWithCommas(itemPrice) + itemTax;
			});
			if (itemList.length > 0) {
				var lordGuildText = "";

				if (data.HoiCastle && data.HoiCastle.lord) {
					var myGuildInfo = getMyGuildInfo(data, guildData, data.HoiCastle.lord);

					if (myGuildInfo && !myGuildInfo.error && myGuildInfo.guild) {
						lordGuildText = "\n점령중인 길드: " + myGuildInfo.guild.name;
						if (myGuildInfo.guild.mark) {
							lordGuildText += "(" + myGuildInfo.guild.mark + ")";
						}
					}
				}

				let taxRate = data.HoiCastle ? "\n호월킹덤 영주: 🏰" + data.HoiCastle.lord + lordGuildText + "\n(세금💲: " + data.HoiCastle.taxRate + "%)" : null;

				let responseMessage = "🛍호월킹덤 포인트 상점🛍\n" + (taxRate ? taxRate : "") + "\n\n(구매방법:/구매 [번호] [갯수])\n" + "※ 상품을 보시려면 전체보기를 눌러주세요\n";
				// ✅ 여기! 아이템 리스트 출력 직전에 allsee 삽입
				if (typeof allsee !== "undefined") {
					responseMessage += allsee + "\n";
				}

				responseMessage += itemList.join("\n");

				replier.reply(responseMessage);
			} else {
				replier.reply("상점에 아이템이 없습니다.");
			}
		}
		if (msg.startsWith("/미출석 ") && isAdmin(sender)) {
			const regexAttend = /\/미출석\s+(\d+)\s*$/;
			const matchAttend = msg.match(regexAttend);
			if (matchAttend) {
				const daysAgo = parseInt(matchAttend[1], 10);
				const currentDate = getCurrentDate();
				const Userlist = Object.keys(data.member) || [];
				const totalUsers = Userlist.length;
				const inactiveUsers = Userlist.filter((userName) => {
					const lastAttendanceDate = (data.member[userName] && data.member[userName].recent) || "";
					return lastAttendanceDate < currentDate - (daysAgo - 1);
				});
				const numInactiveUsers = inactiveUsers.length;
				replier.reply(
					"전체 등록인원 " + totalUsers + "중 " + numInactiveUsers + "명의 사용자가 최근" + daysAgo + "일 내에 ㅊㅊ하지 않았습니다.\n해당일자내 ㅊㅊ인원 : " + (totalUsers - numInactiveUsers)
				);
				const replyMessage2 = "미출첵 명단 \n\n" + inactiveUsers.join(", ");
				replier.reply(replyMessage2);
			}
		}
		if (msg === "/미니펫대전순위") {
			let ranking = [];
			for (let user in petData) {
				if (petData[user].miniPetBattle && petData[user].miniPetBattle.win >= 50) {
					ranking.push({
						user: user,
						win: petData[user].miniPetBattle.win,
						lose: petData[user].miniPetBattle.lose
					});
				}
			}

			// 정렬 : 승 많은 순 → 패 적은 순 → 이름 가나다
			ranking.sort((a, b) => {
				if (b.win !== a.win) return b.win - a.win;
				if (a.lose !== b.lose) return a.lose - b.lose;
				return a.user.localeCompare(b.user, "ko");
			});

			let resultMsg = "🐹 [ 미니펫 대전 순위 ] 🐹\n(승리 → 적은 패배 → 가나다, 50승 이상만 표시)\n\n";
			if (ranking.length === 0) {
				resultMsg += "아직 50승 이상 유저가 없습니다.";
			} else {
				for (let i = 0; i < ranking.length; i++) {
					if (i === 10 && typeof allsee !== "undefined") {
						resultMsg += allsee;
					}
					let total = ranking[i].win + ranking[i].lose;
					let rate = total > 0 ? Math.round((ranking[i].win / total) * 100) : 0;
					resultMsg += i + 1 + "등 [" + checkRank(data, petData, guildData, ranking[i].user) + "] : " + ranking[i].win + "승 " + ranking[i].lose + "패 (" + rate + "%)\n";
				}
			}

			replier.reply(resultMsg.trim());
			return;
		}

		if (msg === "/미니펫대전승률") {
			let ranking = [];
			for (let user in petData) {
				let battle = petData[user].miniPetBattle;
				if (battle && battle.win + battle.lose >= 50) {
					let total = battle.win + battle.lose;
					let rate = total > 0 ? Math.round((battle.win / total) * 100) : 0;
					ranking.push({
						user: user,
						win: battle.win,
						lose: battle.lose,
						rate: rate
					});
				}
			}

			// 정렬 : 승률 높은 순 → 승 많은 순 → 패 적은 순 → 이름 가나다
			ranking.sort((a, b) => {
				if (b.rate !== a.rate) return b.rate - a.rate;
				if (b.win !== a.win) return b.win - a.win;
				if (a.lose !== b.lose) return a.lose - b.lose;
				return a.user.localeCompare(b.user, "ko");
			});

			let resultMsg = "🐹 [ 미니펫 대전 승률 ] 🐹\n(50판 이상, 승률 → 승리 → 적은 패배 → 가나다)\n\n";
			if (ranking.length === 0) {
				resultMsg += "아직 50판 이상 대전 기록을 가진 유저가 없습니다.";
			} else {
				for (let i = 0; i < ranking.length; i++) {
					if (i === 10 && typeof allsee !== "undefined") {
						resultMsg += allsee;
					}
					resultMsg += i + 1 + "등 [" + checkRank(data, petData, guildData, ranking[i].user) + "] : " + ranking[i].win + "승 " + ranking[i].lose + "패 (" + ranking[i].rate + "%)\n";
				}
			}

			replier.reply(resultMsg.trim());
			return;
		}

		if (msg === "/펫강순위") {
			let petUpgradeRanking = generatePetUpgradeRanking(petData, data.member);
			let resultMsg = "🐾 펫 강화 순위 🐾\n\n";
			resultMsg += petUpgradeRanking.rankingMsg1 + allsee + petUpgradeRanking.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/누좋순위") {
			let like2Ranking = generatelike2Ranking(data.member);
			let resultMsg = "💓 누적 좋아요 순위 💓\n\n";
			resultMsg += like2Ranking.rankingMsg1 + allsee + like2Ranking.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/누렙순위") {
			let Usr2Ranking = generate2Ranking(data.member);
			let resultMsg = "🏆 누적 레벨 순위 🏆\n\n";
			resultMsg += Usr2Ranking.rankingMsg1 + allsee + Usr2Ranking.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/영주수익순위") {
			let rankData = generateEarningsRanking(data.member);
			let resultMsg = "🏰 영주 수익 순위 🏰\n\n";
			resultMsg += rankData.rankingMsg1 + allsee + rankData.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/정령순위") {
			let rankData = generateElementalRanking(petData, data.member);
			let resultMsg = "🔯 정령 강화순위 🔯\n\n";
			resultMsg += rankData.rankingMsg1 + allsee + rankData.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/반지순위") {
			let rankData = generateRingRanking(petData, data.member);
			let resultMsg = "💍 반지 강화순위 💍\n\n";
			resultMsg += rankData.rankingMsg1 + allsee + rankData.rankingMsg2;
			replier.reply(resultMsg);
		} else if (msg === "/종합순위" || msg === "ㅈㅈㅈ") {
			let homeData = loadJsonFile(homeDataFile);
			homeData = initSweetHomeUser(homeData, sender);
			let rankData = generateRanking(data, petData, homeData, petSkillData);
			let resultMsg = '👑 종합 순위 👑\n["/펫정보"에 있는 매력+강화로 합산]\n[캐슬⚔️+레이드👾+펫강화⭐️1강*300]\n[하루에 한번 1등~150등 차등으로 보상됩니다.]\n(/종합순위보상) 참조\n\n';
			resultMsg += rankData.rankingMsg1 + allsee + rankData.rankingMsg2;
			replier.reply(resultMsg);
		}

		if (msg == "/티어순위") {
			let userPoints = {};
			let members = data.member;

			for (let user in members) {
				if (!members || !members[user]) continue;

				let regular = members[user].bag["티어 승급티켓🎟"] || 0;
				let advanced = members[user].bag["고급 티어 승급티켓🎫"] || 0;
				let total = regular + advanced * 5;

				userPoints[user] = total;
			}

			let sortedUsers = Object.keys(userPoints).sort(function (a, b) {
				return userPoints[b] - userPoints[a];
			});

			let rankingMsg1 = ""; // 상위 10위
			let rankingMsg2 = ""; // 나머지

			for (let i = 0; i < sortedUsers.length; i++) {
				let username = sortedUsers[i];
				let point = userPoints[username];
				let Rsender = members[username].rank.emoji + username;
				let rankEmoji = getRankEmoji(i + 1);
				let line = rankEmoji + Rsender + " - pt: " + numberWithCommas(point) + "\n";

				if (i < 10) {
					rankingMsg1 += line;
				} else {
					rankingMsg2 += line;
				}
			}

			resultMsg = "🌟티어 순위🌟\n\n[🎟일반 1pt 🎫고급 5pt 적용]\n";
			resultMsg += rankingMsg1.trim();
			resultMsg += allsee + "\n";
			resultMsg += rankingMsg2;

			replier.reply(resultMsg);
		}

		if (msg == "/티어확인") {
			var tierInfo = {};

			for (var user in data.member) {
				if (!data.member || !data.member[user]) {
					replier.reply(user + " 정보 내 데이터가 없습니다.");
					return;
				}
				if (!data.member[user].rank || !data.member[user].rank.tier) {
					replier.reply(user + "님의 정보에 티어데이터가 없습니다.");
					return;
				}

				var userTier = data.member[user].rank.tier;
				if (!tierInfo[userTier]) {
					tierInfo[userTier] = [];
				}
				tierInfo[userTier].push(user);
			}

			var rankList = "[티어]\n현재 티어 정보:\n";
			var tierNames = Object.keys(ticketTierData);
			var tierCount = 0;

			for (var i = tierNames.length - 1; i >= 0; i--) {
				var tier = tierNames[i];
				var users = tierInfo[tier] || [];
				var emoji = ticketTierData[tier].emoji || "";

				tierCount++;
				rankList += tierCount + ". " + emoji + tier + ": ";
				rankList += users.length > 0 ? users.join(", ") : "-";
				rankList += "\n";

				// 10번째 티어 다음 줄에 문구 추가 (단 1회만)
				if (tierCount === 10) {
					rankList += allsee;
				}
			}

			replier.reply(rankList.trim());
		}

		if (msg === "/펫상태") {
			let petInfo = petData[sender];
			if (petInfo.petname) {
				if (petInfo.newimg) {
					petInfo.petimg = petInfo.newimg;
				}
				replier.reply(petInfo.petimg);
			}
		}
		if (msg === "/미니펫통계") {
			var miniPetData = loadJsonFile(miniPetPath);
			let output = getMiniPetGradeStats(petData, miniPetData.gradeTable);
			if (!output.includes("등급")) {
				replier.reply("📦 보유 중인 미니펫이 없습니다.");
			} else {
				replier.reply(output);
			}
		}

		if (msg === "/펫정보" || msg === "ㅁㅁㅁ") {
			var homeData = loadJsonFile(homeDataFile);
			homeData = initSweetHomeUser(homeData, sender);
			var petExploreData = loadJsonFile(petExplorePath);
			var trialTower = loadJsonFile(trialTowerPath);
			var petInfo = petData[sender];

			var castleBattleData = loadJsonFile(castleBattlePath);

			if (!petInfo || !petInfo.petname) {
				replier.reply("펫을 먼저 생성해주세요.");
				return;
			}

			// 이미지/기본값 보정
			if (petInfo.newimg) petInfo.petimg = petInfo.newimg;
			if (!petInfo.upgrade) petInfo.upgrade = 0;
			if (!petInfo.petexp) petInfo.petexp = 0;

			// 홈 매력
			var homeTotalExp = getHomeTotalExp(homeData, sender) || 0;

			// 미니펫(없으면 0)
			var miniPet = petData[sender] && petData[sender].miniPet ? petData[sender].miniPet : { raidExp: 0, castleExp: 0, petexp: 0 };

			// 치명타
			var critChance = getCritChance(petInfo.upgrade);

			// 친밀도
			var intimacyMsg = getIntimacyLvFromBag(data.member[sender].bag); // 친밀도 표기
			var intimacyRank = getIntimacyUserRank(data, sender); // 친밀도 랭킹
			var intimacyExp = getUserIntimacyInfo(data, sender).exp;

			// 레이드/캐슬 원본 수치(기존 /펫정보식)
			var raidExpNum = calculateRaidExp(sender, data, petData, homeData, petSkillData) || 0;
			var castleExpNum = calculateCastleExp(sender, data, petData, homeData, petSkillData) || 0;

			// 종합매력(/종합순위 공식과 동일)
			var totalExpNum = calculateTotalExp(sender, data, petData, homeData, petSkillData);

			// 약식 표기
			var raidShort = formatKoreanShort(raidExpNum);
			var castleShort = formatKoreanShort(castleExpNum);

			// 랭킹/칭호
			var memberRank = getMemberRank(sender, data, petData, homeData, petSkillData);
			var activePetTitle = getTitle(data.member[sender], petTitleData.member[sender]);

			// 펫강화 라인
			var critMul = getCritMultiplier(petInfo.upgrade);
			var upgradeLine = "펫강화⭐️: " + (petInfo.upgrade || 0) + "강(💥" + critChance + "%)[" + critMul + "배]";

			var skillStore = initPetSkillUser(petSkillData, sender);
			var skillSlot = getPetSkillSlotCount(data, petSkillData, sender);

			// 기록: 시련탑(요구사항: 5)
			var towerUsed = data.member[sender] && data.member[sender].towerCnt ? data.member[sender].towerCnt : 0;
			var towerMax = GLOBAL_LIMITS.daily.trialTowerMax;
			var towerFloor = trialTower.user && trialTower.user[sender] ? trialTower.user[sender].floor || 0 : 0;

			// 기록: 캐슬대전(요구사항: 5)
			var battleObj = data.member[sender] && data.member[sender].battle ? data.member[sender].battle : null;
			var castleUsed = battleObj ? battleObj.count || 0 : 0;
			var castleMax = GLOBAL_LIMITS.daily.castleBattleMax;
			var castleScore = battleObj ? battleObj.score || 0 : 0;
			var castleRankName = getCastleBattleRankEmoji(data.member[sender].battle.score, castleBattleData);

			// 기록: 미니펫대전(요구사항: 5)
			var miniBattle = petData[sender] && petData[sender].miniPetBattle ? petData[sender].miniPetBattle : { win: 0, lose: 0, count: 0 };
			var miniWin = miniBattle.win || 0;
			var miniLose = miniBattle.lose || 0;
			var miniTotal = miniWin + miniLose;
			var miniRate = miniTotal > 0 ? ((miniWin / miniTotal) * 100).toFixed(2) : "0.00";
			var miniUsed = miniBattle.count || 0;
			var miniMax = GLOBAL_LIMITS.daily.miniPetBattleMax;

			// 기록: 레이드(요구사항: 5)
			var raidUsed = petData[sender] && petData[sender].raidItemCount ? petData[sender].raidItemCount : 0;
			var raidMax = 5;
			var raidItemCnt = data.member[sender].bag["혼자레이드리셋권😝"] || 0;

			var rec = petExploreData.record && petExploreData.record[sender] ? petExploreData.record[sender] : null;
			var win = rec && typeof rec.win === "number" ? rec.win : 0;
			var lose = rec && typeof rec.lose === "number" ? rec.lose : 0;
			var exploreCount = data.member[sender].exploreCnt;
			var dailyQuestRewardDone = ((data.member[sender] && data.member[sender].dailyQuestCnt) || 0) >= 1;
			var dailyQuestRewardMsg = dailyQuestRewardDone ? "[🅾️일일퀘스트 보상지급 완료🅾️]" : "[❌일일퀘스트 보상지급 미완료❌]";
			var weeklyQuestMax = 7;
			var weeklyQuestCnt = Math.max(0, Math.min(parseInt(data.member[sender].weeklyQuestCnt, 10) || 0, weeklyQuestMax));
			var weeklyQuestRemain = Math.max(0, weeklyQuestMax - weeklyQuestCnt);
			var weeklyQuestGuideMsg = weeklyQuestRemain <= 0 ? "(주간퀘스트🦋 보상 수령 가능✅)" : "(주간퀘스트🦋 보상까지 " + weeklyQuestRemain + "번 남았습니다)";
			var questGuideMessages = ["('/정리' or 'ㅇㅇㅇ'만 해도 자동지급!)", "(👉전부 ✅ /퀘스트완료 or /ㅇ 시 보상지급!)", "(일일퀘스트 7번을 완료하면 주간보상!)", weeklyQuestGuideMsg];
			var questGuideMsg = questGuideMessages[Math.floor(Math.random() * questGuideMessages.length)];

			// 메시지 구성
			var resultMsg = "";
			if (activePetTitle) {
				resultMsg += "⭒━" + activePetTitle + "━⭒\n";
			}

			resultMsg += "[" + checkRank(data, petData, guildData, sender) + "]의 펫정보🐶";
			if (memberRank) resultMsg += "(" + memberRank + "등👑)";
			resultMsg += "\n";

			resultMsg += "이름📝: " + petInfo.petname + " " + petInfo.petimg + " | 속성♻️: " + petInfo.pettype + "\n";
			resultMsg += "성격😶: " + petInfo.pettitle + "\n";
			resultMsg += intimacyMsg + "(" + (intimacyRank > 0 ? intimacyRank + "등🍼" : "순위없음") + ")\n"; //친밀도

			resultMsg += "━━━ ✦ 종합 스탯 ✦ ━━━\n";
			resultMsg += "종합매력👑: " + formatKoreanShort(totalExpNum) + "💞\n";
			resultMsg += "└ 합산: 캐슬매력⚔️: " + castleShort + "\n";
			resultMsg += " └ 레이드매력👾: " + raidShort + "\n";
			resultMsg += upgradeLine + "\n";
			resultMsg += "펫스킬📙: [장착중 " + skillStore.equipped.length + "/" + skillSlot + '] "/펫스킬"\n';
			// 기록
			resultMsg += "━ ✦ (일일주간 · 장비 상세보기) ✦ ━ \n";
			resultMsg +=
				"[😈" +
				getC(towerUsed >= towerMax) +
				"]" +
				"[🏆" +
				getC(castleUsed >= castleMax) +
				"]" +
				"[🐹" +
				getC(miniUsed >= miniMax) +
				"]" +
				"[⛰️" +
				getC(exploreCount >= GLOBAL_LIMITS.daily.petExploreMax) +
				"]" +
				"\n" +
				dailyQuestRewardMsg +
				"\n" +
				questGuideMsg +
				allsee;

			resultMsg += "\n━━━ ✦ 장비 정보 ✦ ━━━\n";
			if (petInfo.elemental) {
				resultMsg += "정령🔯: " + petInfo.elemental.name + "[" + petInfo.elemental.grade + "]" + "(+" + petInfo.elemental.upgrade + ")\n";
			}
			if (petInfo.ring) {
				resultMsg += "반지💍: " + petInfo.ring.name + "[" + petInfo.ring.grade + "]" + "(+" + petInfo.ring.upgrade + ")\n";
			}

			// 미니펫/홈
			if (petData[sender] && petData[sender].miniPet) {
				resultMsg += "미니🐹: " + formatPetInfo(petData[sender].miniPet);
				if (petData[sender].miniPet.upgrade) {
					resultMsg += "(" + getMiniPetUpgradeDisplay(petData[sender].miniPet) + "💫)";
				}
				resultMsg += "\n";
			} else {
				resultMsg += "미니펫🐹: 펫 나만 없어..\n";
			}

			if (homeData[sender]) {
				resultMsg += "펫홈🏡: " + homeData[sender].houseName + "(+" + numberWithCommas(homeTotalExp) + "💕)" + "[+" + homeData[sender].floor + "평]\n";
			}

			resultMsg += "━ ✦ (일일 · 주간 퀘스트 상세정보) ✦ ━ \n";

			resultMsg += formatDoneLine("시련탑😈", towerUsed, towerMax, towerFloor + "층 공략") + "\n";
			resultMsg += formatDoneLine("캐대전🏆", castleUsed, castleMax, numberWithCommas(castleScore) + "pt(" + castleRankName + ")") + "\n";
			resultMsg += formatDoneLine("미대전🐹", miniUsed, miniMax, numberWithCommas(miniWin) + "승(" + miniRate + "%)") + "\n";
			// resultMsg += formatDoneLine("레이드👾", raidUsed, raidMax, "남은 혼레리:" + numberWithCommas(raidItemCnt) + "개") + "\n";

			// 펫 탐험
			var rec = petExploreData.record && petExploreData.record[sender] ? petExploreData.record[sender] : null;
			var win = rec && typeof rec.win === "number" ? rec.win : 0;
			var lose = rec && typeof rec.lose === "number" ? rec.lose : 0;

			var rankInfo = getPetExploreRank(data, petExploreData, sender);
			var rankText = rankInfo ? rankInfo.rank + "등" : "순위없음";

			resultMsg += formatDoneLine("펫탐험⛰️", exploreCount, 10, numberWithCommas(win) + "승 (순위: " + rankText + ")") + "\n";
			resultMsg += "주간퀘스트🦋[" + weeklyQuestCnt + "/" + weeklyQuestMax + "]: " + getWeeklyQuestRemainText(weeklyQuestCnt, weeklyQuestMax) + "\n";

			// 출력
			replier.reply(petInfo.petimg);
			replier.reply(resultMsg);
			return;
		}

		if (msg === "/펫매력순위") {
			let petRanking = generatePetRanking(petData);
			let resultMsg = "🏆 [펫]매력 순위 🏆\n\n";
			resultMsg += petRanking.rankingMsg1 + allsee + petRanking.rankingMsg2;
			replier.reply(resultMsg);
		}
		if (msg === "/캐슬매력순위") {
			let homeData = loadJsonFile(homeDataFile);
			homeData = initSweetHomeUser(homeData, sender);
			let castleRanking = generateCastleRanking(petData, data, homeData);

			let resultMsg = "🏆 [펫] 캐슬매력 순위 🏆\n\n";
			resultMsg += castleRanking.rankingMsg1 + allsee + castleRanking.rankingMsg2;

			replier.reply(resultMsg);
		}
		if (msg === "/레이드매력순위") {
			let homeData = loadJsonFile(homeDataFile);
			homeData = initSweetHomeUser(homeData, sender);
			let raidRanking = generateRaidRanking(petData, data, homeData);
			let resultMsg = "🏆 [펫]레이드매력 순위 🏆\n\n";
			resultMsg += raidRanking.rankingMsg1 + allsee + raidRanking.rankingMsg2;
			replier.reply(resultMsg);
		}
		if (msg == "/시련의탑순위") {
			var trialTower = loadJsonFile(trialTowerPath);
			let rank = trialTowerRanking(data, petData, guildData, trialTower);
			let resultMsg = "😈 [펫] 시련의탑 순위 😈\n\n";
			resultMsg += rank.rankingMsg1 + allsee + rank.rankingMsg2;
			replier.reply(resultMsg);
		}
		if (msg == "/가구통계") {
			let homeData = loadJsonFile(homeDataFile);

			// 등급별 카운트 저장용
			let gradeCount = {};
			let total = 0;

			// 유저별 가구 확인
			let users = Object.keys(homeData);

			for (let i = 0; i < users.length; i++) {
				let user = users[i];
				let udata = homeData[user];

				if (!udata.furnitureBag || udata.furnitureBag.length == 0) continue;

				let bag = udata.furnitureBag;

				for (let j = 0; j < bag.length; j++) {
					let g = (bag[j] && bag[j].grade) || "기타";
					if (!gradeCount[g]) gradeCount[g] = 0;
					gradeCount[g]++;
					total++;
				}
			}

			if (total == 0) {
				replier.reply("📭 등록된 가구가 없습니다.");
				return;
			}

			// 출력 정렬: 개수 많은 순
			let grades = Object.keys(gradeCount).sort(function (a, b) {
				return gradeCount[b] - gradeCount[a];
			});

			let msgOut = "📊 전체 가구 등급별 통계 📊\n\n";
			msgOut += "총합: " + numberWithCommas(total) + "개\n\n" + allsee;

			for (let i = 0; i < grades.length; i++) {
				let g = grades[i];
				let count = gradeCount[g];
				let percent = ((count / total) * 100).toFixed(1);

				msgOut += "- " + g + " [" + percent + "%]: " + numberWithCommas(count) + "개\n";
			}

			replier.reply(msgOut);
			return;
		}
		if (msg == "/서버통계") {
			var members = data.member || {};
			var serverCount = {};
			var total = 0;
			var unknown = 0;

			var names = Object.keys(members);
			for (var i = 0; i < names.length; i++) {
				var name = names[i];
				var m = members[name];

				// 서버 정보가 없으면 미등록
				if (!m.server || m.server === "") {
					unknown++;
					continue;
				}

				var serverName = m.server;

				if (!serverCount[serverName]) {
					serverCount[serverName] = 0;
				}
				serverCount[serverName]++;
				total++;
			}

			if (names.length == 0) {
				replier.reply("📭 등록된 유저가 없습니다.");
				return;
			}

			// 서버 이름 기준 정렬
			var serverNames = Object.keys(serverCount).sort(function (a, b) {
				return a.localeCompare(b, "ko");
			});

			var msgOut = "📊 서버유저 통계 📊\n\n";
			msgOut += "서버 전체인원: " + total + "명\n\n" + allsee;
			msgOut += "가능 서버:\n";

			for (var j = 0; j < serverNames.length; j++) {
				var sName = serverNames[j];
				var cnt = serverCount[sName];
				msgOut += "- " + sName + ": " + cnt + "명\n";
			}

			if (unknown > 0) {
				msgOut += "\n※ 서버 미등록 인원: " + unknown + "명";
			}

			replier.reply(msgOut);
			return;
		}

		if (msg === "/펫주인" && (sender == "호이 남" || sender == "젤리 남")) {
			let ownermsg = "🐶펫 주인확인🐱\n\n";
			for (let user in data.member) {
				if (petData[user] && petData[user].petname) {
					if (petData[user].newimg) {
						petData[user].petimg = petData[user].newimg;
					}
					ownermsg += "[" + checkRank(data, petData, guildData, user) + "] - " + petData[user].petimg + petData[user].petname + "💕" + petData[user].petexp + "\n";
				}
			}
			replier.reply(ownermsg);
		}
		if (msg === "/포인트확인" && (sender == "호이 남" || sender == "젤리 남")) {
			let pointRank = pointRanking(data.member);
			let resultMsg = "🏆 포인트 잔액 순위 🏆\n\n";
			resultMsg += pointRank;
			replier.reply(resultMsg);
		}
		
		if (msg === "/캐슬전적") {
			var castleBattleData = loadJsonFile(castleBattlePath);

			let senderObj = data.member[sender];
			let totalGames = senderObj.battle.win + senderObj.battle.lose;
			let winRatio = totalGames > 0 ? (senderObj.battle.win / totalGames) * 100 : 0;
			let miniPetExp = (petData[sender] && petData[sender].miniPet && petData[sender].miniPet.castleExp) || 0; // 미니펫 캐슬 경험치

			let castleExp = numberWithCommas(calculateCastleItem(sender, data) + calculateItemInfoAll(sender, data, petData).castleExp + petData[sender].petexp + miniPetExp); // 캐슬아이템 + 아이템ll 캐슬매력 + 기본매력 미니펫 캐슬매력

			let message = "[" + checkRank(data, petData, guildData, sender) + "] 님의 캐슬전적\n\n";
			message += "이름 : " + petData[sender].petname + petData[sender].petimg + castleExp + "💕(" + (petData[sender].upgrade || 0) + "⭐)\n";
			message += "전적 : " + (senderObj.battle.win || 0) + "승 " + (senderObj.battle.lose || 0) + "패" + "(" + winRatio.toFixed(2) + "%)\n";
			message += "등급 : " + getCastleBattleRankEmoji(senderObj.battle.score, castleBattleData) + "\n";
			message += "캐슬포인트(CP) : " + numberWithCommas(senderObj.battle.score) + "pt🏆";

			let rank = getCastleBattleRank(sender, data);
			if (rank) {
				message += "\n캐슬대전순위 : " + numberWithCommas(rank) + "위";
			}

			replier.reply(message);
		} else if (msg === "/캐슬대전순위") {
			var castleBattleData = loadJsonFile(castleBattlePath);
			let sortedMembers = sortCastleBattle(data);
			let message = "🏆 캐슬대전 순위 🏆\n\n";

			// 순위 출력
			sortedMembers.forEach((member, index) => {
				let rank = index + 1;
				let rankEmoji = getCastleBattleRankEmoji(member.score, castleBattleData);
				message += getRankEmoji(rank) + "[" + checkRank(data, petData, guildData, member.name) + "] " + rankEmoji + " : " + member.score + "pt\n";
				if (rank == 3) {
					message += allsee;
				}
			});

			replier.reply(message);
		}
	} catch (error) {
		if (msg.startsWith("/")) {
			let errorObj = { system: "info", error: error, msg: msg, room: room, sender: sender };
			Api.replyRoom(testRoom, "[ ERROR : Info error ]" + allsee + JSON.stringify(errorObj));
		}
		FileStream.write(errorLogPath, JSON.stringify(errorObj), "utf-8"); // 명시적으로 UTF-8 인코딩 사용
	} finally {
		exitCommandContext(prevCtx);
		applyItemInfoContext(productionItemInfoData);
	}
}
// JSON 파일 로드 함수
function isDevCommandMessage(msg) {
	return typeof msg === "string" && msg.indexOf("dev/") === 0;
}

function stripDevCommandPrefix(msg) {
	var command = String(msg || "").substring("dev/".length).trim();
	if (!command) return "";
	return command.charAt(0) === "/" ? command : "/" + command;
}

function createCommandContext(isDev) {
	var rootPath = isDev ? DEV_DATA_ROOT_PATH : DATA_ROOT_PATH;
	return {
		isDev: !!isDev,
		rootPath: rootPath,
		path: function (fileName) {
			fileName = String(fileName || "");
			var dataFileName = getDataFileName(fileName);
			if (!dataFileName && fileName.indexOf("/") === -1 && fileName.indexOf("\\") === -1) {
				dataFileName = fileName;
			}
			if (this.isDev && dataFileName && !COMMON_DATA_FILE_MAP[dataFileName]) {
				return this.rootPath + dataFileName;
			}
			if (dataFileName && fileName === dataFileName) {
				return DATA_ROOT_PATH + dataFileName;
			}
			return fileName;
		},
		header: function (message) {
			return this.isDev ? "[DEV 테스트환경]\n" + message : message;
		}
	};
}

function getCurrentContext() {
	var ctx = commandContextThreadLocal.get();
	return ctx || createCommandContext(false);
}

function enterCommandContext(ctx) {
	var previous = commandContextThreadLocal.get();
	commandContextThreadLocal.set(ctx || createCommandContext(false));
	return previous;
}

function exitCommandContext(previous) {
	if (previous) {
		commandContextThreadLocal.set(previous);
	} else {
		commandContextThreadLocal.remove();
	}
}

function createContextReplier(replier, ctx) {
	return {
		reply: function (message) {
			replier.reply(ctx.header(message));
		}
	};
}

function getDataFileName(path) {
	path = String(path || "");
	if (path.indexOf(DATA_ROOT_PATH) !== 0) return null;
	return path.substring(DATA_ROOT_PATH.length);
}

function resolveActiveDataPath(path) {
	return getCurrentContext().path(path);
}

function getMissingDevDataFiles() {
	var missing = [];
	var sourceRoot = new java.io.File(DATA_ROOT_PATH);
	var sourceFiles = sourceRoot.listFiles();
	if (!sourceFiles) return ["운영 데이터 폴더를 읽을 수 없습니다."];

	for (var i = 0; i < sourceFiles.length; i++) {
		var sourceFile = sourceFiles[i];
		if (!sourceFile || !sourceFile.isFile()) continue;
		var fileName = String(sourceFile.getName());
		if (COMMON_DATA_FILE_MAP[fileName]) continue;
		var devFile = new java.io.File(DEV_DATA_ROOT_PATH + fileName);
		if (!devFile.exists()) missing.push(fileName);
	}
	return missing;
}

function loadJsonFile(path) {
	try {
		path = resolveActiveDataPath(path);
		let file = new java.io.File(path);
		if (file.exists()) {
			let fileContent = FileStream.read(path, "utf-8"); // 명시적으로 UTF-8 인코딩 사용
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
		const totalLvA = data[a].like + (data[a].like0 || 0);
		const totalLvB = data[b].like + (data[b].like0 || 0);
		return totalLvB - totalLvA;
	});
	let rankingMsg1 = "";
	let rankingMsg2 = "";
	for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
		var username1 = sortedUsrs[i];
		let Rsender1 = data[username1].rank.emoji + username1;
		let UsrInfo1 = data[username1];
		let rankEmoji1 = getRankEmoji(i + 1);
		let totalLv1 = UsrInfo1.like + (UsrInfo1.like0 || 0);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - 💕:" + totalLv1 + "\n";
	}
	for (let i = 10; i < sortedUsrs.length; i++) {
		var username2 = sortedUsrs[i];
		let Rsender2 = data[username2].rank.emoji + username2;
		let UsrInfo2 = data[username2];
		let rankEmoji2 = getRankEmoji(i + 1);
		let totalLv2 = UsrInfo2.like + (UsrInfo2.like0 || 0);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - 💕:" + totalLv2 + "\n";
	}
	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}

// 누적렙순위
function generate2Ranking(data) {
	let sortedUsrs = Object.keys(data).sort((a, b) => {
		const totalLvA = data[a].lv + (data[a].lv0 || 0);
		const totalLvB = data[b].lv + (data[b].lv0 || 0);
		return totalLvB - totalLvA;
	});
	let rankingMsg1 = "";
	let rankingMsg2 = "";
	for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
		var username1 = sortedUsrs[i];
		let Rsender1 = data[username1].rank.emoji + username1;
		let UsrInfo1 = data[username1];
		let rankEmoji1 = getRankEmoji(i + 1);
		let totalLv1 = UsrInfo1.lv + (UsrInfo1.lv0 || 0);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - LV." + totalLv1 + "\n";
	}
	for (let i = 10; i < sortedUsrs.length; i++) {
		var username2 = sortedUsrs[i];
		let Rsender2 = data[username2].rank.emoji + username2;
		let UsrInfo2 = data[username2];
		let rankEmoji2 = getRankEmoji(i + 1);
		let totalLv2 = UsrInfo2.lv + (UsrInfo2.lv0 || 0);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - LV." + totalLv2 + "\n";
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
	let sortedUsrs = Object.keys(data)
		.filter((key) => (data[key].earnings || 0) > 0)
		.sort((a, b) => (data[b].earnings || 0) - (data[a].earnings || 0));
	let rankingMsg1 = "";
	let rankingMsg2 = "";
	for (let i = 0; i < 10; i++) {
		let username1 = sortedUsrs[i];
		let Rsender1 = data[username1].rank.emoji + username1;
		let UsrInfo1 = data[username1];
		if (!UsrInfo1.earnings) UsrInfo1.earnings = 0;
		let rankEmoji1 = getRankEmoji(i + 1);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - 👑: " + numberWithCommas(UsrInfo1.earnings) + "\n";
	}
	for (let i = 10; i < sortedUsrs.length; i++) {
		let username2 = sortedUsrs[i];
		let Rsender2 = data[username2].rank.emoji + username2;
		let UsrInfo2 = data[username2];
		if (!UsrInfo2.earnings) UsrInfo2.earnings = 0;
		let rankEmoji2 = getRankEmoji(i + 1);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - 👑: " + numberWithCommas(UsrInfo2.earnings) + "\n";
	}
	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}

function generateElementalRanking(petData, members) {
	let gradeArray = Object.keys(itemInfoData.elemental);

	let sortedUsrs = Object.keys(members)
		.filter((key) => petData[key] && petData[key].elemental)
		.sort((a, b) => {
			return (
				(gradeArray.indexOf(petData[b].elemental.grade) + 1) * 100 + petData[b].elemental.upgrade - ((gradeArray.indexOf(petData[a].elemental.grade) + 1) * 100 + petData[a].elemental.upgrade)
			);
		});

	let rankingMsg1 = ""; // 상위 10명의 순위 메시지
	let rankingMsg2 = ""; // 나머지 사용자들의 순위 메시지

	// 상위 10명의 사용자 메시지
	for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
		let username1 = sortedUsrs[i];
		let Rsender1 = members[username1].rank.emoji + username1;
		let rankEmoji1 = getRankEmoji(i + 1);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - 강화 레벨: " + (gradeArray.indexOf(petData[username1].elemental.grade) * 100 + petData[username1].elemental.upgrade) + "🔯\n";
	}

	// 나머지 사용자들에 대해 순위 메시지를 작성합니다.
	for (let i = 10; i < sortedUsrs.length; i++) {
		let username2 = sortedUsrs[i];
		let Rsender2 = members[username2].rank.emoji + username2;
		let rankEmoji2 = getRankEmoji(i + 1);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - 강화 레벨: " + (gradeArray.indexOf(petData[username2].elemental.grade) * 100 + petData[username2].elemental.upgrade) + "🔯\n";
	}

	// 상위 10명과 나머지 사용자들의 순위 메시지를 반환합니다.
	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}

function calculateCastleExp(memberName, data, petData, homeData, petSkillData) {
	let castleItem = calculateCastleItem(memberName, data) || 0;
	let itemInfo = calculateItemInfoAll(memberName, data, petData) || { castleExp: 0 };
	let petExp = (petData[memberName] && petData[memberName].petexp) || 0;
	let miniPetExp = (petData[memberName] && petData[memberName].miniPet && petData[memberName].miniPet.castleExp) || 0;
	let homeExp = getHomeTotalExp(homeData, memberName) || 0;
	if (hasPetSkill(petSkillData, memberName, "인테리어 장인")) {
		homeExp = Math.floor(homeExp * 1.1); // 인테리어 장인 스킬 보유 시 가구 매력 10% 추가
	}

	var bagItems = data && data.member && data.member[memberName] && data.member[memberName].bag ? data.member[memberName].bag : null;
	var intimacyExp = getIntimacyExpFromBag(bagItems);

	// 펫 스킬 
	var skillExp = hasPetSkill(petSkillData, memberName, "장미칼") ? 500000 : 0;
	skillExp += hasPetSkill(petSkillData, memberName, "청룡언월도") ? 1000000 : 0;
	if (hasPetSkill(petSkillData, memberName, "창조림") && hasEquippedCreationMiniPet(petData, memberName)) {
		skillExp += 500000;
	}
	if (hasPetSkill(petSkillData, memberName, "로열 하우스")) {
		var royalLumiereCount = getPlacedFurnitureCountByGrade(homeData, memberName, "로열 루미에르");
		if (royalLumiereCount >= 10) {
			skillExp += 150000;
		}
	}
	return castleItem + itemInfo.castleExp + petExp + miniPetExp + homeExp + intimacyExp + skillExp;
}

function calculateRaidExp(memberName, data, petData, homeData, petSkillData) {
	let itemInfo = calculateItemInfoAll(memberName, data, petData) || { raidExp: 0 }; // `null` 또는 `undefined` 방지
	let petExp = (petData[memberName] && petData[memberName].petexp) || 0; // `petData` 값이 없을 때 `0` 반환
	let miniPetExp = (petData[memberName] && petData[memberName].miniPet && petData[memberName].miniPet.raidExp) || 0; // 미니펫 레이드 경험치
	let homeExp = getHomeTotalExp(homeData, memberName) || 0;
	if (hasPetSkill(petSkillData, memberName, "인테리어 장인")) {
		homeExp = Math.floor(homeExp * 1.1); // 인테리어 장인 스킬 보유 시 가구 매력 10% 추가
	}

	// 펫스킬
	let skillExp = hasPetSkill(petSkillData, memberName, "장미칼") ? 500000 : 0;
	skillExp += hasPetSkill(petSkillData, memberName, "청룡언월도") ? 1000000 : 0;
	if (hasPetSkill(petSkillData, memberName, "창조림") && hasEquippedCreationMiniPet(petData, memberName)) {
		skillExp += 500000;
	}
	if (hasPetSkill(petSkillData, memberName, "로열 하우스")) {
		var royalLumiereCount = getPlacedFurnitureCountByGrade(homeData, memberName, "로열 루미에르");
		if (royalLumiereCount >= 10) {
			skillExp += 150000;
		}
	}
	return itemInfo.raidExp + petExp + miniPetExp + homeExp + skillExp; // 아이템 정보의 레이드 경험치 + 펫 경험치 + 미니펫 레이드 경험치 + 홈 경험치
}

function generateRanking(data, petData, homeData, petSkillData) {
	let members = data.member;
	let userScores = [];

	// 사용자별 점수 계산 후 배열에 저장
	for (let key in members) {
		if (petData[key]) {
			let castleExp = calculateCastleExp(key, data, petData, homeData, petSkillData) || 0;
			let raidExp = calculateRaidExp(key, data, petData, homeData, petSkillData) || 0;
			let upgradeBonus = (petData[key].upgrade || 0) * 300;

			let totalExp = castleExp + raidExp + upgradeBonus;

			userScores.push({ key: key, totalExp: totalExp });
		}
	}

	// 점수를 기준으로 정렬
	userScores.sort((a, b) => b.totalExp - a.totalExp);

	let rankingMsg1 = ""; // 상위 10명 메시지
	let rankingMsg2 = ""; // 나머지 메시지

	// 순위 메시지 생성
	for (let i = 0; i < userScores.length; i++) {
		let memberName = userScores[i].key;
		let Rsender = members[memberName].rank.emoji + memberName;
		let rankEmoji = getRankEmoji(i + 1);
		let message = rankEmoji + Rsender + " - 👑 " + numberWithCommas(userScores[i].totalExp) + "\n";

		if (i < 10) {
			rankingMsg1 += message;
		} else {
			rankingMsg2 += message;
		}
	}

	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}

function getMemberRank(memberName, data, petData, homeData, petSkillData) {
	let members = data.member;
	let userScores = [];

	// 사용자별 점수 계산 후 배열에 저장
	for (let key in members) {
		if (petData[key]) {
			let castleExp = calculateCastleExp(key, data, petData, homeData, petSkillData) || 0;
			let raidExp = calculateRaidExp(key, data, petData, homeData, petSkillData) || 0;
			let upgradeBonus = (petData[key].upgrade || 0) * 300;
			let totalExp = castleExp + raidExp + upgradeBonus;

			userScores.push({ key: key, totalExp: totalExp });
		}
	}

	// 점수를 기준으로 정렬
	userScores.sort((a, b) => b.totalExp - a.totalExp);

	// 특정 멤버의 순위 찾기
	for (let i = 0; i < userScores.length; i++) {
		if (userScores[i].key === memberName) {
			return i + 1; // 순위는 1부터 시작
		}
	}

	return -1; // 해당 멤버가 순위에 없음
}

// function generateRanking(data, petData) {
//   let members = data.member;
//   let sortedUsrs = Object.keys(members)
//     .filter(key => petData[key] && petData[key].ring)
//     .sort((a, b) => {
//       let A = calculateCastleExp(a, data, petData) + calculateRaidExp(a, data, petData) + (petData[a].upgrade * 300);
//       let B = calculateCastleExp(b, data, petData) + calculateRaidExp(b, data, petData) + (petData[b].upgrade * 300);
//       return B - A;
//     });

//   let rankingMsg1 = '';  // 상위 10명의 순위 메시지
//   let rankingMsg2 = '';  // 나머지 사용자들의 순위 메시지

//   // 상위 10명의 사용자 메시지
//   for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
//     let memberName = sortedUsrs[i];
//     let Rsender1 = members[memberName].rank.emoji + memberName;
//     let rankEmoji1 = getRankEmoji(i + 1);
//     rankingMsg1 += rankEmoji1 + Rsender1 + ' - 👑 ' + numberWithCommas(calculateCastleExp(memberName, data, petData) + calculateRaidExp(memberName, data, petData) + (petData[memberName].upgrade * 300)) + '\n';
//   }

//   // 나머지 사용자들에 대해 순위 메시지를 작성합니다.
//   for (let i = 10; i < sortedUsrs.length; i++) {
//     let memberName = sortedUsrs[i];
//     let Rsender2 = members[memberName].rank.emoji + memberName;
//     let rankEmoji2 = getRankEmoji(i + 1);
//     rankingMsg2 += rankEmoji2 + Rsender2 + ' - 👑 ' + numberWithCommas(calculateCastleExp(memberName, data, petData) + calculateRaidExp(memberName, data, petData) + (petData[memberName].upgrade * 300)) + '\n';
//   }

//   // 상위 10명과 나머지 사용자들의 순위 메시지를 반환합니다.
//   return {
//     rankingMsg1: rankingMsg1,
//     rankingMsg2: rankingMsg2
//   };
// };

function generateRingRanking(petData, members) {
	let gradeArray = Object.keys(itemInfoData.ring);

	let sortedUsrs = Object.keys(members)
		.filter((key) => petData[key] && petData[key].ring)
		.sort((a, b) => {
			return (gradeArray.indexOf(petData[b].ring.grade) + 1) * 100 + petData[b].ring.upgrade - ((gradeArray.indexOf(petData[a].ring.grade) + 1) * 100 + petData[a].ring.upgrade);
		});

	let rankingMsg1 = ""; // 상위 10명의 순위 메시지
	let rankingMsg2 = ""; // 나머지 사용자들의 순위 메시지

	// 상위 10명의 사용자 메시지
	for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
		let username1 = sortedUsrs[i];
		let Rsender1 = members[username1].rank.emoji + username1;
		let rankEmoji1 = getRankEmoji(i + 1);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - 강화 레벨: " + (gradeArray.indexOf(petData[username1].ring.grade) * 100 + petData[username1].ring.upgrade) + "💍\n";
	}

	// 나머지 사용자들에 대해 순위 메시지를 작성합니다.
	for (let i = 10; i < sortedUsrs.length; i++) {
		let username2 = sortedUsrs[i];
		let Rsender2 = members[username2].rank.emoji + username2;
		let rankEmoji2 = getRankEmoji(i + 1);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - 강화 레벨: " + (gradeArray.indexOf(petData[username2].ring.grade) * 100 + petData[username2].ring.upgrade) + "💍\n";
	}

	// 상위 10명과 나머지 사용자들의 순위 메시지를 반환합니다.
	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}
// 펫강화순위 생성 함수
function generatePetUpgradeRanking(petData, members) {
	// 필터링: 펫이 있고 강화 레벨이 1 이상인 사용자만 포함
	let sortedUsrs = Object.keys(members)
		.filter((key) => petData[key] && petData[key].upgrade && petData[key].upgrade > 0)
		.sort((a, b) => {
			if (petData[b].upgrade === petData[a].upgrade) {
				// 강화 레벨이 동일하면 강화 성공 시간을 비교
				return new Date(petData[a].upgradeDateTime) - new Date(petData[b].upgradeDateTime);
			}
			// 강화 레벨이 다르면 강화 레벨을 기준으로 정렬
			return petData[b].upgrade - petData[a].upgrade;
		});

	let rankingMsg1 = ""; // 상위 10명의 순위 메시지
	let rankingMsg2 = ""; // 나머지 사용자들의 순위 메시지

	// 상위 10명의 사용자 메시지
	for (let i = 0; i < 10 && i < sortedUsrs.length; i++) {
		let username1 = sortedUsrs[i];
		let Rsender1 = members[username1].rank.emoji + username1;
		let rankEmoji1 = getRankEmoji(i + 1);
		rankingMsg1 += rankEmoji1 + Rsender1 + " - 강화 레벨: " + petData[username1].upgrade + "⭐\n";
	}

	// 나머지 사용자들에 대해 순위 메시지를 작성합니다.
	for (let i = 10; i < sortedUsrs.length; i++) {
		let username2 = sortedUsrs[i];
		let Rsender2 = members[username2].rank.emoji + username2;
		let rankEmoji2 = getRankEmoji(i + 1);
		rankingMsg2 += rankEmoji2 + Rsender2 + " - 강화 레벨: " + petData[username2].upgrade + "⭐\n";
	}

	// 상위 10명과 나머지 사용자들의 순위 메시지를 반환합니다.
	return {
		rankingMsg1: rankingMsg1,
		rankingMsg2: rankingMsg2
	};
}

// 펫 순위 생성 함수
function generatePetRanking(petData) {
	let sortedPets = Object.keys(petData).sort((a, b) => petData[b].petexp - petData[a].petexp);
	let rankingMsg1 = "";
	let rankingMsg2 = "";
	for (let i = 0; i < sortedPets.length; i++) {
		let username = sortedPets[i];
		let petInfo = petData[username];
		if (petInfo.petexp > 5) {
			let rankEmoji = getRankEmoji(i + 1);
			let rankingMsg = rankEmoji + petInfo.petimg + petInfo.pettitle + " " + petInfo.petname + " 💕 " + numberWithCommas(petInfo.petexp) + "\n";
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
// 캐슬매력순위 생성 함수
function generateCastleRanking(petData, data, homeData) {
	let sortedCastlePets = Object.keys(petData).sort((a, b) => {
		let castleExpA =
			calculateCastleItem(a, data) +
			calculateItemInfoAll(a, data, petData).castleExp +
			petData[a].petexp +
			((petData[a] && petData[a].miniPet && petData[a].miniPet.castleExp) || 0) +
			getHomeTotalExp(homeData, a) +
			getUserIntimacyInfo(data, a).exp;
		let castleExpB =
			calculateCastleItem(b, data) +
			calculateItemInfoAll(b, data, petData).castleExp +
			petData[b].petexp +
			((petData[b] && petData[b].miniPet && petData[b].miniPet.castleExp) || 0) +
			getHomeTotalExp(homeData, b) +
			getUserIntimacyInfo(data, b).exp;
		return castleExpB - castleExpA;
	});
	let rankingMsg1 = "";
	let rankingMsg2 = "";
	for (let i = 0; i < sortedCastlePets.length; i++) {
		let username = sortedCastlePets[i];
		let petInfo = petData[username];
		let homeExp = getHomeTotalExp(homeData, username);
		let intimacyExp = getUserIntimacyInfo(data, username).exp;
		let totalCastleExp = Math.round(
			petInfo.petexp +
				calculateCastleItem(username, data) +
				calculateItemInfoAll(username, data, petData).castleExp +
				((petData[username] && petData[username].miniPet && petData[username].miniPet.castleExp) || 0) +
				homeExp +
				intimacyExp
		);

		if (totalCastleExp > 5) {
			let rankEmoji = getRankEmoji(i + 1);
			let rankingMsg = rankEmoji + petInfo.petimg + petInfo.pettitle + " " + petInfo.petname + " ⚔ " + numberWithCommas(totalCastleExp) + "\n";
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

// 레이드매력순위 생성 함수
function generateRaidRanking(petData, data, homeData) {
	var sortedRaidPets = Object.keys(petData).sort(function (a, b) {
		var petA = petData[a];
		var petB = petData[b];

		var miniExpA = petA && petA.miniPet && petA.miniPet.raidExp ? petA.miniPet.raidExp : 0;
		var miniExpB = petB && petB.miniPet && petB.miniPet.raidExp ? petB.miniPet.raidExp : 0;

		var raidExpA = (calculateItemInfoAll(a, data, petData).raidExp || 0) + (petA.petexp || 0) + miniExpA + getHomeTotalExp(homeData, a);
		var raidExpB = (calculateItemInfoAll(b, data, petData).raidExp || 0) + (petB.petexp || 0) + miniExpB + getHomeTotalExp(homeData, b);

		return raidExpB - raidExpA;
	});

	var rankingMsg1 = "";
	var rankingMsg2 = "";

	for (var i = 0; i < sortedRaidPets.length; i++) {
		var username = sortedRaidPets[i];
		var petInfo = petData[username];
		var miniPetExp = petInfo.miniPet && petInfo.miniPet.raidExp ? petInfo.miniPet.raidExp : 0;
		var homeExp = getHomeTotalExp(homeData, username);
		var totalRaidExp = Math.round((petInfo.petexp || 0) + (calculateItemInfoAll(username, data, petData).raidExp || 0) + miniPetExp + homeExp);

		if (totalRaidExp > 5) {
			var rankEmoji = getRankEmoji(i + 1);
			var rankingMsg = rankEmoji + petInfo.petimg + petInfo.pettitle + " " + petInfo.petname + " 👾 " + numberWithCommas(totalRaidExp) + "\n";
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

// 시련의탑 생성 함수
function trialTowerRanking(data, petData, guildData, trialTower) {
	// 유저 데이터가 없으면 빈 값 반환
	if (!trialTower.user || Object.keys(trialTower.user).length === 0) {
		return {
			rankingMsg1: "🚀 시련의 탑 랭킹 데이터가 없습니다.",
			rankingMsg2: ""
		};
	}

	// 유저 데이터를 배열로 변환하여 정렬 준비
	let sortedUsers = Object.keys(trialTower.user)
		.filter((username) => data.member[username])
		.map((username) => ({
			name: username,
			floor: trialTower.user[username].floor,
			lastWinTime: new Date(trialTower.user[username].lastWinTime)
		}))
		.sort((a, b) => {
			// 1. 층수 내림차순 정렬
			if (b.floor !== a.floor) {
				return b.floor - a.floor;
			}
			// 2. 같은 층이면 lastWinTime 오름차순 (먼저 도착한 사람이 상위)
			return a.lastWinTime - b.lastWinTime;
		});

	let rankingMsg1 = "";
	let rankingMsg2 = "";

	for (let i = 0; i < sortedUsers.length; i++) {
		let user = sortedUsers[i];
		let rankEmoji = getRankEmoji(i + 1);
		let rankingMsg = rankEmoji + " " + checkRank(data, petData, guildData, user.name) + " | 층수: " + user.floor + "층\n";

		if (i < 10) {
			rankingMsg1 += rankingMsg;
		} else {
			rankingMsg2 += rankingMsg;
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
		return "-";
	} else {
		let year = dateString.substr(0, 4);
		let month = dateString.substr(4, 2);
		let day = dateString.substr(6, 2);
		return year + "년 " + month + "월 " + day + "일";
	}
}
function formatDate2(dateString) {
	if (!dateString) {
		return "-";
	} else {
		let month = dateString.substr(4, 2);
		let day = dateString.substr(6, 2);
		return month + "월 " + day + "일";
	}
}
// 날짜와 시간 형식 변환 함수
function formatDateTime(dateString) {
	var date = new Date(dateString);
	var year = date.getFullYear();
	var month = (date.getMonth() + 1).toString().padStart(2, "0"); // 월은 0부터 시작하므로 +1
	var day = date.getDate().toString().padStart(2, "0");
	var hours = date.getHours().toString().padStart(2, "0");
	var minutes = date.getMinutes().toString().padStart(2, "0");
	return year + "-" + month + "-" + day + " " + hours + ":" + minutes;
}
// active 값에 따라 해당하는 title 가져오기
function getTitle(memberInfo, titleInfo) {
	if (!titleInfo || !titleInfo.title) {
		return "";
	}
	let activeTitleNum = titleInfo.title.num;
	let titleList = titleInfo.title.list;
	if (activeTitleNum > 0 && titleList && titleList[activeTitleNum - 1]) {
		return titleList[activeTitleNum - 1].name;
	} else {
		return "";
	}
}
// 펫스킬 이름 정규화 함수
function normalizePetSkillName(skillName) {
	skillName = String(skillName || "")
		.replace(/^\[펫스킬북\]/, "")
		.replace(/📙/g, "")
		.replace(/✨/g, "")
		.trim();
	if (skillName === "하느님위에갓물주") return "하느님 위에 갓물주";
	if (skillName === "종의본능") return "종의 본능";
	if (skillName === "로열하우스") return "로열 하우스";
	if (skillName === "전투형지휘관") return "전투형 지휘관";
	if (skillName === "기사단증원") return "기사단 증원";
	if (skillName === "티어상승론") return "티어 상승론";
	if (skillName === "지휘관의재량") return "지휘관의 재량";
	if (skillName === "망한건맞아") return "망한건 맞아";
	return skillName;
}
// 펫스킬 데이터 초기화 함수
function initPetSkillUser(petSkillData, user) {
	if (!petSkillData[user]) petSkillData[user] = {};
	if (!petSkillData[user].petSkills || typeof petSkillData[user].petSkills !== "object") {
		petSkillData[user].petSkills = { equipped: [], bag: {} };
	}
	if (!(petSkillData[user].petSkills.equipped instanceof Array)) petSkillData[user].petSkills.equipped = [];
	if (!petSkillData[user].petSkills.bag || typeof petSkillData[user].petSkills.bag !== "object") petSkillData[user].petSkills.bag = {};
	return petSkillData[user].petSkills;
}

function hasEquippedCreationMiniPet(petData, user) {
	return !!(petData &&
		petData[user] &&
		petData[user].miniPet &&
		(petData[user].miniPet.grade || "") === "창조");
}
// 장착된 펫스킬 이름 배열 반환 함수
function getEquippedPetSkillNames(petSkillData, user) {
	if (!petSkillData || !petSkillData[user]) return [];
	var skills = initPetSkillUser(petSkillData, user);
	return skills.equipped.map(normalizePetSkillName).filter(function (name) {
		return !!name;
	});
}
// 특정 스킬이 장착되어 있는지 확인하는 함수
function hasPetSkill(petSkillData, user, skillName) {
	skillName = normalizePetSkillName(skillName);
	var equipped = getEquippedPetSkillNames(petSkillData, user);
	return equipped.indexOf(skillName) !== -1;
}
// 펫스킬 슬롯 개수 계산 함수
function getPetSkillSlotCount(data, petSkillData, user) {
	var info = getUserIntimacyInfo(data, user);
	var level = info && info.level ? info.level : 0;
	var hasIntro = hasPetSkill(petSkillData, user, "펫스킬 학개론");
	var maxSlot = PET_SKILL_MAX_EQUIP_SLOT + (hasIntro ? 3 : 0);
	var slots = Math.floor(level / 100);
	slots += hasIntro ? 3 : 0;

	if (slots > maxSlot) slots = maxSlot;
	if (slots < 0) slots = 0;
	return slots;
}
// 숫자 3자리마다 쉼표 추가 함수
function numberWithCommas(x) {
	return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 조건 충족 여부에 따라 체크 표시 반환 함수
function buildDailyQuestInfoMessage(data, petData, guildData, sender) {
	var status = getDailyQuestStatus(data, petData, guildData, sender);
	var lines = [];

	lines.push("📜일일,주간 퀘스트 보상 안내🦋");
	lines.push("━━━━━━━━━━━━");
	lines.push("📜일일 퀘스트 조건📜");
	lines.push("시련탑😈[" + status.towerUsed + "/" + status.towerMax + "][" + getC(status.towerUsed >= status.towerMax) + "]");
	lines.push("캐대전🏆[" + status.castleUsed + "/" + status.castleMax + "][" + getC(status.castleUsed >= status.castleMax) + "]");
	lines.push("미대전🐹[" + status.miniUsed + "/" + status.miniMax + "][" + getC(status.miniUsed >= status.miniMax) + "]");
	lines.push("펫탐험⛰️[" + status.exploreUsed + "/" + status.exploreMax + "][" + getC(status.exploreUsed >= status.exploreMax) + "]");
	lines.push("");
	lines.push("일일퀘스트 보상 아이템👏🏻:");
	lines.push("");
	lines.push("길드공헌훈장🌟(/길드공헌 숫자) 1개");
	lines.push("럭키박스🍀(/럭키오픈) 2개");
	lines.push("펫 강화석⭐ 30개");
	lines.push("━━━━━━━━━━━━");
	lines.push("🦋주간 퀘스트 조건🦋");
	lines.push("일일 퀘스트 7번 완료📜(" + status.weeklyUsed + "/" + status.weeklyMax + ")");
	lines.push("");
	lines.push("주간퀘스트 보상 아이템👏🏻:");
	lines.push("미니펫뽑기🐹(/미니펫오픈) 100개");
	lines.push("펫스윗홈인테리어샵🖼️(/샵오픈) 100개");
	lines.push("");
	lines.push("📜일일,주간퀘스트 보상 명령어 안내📜" + allsee);
	lines.push("");
	lines.push('※ 모든 체크가[✅]면 "/퀘스트완료" 또는 "/ㅇ" 를 적어주세요');
	lines.push("※ 정리 or ㅇㅇㅇ 만 해도 보상지급이 됩니다.");
	return lines.join("\n");
}

function getDailyQuestStatus(data, petData, guildData, sender) {
	var towerUsed = data.member[sender] && data.member[sender].towerCnt ? data.member[sender].towerCnt : 0;
	var towerMax = GLOBAL_LIMITS.daily.trialTowerMax;

	var battleObj = data.member[sender] && data.member[sender].battle ? data.member[sender].battle : null;
	var castleUsed = battleObj ? battleObj.count || 0 : 0;
	var castleMax = GLOBAL_LIMITS.daily.castleBattleMax;

	var miniBattle = petData[sender] && petData[sender].miniPetBattle ? petData[sender].miniPetBattle : { win: 0, lose: 0, count: 0 };
	var miniUsed = miniBattle.count || 0;
	var miniMax = GLOBAL_LIMITS.daily.miniPetBattleMax;

	var petExploreData = loadJsonFile(petExplorePath);
	petExploreData = initPetExploreData(petExploreData);
	var rec = petExploreData.record && petExploreData.record[sender] ? petExploreData.record[sender] : { win: 0, lose: 0 };
	var win = typeof rec.win === "number" ? rec.win : 0;
	var lose = typeof rec.lose === "number" ? rec.lose : 0;
	var exploreUsed = data.member[sender] && typeof data.member[sender].exploreCnt === "number" ? data.member[sender].exploreCnt : 0;
	var exploreMax = GLOBAL_LIMITS.daily.petExploreMax;

	var rankInfo = getPetExploreRank(data, petExploreData, sender);
	var rankText = rankInfo ? rankInfo.rank + "등" : "순위없음";
	var weeklyMax = 7;
	var weeklyUsed = data.member[sender] ? parseInt(data.member[sender].weeklyQuestCnt, 10) || 0 : 0;
	weeklyUsed = Math.max(0, Math.min(weeklyUsed, weeklyMax));
	var dailyRewardDone = data.member[sender] ? (data.member[sender].dailyQuestCnt || 0) >= 1 : false;

	return {
		towerUsed: towerUsed,
		towerMax: towerMax,
		castleUsed: castleUsed,
		castleMax: castleMax,
		miniUsed: miniUsed,
		miniMax: miniMax,
		exploreUsed: exploreUsed,
		exploreMax: exploreMax,
		exploreWin: win,
		exploreLose: lose,
		exploreRankText: rankText,
		weeklyUsed: weeklyUsed,
		weeklyMax: weeklyMax,
		weeklyComplete: weeklyUsed >= weeklyMax,
		dailyRewardDone: dailyRewardDone,
		isComplete: towerUsed >= towerMax && castleUsed >= castleMax && miniUsed >= miniMax && exploreUsed >= exploreMax
	};
}

function getWeeklyQuestRemainText(weeklyUsed, weeklyMax) {
	weeklyUsed = Math.max(0, Math.min(parseInt(weeklyUsed, 10) || 0, weeklyMax));
	var remain = Math.max(0, weeklyMax - weeklyUsed);
	if (remain <= 0) return "주간 보상 수령 가능✅";
	return "주간 보상까지 " + remain + "번 일퀘 남음";
}

// 현재 날짜 문자열 반환 함수
function getCurrentDate() {
	let now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth() + 1;
	let day = now.getDate();
	// 월과 일이 한 자리 숫자인 경우 앞에 0을 붙여 두 자리로 만듭니다.
	month = month < 10 ? "0" + month : month;
	day = day < 10 ? "0" + day : day;
	return year + "" + month + "" + day;
}
function checkFee(data, user) {
	var tierName = data.member[user].rank.tier || "새싹";
	var tierData = ticketTierData[tierName] || ticketTierData["새싹"];

	var LowFeeR = tierData.low || 0.95;
	var HighFeeR = tierData.high || 0.7;
	var emoji = tierData.emoji || "";

	var FeeInfo = "(" + emoji + "수수료: " + ((1 - LowFeeR) * 100).toFixed(0) + "% / 고액수수료: " + ((1 - HighFeeR) * 100).toFixed(0) + "%)";

	return {
		FeeInfo: FeeInfo,
		LowFeeR: LowFeeR,
		HighFeeR: HighFeeR
	};
}

function pointRanking(data) {
	let sorted = Object.keys(data).sort((a, b) => data[b].point - data[a].point);
	let rankingMsg = "";
	for (let i = 0; i < sorted.length; i++) {
		let username = sorted[i];
		let Rsender = data[username].rank.emoji + username;
		let rankEmoji = getRankEmoji(i + 1);
		rankingMsg += rankEmoji + "[" + Rsender + "]" + " 🅟" + numberWithCommas(data[username].point) + "\n";
	}
	return rankingMsg;
}
// 순위에 따른 이모지 반환 함수
function getRankEmoji(rank) {
	switch (rank) {
		case 1:
			return "🥇. ";
		case 2:
			return "🥈. ";
		case 3:
			return "🥉. ";
		default:
			return addsingle(rank) + ". ";
	}
}
// 숫자가 1자리 수면 앞에 띄어쓰기를 추가하는 함수
function addsingle(number) {
	return number < 10 ? "  " + number : " " + number;
}

function checkRank(data, petData, guildData, user) {
	let userwithrank = user;

	if (data.member[user]) {
		var isCastleGuildMember = false;

		if (data.HoiCastle && data.HoiCastle.lord) {
			var lordGuildInfo = getMyGuildInfo(data, guildData, data.HoiCastle.lord);
			var userGuildInfo = getMyGuildInfo(data, guildData, user);

			if (lordGuildInfo && !lordGuildInfo.error && lordGuildInfo.guild && userGuildInfo && !userGuildInfo.error && userGuildInfo.guild) {
				if (lordGuildInfo.guild.name === userGuildInfo.guild.name) {
					isCastleGuildMember = true;
				}
			}
		}

		if (isCastleGuildMember) {
			// 성주 또는 성주와 같은 길드원
			userwithrank = "🏰" + userwithrank;
		} else if (user == data.star) {
			//좋아요
			userwithrank = "💞" + userwithrank;
		} else if (user == data.topCarrotGive) {
			//당근
			userwithrank = "🥕" + userwithrank;
		} else if (user == data.topThermo) {
			//온도
			userwithrank = "🌡" + userwithrank;
		} else if (user == data.miniPetTop) {
			//미니펫
			userwithrank = "✨" + userwithrank;
		} else if (user == data.toplv) {
			//최고 레벨
			userwithrank = "🌟" + userwithrank;
		} else if (user == data.mc) {
			//mc
			userwithrank = "💬" + userwithrank;
		} else if (user == data.intimacyTop) {
			//친밀도
			userwithrank = "🍼" + userwithrank;
		} else {
			userwithrank = data.member[user].rank.emoji + userwithrank;
		}

		// 길드 계급 이모지 추가
		var myGuildInfo = getMyGuildInfo(data, guildData, user);
		if (myGuildInfo && !myGuildInfo.error && myGuildInfo.guild) {
			var g = myGuildInfo.guild;
			var guildRank = g.rank;

			if (typeof guildRank === "number" && guildRank >= 1 && guildRank <= 20) {
				var guildEmoji = getGuildMasterRankEmoji(guildRank);
				if (guildEmoji) {
					userwithrank += "_" + guildEmoji;
				}
			}
		}

		return userwithrank;
	} else {
		return userwithrank;
	}
}
/**
 * 가방의 아이템 목록을 정렬하고 출력 형식으로 변환하는 함수
 * @param {Object} bagItems - 가방에 있는 아이템 객체
 * @returns {Object} - 정렬된 아이템 목록과 출력 문자열
 */
// 전제: normalizeItemName(itemName) 함수가 이미 존재해야 함.
//  - 펫 친밀도🐾(숫자/1000)+숫자💕  => "펫 친밀도🐾" 로 정규화
function generateBagOutput(bagItems) {
	var bagOutput = "";
	var sortedItemList = [];

	if (bagItems && Object.keys(bagItems).length > 0) {
		bagOutput = "(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n";

		var specialItems = [
			"자동탐험권🌄",
			"자유시장회원권🏪",
			"확성기📢(/알림 내용 30자)",
			"티어 승급티켓🎟",
			"고급 티어 승급티켓🎫",
			"럭키박스🍀(/럭키오픈)",
			"혼자레이드리셋권😝",
			"펫 강화석⭐",
			"펫강화확률UP🌟(3%)",
			"펫강화확률UP🌟(5%)",
			"펫강화확률UP🌟(10%)",
			"펫강화확률UP🌟(15%)",
			"펫강화확률UP🌟(20%)",
			"펫강화확률UP🌟(25%)",
			"펫강화확률UP🌟(30%)",
			"펫강화확률UP🌟(35%)",
			"펫강화확률UP🌟(40%)",
			"펫강화확률UP🌟(45%)",
			"펫강화확률UP🌟(50%)",
			"펫강화확률UP🌟(55%)",
			"펫강화확률UP🌟(60%)",
			"펫강화확률UP🌟(65%)",
			"펫강화확률UP🌟(70%)",
			"펫강화확률UP🌟(75%)",
			"펫강화확률UP🌟(80%)",
			"펫강화확률UP🌟(85%)",
			"펫강화확률UP🌟(90%)",
			"펫강화확률UP🌟(95%)",
			"펫강화확률UP🌟(100%)",

			"미니펫 강화석💫",
			"미니펫강화확률UP🐷(3%)",
			"미니펫강화확률UP🐷(5%)",
			"미니펫강화확률UP🐷(10%)",
			"미니펫강화확률UP🐷(15%)",
			"미니펫강화확률UP🐷(20%)",
			"미니펫강화확률UP🐷(25%)",
			"미니펫강화확률UP🐷(30%)",
			"미니펫강화확률UP🐷(35%)",
			"미니펫강화확률UP🐷(40%)",
			"미니펫강화확률UP🐷(45%)",
			"미니펫강화확률UP🐷(50%)",
			"미니펫강화확률UP🐷(55%)",
			"미니펫강화확률UP🐷(60%)",
			"미니펫강화확률UP🐷(65%)",
			"미니펫강화확률UP🐷(70%)",
			"미니펫강화확률UP🐷(75%)",
			"미니펫강화확률UP🐷(80%)",
			"미니펫강화확률UP🐷(85%)",
			"미니펫강화확률UP🐷(90%)",
			"미니펫강화확률UP🐷(95%)",
			"미니펫강화확률UP🐷(100%)",

			"미니펫대전리셋권🐹",
			"미니펫뽑기🐹(/미니펫오픈)",
			"미니펫외형변경권😺(/미니펫외형)",
			"미니펫이름변경권🙀(/미니펫이름)",
			"미니펫귀속해제권🐰(/귀속해제)",

			"후원 지원금👌",

			"타이틀선물권💝(/타이틀선물 닉네임 내용)",
			"펫타이틀권🦊(/펫타이틀이름)",
			"펫스킬북📙(/펫스킬오픈)",
			"펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호)",
			"펫특성뽑기권🃏(/특성오픈)",
			"반지 이름변경권🗯(/반지이름)",
			"정령 이름변경권📝(/정령이름)",

			"잡템☠️",
			"잡템상자☠",
			"양념치킨🐔",
			"치킨상자🐔",
			"정령조각🥀",
			"정령상자🥀",
			"랜덤박스💝",
			"극락상자👹",
			"나락상자👹",
			"선물상자🎁",
			"우표💌",

			"🥕당근이세요?",
			"🌡️당근온도기(/온도 아이디)",

			"마정석상자🔮",
			"마정석🔮",
			"시탑 부스터🔮",
			"시탑 공략서📜",
			"시련의탑리셋권😈",

			"레이드타격대인장👑(+600👾)",
			"캐슬대전리셋권🐶",
			"캐슬코인🥇",
			"캐슬공격권⚔",
			"영지공격권⚔",
			"펫먹이🍼",
			"펫먹이상자📦(/상자오픈)",
			"펫먹이특식🥡(/특식오픈)",

			"정령 강화석🥀",
			"정령강화확률UP🥀(3%)",
			"정령강화확률UP🥀(5%)",
			"정령강화확률UP🥀(10%)",
			"정령강화확률UP🥀(15%)",
			"정령강화확률UP🥀(20%)",
			"정령강화확률UP🥀(25%)",
			"정령강화확률UP🥀(30%)",
			"정령강화확률UP🥀(35%)",
			"정령강화확률UP🥀(40%)",
			"정령강화확률UP🥀(45%)",
			"정령강화확률UP🥀(50%)",
			"정령강화확률UP🥀(55%)",
			"정령강화확률UP🥀(60%)",
			"정령강화확률UP🥀(65%)",
			"정령강화확률UP🥀(70%)",
			"정령강화확률UP🥀(75%)",
			"정령강화확률UP🥀(80%)",
			"정령강화확률UP🥀(85%)",
			"정령강화확률UP🥀(90%)",
			"정령강화확률UP🥀(95%)",
			"정령강화확률UP🥀(100%)",

			"반지 강화석💍",
			"반지강화확률UP💍(3%)",
			"반지강화확률UP💍(5%)",
			"반지강화확률UP💍(10%)",
			"반지강화확률UP💍(15%)",
			"반지강화확률UP💍(20%)",
			"반지강화확률UP💍(25%)",
			"반지강화확률UP💍(30%)",
			"반지강화확률UP💍(35%)",
			"반지강화확률UP💍(40%)",
			"반지강화확률UP💍(45%)",
			"반지강화확률UP💍(50%)",
			"반지강화확률UP💍(55%)",
			"반지강화확률UP💍(60%)",
			"반지강화확률UP💍(65%)",
			"반지강화확률UP💍(70%)",
			"반지강화확률UP💍(75%)",
			"반지강화확률UP💍(80%)",
			"반지강화확률UP💍(85%)",
			"반지강화확률UP💍(90%)",
			"반지강화확률UP💍(95%)",
			"반지강화확률UP💍(100%)",

			"보물지도🗺️",
			"펫던전 입장권🌋",
			"탐험확률UP🗻(50%)",
			"탐험확률UP🗻(40%)",
			"탐험확률UP🗻(30%)",
			"탐험확률UP🗻(20%)",
			"탐험확률UP🗻(10%)",

			"영지기습공격권🔥(60%)",
			"영지기습공격권🔥(90%)",
			"영지절대방어권🛡(50%)",
			"영지절대방어권🛡(80%)",
			"🌋 대균열 유도권(/대균열)",
            "🌌 균열 유도권(/균열)",
            "🌪️ 전쟁불안정 증폭권(/불안정)",
            "🚑 전쟁불안정 감소권(/안정)",

			"캐슬고급유닛🧙🏼‍♂(+50💕)",
			"캐슬레어유닛⭐(+100💕)",
			"캐슬유니크유닛👑(+200💕)",
			"캐슬영웅유닛💠(+300💕)",
			"캐슬전설유닛🧝🏻‍♀(+500💕)",
			"캐슬신화유닛🧚🏻‍♀(+1000💕)",
			"캐슬불멸유닛🐉(+1500💕)",
			"캐슬불사조유닛🐦‍🔥(+6000💕)",

			"돌멩이🪨",
			"땅문서📜",
			"펫스윗홈인테리어샵🖼️(/샵오픈)",
			"길드공헌훈장🌟(/길드공헌 숫자)",
			"길드창고패키지🧳(/길드창고패키지오픈)",
			"길드가입권🍭(/길드가입 숫자)",
			"길드탈퇴권👋(/길드탈퇴 길드명)",
			"길드자원분배🫂(/길드분배)",
			"길드이름변경권🪧(/길드이름변경 이름)",
			"길드마크변경권🔖(/길드마크변경 이모지)",
			"H🐹",
			"O🐹",
			"I🐹",
			"W🐹",
			"O🐶",
			"R🐹",
			"L🐹",
			"D🐹"
		];

		//  0) 펫 친밀도(가변 이름) 키 찾기 → 항상 맨 위로
		var intimacyItemKey = null;
		for (var k in bagItems) {
			if (!bagItems.hasOwnProperty(k)) continue;
			if (normalizeItemName(k) === "펫 친밀도🐾") {
				intimacyItemKey = k;
				break;
			}
		}

		var index = 0;

		if (intimacyItemKey) {
			bagOutput += "   " + ++index + ". " + intimacyItemKey + " x " + bagItems[intimacyItemKey] + "\n";
			sortedItemList.push(intimacyItemKey);
		}

		//  1) 특수 아이템만 필터링 (친밀도는 중복 방지로 제외)
		var specialItemsSorted = [];
		for (var i = 0; i < specialItems.length; i++) {
			var sItem = specialItems[i];
			if (sItem === intimacyItemKey) continue;
			if (bagItems[sItem]) specialItemsSorted.push(sItem);
		}

		//  2) 나머지 아이템(특수 제외 + 친밀도 제외)
		var otherItems = [];
		var bagKeys = Object.keys(bagItems);
		for (var j = 0; j < bagKeys.length; j++) {
			var key = bagKeys[j];
			if (key === intimacyItemKey) continue;
			if (specialItems.indexOf(key) !== -1) continue;
			otherItems.push(key);
		}

		//  3) 한글/영문 분리 정렬
		var koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;

		var koreanItems = [];
		var englishItems = [];

		for (var t = 0; t < otherItems.length; t++) {
			if (koreanRegex.test(otherItems[t])) koreanItems.push(otherItems[t]);
			else englishItems.push(otherItems[t]);
		}

		koreanItems.sort();
		englishItems.sort();

		//  출력: 특수 → 한글 → 영어
		for (var a = 0; a < specialItemsSorted.length; a++) {
			var it1 = specialItemsSorted[a];
			bagOutput += "   " + ++index + ". " + it1 + " x " + bagItems[it1] + "\n";
			sortedItemList.push(it1);
		}

		for (var b = 0; b < koreanItems.length; b++) {
			var it2 = koreanItems[b];
			bagOutput += "   " + ++index + ". " + it2 + " x " + bagItems[it2] + "\n";
			sortedItemList.push(it2);
		}

		for (var c = 0; c < englishItems.length; c++) {
			var it3 = englishItems[c];
			bagOutput += "   " + ++index + ". " + it3 + " x " + bagItems[it3] + "\n";
			sortedItemList.push(it3);
		}

		bagOutput = bagOutput.trim();
	}

	return {
		bagOutput: bagOutput,
		sortedItemList: sortedItemList
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
function calculateGearI2tem(memberName, data, petData) {
	if (!data.member[memberName] || !petData[memberName] || !petData[memberName].petgear) {
		return { battleExp: 0, msg: "" };
	}
	let pet = petData[memberName]; // 펫
	let gearRank = pet.petgear.gearRank; // 등급

	var battleExp = 0; // 펫대전 매력치
	var raidExp = 0; // 레이드 매력치
	let msg = ""; // 반환할 메시지

	//레이드공격대인장
	for (let key in raidSpecialItem.dept2) {
		let item = raidSpecialItem.dept2[key];
		if (data.member[memberName].bag[item.name]) {
			let count = data.member[memberName].bag[item.name];
			raidExp += count * item.exp;
		}
	}

	// 펫장비
	if (gearRank === "불멸" || gearRank === "집행관") {
		msg = "[" + (gearRank === "불멸" ? "🪬" : gearRank === "집행관" ? "👑" : "") + "]";
		if (gearRank === "불멸") {
			battleExp += 2000;
			raidExp += 5500;
		} else if (gearRank === "집행관") {
			battleExp += 3500; // '집행관' 랭크의 추가 힘
			raidExp += 20000;
		}
		if (pet.petgear.gearUp) {
			raidExp += parseInt(pet.petgear.gearUp) * 50;
			msg += "(" + pet.petgear.gearUp + ")";
		}
	} else if (gearRank == "고대") {
		// todo msg추가
		msg = "[⚜️]";
		battleExp += 1600;
		raidExp += 4000;
	} else if (gearRank == "신화") {
		msg = "[🔆]";
		battleExp += 1200;
		raidExp += 3000;
	} else if (gearRank == "유물") {
		msg = "[🔮]";
		battleExp += 800;
		raidExp += 2000;
	} else if (gearRank == "전설") {
		msg = "[🌟]";
		battleExp += 500;
		raidExp += 1000;
	} else if (gearRank == "유니크") {
		msg = "[❤️‍🔥]";
		battleExp += 250;
		raidExp += 500;
	} else if (gearRank == "레어") {
		msg = "[✨️]";
		battleExp += 100;
		raidExp += 300;
	} else if (gearRank == "이벤트") {
		msg = "[🌳]";
		battleExp += 5000;
		raidExp += 50000;
	}

	return { battleExp: battleExp, msg: msg, raidExp: raidExp };
}

/** info.js와동일
 * 캐슬공격 아이템 계산 함수
 * @param {String} member - 회원
 * @return {String} exp - 캐슬공격 아이템 매력 합산치
 */
function calculateCastleItem(memberName, data) {
	let returnExp = 0; // 반환할 매력
	let userInfo = data.member[memberName];
	if (!userInfo) {
		return returnExp;
	}
	let bag = data.member[memberName].bag || {};

	for (let item in castleItem) {
		let itemName = castleItem[item].name;
		let itemExp = castleItem[item].exp;

		if (bag[itemName]) {
			returnExp += bag[itemName] * itemExp;
		}
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
			rankName = ranks[rankKey].name;
		}
	}
	return rankName;
}

// 사용자의 점수와 최근 전투 날짜를 기준으로 정렬
function sortCastleBattle(data) {
	let memberData = data.member;

	let sortedMembers = Object.keys(memberData)
		.filter((memberName) => memberData[memberName].battle.lastBattleDateTime) // score = 0 제외
		.map((memberName) => ({
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
function calculateItemInfo(type, memberName, data, petData) {
	//result 객체

	var returnObject = {
		battleExp: 0,
		raidExp: 0,
		castleExp: 0,
		message: ""
	};

	if (!data || !petData) {
		return returnObject;
	}

	if (type == "bag") {
		//레이드공격대인장
		for (let key in raidSpecialItem.dept2) {
			let item = raidSpecialItem.dept2[key];
			if (data.member[memberName] && data.member[memberName].bag && data.member[memberName].bag[item.name]) {
				let count = data.member[memberName].bag[item.name];
				returnObject.raidExp += count * item.exp;
			}
		}
		return returnObject;
	}

	// 유저정보
	let petObject = petData[memberName]; // 펫
	let obj = petObject[type];
	if (!obj) {
		return returnObject;
	}
	let grade = obj.grade; // 등급
	let upgrade = obj.upgrade; // 강화

	//result 객체
	var returnObject = {
		battleExp: 0,
		raidExp: 0,
		castleExp: 0,
		message: ""
	};

	let infoData = itemInfoData[type][grade];

	returnObject.battleExp = infoData.battleExp + upgrade * infoData.battleUpgradeExp;
	returnObject.raidExp = infoData.raidExp + upgrade * infoData.raidUpgradeExp;
	returnObject.castleExp = infoData.castleExp + upgrade * infoData.castleUpgradeExp;

	return returnObject;
}
function calculateItemInfoAll(memberName, data, petData) {
	let returnObj = {
		battleExp: 0,
		raidExp: 0,
		castleExp: 0
	};
	let elementalInfo = calculateItemInfo("elemental", memberName, data, petData);
	let ringInfo = calculateItemInfo("ring", memberName, data, petData);
	let bagInfo = calculateItemInfo("bag", memberName, data, petData);
	returnObj.battleExp = elementalInfo.battleExp + ringInfo.battleExp + bagInfo.battleExp;
	returnObj.raidExp = elementalInfo.raidExp + ringInfo.raidExp + bagInfo.raidExp;
	returnObj.castleExp = elementalInfo.castleExp + ringInfo.castleExp + bagInfo.castleExp;
	return returnObj;
}
// 당근순위 랭킹을 가져오는 함수
function getCarrotRank(username, data) {
	var users = Object.keys(data.member).filter(function (u) {
		return data.member[u].carrotGiven > 0;
	});

	users.sort(function (a, b) {
		var carrotA = data.member[a].carrotGiven;
		var carrotB = data.member[b].carrotGiven;

		if (carrotB !== carrotA) {
			return carrotB - carrotA; // 많이 준 사람 우선
		}

		// 동점이면 한글 이름 오름차순
		return a.localeCompare(b, "ko");
	});

	var rank = users.indexOf(username);
	return rank >= 0 ? rank + 1 + "위" : "순위 없음";
}

function getThermoRank(username, data) {
	var users = Object.keys(data.member).filter(function (u) {
		return data.member[u].thermoPoints > 0;
	});

	users.sort(function (a, b) {
		var pointA = data.member[a].thermoPoints;
		var pointB = data.member[b].thermoPoints;

		if (pointB !== pointA) {
			return pointB - pointA; // 점수 내림차순
		}

		// 점수 같을 경우 이름 오름차순
		return a.localeCompare(b, "ko");
	});

	var rank = users.indexOf(username);
	return rank >= 0 ? rank + 1 + "위" : "순위 없음";
}

function formatPetInfo(pet) {
	return pet.name + pet.emoji + "(+" + numberWithCommas(pet.battleExp) + "💕)[" + pet.grade + "]";
}

function getMiniPetGradeStats(petData, gradeTable) {
	let gradeStats = {};
	let totalCount = 0;

	let definedGrades = gradeTable.map((g) => g.grade);

	for (let user in petData) {
		let bag = petData[user].miniPetBag;
		if (!bag || bag.length === 0) continue;

		for (let pet of bag) {
			let grade = pet.grade || "기타";
			if (!definedGrades.includes(grade)) {
				grade = "기타";
			}
			if (!gradeStats[grade]) gradeStats[grade] = 0;
			gradeStats[grade]++;
			totalCount++;
		}
	}

	let allGrades = Object.keys(gradeStats);

	let sortedGrades = allGrades.sort(function (a, b) {
		if (a === "이벤트") return -1;
		if (b === "이벤트") return 1;

		let indexA = definedGrades.indexOf(a);
		let indexB = definedGrades.indexOf(b);

		if (indexA !== -1 && indexB !== -1) {
			return indexA - indexB;
		} else if (indexA !== -1) {
			return -1;
		} else if (indexB !== -1) {
			return 1;
		} else {
			return a.localeCompare(b, "ko");
		}
	});

	let output = "📊 전체 미니펫 등급별 통계 📊\n\n";
	output += "\n총합: " + numberWithCommas(totalCount) + "마리\n\n" + allsee;

	for (let grade of sortedGrades) {
		let count = gradeStats[grade];
		let percent = ((count / totalCount) * 100).toFixed(1);
		output += "- " + grade + " [" + percent + "%]: " + count + "마리\n";
	}

	return output.trim();
}

function getMiniPetUpgradeDisplay(miniPetObj) {
	if (!miniPetObj) return "";
	if (isElite(miniPetObj) && miniPetObj.upgrade == ELITE_MINIPET_MAX_LV) {
		return "MAX";
	} else if (!isElite(miniPetObj) && miniPetObj.upgrade == MINIPET_MAX_LV) {
		return "MAX";
	} else {
		return miniPetObj.upgrade ? "+" + miniPetObj.upgrade : "";
	}
}

function isElite(mini) {
	return mini && (mini.grade === "엘리트" || mini.grade === "엘리트급" || mini.grade === "ELITE");
}

function getFurnitureExp(userData) {
	if (!userData || !userData.placedFurniture || userData.placedFurniture.length === 0) {
		return 0;
	}

	var total = 0;
	for (var i = 0; i < userData.placedFurniture.length; i++) {
		var item = userData.placedFurniture[i];
		var expValue = Number(item.exp) || 0;
		total += expValue;
	}

	return total;
}

function getHomeTotalExp(homeData, username) {
	if (!homeData || !homeData[username]) return 0;

	var userHome = homeData[username];
	var exp = userHome.exp || 0;

	var furnitureExp = getFurnitureExp(userHome) || 0;

	return exp + furnitureExp;
}

function getPlacedFurnitureCountByGrade(homeData, username, furnitureGrade) {
	if (!homeData || !homeData[username] || !homeData[username].placedFurniture) return 0;
	var placed = homeData[username].placedFurniture;
	var target = String(furnitureGrade || "").trim();
	if (!target) return 0;
	var count = 0;
	for (var i = 0; i < placed.length; i++) {
		var itemGrade = String((placed[i] && placed[i].grade) || "").trim();
		if (itemGrade === target) count++;
	}
	return count;
}

function getHomeLikeRank(sender, homeData) {
	var users = Object.keys(homeData);
	if (users.length === 0) return null;

	var ranking = [];
	for (var i = 0; i < users.length; i++) {
		var name = users[i];
		var d = homeData[name];
		var likeCnt = d.likeCnt || 0;
		ranking.push({ name: name, likeCnt: likeCnt });
	}

	// 정렬: 좋아요 많은 순 → 이름 가나다순
	ranking.sort(function (a, b) {
		if (b.likeCnt !== a.likeCnt) return b.likeCnt - a.likeCnt;
		return a.name.localeCompare(b.name, "ko");
	});

	for (var j = 0; j < ranking.length; j++) {
		if (ranking[j].name === sender) {
			return j + 1; // 순위는 1부터
		}
	}

	return 0;
}

function initSweetHomeUser(homeData, user) {
	if (!homeData[user]) {
		homeData[user] = {
			floor: 0, // 집 평수
			houseName: "서울역 4번출구🚉", // 집 이름(스킨)
			exp: 0, // 집 성장 경험치 (집짓기로 증가)
			placedFurniture: [], // 현재 배치된 가구들의 id 배열
			furnitureBag: [], // 가구 가방: {id, name, charm, grade,...} 리스트
			visitCnt: 0, // 누적 방문 수 (본인 제외)
			likeCnt: 0 // 누적 좋아홈 수
		};
	}

	return homeData;
}
function debuggerLog(msg) {
	if (msg) {
		if (typeof msg == "Object") {
			msg = JSON.stringify(msg);
		}
		Api.replyRoom("팻 테스트방", msg);
	}
}

function formatKoreanShort(num) {
	num = Number(num) || 0;

	if (num >= 100000000) {
		var eok = Math.round((num / 100000000) * 10) / 10; // 억 단위 소수 1자리
		if (eok % 1 === 0) return numberWithCommas(eok.toFixed(0)) + "억";
		return numberWithCommas(eok.toFixed(1)) + "억";
	}

	if (num >= 10000) {
		var man = Math.floor(num / 10000);
		return numberWithCommas(man) + "만";
	}

	return numberWithCommas(num);
}

function formatDoneLine(prefix, used, max, text) {
	used = Number(used) || 0;
	max = Number(max) || 0;
	if (max > 0 && used >= max) return prefix + "[✅완료]: " + text;
	return prefix + "[" + used + "/" + max + "]: " + text;
}

/**
 * 301강 이상에서도 치명타 확률은 "동일"해야 하므로
 * 치확 계산에 사용하는 강화레벨은 300으로 캡
 */
function getCappedUpgradeForCrit(upgradeLevel) {
	var u = parseInt(upgradeLevel || 0, 10);
	if (u > 300) return 300;
	if (u < 0) return 0;
	return u;
}

/**
 * 301강부터 치명타 배수(계수) 증가
 * 0~300강: 1.70 고정
 * 301강: 1.71, 302강: 1.72 ... (0.01씩 증가)
 * @param {number} upgradeLevel
 * @returns {number} - 배수(소수 2자리)
 */
function getCritMultiplier(upgradeLevel) {
	var u = parseInt(upgradeLevel || 0, 10);
	if (u <= 300) return BASE_CRIT_DAMAGE_MULTIPLIER; // 1.7

	var mul = BASE_CRIT_DAMAGE_MULTIPLIER + (u - 300) * 0.01;
	return parseFloat(mul.toFixed(2));
}
/**
 * 펫의 강화 레벨에 따른 치명타 확률(%) 계산 함수
 * @param {number} upgradeLevel - 펫의 현재 강화 레벨
 * @returns {string} - 계산된 치명타 확률 (소수점 2자리, % 기호 제외)
 */
function getCritChance(upgradeLevel) {
	upgradeLevel = getCappedUpgradeForCrit(upgradeLevel);

	var critChance = 0;
	if (upgradeLevel <= 100) {
		critChance = upgradeLevel * 0.5;
	} else if (upgradeLevel <= 200) {
		critChance = 100 * 0.5 + (upgradeLevel - 100) * 0.3;
	} else {
		// <= 300
		critChance = 100 * 0.5 + 100 * 0.3 + (upgradeLevel - 200) * 0.1;
	}
	return critChance.toFixed(2);
}

/**
 * 종합매력 계산 (펫정보/시련의탑 등 공용)
 * - /펫정보에서 쓰던 계산식을 그대로 함수화
 * - homeData는 외부에서 넘겨주거나, 없으면 내부에서 로드
 *
 * @param {string} sender
 * @param {object} data
 * @param {object} petData
 * @param {object=} homeDataOpt  // 선택: 이미 로드된 homeData가 있으면 넘겨 중복 로드 방지
 * @returns {number} 종합매력(정수)
 */
function calculateTotalExp(sender, data, petData, homeData, petSkillData) {
	if (!petData || !petData[sender]) return 0;

	var petInfo = petData[sender];
	var homeData = homeData || loadJsonFile(homeDataFile);

	var totalCastle = calculateCastleExp(sender, data, petData, homeData, petSkillData) || 0;
	var totalRaid = calculateRaidExp(sender, data, petData, homeData, petSkillData) || 0;

	// 강화 매력 보너스(기존 로직 유지)
	var upgradeBonus = (petInfo.upgrade || 0) * 300;

	var total = totalCastle + totalRaid + upgradeBonus;
	
	// 혹시 NaN 방지
	total = parseInt(total, 10);
	if (isNaN(total)) total = 0;

	return total;
}

function getPetExploreRank(data, petExploreData, sender) {
	var record = petExploreData && petExploreData.record ? petExploreData.record : {};
	var rows = [];
	var MIN_WIN = 50; // 순위표와 동일 기준

	for (var user in record) {
		if (!record.hasOwnProperty(user)) continue;

		var r = record[user] || {};
		var win = typeof r.win === "number" ? r.win : 0;
		var lose = typeof r.lose === "number" ? r.lose : 0;

		if (win < MIN_WIN) continue;

		rows.push({ user: user, win: win, lose: lose });
	}

	// 정렬 기준 동일
	rows.sort(function (a, b) {
		if (a.win !== b.win) return b.win - a.win; // 승리 내림차순
		if (a.lose !== b.lose) return a.lose - b.lose; // 패배 오름차순
		return a.user < b.user ? -1 : a.user > b.user ? 1 : 0;
	});

	// sender 순위 찾기
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].user === sender) {
			return {
				rank: i + 1,
				win: rows[i].win,
				lose: rows[i].lose,
				total: rows.length
			};
		}
	}

	// 조건 미달(50승 미만 or 기록 없음)
	return null;
}

function getC(isDone) {
	return isDone ? "✅" : "❌";
}

function getIntimacyExpFromBag(bagItems) {
	if (!bagItems) return 0;

	var key = null;
	for (var k in bagItems) {
		if (!bagItems.hasOwnProperty(k)) continue;
		if (normalizeItemName(k) === "펫 친밀도🐾") {
			// 가변 이름 대응
			key = k;
			break;
		}
	}
	if (!key) return 0;

	// 예: "펫 친밀도🐾 [Lv.3](420/1000)+8500💕"
	// +숫자💕 부분만 추출
	var m = String(key).match(/\+(\d+)\s*💕/);
	if (!m) return 0;

	return parseInt(m[1], 10) || 0;
}
function normalizeItemName(itemName) {
	itemName = String(itemName || "");
	if (/^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/.test(itemName)) return "펫 친밀도🐾";
	return itemName;
}
function getIntimacyLvFromBag(bagItems) {
	if (!bagItems) return "펫 친밀도🐾 [Lv.0]";

	var key = null;
	for (var k in bagItems) {
		if (!bagItems.hasOwnProperty(k)) continue;
		if (normalizeItemName(k) === "펫 친밀도🐾") {
			// 가변 이름 대응
			key = k;
			break;
		}
	}
	if (!key) return "펫 친밀도🐾 [Lv.0]";

	// 예: "펫 친밀도🐾 [Lv.3](420/1000)+8500💕"
	var m = String(key).match(/\[Lv\.(\d+)\]/);
	var lv = m ? parseInt(m[1], 10) || 0 : 0;

	return "펫 친밀도🐾 [Lv." + lv + "]";
}

function hasItem(data, user, itemName, count) {
	if (!data.member[user]) return false;
	if (!data.member[user].bag) return false;
	if (typeof data.member[user].bag[itemName] === "undefined") return false;
	return data.member[user].bag[itemName] >= count;
}

// 아이템명 정규화
/** 친밀도 아이템 정규화: 가변 이름(수치/레벨) -> 베이스명 */
function normalizeItemName(itemName) {
	itemName = String(itemName || "");
	if (/^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/.test(itemName)) return "펫 친밀도🐾";
	return itemName;
}

//가방에서 “친밀도 아이템 키” 가져오기
function findIntimacyItemKey(bagItems) {
	if (!bagItems) return null;
	for (var k in bagItems) {
		if (!bagItems.hasOwnProperty(k)) continue;
		if (normalizeItemName(k) === "펫 친밀도🐾") return k;
	}
	return null;
}

//친밀도 아이템명 파싱 (진행도/매력)
function parseIntimacyItemName(itemName) {
	itemName = String(itemName || "");
	var m = itemName.match(/^펫 친밀도🐾\s*\[Lv\.(\d+)\]\((\d+)\/1000\)\+(\d+)💕$/);
	if (!m) return { level: 0, progress: 0, exp: 0 };
	return {
		level: parseInt(m[1], 10) || 0,
		progress: parseInt(m[2], 10) || 0,
		exp: parseInt(m[3], 10) || 0
	};
}
// data를 받아 "가방의 펫 친밀도🐾" 기준으로 랭킹(rows) 생성
function buildIntimacyRanking(data) {
	var rows = [];
	if (!data || !data.member) return rows;

	for (var user in data.member) {
		if (!data.member.hasOwnProperty(user)) continue;

		var mem = data.member[user] || {};
		var bag = mem.bag;

		var key = findIntimacyItemKey(bag);
		if (!key) continue; // 친밀도 아이템 없는 유저 제외

		var info = parseIntimacyItemName(key);
		if (info.level === 0 && info.exp === 0 && info.progress === 0) continue; // 파싱 실패 방어

		rows.push({
			user: user,
			level: info.level,
			exp: info.exp, // 포만감(= +숫자💕)
			progress: info.progress // (필요 시 출력용)
		});
	}

	rows.sort(function (a, b) {
		if (a.level !== b.level) return b.level - a.level;
		if (a.exp !== b.exp) return b.exp - a.exp;
		return a.user < b.user ? -1 : a.user > b.user ? 1 : 0;
	});

	return rows;
}
//data를 받아 "가방의 펫 친밀도🐾" 기준으로 내 랭킹(등수) 찾기
function getIntimacyUserRank(data, sender) {
	if (!data || !data.member) {
		return -1;
	}

	var rows = buildIntimacyRanking(data);
	if (!rows || rows.length == 0) {
		return -1;
	}

	for (var i = 0; i < rows.length; i++) {
		if (rows[i].user == sender) return i + 1;
	}

	return -1;
}

function getUserIntimacyInfo(data, user) {
	if (!data || !data.member) {
		return { exists: false, level: 0, progress: 0, exp: 0, itemKey: null };
	}

	var mem = data.member[user];
	if (!mem || !mem.bag) {
		return { exists: false, level: 0, progress: 0, exp: 0, itemKey: null };
	}

	var key = findIntimacyItemKey(mem.bag);
	if (!key) {
		return { exists: false, level: 0, progress: 0, exp: 0, itemKey: null };
	}

	var info = parseIntimacyItemName(key);

	return {
		exists: true, // 존재여부
		level: info.level, // 친밀도 렙
		progress: info.progress, //포만감
		exp: info.exp, // 누적매력
		itemKey: key // 가방에 실제 저장된 전체 문자열
	};
}

function formatToK(value) {
	value = parseInt(value, 10) || 0;

	if (value >= 1000) {
		var k = value / 1000;
		// 소수 첫째자리까지만 표시 (8.5k)
		return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
	}

	return String(value);
}

// 현재 유저가 속한 길드 ID 반환
function getMyGuildId(data, sender) {
	if (!data.member[sender]) return null; // 유저 없음
	if (!data.member[sender].guild) return null; // 길드 미가입
	return data.member[sender].guild.id || null;
}
function getMyGuildInfo(data, guildData, sender) {
	var gid = getMyGuildId(data, sender);
	if (!gid) return null;

	if (!guildData || !guildData.guilds) {
		return null;
	}

	var g = guildData.guilds[gid];
	if (!g) {
		if (data.member[sender] && data.member[sender].guild) {
			delete data.member[sender].guild;
			// saveJsonFile(data, filePath);
		}
		return null;
	}

	if (!g.members || !g.members[sender]) {
		if (data.member[sender] && data.member[sender].guild) {
			// delete data.member[sender].guild;
			// saveJsonFile(data, filePath);
		}
		return null;
	}

	return {
		guildId: gid,
		guild: g,
		guildData: guildData
	};
}

// 길드마스터 랭크에 따른 이모지 반환
function getGuildMasterRankEmoji(rank) {
	if (rank === 1) return "☬";
	if (rank === 2) return "♔";
	if (rank === 3) return "♛";
	if (rank === 4) return "♕";
	if (rank === 5) return "⚝";
	if (rank === 6) return "❁";
	if (rank === 7) return "⌺";
	if (rank === 8) return "⍌";
	if (rank === 9) return "⍫";
	if (rank === 10) return "⚔︎";
	if (rank === 11) return "⚚";
	if (rank === 12) return "✥";
	if (rank === 13) return "❖";
	if (rank === 14) return "◈";
	if (rank === 15) return "◉";
	if (rank === 16) return "◍";
	if (rank === 17) return "◌";
	if (rank === 18) return "△";
	if (rank === 19) return "◇";
	if (rank === 20) return "◻︎";
	return "";
}
