import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드마크변경";
const COMMAND_CODE = "GUILD_MARK_MUTATE";
const TICKET_CODE = "ITEM-GUILD-MARK-CHANGE-TICKET";

export interface GuildMarkMutateInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface ParsedGuildMarkMutate { mark: string; }
export interface GuildMarkMutateResult { status: "changed"; guildId: string; oldMark: string | null; mark: string; guildVersion: string; ticketQuantity: string; data: string; outboxId: string; auditId: string; }

// 레거시 broad namespace 후보를 보존하고 실제 실행 검증은 parser에 위임합니다.
export function isGuildMarkMutateCandidate(message: string | undefined): boolean {
  return message !== undefined && message.indexOf(COMMAND) === 0;
}

// trim 이후 공백 없는 UTF-16 1~10자 길드 마크를 반환합니다.
export function parseGuildMarkMutate(message: string): ParsedGuildMarkMutate {
  if (!isGuildMarkMutateCandidate(message)) throw new ApplicationError("INVALID_GUILD_MARK_MUTATE_COMMAND", "길드마크변경 명령 형식이 올바르지 않습니다.", 422);
  const mark = message.slice(COMMAND.length).trim();
  if (mark.length < 1 || mark.length > 10 || /\s/.test(mark) || /[\u0000-\u001f\u007f]/.test(mark)) {
    throw new ApplicationError("GUILD_MARK_MUTATE_USAGE", "사용법: /길드마크변경 이모지 (공백 없이 1~10자)", 422);
  }
  return { mark };
}

// 긴 event ID를 operations unique key 길이에 맞게 축약합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | GuildMarkMutateResult): GuildMarkMutateResult {
  return typeof value === "string" ? JSON.parse(value) as GuildMarkMutateResult : value;
}

