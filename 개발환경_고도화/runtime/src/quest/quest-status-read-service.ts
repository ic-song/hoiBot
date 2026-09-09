import type { DatabaseClient } from "../database.js";

const QUEST_STATUS_ALIASES = new Set(["/퀘스트", "ㄹㄹㄹ", "/ㅋ"]);

export interface QuestStatusProjection {
  playerId: string;
  displayName: string;
  towerUsed: string;
  castleUsed: string;
  miniUsed: string;
  exploreUsed: string;
  weeklyUsed: string;
  dailyRewardDone: boolean;
  petHomeCommentUsed: string;
  feedPostUsed: string;
  homeAlertOpenUsed: string;
  passDailyRewardDone: boolean;
  premiumDailyRewardDone: boolean;
  hasBasePass: boolean;
  hasPremiumPass: boolean;
}

export interface QuestStatusLimits {
  towerMax: number;
  castleMax: number;
  miniMax: number;
  exploreMax: number;
  weeklyMax: number;
  passPetHomeCommentMax: number;
  passFeedPostMax: number;
  passHomeAlertOpenMax: number;
  passPointBoxReward: number;
  premiumDiamondBoxReward: number;
}

export interface QuestStatusRepository {
  findByExternalIdentity(providerCode: string, externalUserId: string): Promise<QuestStatusProjection | null>;
}

interface QuestStatusRow {
  player_id: bigint;
  display_name: string;
  tower_attempts: bigint;
  castle_battle_attempts: bigint;
  mini_battle_attempts: bigint;
  explore_attempts: bigint;
  weekly_quest_count: bigint;
  daily_quest_rewarded: number;
  pet_home_comment_count: bigint;
  feed_post_count: bigint;
  home_alert_open_count: bigint;
  pass_daily_quest_rewarded: number;
  premium_daily_quest_rewarded: number;
  has_base_pass: number;
  has_premium_pass: number;
}

export const LEGACY_QUEST_STATUS_LIMITS: QuestStatusLimits = {
  towerMax: 15,
  castleMax: 15,
  miniMax: 15,
  exploreMax: 10,
  weeklyMax: 7,
  passPetHomeCommentMax: 1,
  passFeedPostMax: 1,
  passHomeAlertOpenMax: 1,
  passPointBoxReward: 2,
  premiumDiamondBoxReward: 1
};

export function isQuestStatusReadCommandCandidate(message: string): boolean {
  return QUEST_STATUS_ALIASES.has(message.trim());
}

