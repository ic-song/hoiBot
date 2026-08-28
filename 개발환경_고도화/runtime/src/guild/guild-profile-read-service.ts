import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface ActorRow { identity_id: bigint; player_id: bigint; }
interface MembershipRow { guild_id: bigint; }
interface GuildRow {
  guild_id: bigint; guild_name: string; guild_code: string; level_value: bigint; experience: bigint;
  territory_booster: bigint; join_condition_experience: bigint; recruitment_closed: number;
  mark_text: string | null; server_display_name: string | null; tax_rate: string; charm_value: bigint;
}
interface MemberRow { player_id: bigint; display_name: string; role_code: string; pet_name: string | null; contribution_value: bigint; }
interface ResourceRow { currency_code: string; balance: string; }
interface WarehouseRow { item_code: string; display_name: string; quantity: bigint; }
interface TerritoryRow { territory_no: bigint; territory_name: string; }
interface RepairResult { guildId: string | null; profileRowsCreated: number; resourceRowsCreated: number; memberRowsCreated: number; }
export interface GuildProfileReadResult {
  status: "detail" | "no_guild"; data: string; outboxId: string; guildId: string | null;
  memberCount: number; resourceCount: number; warehouseCount: number; territoryCount: number; repairCount: number;
}

// 사용자 길드정보 명령의 두 exact 별칭만 허용합니다.
export function isGuildProfileReadCommand(message: string | undefined): boolean {
  return message === "/길드정보" || message === "ㄱㄱㄱ";
}

// DB 권위 필드와 안정된 회원·자원·영지 순서를 한 개의 사용자 응답으로 투영합니다.
export function formatGuildProfile(input: { guild: GuildRow; members: readonly MemberRow[]; resources: readonly ResourceRow[]; warehouse: readonly WarehouseRow[]; territories: readonly TerritoryRow[] }): string {
  const leader = input.members.find((row) => row.role_code === "master" || row.role_code === "leader");
  const subMasters = input.members.filter((row) => row.role_code === "sub_master" || row.role_code === "submaster").map((row) => row.display_name);
  const memberLines = input.members.length === 0 ? "없음" : input.members.map((row, index) => `${index + 1}. ${row.display_name} [${row.role_code}] · 공헌 ${row.contribution_value}${row.pet_name === null ? "" : ` · 펫 ${row.pet_name}`}`).join("\n");
  const resourceLines = input.resources.length === 0 ? "없음" : input.resources.map((row) => `${row.currency_code}: ${row.balance}`).join("\n");
  const warehouseLines = input.warehouse.length === 0 ? "없음" : input.warehouse.map((row) => `${row.display_name}(${row.item_code}) x${row.quantity}`).join("\n");
  const territoryLines = input.territories.length === 0 ? "없음" : input.territories.map((row) => `${row.territory_no}. ${row.territory_name}`).join("\n");
  return `🏰 길드정보
길드: ${input.guild.mark_text ?? ""}${input.guild.guild_name} (${input.guild.guild_code})
서버: ${input.guild.server_display_name ?? "미확인"}
마스터: ${leader?.display_name ?? "미지정"}
부마스터: ${subMasters.length === 0 ? "없음" : subMasters.join(", ")}
레벨/경험치: ${input.guild.level_value} / ${input.guild.experience}
길드 매력: ${input.guild.charm_value}
영지 부스터: ${input.guild.territory_booster}
가입 경험치 조건: ${input.guild.join_condition_experience}
신규 가입: ${input.guild.recruitment_closed === 1 ? "마감" : "가능"}
세율: ${input.guild.tax_rate}%
회원 수: ${input.members.length}

[회원]
${memberLines}

[길드 자원]
${resourceLines}

[길드 창고]
${warehouseLines}

[보유 영지]
${territoryLines}`;
}

function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored<T>(value: string | T): T { return typeof value === "string" ? JSON.parse(value) as T : value; }

