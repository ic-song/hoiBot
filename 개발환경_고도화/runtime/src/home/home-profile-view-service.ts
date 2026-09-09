import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { awardHomeActivityBadges } from "./daily-comment-service.js";
import { parseHomeProfileViewCommand } from "./home-profile-view-command.js";

type Identity = { player_id: bigint; display_name: string };
type Result = { messages: string[]; outboxIds: string[]; replayed: boolean; targetPlayerId: string; selfView: boolean; visitCount: string };
type HomeRow = { player_id: bigint; display_name: string; rank_emoji: string | null; home_name: string | null; base_experience: bigint; like_count: bigint; visit_count: bigint; floor_area: bigint; version: bigint; pet_name: string };
const SCOPE = "home.profile_view";
const ALLSEE = "\u200b".repeat(500);
const key = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | Result): Result => typeof value === "string" ? JSON.parse(value) as Result : value;
const commas = (value: bigint): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// 펫홈 본문을 DB 안정 순서와 가구 접힘 경계로 투영합니다.
export function formatHomeProfile(input: { home: HomeRow; placed: Array<{ display_name: string; charm_snapshot: bigint }>; followers: bigint; following: bigint; equippedBadge: string | null }): string {
  let text = `🏡 [${input.home.rank_emoji ?? ""}${input.home.display_name}] 펫스윗홈\n${input.home.home_name ?? "서울역 4번출구🚉"}(+${commas(input.home.base_experience)}💕)[+${input.home.floor_area.toString()}평]\n🐾 ${input.home.pet_name}\n좋아홈💌x${input.home.like_count.toString()} · 방문x${input.home.visit_count.toString()}\n팔로워 ${input.followers.toString()} · 팔로잉 ${input.following.toString()}${input.equippedBadge ? `\n대표뱃지 ${input.equippedBadge}` : ""}\n━━━━━━━━━━━━━━━`;
  if (input.placed.length === 0) return `${text}\n[배치된 가구 없음]`;
  input.placed.forEach((row, index) => { text += `${index === 1 ? ALLSEE : ""}\n${index + 1}. ${row.display_name}(+${commas(row.charm_snapshot)}💕)`; });
  return text;
}

// 피드와 댓글을 독립 응답으로 만들어 전달 순서를 고정합니다.
export function formatHomeFeeds(rows: Array<{ content: string }>): string { return `📝 펫홈 피드\n${rows.length === 0 ? "등록된 피드가 없습니다." : rows.map((row, index) => `${index + 1}. ${row.content}`).join("\n")}`; }
export function formatHomeComments(pins: Array<{ author_name: string; body: string }>, comments: Array<{ author_name: string; body: string }>): string {
  const pinned = pins.length === 0 ? "고정 댓글 없음" : pins.map((row) => `📌 ${row.author_name}: ${row.body}`).join("\n");
  const ordinary = comments.length === 0 ? "등록된 댓글이 없습니다." : comments.map((row, index) => `${index + 1}. ${row.author_name}: ${row.body}`).join("\n");
  return `💬 펫홈 댓글\n${pinned}${ALLSEE}\n${ordinary}`;
}

async function queue(tx: DatabaseTransaction, operation: bigint, room: string, messages: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation, room, JSON.stringify({ data: messages[index] })]);
    await tx.execute("INSERT INTO home_profile_view_outbox_parts(operation_id,sequence_no,outbox_id,section_code) VALUES (?,?,?,?)", [operation, index + 1, outbox.insertId, index === 0 ? "home" : messages.length === 3 && index === 1 ? "feed" : "comments"]);
    ids.push(outbox.insertId.toString());
  }
  return ids;
}