// MariaDB BIGINT 반환 형식을 bigint로 정규화합니다.
function asBigInt(value: bigint | number | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

async function rollout(database: DatabaseClient): Promise<string | null> {
  const row = (await database.query<Array<{ rollout_state: string; enabled: number }>>(
    "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
  ))[0];
  return row === undefined || row.enabled !== 1 ? null : row.rollout_state;
}

// 길드 마크와 변경권 차감 및 실행 증거를 한 transaction에서 커밋합니다.
export class GuildMarkMutateService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildMarkMutateInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    parseGuildMarkMutate(input.message);
    const state = await rollout(this.database);
    if (state === null || state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (state !== "ACTIVE") return { status: "shadow" };
    const result = await this.change(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async change(input: GuildMarkMutateInput): Promise<GuildMarkMutateResult> {
    const requested = parseGuildMarkMutate(input.message);
    return this.database.withTransaction(async (tx: DatabaseTransaction) => {
      const actors = await tx.query<Array<{ identity_id: bigint; player_id: bigint; guild_id: bigint; role_code: string; guild_name: string; guild_mark: string | null; guild_version: bigint; can_admin: number }>>(
        `SELECT identity.id identity_id,identity.player_id,membership.guild_id,membership.role_code,
          guild.display_name guild_name,guild.mark guild_mark,guild.version guild_version,
          EXISTS(SELECT 1 FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            LEFT JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='game.guild.change'
            WHERE mapping.external_identity_id=identity.id AND (role.code='super_admin' OR permission.permission_code IS NOT NULL)) can_admin
         FROM external_identities identity
         JOIN guild_members membership ON membership.player_id=identity.player_id
         JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL
         LIMIT 2 FOR UPDATE`, [input.externalUserId]
      );
      if (actors.length === 0) throw new ApplicationError("GUILD_MARK_MUTATE_MEMBER_REQUIRED", "❌ 가입된 길드 정보를 찾을 수 없습니다.", 404);
      if (actors.length > 1) throw new ApplicationError("GUILD_MARK_MUTATE_MEMBERSHIP_AMBIGUOUS", "❌ 길드 회원 정보가 중복되어 마크를 변경할 수 없습니다.", 409);
      const actor = actors[0]!;
      const role = actor.role_code.toLowerCase();
      if (role !== "leader" && role !== "master" && Number(actor.can_admin) !== 1) {
        throw new ApplicationError("GUILD_MARK_MUTATE_AUTHORITY_REQUIRED", "❌ 길드장 또는 관리자만 길드 마크를 변경할 수 있습니다.", 403);
      }

      const scope = `guild.mark.mutate:${actor.guild_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ actor_id: bigint | null; result_json: string | GuildMarkMutateResult | null }>>(
        "SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        if (prior[0].actor_id !== actor.player_id) throw new ApplicationError("GUILD_MARK_MUTATE_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
        return stored(prior[0].result_json);
      }

      const ticket = (await tx.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT definition.id item_id,COALESCE(stack.quantity,0) quantity,COALESCE(stack.version,0) version
         FROM item_definitions definition
         LEFT JOIN inventory_stacks stack ON stack.item_id=definition.id AND stack.player_id=?
         WHERE definition.code=? AND definition.active=TRUE LIMIT 1 FOR UPDATE`, [actor.player_id,TICKET_CODE]
      ))[0];
      if (ticket === undefined) throw new ApplicationError("GUILD_MARK_MUTATE_TICKET_DEFINITION_REQUIRED", "❌ 길드 마크 변경권 정보를 찾을 수 없습니다.", 409);
      const guildVersion = asBigInt(actor.guild_version);
      const ticketQuantity = asBigInt(ticket.quantity);
      const ticketVersion = asBigInt(ticket.version);
      if (ticketQuantity < 1n) throw new ApplicationError("GUILD_MARK_MUTATE_TICKET_REQUIRED", "❌ 길드마크변경권이 필요합니다.", 422);

      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,actor.player_id]
      );
      const guildWrite = await tx.execute(
        "UPDATE guilds SET mark=?,version=version+1 WHERE id=? AND version=? AND (mark <=> ?)",
        [requested.mark,actor.guild_id,guildVersion,actor.guild_mark]
      );
      const ticketWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity=? AND version=?",
        [actor.player_id,ticket.item_id,ticketQuantity,ticketVersion]
      );
      if (guildWrite.affectedRows !== 1n || ticketWrite.affectedRows !== 1n) {
        throw new ApplicationError("GUILD_MARK_MUTATE_CONFLICT", "❌ 길드 또는 변경권 정보가 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'GUILD_MARK_CHANGE_TICKET_CONSUME')",
        [operation.insertId,actor.player_id,ticket.item_id]
      );
      await tx.execute(
        `INSERT INTO guild_mark_mutation_runs(operation_id,guild_id,actor_player_id,ticket_item_id,old_mark,new_mark,ticket_quantity_before,ticket_quantity_after,guild_version_before,guild_version_after)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId,actor.guild_id,actor.player_id,ticket.item_id,actor.guild_mark,requested.mark,ticketQuantity,ticketQuantity-1n,guildVersion,guildVersion+1n]
      );
      const data = `✅ [${actor.guild_name}] 길드 마크를 [${requested.mark}](으)로 변경했습니다.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,input.channelId,JSON.stringify({data})]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','changed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId,COMMAND_CODE,operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.mark.change','changed','Iris 길드마크변경',?,UTC_TIMESTAMP(3))",
        [operation.insertId,actor.player_id,actor.guild_id,JSON.stringify({oldMark:actor.guild_mark,mark:requested.mark,ticketBefore:ticketQuantity.toString(),ticketAfter:(ticketQuantity-1n).toString(),guildVersion:(guildVersion+1n).toString()})]
      );
      const result: GuildMarkMutateResult = { status:"changed",guildId:actor.guild_id.toString(),oldMark:actor.guild_mark,mark:requested.mark,guildVersion:(guildVersion+1n).toString(),ticketQuantity:(ticketQuantity-1n).toString(),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
