import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { GuildRankCharmInputProvider, serializeComponents, type GuildMemberCharmInput } from "./guild-rank-charm-input-provider.js";

const ALLSEE = "\u200b".repeat(500);
type Numeric = bigint | number | string;
interface ActorRow { identity_id: Numeric; player_id: Numeric; guild_id: Numeric; }
interface PolicyRow { policy_version: Numeric; title_definition_version: Numeric | null; enabled: number | boolean; }
interface TitleRow { title_code: string; display_name: string; minimum_rank: Numeric; maximum_rank: Numeric | null; }
interface CurrentRow { snapshot_id: Numeric | null; version: Numeric; }
interface OperationRow { result_json: string | GuildRankSnapshotRefreshResult | null; }
export interface GuildRankTitleDefinition { titleCode: string; displayName: string; minimumRank: number; maximumRank: number | null; }
export interface GuildRankSnapshotRow { guildId: string; guildName: string; guildLevel: bigint; memberCount: number; totalCharm: bigint; ordinal: number; titleCode: string; titleDisplayName: string; }
export interface GuildRankSnapshotRefreshResult { status: "published"; data: string; snapshotId: string; snapshotVersion: string; rowCount: number; memberCount: number; outboxId: string; }
export type GuildRankSnapshotDispatchResult = GuildRankSnapshotRefreshResult | { status: "shadow" };

// 길드 순위 갱신 명령은 인자 없는 exact 문자열만 허용합니다.
export function isGuildRankSnapshotRefreshCommand(message: string | undefined): boolean { return message === "/길드순위"; }

// 길드별 회원 종합매력을 합산하고 확정 tie-break로 순위를 계산합니다.
export function rankGuildCharmInputs(inputs: readonly GuildMemberCharmInput[], definitions: readonly GuildRankTitleDefinition[]): GuildRankSnapshotRow[] {
  const grouped = new Map<string, Omit<GuildRankSnapshotRow, "ordinal" | "titleCode" | "titleDisplayName">>();
  for (const input of inputs) { const row = grouped.get(input.guildId) ?? { guildId: input.guildId, guildName: input.guildName, guildLevel: input.guildLevel, memberCount: 0, totalCharm: 0n }; row.memberCount += 1; row.totalCharm += input.totalCharm; if (input.guildLevel > row.guildLevel) row.guildLevel = input.guildLevel; grouped.set(input.guildId, row); }
  const collator = new Intl.Collator("ko-KR", { usage: "sort", sensitivity: "variant", numeric: true });
  const sorted = [...grouped.values()].sort((left, right) => { if (left.totalCharm !== right.totalCharm) return left.totalCharm > right.totalCharm ? -1 : 1; if (left.guildLevel !== right.guildLevel) return left.guildLevel > right.guildLevel ? -1 : 1; const name = collator.compare(left.guildName, right.guildName); if (name !== 0) return name; return BigInt(left.guildId) < BigInt(right.guildId) ? -1 : 1; });
  return sorted.map((row, index) => { const ordinal = index + 1, matches = definitions.filter((definition) => ordinal >= definition.minimumRank && (definition.maximumRank === null || ordinal <= definition.maximumRank)); if (matches.length !== 1) throw new Error(`Guild rank title definition is incomplete for rank ${ordinal}.`); return { ...row, ordinal, titleCode: matches[0]!.titleCode, titleDisplayName: matches[0]!.displayName }; });
}

// 상위 3개 이후 접힘 경계를 유지하는 길드 순위 응답을 만듭니다.
export function formatGuildRankSnapshot(rows: readonly GuildRankSnapshotRow[]): string { const lines = rows.map((row) => `${row.ordinal}위 ${row.titleDisplayName} ${row.guildName} - 👑 ${commas(row.totalCharm.toString())} · Lv.${row.guildLevel} · ${row.memberCount}명`), head = lines.slice(0, 3).join("\n"), tail = lines.slice(3).join("\n"); return `🏆 길드 순위 🏆\n${head}${tail === "" ? "" : `\n${ALLSEE}\n${tail}`}`; }

