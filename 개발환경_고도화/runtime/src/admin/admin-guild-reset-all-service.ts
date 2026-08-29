import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드전체초기화";
const COMMAND_CODE = "ADMIN_GUILD_RESET_ALL";
const RESTORE_COMMAND_CODE = "ADMIN_GUILD_RESET_ALL_RESTORE";
const SCOPE = "admin.guild.reset_all";
const RESTORE_SCOPE = "admin.guild.reset_all.restore";
const STATE_KEY = "guild_reset_all";
const SNAPSHOT_SCHEMA_VERSION = 1;

type Numeric = bigint | string | number;
interface AuthorityRow { operator_id: Numeric; identity_id: Numeric }
interface StateRow { generation: Numeric; version: Numeric }
interface GuildRow { id: Numeric; code: string; display_name: string; mark: string | null; server_code: string | null; level: Numeric; join_requirement_experience: Numeric; member_join_closed: Numeric; max_members: Numeric; recruitment_bonus: Numeric; status: string; version: Numeric }
interface MemberRow { guild_id: Numeric; player_id: Numeric; role_code: string; joined_at: string | null }
interface NameRow { guild_id: Numeric; normalized_name: string; display_name: string; version: Numeric; updated_at: string }
interface SnapshotRow { id: Numeric; generation_before: Numeric; generation_after: Numeric | null; snapshot_checksum: string; status: string }
interface SnapshotDataRow { table_code: "guilds" | "guild_members" | "guild_name_registry"; ordinal_value: Numeric; stable_key: string; row_json: string | Record<string, string | null>; row_hash: string }
interface StoredResetRow { operator_id: Numeric; result_json: string | AdminGuildResetAllResult }
interface StoredRestoreRow { operator_id: Numeric; result_json: string | AdminGuildResetRestoreResult }

type CanonicalRow = Record<string, string | null>;
interface SnapshotEntry { tableCode: "guilds" | "guild_members" | "guild_name_registry"; ordinal: number; stableKey: string; value: CanonicalRow; json: string; hash: string }

export interface AdminGuildResetAllResult {
  status: "reset";
  operationId: string;
  snapshotId: string;
  generationBefore: string;
  generationAfter: string;
  resetGuildCount: number;
  resetMemberCount: number;
  resetNameCount: number;
  snapshotChecksum: string;
  data: string;
  outboxId: string;
}

export interface AdminGuildResetRestoreResult {
  status: "restored";
  operationId: string;
  snapshotId: string;
  generationBefore: string;
  generationAfter: string;
  restoredGuildCount: number;
  restoredMemberCount: number;
  restoredNameCount: number;
  snapshotChecksum: string;
  data: string;
  outboxId: string;
}