// 자기 홈은 순수 조회하고 타인 홈은 방문·최근방문·뱃지·알림을 한 transaction으로 처리합니다.
export class HomeProfileViewService {
  constructor(private readonly database: DatabaseClient) {}
  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<Result> {
    const command = parseHomeProfileViewCommand(input.message);
    if (command === null) throw new ApplicationError("HOME_PROFILE_COMMAND_INVALID", "펫홈 명령 형식을 확인해 주세요.", 422);
    const actor = (await this.database.query<Identity[]>(`SELECT identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) throw new ApplicationError("HOME_PROFILE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    return this.database.withTransaction(async (tx) => {
      const requestKey = key(input.eventId);
      const prior = (await tx.query<Array<{ result_json: string | Result | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const targetRows = command.targetName === null
        ? await tx.query<HomeRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,rank.rank_emoji,home.display_name home_name,home.base_experience,home.like_count,home.visit_count,home.floor_area,home.version,pet.display_name pet_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id JOIN player_homes home ON home.player_id=player.id JOIN player_pets pet ON pet.player_id=player.id AND pet.display_name IS NOT NULL LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE player.id=? AND player.status='active' AND player.deleted_at IS NULL`, [actor.player_id])
        : await tx.query<HomeRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,rank.rank_emoji,home.display_name home_name,home.base_experience,home.like_count,home.visit_count,home.floor_area,home.version,pet.display_name pet_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id JOIN player_homes home ON home.player_id=player.id JOIN player_pets pet ON pet.player_id=player.id AND pet.display_name IS NOT NULL LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE profile.current_display_name=? AND player.status='active' AND player.deleted_at IS NULL ORDER BY player.id LIMIT 2`, [command.targetName]);
      if (targetRows.length === 0) throw new ApplicationError("HOME_PROFILE_TARGET_NOT_FOUND", "펫홈 또는 펫 정보를 찾을 수 없습니다.", 404);
      if (targetRows.length > 1) throw new ApplicationError("HOME_PROFILE_TARGET_AMBIGUOUS", "같은 이름의 회원이 여러 명입니다.", 409);
      const home = targetRows[0]!, selfView = home.player_id === actor.player_id;
      await tx.query("SELECT version FROM home_profile_view_global_locks WHERE lock_code='HOME_PROFILE_VIEW' FOR UPDATE");
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, actor.player_id])).insertId;
      let visitCount = BigInt(home.visit_count), awarded: string[] = [];
      if (!selfView) {
        const locked = (await tx.query<Array<{ visit_count: bigint; version: bigint }>>("SELECT visit_count,version FROM player_homes WHERE player_id=? FOR UPDATE", [home.player_id]))[0]!;
        visitCount = locked.visit_count + 1n;
        await tx.execute("UPDATE player_homes SET visit_count=?,version=version+1 WHERE player_id=? AND version=?", [visitCount, home.player_id, locked.version]);
        await tx.execute("INSERT INTO pet_home_badge_stats(player_id,total_visits,version,updated_at) VALUES (?,1,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE total_visits=total_visits+1,version=version+1,updated_at=UTC_TIMESTAMP(3)", [home.player_id]);
        awarded = await awardHomeActivityBadges(tx, home.player_id);
        await tx.execute("DELETE FROM pet_home_recent_visitors WHERE owner_player_id=? AND visitor_player_id=?", [home.player_id, actor.player_id]);
        const recentNo = Number((await tx.query<Array<{ next_no: bigint }>>("SELECT COALESCE(MAX(sequence_no),0)+1 next_no FROM pet_home_recent_visitors WHERE owner_player_id=?", [home.player_id]))[0]!.next_no);
        const visitedAt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(new Date());
        await tx.execute("INSERT INTO pet_home_recent_visitors(owner_player_id,sequence_no,visitor_player_id,visited_at_text,restored_operation_id) VALUES (?,?,?,?,?)", [home.player_id, recentNo, actor.player_id, visitedAt, operation]);
        await tx.execute("DELETE FROM pet_home_recent_visitors WHERE owner_player_id=? AND sequence_no NOT IN (SELECT sequence_no FROM (SELECT sequence_no FROM pet_home_recent_visitors WHERE owner_player_id=? ORDER BY sequence_no DESC LIMIT 100) keep_rows)", [home.player_id, home.player_id]);
        const alertNo = Number((await tx.query<Array<{ next_no: bigint }>>("SELECT COALESCE(MAX(sequence_no),0)+1 next_no FROM pet_home_activity_alerts WHERE owner_player_id=?", [home.player_id]))[0]!.next_no);
        await tx.execute("INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,actor_name,aggregate_count,restored_operation_id) VALUES (?,?,'home_visit',?,?,FALSE,?,?,?)", [home.player_id, alertNo, actor.player_id, visitedAt, actor.display_name, visitCount, operation]);
        await tx.execute("INSERT INTO home_activity_events(operation_id,home_player_id,actor_player_id,activity_code,detail_json) VALUES (?,?,?,'visit',?)", [operation, home.player_id, actor.player_id, JSON.stringify({ visitCount: visitCount.toString(), recentSequenceNo: recentNo, awardedBadges: awarded })]);
        await tx.execute("INSERT INTO home_profile_visit_events(operation_id,actor_player_id,target_player_id,visit_count_after,recent_sequence_no,awarded_badges_json) VALUES (?,?,?,?,?,?)", [operation, actor.player_id, home.player_id, visitCount, recentNo, JSON.stringify(awarded)]);
      }
      home.visit_count = visitCount;
      const placed = await tx.query<Array<{ display_name: string; charm_snapshot: bigint }>>("SELECT definition.display_name,instance.charm_snapshot FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='placed' ORDER BY instance.id", [home.player_id]);
      const relation = (await tx.query<Array<{ followers: bigint; following: bigint }>>("SELECT (SELECT COUNT(*) FROM pet_home_follows WHERE followed_player_id=? AND active=TRUE) followers,(SELECT COUNT(*) FROM pet_home_follows WHERE follower_player_id=? AND active=TRUE) following", [home.player_id, home.player_id]))[0]!;
      const badge = (await tx.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badges WHERE player_id=? AND owned=TRUE AND equipped=TRUE ORDER BY badge_code LIMIT 1", [home.player_id]))[0]?.badge_code ?? null;
      const ownerPass = Number((await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner','premium') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))", [home.player_id]))[0]?.count_value ?? 0n) > 0;
      const feeds = ownerPass ? await tx.query<Array<{ content: string }>>("SELECT content FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL ORDER BY owner_sequence DESC,id DESC LIMIT 10", [home.player_id]) : [];
      const pins = await tx.query<Array<{ author_name: string; body: string }>>("SELECT profile.current_display_name author_name,comment.body FROM home_comment_pins pin JOIN home_comments comment ON comment.id=pin.comment_id AND comment.status='visible' AND comment.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=comment.author_player_id WHERE pin.home_player_id=? AND pin.deleted_at IS NULL ORDER BY pin.display_order,pin.pin_id", [home.player_id]);
      const comments = await tx.query<Array<{ author_name: string; body: string }>>("SELECT profile.current_display_name author_name,comment.body FROM home_comments comment JOIN player_profiles profile ON profile.player_id=comment.author_player_id WHERE comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM home_comment_pins pin WHERE pin.comment_id=comment.id AND pin.deleted_at IS NULL) ORDER BY comment.created_at DESC,comment.id DESC LIMIT 50", [home.player_id]);
      const messages = [formatHomeProfile({ home, placed, followers: relation.followers, following: relation.following, equippedBadge: badge }), ...(ownerPass ? [formatHomeFeeds(feeds)] : []), formatHomeComments(pins, comments)];
      const outboxIds = await queue(tx, operation, input.destinationId, messages);
      await tx.execute("INSERT INTO home_profile_view_reads(operation_id,actor_player_id,target_player_id,self_view,reply_count,snapshot_json) VALUES (?,?,?,?,?,?)", [operation, actor.player_id, home.player_id, selfView, messages.length, JSON.stringify({ visitCount: visitCount.toString(), placedCount: placed.length, followerCount: relation.followers.toString(), followingCount: relation.following.toString(), feedCount: feeds.length, pinnedCount: pins.length, commentCount: comments.length, awardedBadges: awarded })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_PROFILE_VIEW',?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',?,'player',?,'home.profile_view','success',?,UTC_TIMESTAMP(3))", [operation, actor.player_id, home.player_id, JSON.stringify({ selfView, visitCount: visitCount.toString(), replyCount: messages.length })]);
      const result: Result = { messages, outboxIds, replayed: false, targetPlayerId: home.player_id.toString(), selfView, visitCount: visitCount.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation]);
      return result;
    });
  }
}
