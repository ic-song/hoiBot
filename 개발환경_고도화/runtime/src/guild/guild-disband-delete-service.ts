import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "GUILD_DISBAND_DELETE";
const IDEMPOTENCY_SCOPE = "guild.disband.delete";
const COMMAND_PATTERN = /^\/(?:길드삭제|길드해산|길드해지)\s+(\S(?:.*\S)?)$/;

interface AuthorityRow { operator_id: bigint; identity_id: bigint; }
interface GuildRow { id: bigint; code: string; display_name: string; mark: string | null; server_code: string | null; status: string; version: bigint; }
interface StoredOperationRow { actor_id: bigint | null; result_json: string | GuildDisbandDeleteResult | null; }

export interface GuildDisbandDeleteInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface GuildDisbandDeleteCommand { guildName: string; }
export interface GuildDisbandDeleteResult {
  status: "disbanded";
  replayed: boolean;
  guildId: string;
  guildName: string;
  memberCount: number;
  pendingJoinCount: number;
  territoryCount: number;
  castleReleased: boolean;
  data: string;
  outboxId: string;
}

// 길드 삭제 계열은 길드명이 포함된 완전한 명령만 후보로 허용합니다.
export function isGuildDisbandDeleteCommandCandidate(message: string | undefined): boolean {
  return message === "/길드삭제" || message === "/길드해산" || message === "/길드해지"
    || (message !== undefined && COMMAND_PATTERN.test(message));
}

// 세 레거시 별칭의 길드명을 하나의 NFC 이름 계약으로 변환합니다.
export function parseGuildDisbandDeleteCommand(message: string | undefined): GuildDisbandDeleteCommand | null {
  if (message === undefined || /[\r\n]/.test(message)) return null;
  const match = COMMAND_PATTERN.exec(message);
  if (match === null) return null;
  const guildName = match[1]!.normalize("NFC");
  return guildName.length <= 191 ? { guildName } : null;
}

// 긴 Iris 이벤트 ID를 공용 멱등 키 길이에 맞게 고정합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시작 가능한 응답으로 복원합니다.
function stored(value: string | GuildDisbandDeleteResult): GuildDisbandDeleteResult {
  return typeof value === "string" ? JSON.parse(value) as GuildDisbandDeleteResult : value;
}

// 관리자 외부 identity를 잠그고 길드 해산 권한을 확인합니다.
async function requireAuthority(transaction: DatabaseTransaction, externalUserId: string): Promise<AuthorityRow> {
  const authority = (await transaction.query<AuthorityRow[]>(
    `SELECT operator_row.id operator_id,identity.id identity_id
       FROM external_identities identity
       JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id
       JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active'
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
      LIMIT 1 FOR UPDATE`, [externalUserId]
  ))[0];
  if (authority === undefined) throw new ApplicationError("GUILD_DISBAND_FORBIDDEN", "❌ MASTER 권한만 길드를 해산할 수 있습니다.", 403);
  return authority;
}

// 표시명은 길드 ID를 찾는 입력으로만 쓰고 이후 정리는 잠긴 stable guild_id로 수행합니다.
async function lockGuildByExactName(transaction: DatabaseTransaction, guildName: string): Promise<GuildRow> {
  const rows = await transaction.query<GuildRow[]>(
    "SELECT id,code,display_name,mark,server_code,status,version FROM guilds WHERE display_name=? AND status='active' ORDER BY id FOR UPDATE", [guildName]
  );
  if (rows.length === 0) throw new ApplicationError("GUILD_DISBAND_NOT_FOUND", `❌ 존재하지 않는 길드입니다.\n\n입력한 길드명: ${guildName}`, 404);
  if (rows.length !== 1) throw new ApplicationError("GUILD_DISBAND_NAME_CONFLICT", "동일 길드명이 여러 안정 ID에 연결되어 해산을 중지했습니다.", 409);
  return rows[0]!;
}

