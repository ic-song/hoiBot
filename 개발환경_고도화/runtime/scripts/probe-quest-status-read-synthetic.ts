import mariadb from "mariadb";
import { formatQuestStatusReply, type QuestStatusProjection } from "../src/quest/quest-status-read-service.js";

const pool = mariadb.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? "3306"),
  user: process.env.DB_USER ?? "hoibot",
  password: process.env.DB_PASSWORD ?? "hoibot",
  database: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 2,
  bigIntAsNumber: false
});

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const suffix = Date.now().toString();
  const externalId = `quest-status-fixture-${suffix}`;
  const player = await connection.query("INSERT INTO players(status) VALUES ('active')");
  const playerId = player.insertId as bigint;
  await connection.query("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,?,?)", [playerId, `퀘스트합성-${suffix}`, "seed"]);
  await connection.query("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [externalId, playerId]);
  await connection.query(
    `INSERT INTO player_pet_daily_records(player_id,record_date,tower_attempts,castle_battle_attempts,mini_battle_attempts,
       explore_attempts,weekly_quest_count,daily_quest_rewarded,pet_home_comment_count,feed_post_count,home_alert_open_count,
       pass_daily_quest_rewarded,premium_daily_quest_rewarded)
     VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),15,14,15,10,7,TRUE,1,0,1,TRUE,FALSE)`, [playerId]
  );
  await connection.query("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'support',TRUE,TRUE),(?,'premium',TRUE,TRUE)", [playerId, playerId]);
  const rows = await connection.query(
    `SELECT player_id,display_name,tower_attempts,castle_battle_attempts,mini_battle_attempts,explore_attempts,
            weekly_quest_count,daily_quest_rewarded,pet_home_comment_count,feed_post_count,home_alert_open_count,
            pass_daily_quest_rewarded,premium_daily_quest_rewarded,has_base_pass,has_premium_pass
     FROM legacy_quest_status_projection WHERE provider_code='kakao' AND external_user_id=?`, [externalId]
  );
  if (rows.length !== 1) throw new Error(`fixture projection count mismatch: ${rows.length}`);
  const row = rows[0];
  const projection: QuestStatusProjection = {
    playerId: row.player_id.toString(), displayName: row.display_name, towerUsed: row.tower_attempts.toString(),
    castleUsed: row.castle_battle_attempts.toString(), miniUsed: row.mini_battle_attempts.toString(), exploreUsed: row.explore_attempts.toString(),
    weeklyUsed: row.weekly_quest_count.toString(), dailyRewardDone: Boolean(row.daily_quest_rewarded),
    petHomeCommentUsed: row.pet_home_comment_count.toString(), feedPostUsed: row.feed_post_count.toString(),
    homeAlertOpenUsed: row.home_alert_open_count.toString(), passDailyRewardDone: Boolean(row.pass_daily_quest_rewarded),
    premiumDailyRewardDone: Boolean(row.premium_daily_quest_rewarded), hasBasePass: Boolean(row.has_base_pass), hasPremiumPass: Boolean(row.has_premium_pass)
  };
  const reply = formatQuestStatusReply(projection, `⭐${projection.displayName}`, "<ALLSEE>");
  if (!reply.includes("캐대전🏆[14/15][❌]") || !reply.includes("일일 퀘스트 7번 완료📜(7/7)") || !reply.includes("<ALLSEE>")) {
    throw new Error("quest status parity mismatch");
  }
  await connection.rollback();
  const remaining = await connection.query("SELECT COUNT(*) count FROM external_identities WHERE external_user_id=?", [externalId]);
  if (Number(remaining[0].count) !== 0) throw new Error("rollback residue detected");
  console.log("quest-status probe PASS: fixture=1, aliases/pass/daily/weekly/allsee/rollback=PASS");
} finally {
  connection.release();
  await pool.end();
}
