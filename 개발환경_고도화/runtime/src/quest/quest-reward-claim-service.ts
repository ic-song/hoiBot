import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ALIASES = new Set(["/퀘스트완료", "ㅎㅎㅎ", "/ㅇ", "/ㅇㅇㅇ"]);
const LIMITS = { tower: 15n, castle: 15n, mini: 15n, explore: 10n, weekly: 7n };
type Numeric = bigint | number | string;
interface State { tower: bigint; castle: bigint; mini: bigint; explore: bigint; weekly: bigint; daily: boolean; pass: boolean; premium: boolean; }
interface RewardRow { reward_scope: string; reward_order: number; item_id: Numeric; quantity: Numeric; display_name: string; }
export interface QuestRewardClaimResult { status: "claimed" | "already_claimed" | "not_ready"; playerId: string; claimedScopes: string[]; pointBonus: string; data: string; outboxId?: string; replayed: boolean; }

export function isQuestRewardClaimCommand(message: string | undefined): boolean { return message !== undefined && ALIASES.has(message); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function integer(value: Numeric): bigint { return BigInt(String(value).split(".")[0]!); }
function stored(value: string | QuestRewardClaimResult): QuestRewardClaimResult { return typeof value === "string" ? JSON.parse(value) as QuestRewardClaimResult : value; }
function serial(value: unknown): string { return JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current); }

