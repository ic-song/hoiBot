import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드이름변경";
const COMMAND_CODE = "GUILD_NAME_RENAME";
const TICKET_CODE = "ITEM-GUILD-NAME-RENAME-TICKET";

export interface GuildNameRenameInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface ParsedGuildNameRename { displayName: string; normalizedName: string; }
export interface GuildNameRenameResult { status: "renamed"; guildId: string; oldDisplayName: string; displayName: string; guildVersion: string; registryVersion: string; ticketQuantity: string; data: string; outboxId: string; auditId: string; }

// 레거시 broad namespace 후보를 보존하고 실제 실행 검증은 parser에 위임합니다.
export function isGuildNameRenameCandidate(message: string | undefined): boolean {
  return message !== undefined && message.indexOf(COMMAND) === 0;
}

// 공백 없는 UTF-16 1~10자 이름을 NFC stable key와 함께 반환합니다.
export function parseGuildNameRename(message: string): ParsedGuildNameRename {
  if (!isGuildNameRenameCandidate(message)) throw new ApplicationError("INVALID_GUILD_NAME_RENAME_COMMAND", "길드이름변경 명령 형식이 올바르지 않습니다.", 422);
  const displayName = message.slice(COMMAND.length).trim();
  if (displayName.length < 1 || displayName.length > 10 || /\s/.test(displayName) || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new ApplicationError("GUILD_NAME_RENAME_USAGE", "사용법: /길드이름변경 새이름 (공백 없이 1~10자)", 422);
  }
  return { displayName, normalizedName: displayName.normalize("NFC") };
}

// 긴 event ID를 operations unique key 길이에 맞게 축약합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | GuildNameRenameResult): GuildNameRenameResult {
  return typeof value === "string" ? JSON.parse(value) as GuildNameRenameResult : value;
}