export type AdminGuildResetAllIrisResult = { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

// 길드 전체 초기화는 인자 없는 exact legacy 명령만 후보로 허용합니다.
export function isAdminGuildResetAllCommand(message: string | undefined): boolean { return message === COMMAND; }

// table·stable key·canonical JSON 순서로 sealed snapshot checksum을 계산합니다.
export function computeAdminGuildResetSnapshotChecksum(entries: readonly { tableCode: string; stableKey: string; json: string }[]): string {
  return createHash("sha256").update(entries.map((entry) => `${entry.tableCode}|${entry.stableKey}|${entry.json}`).join("\n")).digest("hex");
}

// 현재형 길드·회원·이름 registry를 sealed snapshot 뒤 한 transaction으로 초기화합니다.
export class AdminGuildResetAllService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<AdminGuildResetAllIrisResult> {
    if (!isAdminGuildResetAllCommand(input.message)) return { status: "legacy_fallback" };
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || !rollout.enabled || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    try {
      const result = await this.reset(input);
      return { status: "changed", data: result.data, outboxId: result.outboxId };
    } catch (error) {
      if (error instanceof ApplicationError && (error.code === "ADMIN_GUILD_RESET_FORBIDDEN" || error.code === "ADMIN_GUILD_RESET_ROOM_FORBIDDEN")) return { status: "handled_no_reply" };
      throw error;
    }
  }

  public async reset(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<AdminGuildResetAllResult> {
    if (!isAdminGuildResetAllCommand(input.message)) throw new ApplicationError("INVALID_ADMIN_GUILD_RESET_COMMAND", "길드 전체 초기화 명령 형식이 올바르지 않습니다.", 422);
    const requestKey = key(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const authority = await this.requireAuthority(transaction, input.externalUserId, input.channelId);
      const state = await this.lockState(transaction);
      const replay = (await transaction.query<StoredResetRow[]>("SELECT operator_id,result_json FROM admin_guild_reset_runs WHERE request_key=? FOR UPDATE", [requestKey]))[0];
      if (replay !== undefined) {
        if (String(replay.operator_id) !== String(authority.operator_id)) throw new ApplicationError("ADMIN_GUILD_RESET_REPLAY_ACTOR_MISMATCH", "같은 초기화 요청의 운영자가 다릅니다.", 409);
        return storedReset(replay.result_json);
      }
      await this.requireNoActiveWar(transaction);
      const locked = await this.lockCurrentRows(transaction);
      const entries = buildEntries(locked.guilds, locked.members, locked.names);
      const checksum = computeAdminGuildResetSnapshotChecksum(entries);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, authority.identity_id]);
      const snapshot = await transaction.execute("INSERT INTO admin_guild_reset_snapshots(operation_id,schema_version,generation_before,active_guild_count,member_count,name_count,snapshot_checksum,status) VALUES (?,?,?,?,?,?,?,'building')", [operation.insertId, SNAPSHOT_SCHEMA_VERSION, state.generation, locked.guilds.length, locked.members.length, locked.names.length, checksum]);
      for (const entry of entries) await transaction.execute("INSERT INTO admin_guild_reset_snapshot_rows(snapshot_id,table_code,ordinal_value,stable_key,row_json,row_hash) VALUES (?,?,?,?,?,?)", [snapshot.insertId, entry.tableCode, entry.ordinal, entry.stableKey, entry.json, entry.hash]);
      const generationAfter = BigInt(state.generation) + 1n;
      await transaction.execute("UPDATE admin_guild_reset_snapshots SET generation_after=?,status='sealed',sealed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='building'", [generationAfter, snapshot.insertId]);

      const namesDeleted = await transaction.execute("DELETE registry FROM guild_name_registry registry JOIN guilds guild ON guild.id=registry.guild_id WHERE guild.status='active'");
      const membersDeleted = await transaction.execute("DELETE membership FROM guild_members membership JOIN guilds guild ON guild.id=membership.guild_id WHERE guild.status='active'");
      const guildsReset = await transaction.execute("UPDATE guilds SET code=CONCAT('__reset_',?,'_',id),display_name=CONCAT('reset#',?,'#',id),mark=NULL,status='reset',version=version+1 WHERE status='active'", [snapshot.insertId, snapshot.insertId]);
      if (namesDeleted.affectedRows !== BigInt(locked.names.length) || membersDeleted.affectedRows !== BigInt(locked.members.length) || guildsReset.affectedRows !== BigInt(locked.guilds.length)) throw new Error("ADMIN_GUILD_RESET_COUNT_MISMATCH");
      await this.requireEmptyCurrentState(transaction);
      const stateUpdate = await transaction.execute("UPDATE admin_guild_reset_state SET generation=?,version=version+1,last_snapshot_id=? WHERE state_key=? AND version=?", [generationAfter, snapshot.insertId, STATE_KEY, state.version]);
      if (stateUpdate.affectedRows !== 1n) throw new Error("ADMIN_GUILD_RESET_STATE_CONFLICT");

      const data = `✅ 길드 전체 초기화 완료\n초기화 길드: ${locked.guilds.length}개\n초기화 회원 소속: ${locked.members.length}개\n초기화 이름 인덱스: ${locked.names.length}개\n복구 스냅샷: #${snapshot.insertId}`;
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild_reset_snapshot',?,'admin.guild.reset_all','reset','Iris /길드전체초기화',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, snapshot.insertId, JSON.stringify({ generationBefore: String(state.generation), generationAfter: generationAfter.toString(), resetGuildCount: locked.guilds.length, resetMemberCount: locked.members.length, resetNameCount: locked.names.length, snapshotChecksum: checksum, physicalGuildDelete: false, appendOnlyHistoryPreserved: true })]);
      const result: AdminGuildResetAllResult = { status: "reset", operationId: operation.insertId.toString(), snapshotId: snapshot.insertId.toString(), generationBefore: String(state.generation), generationAfter: generationAfter.toString(), resetGuildCount: locked.guilds.length, resetMemberCount: locked.members.length, resetNameCount: locked.names.length, snapshotChecksum: checksum, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("INSERT INTO admin_guild_reset_runs(operation_id,request_key,operator_id,identity_id,snapshot_id,generation_before,generation_after,reset_guild_count,reset_member_count,reset_name_count,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, requestKey, authority.operator_id, authority.identity_id, snapshot.insertId, state.generation, generationAfter, locked.guilds.length, locked.members.length, locked.names.length, JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  // sealed snapshot과 generation CAS를 확인한 뒤 current 세 테이블만 원자 복구합니다.
  public async restore(input: { eventId: string; externalUserId: string; channelId: string; snapshotId: string }): Promise<AdminGuildResetRestoreResult> {
    const requestKey = key(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const authority = await this.requireAuthority(transaction, input.externalUserId, input.channelId);
      const state = await this.lockState(transaction);
      const replay = (await transaction.query<StoredRestoreRow[]>("SELECT operator_id,result_json FROM admin_guild_reset_restore_runs WHERE request_key=? FOR UPDATE", [requestKey]))[0];
      if (replay !== undefined) {
        if (String(replay.operator_id) !== String(authority.operator_id)) throw new ApplicationError("ADMIN_GUILD_RESTORE_REPLAY_ACTOR_MISMATCH", "같은 복구 요청의 운영자가 다릅니다.", 409);
        return storedRestore(replay.result_json);
      }
      const snapshot = (await transaction.query<SnapshotRow[]>("SELECT id,generation_before,generation_after,snapshot_checksum,status FROM admin_guild_reset_snapshots WHERE id=? FOR UPDATE", [input.snapshotId]))[0];
      if (snapshot === undefined || snapshot.status !== "sealed" || snapshot.generation_after === null) throw new ApplicationError("ADMIN_GUILD_RESTORE_SNAPSHOT_UNAVAILABLE", "복구 가능한 sealed 길드 스냅샷이 없습니다.", 409);
      if (String(snapshot.generation_after) !== String(state.generation)) throw new ApplicationError("ADMIN_GUILD_RESTORE_GENERATION_CONFLICT", "스냅샷 이후 길드 초기화 세대가 변경되었습니다.", 409);
      await this.requireNoActiveWar(transaction);
      const current = await this.lockCurrentRows(transaction, false);
      if (current.guilds.length !== 0) throw new ApplicationError("ADMIN_GUILD_RESTORE_ACTIVE_GUILD_CONFLICT", "초기화 후 생성된 활성 길드가 있어 자동 복구할 수 없습니다.", 409);
      const rows = await transaction.query<SnapshotDataRow[]>("SELECT table_code,ordinal_value,stable_key,row_json,row_hash FROM admin_guild_reset_snapshot_rows WHERE snapshot_id=? ORDER BY FIELD(table_code,'guilds','guild_name_registry','guild_members'),ordinal_value FOR UPDATE", [snapshot.id]);
      const entries = rows.map((row) => { const json = typeof row.row_json === "string" ? row.row_json : JSON.stringify(row.row_json); if (sha(json) !== row.row_hash) throw new Error("ADMIN_GUILD_RESTORE_ROW_HASH_MISMATCH"); return { tableCode: row.table_code, stableKey: row.stable_key, json }; });
      if (computeAdminGuildResetSnapshotChecksum(entries) !== snapshot.snapshot_checksum) throw new Error("ADMIN_GUILD_RESTORE_SNAPSHOT_CHECKSUM_MISMATCH");
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), RESTORE_SCOPE, requestKey, authority.identity_id]);
      let guildCount = 0, memberCount = 0, nameCount = 0;
      for (const row of rows) {
        const value = parseRow(row.row_json);
        if (row.table_code === "guilds") {
          const write = await transaction.execute("UPDATE guilds SET code=?,display_name=?,mark=?,server_code=?,level=?,join_requirement_experience=?,member_join_closed=?,max_members=?,recruitment_bonus=?,status=?,version=? WHERE id=? AND status='reset' AND code=?", [value.code, value.display_name, value.mark, value.server_code, value.level, value.join_requirement_experience, value.member_join_closed, value.max_members, value.recruitment_bonus, value.status, value.version, value.id, tombstoneCode(snapshot.id, value.id!)]);
          if (write.affectedRows !== 1n) throw new ApplicationError("ADMIN_GUILD_RESTORE_GUILD_CONFLICT", "복구 대상 길드 tombstone이 변경되었습니다.", 409);
          guildCount += 1;
        } else if (row.table_code === "guild_name_registry") {
          await transaction.execute("INSERT INTO guild_name_registry(guild_id,normalized_name,display_name,version,updated_at) VALUES (?,?,?,?,?)", [value.guild_id, value.normalized_name, value.display_name, value.version, value.updated_at]);
          nameCount += 1;
        } else {
          await transaction.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,?)", [value.guild_id, value.player_id, value.role_code, value.joined_at]);
          memberCount += 1;
        }
      }
      const generationAfter = BigInt(state.generation) + 1n;
      const stateUpdate = await transaction.execute("UPDATE admin_guild_reset_state SET generation=?,version=version+1,last_snapshot_id=? WHERE state_key=? AND version=?", [generationAfter, snapshot.id, STATE_KEY, state.version]);
      if (stateUpdate.affectedRows !== 1n) throw new Error("ADMIN_GUILD_RESTORE_STATE_CONFLICT");
      await transaction.execute("UPDATE admin_guild_reset_snapshots SET status='restored',restored_at=UTC_TIMESTAMP(3) WHERE id=? AND status='sealed'", [snapshot.id]);
      const data = `♻️ 길드 전체 초기화 복구 완료\n복구 길드: ${guildCount}개\n복구 회원 소속: ${memberCount}개\n복구 이름 인덱스: ${nameCount}개\n스냅샷: #${snapshot.id}`;
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','restored',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, RESTORE_COMMAND_CODE, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild_reset_snapshot',?,'admin.guild.reset_all.restore','restored','sealed snapshot restore',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, snapshot.id, JSON.stringify({ generationBefore: String(state.generation), generationAfter: generationAfter.toString(), restoredGuildCount: guildCount, restoredMemberCount: memberCount, restoredNameCount: nameCount, snapshotChecksum: snapshot.snapshot_checksum })]);
      const result: AdminGuildResetRestoreResult = { status: "restored", operationId: operation.insertId.toString(), snapshotId: String(snapshot.id), generationBefore: String(state.generation), generationAfter: generationAfter.toString(), restoredGuildCount: guildCount, restoredMemberCount: memberCount, restoredNameCount: nameCount, snapshotChecksum: snapshot.snapshot_checksum, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("INSERT INTO admin_guild_reset_restore_runs(operation_id,request_key,operator_id,identity_id,snapshot_id,generation_before,generation_after,restored_guild_count,restored_member_count,restored_name_count,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, requestKey, authority.operator_id, authority.identity_id, snapshot.id, state.generation, generationAfter, guildCount, memberCount, nameCount, JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async requireAuthority(transaction: DatabaseTransaction, externalUserId: string, channelId: string): Promise<AuthorityRow> {
    const row = (await transaction.query<AuthorityRow[]>(`SELECT operator_row.id operator_id,identity.id identity_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active' JOIN admin_guild_reset_operator_allowlist allowlist ON allowlist.operator_id=operator_row.id AND allowlist.external_channel_id=? AND allowlist.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator_row.id LIMIT 1 FOR UPDATE`, [channelId, externalUserId]))[0];
    if (row !== undefined) return row;
    const operator = (await transaction.query<Array<{ operator_id: Numeric }>>(`SELECT operator_row.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active' JOIN admin_guild_reset_operator_allowlist allowlist ON allowlist.operator_id=operator_row.id AND allowlist.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [externalUserId]))[0];
    if (operator === undefined) throw new ApplicationError("ADMIN_GUILD_RESET_FORBIDDEN", "길드 전체 초기화 권한이 없습니다.", 403);
    throw new ApplicationError("ADMIN_GUILD_RESET_ROOM_FORBIDDEN", "허용된 운영 채널에서만 길드 전체 초기화를 실행할 수 있습니다.", 403);
  }

  private async lockState(transaction: DatabaseTransaction): Promise<StateRow> {
    const row = (await transaction.query<StateRow[]>("SELECT generation,version FROM admin_guild_reset_state WHERE state_key=? FOR UPDATE", [STATE_KEY]))[0];
    if (row === undefined) throw new Error("ADMIN_GUILD_RESET_STATE_MISSING");
    return row;
  }

  private async requireNoActiveWar(transaction: DatabaseTransaction): Promise<void> {
    const active = (await transaction.query<Array<{ id: Numeric }>>("SELECT id FROM guild_territory_wars WHERE active=TRUE OR lifecycle_state<>'READY' OR start_ready=TRUE OR pending_start_token IS NOT NULL OR opening_token IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE"))[0];
    if (active !== undefined) throw new ApplicationError("ADMIN_GUILD_RESET_ACTIVE_WAR", "진행 중이거나 예약된 길드 영지전이 있어 전체 초기화를 중단했습니다.", 409);
  }

  private async lockCurrentRows(transaction: DatabaseTransaction, includeInactive = true): Promise<{ guilds: GuildRow[]; members: MemberRow[]; names: NameRow[] }> {
    const allGuilds = await transaction.query<GuildRow[]>("SELECT id,code,display_name,mark,server_code,level,join_requirement_experience,member_join_closed,max_members,recruitment_bonus,status,version FROM guilds ORDER BY id FOR UPDATE");
    const allNames = await transaction.query<NameRow[]>("SELECT guild_id,normalized_name,display_name,version,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') updated_at FROM guild_name_registry ORDER BY guild_id FOR UPDATE");
    const allMembers = await transaction.query<MemberRow[]>("SELECT guild_id,player_id,role_code,DATE_FORMAT(joined_at,'%Y-%m-%d %H:%i:%s.%f') joined_at FROM guild_members ORDER BY guild_id,player_id FOR UPDATE");
    const activeIds = new Set(allGuilds.filter((guild) => guild.status === "active").map((guild) => String(guild.id)));
    return { guilds: includeInactive ? allGuilds.filter((guild) => guild.status === "active") : allGuilds.filter((guild) => guild.status === "active"), members: allMembers.filter((member) => activeIds.has(String(member.guild_id))), names: allNames.filter((name) => activeIds.has(String(name.guild_id))) };
  }

  private async requireEmptyCurrentState(transaction: DatabaseTransaction): Promise<void> {
    const row = (await transaction.query<Array<{ guilds: Numeric; members: Numeric; names: Numeric }>>(`SELECT (SELECT COUNT(*) FROM guilds WHERE status='active') guilds,(SELECT COUNT(*) FROM guild_members membership JOIN guilds guild ON guild.id=membership.guild_id WHERE guild.status='active') members,(SELECT COUNT(*) FROM guild_name_registry registry JOIN guilds guild ON guild.id=registry.guild_id WHERE guild.status='active') names`))[0]!;
    if (BigInt(row.guilds) !== 0n || BigInt(row.members) !== 0n || BigInt(row.names) !== 0n) throw new Error("ADMIN_GUILD_RESET_POSTCONDITION_FAILED");
  }
}

function buildEntries(guilds: readonly GuildRow[], members: readonly MemberRow[], names: readonly NameRow[]): SnapshotEntry[] {
  const values: Array<{ tableCode: SnapshotEntry["tableCode"]; stableKey: string; value: CanonicalRow }> = [];
  for (const guild of guilds) values.push({ tableCode: "guilds", stableKey: String(guild.id), value: { id: String(guild.id), code: guild.code, display_name: guild.display_name, mark: guild.mark, server_code: guild.server_code, level: String(guild.level), join_requirement_experience: String(guild.join_requirement_experience), member_join_closed: String(guild.member_join_closed), max_members: String(guild.max_members), recruitment_bonus: String(guild.recruitment_bonus), status: guild.status, version: String(guild.version) } });
  for (const name of names) values.push({ tableCode: "guild_name_registry", stableKey: String(name.guild_id), value: { guild_id: String(name.guild_id), normalized_name: name.normalized_name, display_name: name.display_name, version: String(name.version), updated_at: name.updated_at } });
  for (const member of members) values.push({ tableCode: "guild_members", stableKey: `${member.guild_id}:${member.player_id}`, value: { guild_id: String(member.guild_id), player_id: String(member.player_id), role_code: member.role_code, joined_at: member.joined_at } });
  const ordinals = new Map<string, number>();
  return values.map((entry) => { const ordinal = (ordinals.get(entry.tableCode) ?? 0) + 1; ordinals.set(entry.tableCode, ordinal); const json = JSON.stringify(entry.value); return { ...entry, ordinal, json, hash: sha(json) }; });
}

function parseRow(value: string | Record<string, string | null>): CanonicalRow { return typeof value === "string" ? JSON.parse(value) as CanonicalRow : value; }
function storedReset(value: string | AdminGuildResetAllResult): AdminGuildResetAllResult { return typeof value === "string" ? JSON.parse(value) as AdminGuildResetAllResult : value; }
function storedRestore(value: string | AdminGuildResetRestoreResult): AdminGuildResetRestoreResult { return typeof value === "string" ? JSON.parse(value) as AdminGuildResetRestoreResult : value; }
function key(value: string): string { return value.length <= 191 ? value : `sha256:${sha(value)}`; }
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function tombstoneCode(snapshotId: Numeric, guildId: string): string { return `__reset_${snapshotId}_${guildId}`; }
