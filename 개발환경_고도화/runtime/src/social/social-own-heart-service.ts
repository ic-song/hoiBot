import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type OwnHeartStatus = "shown" | "pass_required";

export interface SocialOwnHeartResult {
  status: OwnHeartStatus;
  reply: string;
  outboxId: string;
  date: string;
  base: string;
  mutualBonus: string;
  premiumBonus: string;
  skillBonus: string;
  used: string;
  remaining: string;
  limit: string;
}

interface Owner {
  identity_id: bigint;
  player_id: bigint;
  display_name: string;
  rank_emoji: string;
  last_heart_expression_date: string | null;
}

// 레거시와 동일하게 정확한 /내마음만 실행 후보로 봅니다.
export function isSocialOwnHeartCandidate(message: string | undefined): boolean {
  return message === "/내마음";
}

// 실행 가능한 입력만 하나의 DB 대표 alias로 정규화합니다.
export function normalizeSocialOwnHeartDispatchMessage(message: string): string {
  return isSocialOwnHeartCandidate(message) ? "/내마음" : message;
}

// 계산된 마음 사용량을 레거시 출력 순서로 투영합니다.
export function formatSocialOwnHeartReply(input: {
  displayName: string; rankEmoji?: string; premium: boolean; base: bigint; mutualBonus: bigint;
  premiumBonus: bigint; skillBonus: bigint; used: bigint; remaining: bigint; limit: bigint;
}): string {
  return (input.premium ? "[👑호이패스 프리미엄👑]\n" : "") +
    `[${input.rankEmoji ?? ""}${input.displayName}] 님\n` +
    "💞 맞팔 마음표현 혜택\n━━━━━━━━━━━━\n" +
    `기본 사용 가능 횟수: ${input.base}회\n` +
    `맞팔 보너스: +${input.mutualBonus}회\n` +
    (input.premiumBonus > 0n ? `호이패스 프리미엄: +${input.premiumBonus}회\n` : "") +
    (input.skillBonus > 0n ? `망므📙: +${input.skillBonus}회\n` : "") +
    `오늘 사용: ${input.used}회\n남은 마음: ${input.remaining}회\n최종 사용 가능 횟수: ${input.limit}회`;
}

function idempotencyKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | SocialOwnHeartResult): SocialOwnHeartResult {
  return typeof value === "string" ? JSON.parse(value) as SocialOwnHeartResult : value;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; identityId: bigint; playerId: bigint;
  resultCode: OwnHeartStatus; reply: string; result: Omit<SocialOwnHeartResult, "reply" | "outboxId">;
  summary: Record<string, unknown>;
}): Promise<SocialOwnHeartResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'SOCIAL_OWN_HEART',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'social.own_heart.read',?,'Iris /내마음',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.identityId, input.playerId, input.resultCode, JSON.stringify(input.summary)],
  );
  const result: SocialOwnHeartResult = { ...input.result, reply: input.reply, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 활성 패스·맞팔·프리미엄·장착 스킬과 오늘 사용량을 한 transaction에서 읽고 증적을 남깁니다.
export class SocialOwnHeartService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<SocialOwnHeartResult> {
    if (!isSocialOwnHeartCandidate(input.message)) throw new ApplicationError("INVALID_SOCIAL_OWN_HEART", "지원하지 않는 명령어입니다.", 422);
    return this.database.withTransaction(async (transaction) => {
      const owner = (await transaction.query<Owner[]>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,
                COALESCE(rank_profile.rank_emoji,'') rank_emoji,
                DATE_FORMAT(home.last_heart_expression_date,'%Y-%m-%d') last_heart_expression_date
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
         LEFT JOIN player_homes home ON home.player_id=player.id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         LIMIT 1 FOR UPDATE`, [input.externalUserId],
      ))[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      const key = idempotencyKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | SocialOwnHeartResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='social.own_heart' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'social.own_heart',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, owner.identity_id],
      );
      const today = (await transaction.query<Array<{ today: string }>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR),'%Y-%m-%d') today"))[0]!.today;
      const passes = await transaction.query<Array<{ pass_code: string }>>(
        `SELECT pass_code FROM player_passes WHERE player_id=? AND pass_code IN ('hoi','newbie','premium') AND enabled=TRUE
           AND (permanent=TRUE OR ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3)) ORDER BY pass_code FOR UPDATE`, [owner.player_id],
      );
      if (passes.length === 0) {
        const reply = "❌ 마음표현 혜택은 호이패스·초보패스 이용자만 확인할 수 있습니다.";
        await transaction.execute(
          "INSERT INTO social_own_heart_reads(operation_id,player_id,usage_date,access_allowed,base_count,mutual_bonus,premium_bonus,skill_bonus,used_count,remaining_count,limit_count) VALUES (?,?,?,FALSE,0,0,0,0,0,0,0)",
          [operation.insertId, owner.player_id, today],
        );
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id,
          playerId: owner.player_id, resultCode: "pass_required", reply,
          result: { status: "pass_required", date: today, base: "0", mutualBonus: "0", premiumBonus: "0", skillBonus: "0", used: "0", remaining: "0", limit: "0" },
          summary: { accessAllowed: false, domainMutation: false },
        });
      }
      const premium = passes.some((row) => row.pass_code === "premium");
      const mutualBonus = BigInt((await transaction.query<Array<{ mutual_count: bigint }>>(
        `SELECT COUNT(*) mutual_count FROM pet_home_follows follow_row
         JOIN pet_home_follows reverse_row ON reverse_row.follower_player_id=follow_row.followed_player_id
          AND reverse_row.followed_player_id=follow_row.follower_player_id AND reverse_row.active=TRUE
         WHERE follow_row.follower_player_id=? AND follow_row.active=TRUE AND EXISTS (
           SELECT 1 FROM player_passes target_pass WHERE target_pass.player_id=follow_row.followed_player_id
            AND target_pass.pass_code IN ('hoi','newbie','premium') AND target_pass.enabled=TRUE
            AND (target_pass.permanent=TRUE OR target_pass.ends_at IS NULL OR target_pass.ends_at>=UTC_TIMESTAMP(3))
         )`, [owner.player_id],
      ))[0]?.mutual_count ?? 0n);
      const skillBonus = BigInt((await transaction.query<Array<{ heart_bonus: bigint }>>(
        `SELECT COALESCE(SUM(skill_row.heart_bonus),0) heart_bonus FROM (
           SELECT DISTINCT definition.id,CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.heartBonus')),'0') AS UNSIGNED) heart_bonus
           FROM player_pets pet JOIN pet_skills equipped ON equipped.player_pet_id=pet.id AND equipped.equipped=TRUE
           JOIN skill_definitions definition ON definition.id=equipped.skill_id AND definition.active=TRUE
           WHERE pet.player_id=? AND JSON_EXTRACT(definition.rules_json,'$.heartBonus') IS NOT NULL
         ) skill_row`, [owner.player_id],
      ))[0]?.heart_bonus ?? 0n);
      const usage = (await transaction.query<Array<{ used_count: bigint }>>(
        "SELECT used_count FROM player_pet_home_heart_usage WHERE player_id=? AND usage_date=? FOR UPDATE", [owner.player_id, today],
      ))[0];
      const used = usage?.used_count ?? (owner.last_heart_expression_date === today ? 1n : 0n);
      let usageInitialized = false;
      if (usage === undefined) {
        await transaction.execute("INSERT INTO player_pet_home_heart_usage(player_id,usage_date,used_count,version) VALUES (?,?,?,1)", [owner.player_id, today, used]);
        usageInitialized = true;
      }
      const base = 1n, premiumBonus = premium ? 15n : 0n, limit = base + mutualBonus + premiumBonus + skillBonus;
      const remaining = limit > used ? limit - used : 0n;
      const reply = formatSocialOwnHeartReply({ displayName: owner.display_name, rankEmoji: owner.rank_emoji, premium, base, mutualBonus, premiumBonus, skillBonus, used, remaining, limit });
      await transaction.execute(
        "INSERT INTO social_own_heart_reads(operation_id,player_id,usage_date,access_allowed,base_count,mutual_bonus,premium_bonus,skill_bonus,used_count,remaining_count,limit_count) VALUES (?,?,?,TRUE,?,?,?,?,?,?,?)",
        [operation.insertId, owner.player_id, today, base, mutualBonus, premiumBonus, skillBonus, used, remaining, limit],
      );
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id,
        playerId: owner.player_id, resultCode: "shown", reply,
        result: { status: "shown", date: today, base: base.toString(), mutualBonus: mutualBonus.toString(), premiumBonus: premiumBonus.toString(), skillBonus: skillBonus.toString(), used: used.toString(), remaining: remaining.toString(), limit: limit.toString() },
        summary: { accessAllowed: true, base: base.toString(), mutualBonus: mutualBonus.toString(), premiumBonus: premiumBonus.toString(), skillBonus: skillBonus.toString(), used: used.toString(), remaining: remaining.toString(), limit: limit.toString(), usageInitialized },
      });
    });
  }
}