// MariaDB 드라이버의 BIGINT 반환 형식을 bigint로 정규화합니다.
function asBigInt(value: bigint | number | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

async function rollout(database: DatabaseClient): Promise<string | null> {
  const row = (await database.query<Array<{ rollout_state: string; enabled: number }>>(
    "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
  ))[0];
  return row === undefined || row.enabled !== 1 ? null : row.rollout_state;
}

// 길드 이름과 변경권 차감 및 모든 실행 증거를 한 transaction에서 커밋합니다.
export class GuildNameRenameService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildNameRenameInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    parseGuildNameRename(input.message);
    const state = await rollout(this.database);
    if (state === null || state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (state !== "ACTIVE") return { status: "shadow" };
    const result = await this.rename(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async rename(input: GuildNameRenameInput): Promise<GuildNameRenameResult> {
    const requested = parseGuildNameRename(input.message);
    return this.database.withTransaction(async (tx: DatabaseTransaction) => {
      const actorRows = await tx.query<Array<{ player_id: bigint; guild_id: bigint; role_code: string; guild_name: string; guild_version: bigint }>>(
        `SELECT identity.player_id,member.guild_id,member.role_code,guild.display_name guild_name,guild.version guild_version
         FROM external_identities identity
         JOIN guild_members member ON member.player_id=identity.player_id
         JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL
         LIMIT 2 FOR UPDATE`, [input.externalUserId]
      );
      if (actorRows.length === 0) throw new ApplicationError("GUILD_NAME_RENAME_MEMBER_REQUIRED", "❌ 가입된 길드 정보를 찾을 수 없습니다.", 404);
      if (actorRows.length > 1) throw new ApplicationError("GUILD_NAME_RENAME_MEMBERSHIP_AMBIGUOUS", "❌ 길드 회원 정보가 중복되어 이름을 변경할 수 없습니다.", 409);
      const actor = actorRows[0]!;
      const role = actor.role_code.toLowerCase();
      if (role !== "leader" && role !== "master") throw new ApplicationError("GUILD_NAME_RENAME_LEADER_REQUIRED", "❌ 길드장만 길드 이름을 변경할 수 있습니다.", 403);

      const scope = `guild.name.rename:${actor.guild_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ actor_id: bigint | null; result_json: string | GuildNameRenameResult | null }>>(
        "SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        if (prior[0].actor_id !== actor.player_id) throw new ApplicationError("GUILD_NAME_RENAME_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
        return stored(prior[0].result_json);
      }

      const oldNormalizedName = actor.guild_name.normalize("NFC");
      await tx.execute(
        "INSERT IGNORE INTO guild_name_registry(guild_id,normalized_name,display_name,version) VALUES (?,?,?,1)",
        [actor.guild_id,oldNormalizedName,actor.guild_name]
      );
      const registry = (await tx.query<Array<{ normalized_name: string; display_name: string; version: bigint }>>(
        "SELECT normalized_name,display_name,version FROM guild_name_registry WHERE guild_id=? FOR UPDATE", [actor.guild_id]
      ))[0];
      if (registry === undefined || registry.normalized_name !== oldNormalizedName || registry.display_name !== actor.guild_name) {
        throw new ApplicationError("GUILD_NAME_RENAME_REGISTRY_MISMATCH", "❌ 길드 이름 등록부가 현재 길드 정보와 일치하지 않습니다.", 409);
      }
      if (requested.normalizedName === registry.normalized_name) throw new ApplicationError("GUILD_NAME_RENAME_SAME", "❌ 현재 길드 이름과 같습니다.", 409);
      const duplicate = (await tx.query<Array<{ guild_id: bigint }>>(
        "SELECT guild_id FROM guild_name_registry WHERE normalized_name=? LIMIT 1 FOR UPDATE", [requested.normalizedName]
      ))[0];
      if (duplicate !== undefined && duplicate.guild_id !== actor.guild_id) throw new ApplicationError("GUILD_NAME_RENAME_DUPLICATE", "❌ 이미 사용 중인 길드 이름입니다.", 409);

      const ticket = (await tx.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT definition.id item_id,COALESCE(stack.quantity,0) quantity,COALESCE(stack.version,0) version
         FROM item_definitions definition
         LEFT JOIN inventory_stacks stack ON stack.item_id=definition.id AND stack.player_id=?
         WHERE definition.code=? AND definition.active=TRUE LIMIT 1 FOR UPDATE`, [actor.player_id,TICKET_CODE]
      ))[0];
      if (ticket === undefined) throw new ApplicationError("GUILD_NAME_RENAME_TICKET_DEFINITION_REQUIRED", "❌ 길드 이름 변경권 정보를 찾을 수 없습니다.", 409);
      const guildVersion = asBigInt(actor.guild_version);
      const registryVersion = asBigInt(registry.version);
      const ticketQuantity = asBigInt(ticket.quantity);
      const ticketVersion = asBigInt(ticket.version);
      if (ticketQuantity < 1n) throw new ApplicationError("GUILD_NAME_RENAME_TICKET_REQUIRED", "❌ 길드이름변경권이 필요합니다.", 422);

      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,actor.player_id]
      );
      const guildWrite = await tx.execute(
        "UPDATE guilds SET display_name=?,version=version+1 WHERE id=? AND version=? AND display_name=?",
        [requested.displayName,actor.guild_id,guildVersion,actor.guild_name]
      );
      const registryWrite = await tx.execute(
        "UPDATE guild_name_registry SET normalized_name=?,display_name=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=? AND normalized_name=?",
        [requested.normalizedName,requested.displayName,actor.guild_id,registryVersion,registry.normalized_name]
      );
      const ticketWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity=? AND version=?",
        [actor.player_id,ticket.item_id,ticketQuantity,ticketVersion]
      );
      if (guildWrite.affectedRows !== 1n || registryWrite.affectedRows !== 1n || ticketWrite.affectedRows !== 1n) {
        throw new ApplicationError("GUILD_NAME_RENAME_CONFLICT", "❌ 길드 또는 변경권 정보가 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'GUILD_NAME_RENAME_TICKET_CONSUME')",
        [operation.insertId,actor.player_id,ticket.item_id]
      );
      await tx.execute(
        `INSERT INTO guild_name_rename_operations(operation_id,guild_id,actor_player_id,ticket_item_id,old_display_name,new_display_name,old_normalized_name,new_normalized_name,ticket_quantity_before,ticket_quantity_after,guild_version_before,guild_version_after,registry_version_before,registry_version_after)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId,actor.guild_id,actor.player_id,ticket.item_id,actor.guild_name,requested.displayName,registry.normalized_name,requested.normalizedName,ticketQuantity,ticketQuantity-1n,guildVersion,guildVersion+1n,registryVersion,registryVersion+1n]
      );
      const data = `✅ [${actor.guild_name}] 길드 이름을 [${requested.displayName}](으)로 변경했습니다.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,input.channelId,JSON.stringify({data})]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','renamed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId,COMMAND_CODE,operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.name.rename','renamed','Iris 길드이름변경',?,UTC_TIMESTAMP(3))",
        [operation.insertId,actor.player_id,actor.guild_id,JSON.stringify({oldDisplayName:actor.guild_name,displayName:requested.displayName,oldNormalizedName:registry.normalized_name,normalizedName:requested.normalizedName,ticketBefore:ticketQuantity.toString(),ticketAfter:(ticketQuantity-1n).toString(),guildVersion:(guildVersion+1n).toString(),registryVersion:(registryVersion+1n).toString()})]
      );
      const result: GuildNameRenameResult = { status:"renamed",guildId:actor.guild_id.toString(),oldDisplayName:actor.guild_name,displayName:requested.displayName,guildVersion:(guildVersion+1n).toString(),registryVersion:(registryVersion+1n).toString(),ticketQuantity:(ticketQuantity-1n).toString(),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