function count(value: string, maximum?: number): number {
  const parsed = Number.parseInt(value, 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return maximum === undefined ? normalized : Math.min(normalized, maximum);
}

function mark(done: boolean): string {
  return done ? "✅" : "❌";
}

export function formatQuestStatusReply(
  projection: QuestStatusProjection,
  rankDisplay: string,
  allsee: string,
  limits: QuestStatusLimits = LEGACY_QUEST_STATUS_LIMITS
): string {
  const tower = count(projection.towerUsed);
  const castle = count(projection.castleUsed);
  const mini = count(projection.miniUsed);
  const explore = count(projection.exploreUsed);
  const weekly = count(projection.weeklyUsed, limits.weeklyMax);
  const comment = count(projection.petHomeCommentUsed);
  const feed = count(projection.feedPostUsed);
  const alert = count(projection.homeAlertOpenUsed);
  const hasPass = projection.hasBasePass || projection.hasPremiumPass;
  const lines = [
    `[${rankDisplay}] 님`,
    "📜 일일 · 주간 · 🐶호패,초패🐥 ",
    "퀘스트 보상 안내 🦋 ",
    "━━━━━━━━━━━━",
    "【 🐶호이,초보패스🐥전용 일퀘 조건 】"
  ];

  if (hasPass) {
    lines.push("━━━━━━━━━━━━━━━━");
    lines.push(`펫홈 댓글 달성📝[${comment}/${limits.passPetHomeCommentMax}][${mark(comment >= limits.passPetHomeCommentMax)}]`);
    lines.push(`피드 글 작성✍️[${feed}/${limits.passFeedPostMax}][${mark(feed >= limits.passFeedPostMax)}]`);
    lines.push(`홈알림 열기🔔[${alert}/${limits.passHomeAlertOpenMax}][${mark(alert >= limits.passHomeAlertOpenMax)}]`);
    lines.push("");
    if (projection.hasBasePass) {
      lines.push("《🎁 호패,초패 퀘스트 보상》");
      lines.push(`1억포인트상자🪙(/포인트상자오픈) ${limits.passPointBoxReward}개`);
      if (projection.passDailyRewardDone) lines.push("[✅ 금일 호패,초패 일퀘 보상 지급 완료]");
    }
    if (projection.hasPremiumPass) {
      lines.push("《👑 호이패스 프리미엄 추가 보상》");
      lines.push(`다이아상자💎(/다이아상자오픈) ${limits.premiumDiamondBoxReward}개`);
      if (projection.premiumDailyRewardDone) lines.push("[✅ 금일 프리미엄 일퀘 보상 지급 완료]");
    }
    lines.push("");
  } else {
    lines.push("");
    lines.push("펫홈 댓글 달성📝[호패,초패 회원전용]");
    lines.push("피드 글 작성✍️[호패,초패 회원전용]");
    lines.push("홈알림 열기🔔[호패,초패 회원전용]");
  }

  lines.push("━━━━━━━━━━━━");
  lines.push("📜일일 퀘스트 조건📜");
  lines.push(`시련탑😈[${tower}/${limits.towerMax}][${mark(tower >= limits.towerMax)}]`);
  lines.push(`캐대전🏆[${castle}/${limits.castleMax}][${mark(castle >= limits.castleMax)}]`);
  lines.push(`미대전🐹[${mini}/${limits.miniMax}][${mark(mini >= limits.miniMax)}]`);
  lines.push(`펫탐험⛰️[${explore}/${limits.exploreMax}][${mark(explore >= limits.exploreMax)}]`);
  lines.push("");
  lines.push("일일퀘스트 보상 아이템👏🏻:");
  lines.push("");
  lines.push("다이아상자💎(/다이아상자오픈) 1개");
  lines.push("1억포인트상자🪙(/포인트상자오픈) 1개");
  lines.push("펫 강화석⭐ 30개");
  lines.push("━━━━━━━━━━━━");
  lines.push("🦋주간 퀘스트 조건🦋");
  lines.push(`일일 퀘스트 7번 완료📜(${weekly}/${limits.weeklyMax})`);
  lines.push("");
  lines.push("주간퀘스트 보상 아이템👏🏻:");
  lines.push("펫스킬북📙(/펫스킬오픈) 1개");
  lines.push("다이아상자💎(/다이아상자오픈) 2개");
  lines.push("미니펫뽑기🐹(/미니펫오픈) 100개");
  lines.push("땅문서📜 1개");
  lines.push("펫스윗홈인테리어샵🖼️(/샵오픈) 100개");
  lines.push("");
  lines.push(`📜일일,주간퀘스트 보상 명령어 안내📜${allsee}`);
  lines.push("");
  lines.push('※ 모든 체크가[✅]면 "/퀘스트완료" 또는 "/ㅇ" 를 적어주세요');
  lines.push("※ 정리 or ㅇㅇㅇ 만 해도 보상지급이 됩니다.");
  return lines.join("\n");
}

export class MariaQuestStatusRepository implements QuestStatusRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByExternalIdentity(providerCode: string, externalUserId: string): Promise<QuestStatusProjection | null> {
    const rows = await this.database.query<QuestStatusRow[]>(
      `SELECT player_id,display_name,tower_attempts,castle_battle_attempts,mini_battle_attempts,
              explore_attempts,weekly_quest_count,daily_quest_rewarded,pet_home_comment_count,
              feed_post_count,home_alert_open_count,pass_daily_quest_rewarded,
              premium_daily_quest_rewarded,has_base_pass,has_premium_pass
       FROM legacy_quest_status_projection WHERE provider_code=? AND external_user_id=? LIMIT 1`,
      [providerCode, externalUserId]
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      playerId: row.player_id.toString(), displayName: row.display_name,
      towerUsed: row.tower_attempts.toString(), castleUsed: row.castle_battle_attempts.toString(),
      miniUsed: row.mini_battle_attempts.toString(), exploreUsed: row.explore_attempts.toString(),
      weeklyUsed: row.weekly_quest_count.toString(), dailyRewardDone: Boolean(row.daily_quest_rewarded),
      petHomeCommentUsed: row.pet_home_comment_count.toString(), feedPostUsed: row.feed_post_count.toString(),
      homeAlertOpenUsed: row.home_alert_open_count.toString(), passDailyRewardDone: Boolean(row.pass_daily_quest_rewarded),
      premiumDailyRewardDone: Boolean(row.premium_daily_quest_rewarded), hasBasePass: Boolean(row.has_base_pass),
      hasPremiumPass: Boolean(row.has_premium_pass)
    };
  }
}

export class QuestStatusReadService {
  constructor(
    private readonly repository: QuestStatusRepository,
    private readonly rankResolver: (playerId: string, displayName: string) => Promise<string>,
    private readonly allsee: string,
    private readonly limits: QuestStatusLimits = LEGACY_QUEST_STATUS_LIMITS
  ) {}

  async read(providerCode: string, externalUserId: string, message: string): Promise<string | null> {
    if (!isQuestStatusReadCommandCandidate(message)) return null;
    const projection = await this.repository.findByExternalIdentity(providerCode, externalUserId);
    if (projection === null) return null;
    return formatQuestStatusReply(projection, await this.rankResolver(projection.playerId, projection.displayName), this.allsee, this.limits);
  }
}