// 버전형 입력·계급 정의로 immutable 길드 순위 snapshot을 게시합니다.
export class GuildRankSnapshotRefreshService {
  private readonly inputProvider = new GuildRankCharmInputProvider();
  constructor(private readonly database: DatabaseClient) {}
  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildRankSnapshotDispatchResult | null> {
    if (!isGuildRankSnapshotRefreshCommand(input.message)) return null;
    const registry = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_RANK_SNAPSHOT_REFRESH' LIMIT 1"))[0];
    if (registry === undefined || !registry.enabled || registry.rollout_state === "LEGACY_ONLY") return null;
    if (registry.rollout_state !== "ACTIVE") return { status: "shadow" };
    return this.refresh(input);
  }
  async refresh(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildRankSnapshotRefreshResult> {
    if (!isGuildRankSnapshotRefreshCommand(input.message)) throw new Error("길드순위 명령 형식을 확인해주세요.");
    return this.database.withTransaction(async (transaction) => {
      const actor = (await transaction.query<ActorRow[]>(`SELECT identity.id identity_id,identity.player_id,membership.guild_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN guild_members membership ON membership.player_id=player.id JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (actor === undefined) throw new Error("가입한 길드가 없습니다.");
      const operationWrite = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.rank.snapshot.refresh',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [randomUUID(), key(input.eventId), actor.identity_id]);
      const operation = (await transaction.query<OperationRow[]>("SELECT result_json FROM operations WHERE id=? FOR UPDATE", [operationWrite.insertId]))[0];
      if (operation?.result_json != null) return stored(operation.result_json);
      const policy = (await transaction.query<PolicyRow[]>("SELECT policy_version,title_definition_version,enabled FROM guild_rank_snapshot_policies WHERE policy_key='default' FOR UPDATE"))[0];
      if (policy === undefined || !policy.enabled || policy.title_definition_version === null) throw new Error("활성 길드 순위 정책과 계급 정의가 필요합니다.");
      const titleRows = await transaction.query<TitleRow[]>("SELECT title_code,display_name,minimum_rank,maximum_rank FROM guild_rank_title_definitions WHERE definition_version=? AND active=TRUE ORDER BY minimum_rank,title_code FOR UPDATE", [policy.title_definition_version]);
      if (titleRows.length === 0) throw new Error("활성 길드 계급 정의가 없습니다.");
      const definitions = titleRows.map((row) => ({ titleCode: row.title_code, displayName: row.display_name, minimumRank: Number(row.minimum_rank), maximumRank: row.maximum_rank === null ? null : Number(row.maximum_rank) }));
      const inputs = await this.inputProvider.loadAll(transaction), rows = rankGuildCharmInputs(inputs, definitions);
      const current = (await transaction.query<CurrentRow[]>("SELECT snapshot_id,version FROM guild_rank_snapshot_current WHERE policy_key='default' FOR UPDATE"))[0];
      if (current === undefined) throw new Error("Guild rank snapshot current row is missing.");
      const nextVersion = BigInt(current.version) + 1n, inputHash = createHash("sha256").update(inputs.map((value) => value.sourceHash).sort().join(":"), "utf8").digest("hex");
      const snapshotWrite = await transaction.execute("INSERT INTO guild_rank_snapshots(operation_id,policy_version,title_definition_version,snapshot_version,input_hash,eligible_guild_count,eligible_member_count,status,created_at) VALUES (?,?,?,?,?,?,?,'building',UTC_TIMESTAMP(3))", [operationWrite.insertId, policy.policy_version, policy.title_definition_version, nextVersion, inputHash, rows.length, inputs.length]);
      const snapshotId = snapshotWrite.insertId;
      for (const value of inputs) await transaction.execute("INSERT INTO guild_rank_snapshot_inputs(snapshot_id,player_id,guild_id,source_hash,total_charm,player_level,component_json) VALUES (?,?,?,?,?,?,?)", [snapshotId, value.playerId, value.guildId, value.sourceHash, value.totalCharm, value.playerLevel, JSON.stringify(serializeComponents(value.components))]);
      for (const row of rows) {
        await transaction.execute("INSERT INTO guild_rank_snapshot_rows(snapshot_id,ordinal_value,guild_id,guild_name_snapshot,guild_level,member_count,total_charm,title_code,title_display_name) VALUES (?,?,?,?,?,?,?,?,?)", [snapshotId, row.ordinal, row.guildId, row.guildName, row.guildLevel, row.memberCount, row.totalCharm, row.titleCode, row.titleDisplayName]);
        await transaction.execute("INSERT INTO guild_rank_current_projections(guild_id,snapshot_id,ordinal_value,total_charm,title_code,title_display_name,version) VALUES (?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id),ordinal_value=VALUES(ordinal_value),total_charm=VALUES(total_charm),title_code=VALUES(title_code),title_display_name=VALUES(title_display_name),version=version+1", [row.guildId, snapshotId, row.ordinal, row.totalCharm, row.titleCode, row.titleDisplayName]);
      }
      await transaction.execute("DELETE FROM guild_rank_current_projections WHERE snapshot_id<>?", [snapshotId]);
      const published = await transaction.execute("UPDATE guild_rank_snapshot_current SET snapshot_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE policy_key='default' AND version=?", [snapshotId, current.version]);
      if (published.affectedRows !== 1n) throw new Error("Guild rank snapshot publish version conflict.");
      await transaction.execute("UPDATE guild_rank_snapshots SET status='published',published_at=UTC_TIMESTAMP(3) WHERE id=?", [snapshotId]);
      const data = formatGuildRankSnapshot(rows), outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationWrite.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO guild_rank_snapshot_refresh_runs(operation_id,snapshot_id,actor_identity_id,outbox_id) VALUES (?,?,?,?)", [operationWrite.insertId, snapshotId, actor.identity_id, outbox.insertId]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_RANK_SNAPSHOT_REFRESH',?,'completed','published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operationWrite.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild_rank_snapshot',?,'guild.rank.snapshot.refresh','published','Iris /길드순위',?,UTC_TIMESTAMP(3))", [operationWrite.insertId, actor.identity_id, snapshotId, JSON.stringify({ snapshotVersion: nextVersion.toString(), policyVersion: String(policy.policy_version), titleDefinitionVersion: String(policy.title_definition_version), guildCount: rows.length, memberCount: inputs.length, inputHash, stableGuildIds: rows.map((row) => row.guildId) })]);
      const result: GuildRankSnapshotRefreshResult = { status: "published", data, snapshotId: snapshotId.toString(), snapshotVersion: nextVersion.toString(), rowCount: rows.length, memberCount: inputs.length, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationWrite.insertId]);
      return result;
    });
  }
}
function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildRankSnapshotRefreshResult): GuildRankSnapshotRefreshResult { return typeof value === "string" ? JSON.parse(value) as GuildRankSnapshotRefreshResult : value; }
function commas(value: string): string { return value.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