// 사용자 길드 조회 전에 누락된 관계형 기본행만 별도 원자 repair 작업으로 수렴시킵니다.
async function repairGuildProjection(database: DatabaseClient, input: { eventId: string; actor: ActorRow }): Promise<RepairResult> {
  return database.withTransaction(async (transaction: DatabaseTransaction) => {
    const repairKey = key(`${input.eventId}:repair`);
    const prior = await transaction.query<Array<{ result_json: string | RepairResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.profile.repair' AND idempotency_key=? FOR UPDATE", [repairKey]);
    if (prior[0]?.result_json != null) return stored<RepairResult>(prior[0].result_json);
    const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.profile.repair',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), repairKey, input.actor.identity_id]);
    const membership = (await transaction.query<MembershipRow[]>("SELECT member.guild_id FROM guild_members member JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active' WHERE member.player_id=? LIMIT 1 FOR UPDATE", [input.actor.player_id]))[0];
    let profileRowsCreated = 0, resourceRowsCreated = 0, memberRowsCreated = 0;
    if (membership !== undefined) {
      profileRowsCreated = Number((await transaction.execute("INSERT IGNORE INTO guild_profile_details(guild_id) VALUES (?)", [membership.guild_id])).affectedRows);
      resourceRowsCreated = Number((await transaction.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) SELECT ?,code,0,1 FROM currency_definitions WHERE active=TRUE", [membership.guild_id])).affectedRows);
      memberRowsCreated = Number((await transaction.execute("INSERT IGNORE INTO guild_member_profile_details(guild_id,player_id) SELECT guild_id,player_id FROM guild_members WHERE guild_id=?", [membership.guild_id])).affectedRows);
    }
    const result: RepairResult = { guildId: membership?.guild_id.toString() ?? null, profileRowsCreated, resourceRowsCreated, memberRowsCreated };
    await transaction.execute("INSERT INTO guild_profile_repair_runs(operation_id,guild_id,profile_rows_created,resource_rows_created,member_rows_created) VALUES (?,?,?,?,?)", [operation.insertId, membership?.guild_id ?? null, profileRowsCreated, resourceRowsCreated, memberRowsCreated]);
    await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.profile.repair','completed','Iris guild profile normalization',?,UTC_TIMESTAMP(3))", [operation.insertId, input.actor.identity_id, result.guildId, JSON.stringify({ profileRowsCreated, resourceRowsCreated, memberRowsCreated })]);
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
    return result;
  });
}

// 본인 길드의 회원·펫·자원·창고·영지를 한 transaction의 일관 snapshot으로 조회합니다.
export class GuildProfileReadService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<GuildProfileReadResult | null> {
    if (!isGuildProfileReadCommand(input.message)) return null;
    const actor = (await this.database.query<ActorRow[]>("SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1", [input.externalUserId]))[0];
    if (actor === undefined) return null;
    const repair = await repairGuildProjection(this.database, { eventId: input.eventId, actor });
    return this.database.withTransaction(async (transaction) => {
      const eventKey = key(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | GuildProfileReadResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.profile.read' AND idempotency_key=? FOR UPDATE", [eventKey]);
      if (prior[0]?.result_json != null) return stored<GuildProfileReadResult>(prior[0].result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.profile.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), eventKey, actor.identity_id]);
      const guild = (await transaction.query<GuildRow[]>(`SELECT guild.id guild_id,guild.display_name guild_name,guild.code guild_code,detail.level_value,detail.experience,detail.territory_booster,detail.join_condition_experience,detail.recruitment_closed,detail.mark_text,detail.server_display_name,detail.tax_rate,detail.charm_value FROM guild_members viewer JOIN guilds guild ON guild.id=viewer.guild_id AND guild.status='active' JOIN guild_profile_details detail ON detail.guild_id=guild.id WHERE viewer.player_id=? LIMIT 1 FOR UPDATE`, [actor.player_id]))[0];
      let status: GuildProfileReadResult["status"], data: string, guildId: string | null = null, memberCount = 0, resourceCount = 0, warehouseCount = 0, territoryCount = 0;
      if (guild === undefined) { status = "no_guild"; data = "가입한 길드가 없습니다."; }
      else {
        const members = await transaction.query<MemberRow[]>(`SELECT member.player_id,profile.current_display_name display_name,member.role_code,pet.display_name pet_name,COALESCE(detail.contribution_value,0) contribution_value FROM guild_members member JOIN player_profiles profile ON profile.player_id=member.player_id LEFT JOIN player_pets pet ON pet.player_id=member.player_id LEFT JOIN guild_member_profile_details detail ON detail.guild_id=member.guild_id AND detail.player_id=member.player_id WHERE member.guild_id=? ORDER BY CASE member.role_code WHEN 'master' THEN 0 WHEN 'leader' THEN 0 WHEN 'sub_master' THEN 1 WHEN 'submaster' THEN 1 ELSE 2 END,COALESCE(detail.contribution_value,0) DESC,COALESCE(member.joined_at,'9999-12-31'),member.player_id`, [guild.guild_id]);
        const resources = await transaction.query<ResourceRow[]>("SELECT currency_code,balance FROM guild_resource_accounts WHERE guild_id=? ORDER BY currency_code", [guild.guild_id]);
        const warehouse = await transaction.query<WarehouseRow[]>(`SELECT item.code item_code,item.display_name,stack.quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.guild_id=? AND stack.quantity>0 ORDER BY item.display_name,item.id`, [guild.guild_id]);
        const territories = await transaction.query<TerritoryRow[]>(`SELECT occupation.territory_no,occupation.territory_name FROM guild_territory_occupations occupation JOIN (SELECT id FROM guild_territory_wars ORDER BY id DESC LIMIT 1) latest ON latest.id=occupation.war_id WHERE occupation.owner_guild_id=? ORDER BY occupation.territory_no`, [guild.guild_id]);
        status = "detail"; data = formatGuildProfile({ guild, members, resources, warehouse, territories }); guildId = guild.guild_id.toString(); memberCount = members.length; resourceCount = resources.length; warehouseCount = warehouse.length; territoryCount = territories.length;
      }
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_PROFILE_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, status]);
      const repairCount = repair.profileRowsCreated + repair.resourceRowsCreated + repair.memberRowsCreated;
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.profile.read',?,'Iris /길드정보',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, guildId, status, JSON.stringify({ memberCount, resourceCount, warehouseCount, territoryCount, repairCount, domainMutation: false })]);
      const result: GuildProfileReadResult = { status, data, outboxId: outbox.insertId.toString(), guildId, memberCount, resourceCount, warehouseCount, territoryCount, repairCount };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