// 일일·패스·주간 조건과 펫스킬 보너스를 DB 원장으로 원자 지급합니다.
export class QuestRewardClaimService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string; suppressOutbox?: boolean }): Promise<QuestRewardClaimResult | null> {
    if (!isQuestRewardClaimCommand(input.message)) throw new ApplicationError("QUEST_REWARD_COMMAND_INVALID", "정확한 /퀘스트완료 명령을 입력해주세요.", 422);
    return this.database.withTransaction(async transaction => {
      const actor = (await transaction.query<Array<{ identity_id: bigint; player_id: bigint; display_name: string }>>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE", [input.externalUserId]))[0];
      if (actor === undefined) return null;
      const key = eventKey(input.eventId), scope = `quest.reward.claim:${actor.identity_id}`;
      const prior = (await transaction.query<Array<{ result_json: string | QuestRewardClaimResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id]);
      const date = (await transaction.query<Array<{ value: string }>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d') value"))[0]!.value;
      await transaction.execute("INSERT INTO player_pet_daily_records(player_id,record_date) VALUES (?,?) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)", [actor.player_id, date]);
      const before = await readState(transaction, actor.player_id, date);
      const passFlags = (await transaction.query<Array<{ base_pass: number; premium_pass: number }>>(`SELECT EXISTS(SELECT 1 FROM player_passes WHERE player_id=? AND enabled=TRUE AND pass_code IN ('support','beginner') AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) base_pass,EXISTS(SELECT 1 FROM player_passes WHERE player_id=? AND enabled=TRUE AND pass_code='premium' AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) premium_pass`, [actor.player_id, actor.player_id]))[0]!;
      const baseComplete = before.tower >= LIMITS.tower && before.castle >= LIMITS.castle && before.mini >= LIMITS.mini && before.explore >= LIMITS.explore;
      const passComplete = before.explore >= LIMITS.explore;
      const scopes: string[] = [];
      let weekly = before.weekly;
      if (baseComplete && !before.daily) { scopes.push("DAILY"); weekly = weekly + 1n > LIMITS.weekly ? LIMITS.weekly : weekly + 1n; await transaction.execute("UPDATE player_pet_daily_records SET daily_quest_rewarded=TRUE,weekly_quest_count=?,version=version+1 WHERE player_id=? AND record_date=?", [weekly, actor.player_id, date]); }
      if (Boolean(passFlags.base_pass) && passComplete && !before.pass) { scopes.push("PASS_DAILY"); await transaction.execute("UPDATE player_pet_daily_records SET pass_daily_quest_rewarded=TRUE,version=version+1 WHERE player_id=? AND record_date=?", [actor.player_id, date]); }
      if (Boolean(passFlags.premium_pass) && passComplete && !before.premium) { scopes.push("PREMIUM_DAILY"); await transaction.execute("UPDATE player_pet_daily_records SET premium_daily_quest_rewarded=TRUE,version=version+1 WHERE player_id=? AND record_date=?", [actor.player_id, date]); }
      if (weekly >= LIMITS.weekly && scopes.includes("DAILY")) { scopes.push("WEEKLY"); weekly = 0n; await transaction.execute("UPDATE player_pet_daily_records SET weekly_quest_count=0,version=version+1 WHERE player_id=? AND record_date=?", [actor.player_id, date]); }
      const rewards: RewardRow[] = scopes.length === 0 ? [] : await transaction.query<RewardRow[]>(`SELECT reward.reward_scope,reward.reward_order,reward.item_id,reward.quantity,item.display_name FROM auto_daily_quest_reward_definitions reward JOIN item_definitions item ON item.id=reward.item_id WHERE reward.active=TRUE AND reward.reward_scope IN (${scopes.map(() => "?").join(",")}) ORDER BY reward.reward_scope,reward.reward_order FOR UPDATE`, scopes);
      let sequence = 1;
      for (const reward of rewards) { await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [actor.player_id, reward.item_id, reward.quantity]); await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'quest_reward_claim')", [operation.insertId, sequence++, actor.player_id, reward.item_id, reward.quantity]); }
      const skills = await transaction.query<Array<{ display_name: string }>>("SELECT definition.display_name FROM player_pets pet JOIN pet_skills assignment ON assignment.player_pet_id=pet.id AND assignment.equipped=TRUE JOIN skill_definitions definition ON definition.id=assignment.skill_id AND definition.active=TRUE WHERE pet.player_id=? ORDER BY assignment.slot_no FOR UPDATE", [actor.player_id]);
      const names = new Set(skills.map(row => row.display_name));
      const pointBonus = (scopes.includes("DAILY") && names.has("일일루틴") ? 100_000_000n : 0n) + (scopes.includes("WEEKLY") && names.has("주간루틴") ? 1_000_000_000n : 0n);
      if (pointBonus > 0n) {
        await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [actor.player_id]);
        const account = (await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0]!;
        const after = integer(account.balance) + pointBonus;
        await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [after, actor.player_id, account.version]);
        await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'quest_routine_bonus')", [operation.insertId, actor.player_id, pointBonus, after]);
      }
      const messages: string[] = [];
      if (scopes.includes("DAILY")) messages.push("✅ 일일퀘스트 보상 지급 완료!\n보상 : 다이아상자💎(/다이아상자오픈) 1개\n1억포인트상자🪙(/포인트상자오픈) 1개\n펫 강화석⭐ 30개");
      if (scopes.includes("PASS_DAILY")) messages.push("✅ 호이·초보패스 전용 일퀘 보상 지급 완료!\n보상 : 1억포인트상자🪙(/포인트상자오픈) 2개");
      if (scopes.includes("PREMIUM_DAILY")) messages.push("✅ 호이패스 프리미엄 추가 일퀘 보상 지급 완료!\n보상 : 다이아상자💎(/다이아상자오픈) 1개");
      if (scopes.includes("WEEKLY")) messages.push("🦋 주간퀘스트 보상 지급 완료!\n보상 : 펫스킬북📙(/펫스킬오픈) 1개\n다이아상자💎(/다이아상자오픈) 2개\n땅문서📜 1개\n미니펫뽑기🐹(/미니펫오픈) 100개\n펫스윗홈인테리어샵🖼️(/샵오픈) 100개");
      if (scopes.includes("WEEKLY") && names.has("주간루틴")) messages.push(`[${actor.display_name}] 주간루틴이 완벽하게 이어집니다!\n[${actor.display_name}] 꾸준함의 보상으로 추가 포인트를 획득합니다!\n[${actor.display_name}] 주퀘보상 보너스 발동! 🅟1,000,000,000`);
      if (scopes.includes("DAILY") && names.has("일일루틴")) messages.push("🎉 일일루틴📙 1억 포인트를 지급받습니다.");
      if (messages.length === 0 && baseComplete && before.daily) messages.push(`✅ 오늘 이미 일일퀘스트 완료 보상을 받았습니다.\n주간퀘스트🦋[${before.weekly}/7]`);
      const status: QuestRewardClaimResult["status"] = scopes.length > 0 ? "claimed" : messages.length > 0 ? "already_claimed" : "not_ready";
      const data = messages.join("\n\n");
      const outbox = data && !input.suppressOutbox ? await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]) : undefined;
      const result: QuestRewardClaimResult = { status, playerId: actor.player_id.toString(), claimedScopes: scopes, pointBonus: pointBonus.toString(), data, ...(outbox === undefined ? {} : { outboxId: outbox.insertId.toString() }), replayed: false };
      const after = await readState(transaction, actor.player_id, date);
      await transaction.execute("INSERT INTO quest_reward_claim_runs(operation_id,player_id,record_date,status,before_json,after_json,claimed_scope_json,point_bonus) VALUES (?,?,?,?,?,?,?,?)", [operation.insertId, actor.player_id, date, status, serial(before), serial(after), JSON.stringify(scopes), pointBonus]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'QUEST_REWARD_CLAIM',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'quest.reward.claim',?,'Iris 퀘스트 보상',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, actor.player_id, status, serial(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

async function readState(transaction: DatabaseTransaction, playerId: bigint, date: string): Promise<State> {
  const row = (await transaction.query<Array<{ tower_attempts: Numeric; castle_battle_attempts: Numeric; mini_battle_attempts: Numeric; explore_attempts: Numeric; weekly_quest_count: Numeric; daily_quest_rewarded: number; pass_daily_quest_rewarded: number; premium_daily_quest_rewarded: number }>>("SELECT tower_attempts,castle_battle_attempts,mini_battle_attempts,explore_attempts,weekly_quest_count,daily_quest_rewarded,pass_daily_quest_rewarded,premium_daily_quest_rewarded FROM player_pet_daily_records WHERE player_id=? AND record_date=? FOR UPDATE", [playerId, date]))[0]!;
  return { tower: integer(row.tower_attempts), castle: integer(row.castle_battle_attempts), mini: integer(row.mini_battle_attempts), explore: integer(row.explore_attempts), weekly: integer(row.weekly_quest_count), daily: Boolean(row.daily_quest_rewarded), pass: Boolean(row.pass_daily_quest_rewarded), premium: Boolean(row.premium_daily_quest_rewarded) };
}
