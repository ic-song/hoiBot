import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { awardHomeActivityBadges } from "./daily-comment-service.js";
import type { HomeFeedMutationCommand } from "./home-feed-mutate-command.js";

type Identity = { player_id: bigint; display_name: string };
type FeedRow = { id: bigint; owner_sequence: bigint; content: string };
export type HomeFeedMutationResult = {
  kind: HomeFeedMutationCommand["kind"];
  message: string;
  outboxId: string;
  replayed: boolean;
  feedId: string | null;
  activeCount: number;
  deliveredCount: number;
  trimmedCount: number;
};
type Input = { eventId: string; externalUserId: string; destinationId: string; command: HomeFeedMutationCommand };

const SCOPE = "home.feed.mutate";
const requestKey = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | HomeFeedMutationResult): HomeFeedMutationResult => typeof value === "string" ? JSON.parse(value) as HomeFeedMutationResult : value;

// Asia/Seoul 기준 피드 일일 period key를 반환합니다.
export function homeFeedKstDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// 레거시 UTF-16 length 제한을 그대로 판정합니다.
export function validateHomeFeedContent(content: string): void {
  if (content.length > 100) throw new ApplicationError("HOME_FEED_CONTENT_TOO_LONG", `피드 내용은 최대 100자까지 작성할 수 있습니다. (현재 ${content.length}자)`, 422);
}

// 피드 작성 결과를 전달 인원과 현재 보관량으로 투영합니다.
export function formatHomeFeedCreateReply(deliveredCount: number, activeCount: number): string {
  const delivery = deliveredCount === 0 ? "팔로워에게 전달된 알림이 없습니다." : `팔로워 ${deliveredCount}명에게 알림을 전달했습니다.`;
  return `📰 피드를 작성했습니다.\n${delivery}\n현재 피드 ${activeCount}/10`;
}

async function queueResult(tx: DatabaseTransaction, operationId: bigint, input: Input, result: Omit<HomeFeedMutationResult, "outboxId" | "replayed">): Promise<HomeFeedMutationResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data: result.message })]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.command.commandCode, operationId]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',(SELECT player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1),'player',(SELECT player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1),?,'success',?,UTC_TIMESTAMP(3))", [operationId, input.externalUserId, input.externalUserId, `home.feed.${result.kind}`, JSON.stringify({ activeCount: result.activeCount, deliveredCount: result.deliveredCount, trimmedCount: result.trimmedCount, feedId: result.feedId })]);
  const completed: HomeFeedMutationResult = { ...result, outboxId: outbox.insertId.toString(), replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(completed), operationId]);
  return completed;
}

async function insertFeedAlert(tx: DatabaseTransaction, recipientId: bigint, actor: Identity, operationId: bigint, feedKey: string, content: string): Promise<void> {
  const next = (await tx.query<Array<{ next_no: bigint }>>("SELECT COALESCE(MAX(sequence_no),0)+1 next_no FROM pet_home_activity_alerts WHERE owner_player_id=?", [recipientId]))[0]!.next_no;
  await tx.execute("INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,actor_name,feed_key,feed_content,restored_operation_id) VALUES (?,?,'feed',?,DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(3),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),FALSE,?,?,?,?)", [recipientId, next, actor.player_id, actor.display_name, feedKey, content, operationId]);
  await tx.execute("DELETE FROM pet_home_activity_alerts WHERE owner_player_id=? AND sequence_no NOT IN (SELECT sequence_no FROM (SELECT sequence_no FROM pet_home_activity_alerts WHERE owner_player_id=? ORDER BY sequence_no DESC LIMIT 100) keep_rows)", [recipientId, recipientId]);
}

// 피드 작성·단건삭제·전체삭제를 소유자 단위 원자 transaction으로 처리합니다.
export class HomeFeedMutationService {
  constructor(private readonly db: DatabaseClient) {}

