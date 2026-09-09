import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

type Numeric = bigint | number | string;

export interface CastleKingdomStatusSnapshot {
  lordName: string;
  lordRank: string;
  petName: string;
  guildName: string;
  guildMark: string;
  serverName: string;
  castleCharm: bigint;
  taxRateBasisPoints: number;
  earnings: bigint;
}

export interface CastleKingdomStatusReadResult {
  status: "active" | "no_lord";
  data: string;
  outboxId: string;
  replayed: boolean;
}

// 호월킹덤 exact 명령만 현대화 조회 경로로 전달합니다.
export function isCastleKingdomStatusReadCommand(message: string | undefined): boolean {
  return message === "/호월킹덤";
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function taxPercent(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

// 캐슬·영주·펫·길드 권위 projection을 기존 필드 순서로 표시합니다.
export function formatCastleKingdomStatus(snapshot: CastleKingdomStatusSnapshot | null): string {
  if (snapshot === null) return "🏰 호월킹덤 🏰\n\n현재 영주가 없습니다.";
  return [
    "🏰 호월킹덤 🏰",
    "━━━━━━━━━━━━━━━",
    `영주: ${snapshot.lordRank}${snapshot.lordName}`,
    `영주 펫: ${snapshot.petName}`,
    `길드: ${snapshot.guildName}(${snapshot.guildMark})`,
    `서버: ${snapshot.serverName}`,
    `캐슬 매력: ${commas(snapshot.castleCharm)}💕`,
    `세율: ${taxPercent(snapshot.taxRateBasisPoints)}%`,
    `수익: ${commas(snapshot.earnings)} Point`
  ].join("\n");
}

function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function parseResult(value: string | CastleKingdomStatusReadResult): CastleKingdomStatusReadResult {
  return typeof value === "string" ? JSON.parse(value) as CastleKingdomStatusReadResult : value;
}

// 호월킹덤 상태를 조회 전용 operation·audit·outbox로 기록합니다.
export class CastleKingdomStatusReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<CastleKingdomStatusReadResult | null> {
    if (!isCastleKingdomStatusReadCommand(input.message)) return null;
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ identity_id: Numeric; player_id: Numeric }>>(
        `SELECT identity.id AS identity_id,identity.player_id FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [input.externalUserId]
      );
      const identity = identities[0];
      if (identity === undefined) return null;
      const scope = `castle.kingdom.status.read:${identity.identity_id}`;
      const key = normalizeEventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleKingdomStatusReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]
      );
      if (prior[0]?.result_json != null) return { ...parseResult(prior[0].result_json), replayed:true };
      const rows = await transaction.query<Array<{ lord_player_id: Numeric | null; tax_rate_basis_points: number; earnings: Numeric; lord_name: string | null; lord_rank: string | null; pet_name: string | null; pet_experience: Numeric | null; guild_name: string | null; legacy_guild_name: string | null; guild_mark: string | null; server_name: string | null; guild_charm: Numeric | null; item_charm: Numeric | null; lord_earnings: Numeric | null }>>(
        `SELECT castle.lord_player_id,castle.tax_rate_basis_points,castle.earnings,
           profile.current_display_name AS lord_name,rank_profile.rank_emoji AS lord_rank,pet.display_name AS pet_name,pet.experience AS pet_experience,
           guild.display_name AS guild_name,castle.lord_guild_name AS legacy_guild_name,COALESCE(guild_profile.mark_text,guild.mark) AS guild_mark,
           COALESCE(guild_profile.server_display_name,guild.server_code) AS server_name,guild_profile.charm_value AS guild_charm,
           (SELECT COALESCE(SUM(stack.quantity*bonus.charm_per_unit),0) FROM inventory_stacks stack
             JOIN castle_battle_item_bonus_definitions bonus ON bonus.item_id=stack.item_id AND bonus.active=TRUE
             WHERE stack.player_id=castle.lord_player_id) AS item_charm,
           lord_earning.amount AS lord_earnings
         FROM castle_state castle
         LEFT JOIN players lord ON lord.id=castle.lord_player_id AND lord.status='active'
         LEFT JOIN player_profiles profile ON profile.player_id=lord.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=lord.id
         LEFT JOIN player_pets pet ON pet.player_id=lord.id
         LEFT JOIN guild_members membership ON membership.player_id=lord.id
         LEFT JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
         LEFT JOIN guild_profile_details guild_profile ON guild_profile.guild_id=guild.id
         LEFT JOIN player_lord_earnings lord_earning ON lord_earning.player_id=lord.id
         WHERE castle.state_code='HOI_CASTLE' FOR UPDATE`
      );
      const row = rows[0];
      const snapshot = row?.lord_player_id == null ? null : {
        lordName:row.lord_name ?? "미지정",lordRank:row.lord_rank ?? "",petName:row.pet_name ?? "미지정",
        guildName:row.guild_name ?? row.legacy_guild_name ?? "미지정",guildMark:row.guild_mark ?? "",serverName:row.server_name ?? "미지정",
        castleCharm:BigInt(row.pet_experience ?? 0)+BigInt(row.guild_charm ?? 0)+BigInt(row.item_charm ?? 0),
        taxRateBasisPoints:row.tax_rate_basis_points,earnings:BigInt(row.earnings ?? row.lord_earnings ?? 0)
      } satisfies CastleKingdomStatusSnapshot;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(),scope,key,String(identity.identity_id)]
      );
      const data = formatCastleKingdomStatus(snapshot);
      const status = snapshot === null ? "no_lord" : "active";
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,input.channelId,JSON.stringify({data})]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'CASTLE_KINGDOM_STATUS_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId,operation.insertId,status]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'castle_state',?,'castle.kingdom.status.read',?,'Iris /호월킹덤',?,UTC_TIMESTAMP(3))",
        [operation.insertId,identity.identity_id,row?.lord_player_id ?? null,status,JSON.stringify({stateCode:"HOI_CASTLE",lordPlayerId:row?.lord_player_id == null ? null : String(row.lord_player_id),domainMutation:false,repairMutation:false})]
      );
      const result: CastleKingdomStatusReadResult = {status,data,outboxId:outbox.insertId.toString(),replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