// 현재 projection만 정리하고 과거 길드·ledger·event 행은 보존합니다.
async function clearCurrentReferences(transaction: DatabaseTransaction, guild: GuildRow): Promise<{ memberCount: number; pendingJoinCount: number; territoryCount: number; castleReleased: boolean }> {
  const memberCount = Number((await transaction.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_members WHERE guild_id=? FOR UPDATE", [guild.id]))[0]!.count);
  const pending = await transaction.execute("UPDATE guild_join_requests SET status='cancelled',completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND status='pending'", [guild.id]);
  await transaction.execute(
    `UPDATE guild_territory_ready_guilds ready_row
        JOIN guild_territory_wars war ON war.id=ready_row.war_id AND war.active=TRUE
        SET ready_row.ready=FALSE,ready_row.eliminated_reason='guild_disbanded',ready_row.eliminated_at=UTC_TIMESTAMP(3)
      WHERE ready_row.guild_id=?`, [guild.id]
  );
  const territories = await transaction.execute(
    `UPDATE guild_territory_occupations occupation
        JOIN guild_territory_wars war ON war.id=occupation.war_id AND war.active=TRUE
        SET occupation.owner_guild_id=NULL,occupation.owner_player_id=NULL,occupation.version=occupation.version+1
      WHERE occupation.owner_guild_id=?`, [guild.id]
  );
  await transaction.execute("UPDATE guild_territory_wars SET rift_event_guild_id=NULL,rift_event_status=NULL,rift_event_at=NULL,version=version+1 WHERE active=TRUE AND rift_event_guild_id=?", [guild.id]);
  await transaction.execute("UPDATE guild_territory_rift_authorizations SET active=FALSE,version=version+1 WHERE guild_id=? AND active=TRUE", [guild.id]);
  const castle = await transaction.execute("UPDATE castle_state SET lord_guild_name=NULL,lord_player_id=NULL,earnings=0,defense_count=0,version=version+1 WHERE state_code='HOI_CASTLE' AND lord_guild_name=?", [guild.display_name]);
  await transaction.execute("DELETE FROM guild_name_registry WHERE guild_id=?", [guild.id]);
  await transaction.execute("DELETE FROM guild_members WHERE guild_id=?", [guild.id]);
  return { memberCount, pendingJoinCount: Number(pending.affectedRows), territoryCount: Number(territories.affectedRows), castleReleased: castle.affectedRows === 1n };
}

// 길드 해산을 tombstone·참조 정리·감사·outbox까지 한 transaction으로 완료합니다.
export class GuildDisbandDeleteService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: GuildDisbandDeleteInput): Promise<GuildDisbandDeleteResult | null> {
    const command = parseGuildDisbandDeleteCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_GUILD_DISBAND_COMMAND", "사용법: /길드해산 [길드명]", 422);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return null;
    if (rollout.rollout_state !== "ACTIVE") return null;
    return this.execute(input, command);
  }

  public async execute(input: GuildDisbandDeleteInput, command = parseGuildDisbandDeleteCommand(input.message)): Promise<GuildDisbandDeleteResult> {
    if (command === null) throw new ApplicationError("INVALID_GUILD_DISBAND_COMMAND", "사용법: /길드해산 [길드명]", 422);
    return this.database.withTransaction(async (transaction) => {
      const authority = await requireAuthority(transaction, input.externalUserId);
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperationRow[]>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [IDEMPOTENCY_SCOPE, key]))[0];
      if (prior?.result_json !== undefined && prior.result_json !== null) {
        if (String(prior.actor_id) !== String(authority.identity_id)) throw new ApplicationError("GUILD_DISBAND_REPLAY_ACTOR_MISMATCH", "같은 해산 요청의 실행자가 다릅니다.", 409);
        return { ...stored(prior.result_json), replayed: true };
      }
      const guild = await lockGuildByExactName(transaction, command.guildName);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), IDEMPOTENCY_SCOPE, key, authority.identity_id]);
      const cleared = await clearCurrentReferences(transaction, guild);
      const tombstoneCode = `DISBANDED-${guild.id}-${randomUUID()}`;
      const tombstoneName = `disbanded#${guild.id}`;
      const guildWrite = await transaction.execute("UPDATE guilds SET code=?,display_name=?,mark=NULL,status='disbanded',version=version+1 WHERE id=? AND status='active' AND version=?", [tombstoneCode, tombstoneName, guild.id, guild.version]);
      if (guildWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_DISBAND_CONFLICT", "길드 상태가 먼저 변경되었습니다.", 409);
      const data = `🏰 길드 해산 완료\n━━━━━━━━━━━━━━━\n길드명: ${guild.display_name}\n길드원: ${cleared.memberCount}명\n\n해당 길드가 정상적으로 해산되었습니다.\n\n✅ 길드 현재 상태 종료\n✅ 길드원 소속 초기화\n✅ 영지·성주 참조 정리\n━━━━━━━━━━━━━━━`;
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','disbanded',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.disband.delete','disbanded','Iris 길드 해산',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, guild.id, JSON.stringify({ guildId: guild.id.toString(), guildName: guild.display_name, memberCount: cleared.memberCount, pendingJoinCount: cleared.pendingJoinCount, territoryCount: cleared.territoryCount, castleReleased: cleared.castleReleased, physicalDelete: false, historyPreserved: true })]);
      const result: GuildDisbandDeleteResult = { status: "disbanded", replayed: false, guildId: guild.id.toString(), guildName: guild.display_name, ...cleared, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("INSERT INTO guild_disband_runs(operation_id,request_key,operator_id,identity_id,guild_id,guild_code,guild_name,guild_mark,server_code,guild_version_before,member_count,pending_join_count,territory_count,castle_released,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, key, authority.operator_id, authority.identity_id, guild.id, guild.code, guild.display_name, guild.mark, guild.server_code, guild.version, cleared.memberCount, cleared.pendingJoinCount, cleared.territoryCount, cleared.castleReleased, JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