  async execute(input: Input): Promise<HomeFeedMutationResult> {
    const actor = (await this.db.query<Identity[]>("SELECT identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN player_profiles profile ON profile.player_id=identity.player_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1", [input.externalUserId]))[0];
    if (actor === undefined) throw new ApplicationError("HOME_FEED_IDENTITY_REQUIRED", "호이패스·초보패스 이용자만 사용할 수 있습니다.", 403);
    if (input.command.kind === "create" && input.command.content !== null) validateHomeFeedContent(input.command.content);
    return this.db.withTransaction(async (tx) => {
      const key = requestKey(input.eventId);
      await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
      const prior = (await tx.query<Array<{ result_json: string | HomeFeedMutationResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]))[0];
      if (prior?.result_json !== null && prior?.result_json !== undefined) return { ...stored(prior.result_json), replayed: true };
      const pass = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner','premium') AND enabled=TRUE AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))", [actor.player_id]))[0]?.count_value ?? 0n;
      if (pass === 0n) throw new ApplicationError("HOME_FEED_PASS_REQUIRED", "호이패스·초보패스 이용자만 사용할 수 있습니다.", 403);
      if (input.command.kind === "create" && input.command.content !== null) {
        const pet = (await tx.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=? LIMIT 1", [actor.player_id]))[0];
        if (pet === undefined) throw new ApplicationError("HOME_FEED_PET_REQUIRED", "먼저 펫을 생성해 주세요.", 422);
      }
      await tx.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,?,1) ON DUPLICATE KEY UPDATE display_name=COALESCE(display_name,VALUES(display_name))", [actor.player_id, actor.display_name]);
      await tx.query("SELECT player_id FROM player_homes WHERE player_id=? FOR UPDATE", [actor.player_id]);
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, key, actor.player_id])).insertId;
      const beforeRows = await tx.query<FeedRow[]>("SELECT id,owner_sequence,content FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL ORDER BY owner_sequence DESC,id DESC FOR UPDATE", [actor.player_id]);

      if (input.command.kind === "create") {
        if (input.command.content === null) {
          const result = await queueResult(tx, operation, input, { kind: "create", message: "사용법: /피드 [내용]", feedId: null, activeCount: beforeRows.length, deliveredCount: 0, trimmedCount: 0 });
          await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,active_count_before,active_count_after,snapshot_json) VALUES (?,?,'create_usage',?,?,?)", [operation, actor.player_id, beforeRows.length, beforeRows.length, JSON.stringify({ usage: true })]);
          return result;
        }
        const nextSequence = (await tx.query<Array<{ next_sequence: bigint }>>("SELECT COALESCE(MAX(owner_sequence),0)+1 next_sequence FROM home_feeds WHERE home_player_id=?", [actor.player_id]))[0]!.next_sequence;
        await tx.execute("UPDATE home_feeds SET display_order=display_order+1,version=version+1 WHERE home_player_id=? AND deleted_at IS NULL", [actor.player_id]);
        const feedKey = `feed:${operation.toString()}`;
        const created = await tx.execute("INSERT INTO home_feeds(home_player_id,feed_key,owner_sequence,content,display_order,created_at_ms,source_code,source_operation_id) VALUES (?,?,?,?,0,?,'home_feed_mutate',?)", [actor.player_id, feedKey, nextSequence, input.command.content, Date.now(), operation]);
        const trimmed = await tx.execute("UPDATE home_feeds SET deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE home_player_id=? AND deleted_at IS NULL AND id NOT IN (SELECT id FROM (SELECT id FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL ORDER BY owner_sequence DESC,id DESC LIMIT 10) keep_rows)", [actor.player_id, actor.player_id]);
        const period = homeFeedKstDate();
        await tx.execute("INSERT IGNORE INTO pet_home_feed_activity_days(player_id,activity_date,source_code) VALUES (?,?,'home_feed_mutate')", [actor.player_id, period]);
        const activeDays = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_feed_activity_days WHERE player_id=?", [actor.player_id]))[0]!.count_value;
        await tx.execute("INSERT INTO pet_home_badge_stats(player_id,feed_active_days,version,updated_at) VALUES (?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE feed_active_days=VALUES(feed_active_days),version=version+1,updated_at=UTC_TIMESTAMP(3)", [actor.player_id, activeDays]);
        const awardedBadges = await awardHomeActivityBadges(tx, actor.player_id);
        await tx.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'feed_post',?,0,UTC_TIMESTAMP(3))", [actor.player_id, period]);
        await tx.query("SELECT value FROM player_counters WHERE player_id=? AND counter_code='feed_post' AND period_key=? FOR UPDATE", [actor.player_id, period]);
        await tx.execute("UPDATE player_counters SET value=1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='feed_post' AND period_key=?", [actor.player_id, period]);
        const followerRows = await tx.query<Array<{ player_id: bigint }>>("SELECT DISTINCT follow.follower_player_id player_id FROM pet_home_follows follow JOIN players player ON player.id=follow.follower_player_id WHERE follow.followed_player_id=? AND follow.active=TRUE AND follow.follower_player_id<>? ORDER BY follow.follower_player_id", [actor.player_id, actor.player_id]);
        const recipients = [actor.player_id, ...followerRows.map((row) => row.player_id)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        for (const recipientId of recipients) {
          if (recipientId !== actor.player_id) await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [recipientId]);
          await insertFeedAlert(tx, recipientId, actor, operation, feedKey, input.command.content);
        }
        const activeCount = Number((await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL", [actor.player_id]))[0]!.count_value);
        const deliveredCount = followerRows.length;
        const trimmedCount = Number(trimmed.affectedRows);
        const result = await queueResult(tx, operation, input, { kind: "create", message: formatHomeFeedCreateReply(deliveredCount, activeCount), feedId: created.insertId.toString(), activeCount, deliveredCount, trimmedCount });
        await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,feed_id,active_count_before,active_count_after,delivered_count,trimmed_count,counter_after,snapshot_json) VALUES (?,?,'create',?,?,?,?,?,1,?)", [operation, actor.player_id, created.insertId, beforeRows.length, activeCount, deliveredCount, trimmedCount, JSON.stringify({ ownerSequence: nextSequence.toString(), period, recipientIds: recipients.map(String), awardedBadges })]);
        return result;
      }

      if (input.command.kind === "delete") {
        const requested = input.command.displayNumber;
        if (requested === null) {
          const result = await queueResult(tx, operation, input, { kind: "delete", message: "사용법: /피드삭제 [번호]", feedId: null, activeCount: beforeRows.length, deliveredCount: 0, trimmedCount: 0 });
          await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,active_count_before,active_count_after,snapshot_json) VALUES (?,?,'delete_usage',?,?,?)", [operation, actor.player_id, beforeRows.length, beforeRows.length, JSON.stringify({ usage: true })]);
          return result;
        }
        const index = requested > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(requested) - 1;
        const target = index >= 0 ? beforeRows[index] : undefined;
        if (target === undefined) {
          const result = await queueResult(tx, operation, input, { kind: "delete", message: `${requested.toString()}번 피드를 찾을 수 없습니다.`, feedId: null, activeCount: beforeRows.length, deliveredCount: 0, trimmedCount: 0 });
          await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,requested_display_no,active_count_before,active_count_after,snapshot_json) VALUES (?,?,'delete_missing',?,?,?,?)", [operation, actor.player_id, requested, beforeRows.length, beforeRows.length, JSON.stringify({ requested: requested.toString() })]);
          return result;
        }
        await tx.execute("UPDATE home_feeds SET deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=? AND home_player_id=? AND deleted_at IS NULL", [target.id, actor.player_id]);
        const activeCount = beforeRows.length - 1;
        const result = await queueResult(tx, operation, input, { kind: "delete", message: `${requested.toString()}번 피드를 삭제했습니다.`, feedId: target.id.toString(), activeCount, deliveredCount: 0, trimmedCount: 0 });
        await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,feed_id,requested_display_no,active_count_before,active_count_after,snapshot_json) VALUES (?,?,'delete',?,?,?,?,?)", [operation, actor.player_id, target.id, requested, beforeRows.length, activeCount, JSON.stringify({ ownerSequence: target.owner_sequence.toString(), content: target.content })]);
        return result;
      }

      const cleared = await tx.execute("UPDATE home_feeds SET deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE home_player_id=? AND deleted_at IS NULL", [actor.player_id]);
      const result = await queueResult(tx, operation, input, { kind: "clear", message: "피드를 모두 삭제했습니다. (0/10)", feedId: null, activeCount: 0, deliveredCount: 0, trimmedCount: 0 });
      await tx.execute("INSERT INTO home_feed_mutation_events(operation_id,player_id,action_code,active_count_before,active_count_after,snapshot_json) VALUES (?,?,'clear',?,0,?)", [operation, actor.player_id, beforeRows.length, JSON.stringify({ cleared: Number(cleared.affectedRows) })]);
      return result;
    });
  }
}
