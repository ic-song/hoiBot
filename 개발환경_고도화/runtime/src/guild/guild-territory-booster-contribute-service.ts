import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드부스터공헌";
const COMMAND_CODE = "GUILD_TERRITORY_BOOSTER_CONTRIBUTE";
const ITEM_CODE = "ITEM-GUILD-TERRITORY-BOOSTER";
const COUNTER_CODE = "guild_territory_booster_contribution_count";
const UINT64_MAX = 18_446_744_073_709_551_615n;

export interface GuildTerritoryBoosterContributeCommand {
  requestedCount: bigint | null;
}

export interface GuildTerritoryBoosterContributeResult {
  status: "contributed" | "usage" | "guild_required" | "item_shortage" | "invalid_count";
  requestedCount: string;
  inventoryBefore: string;
  inventoryAfter: string;
  guildBoosterBefore: string;
  guildBoosterAfter: string;
  memberContributionBefore: string;
  memberContributionAfter: string;
  dailyCountBefore: string;
  dailyCountAfter: string;
  data: string;
  outboxId: string;
}

interface ActorRow {
  identity_id: bigint;
  player_id: bigint;
  display_name: string;
  guild_id: bigint | null;
  guild_name: string | null;
}

interface MemberRow {
  territory_booster_contribution: bigint;
  version: bigint;
}

interface ProfileRow {
  territory_booster: bigint;
  version: bigint;
}

interface ItemRow {
  item_id: bigint;
  display_name: string;
  quantity: bigint;
  version: bigint;
}

// exact 명령 또는 숫자 인자 하나만 실행 후보로 파싱합니다.
export function parseGuildTerritoryBoosterContributeCommand(message: string | undefined): GuildTerritoryBoosterContributeCommand | null {
  if (message === COMMAND) return { requestedCount: null };
  if (message === undefined) return null;
  const match = /^\/길드부스터공헌\s+(\d{1,20})$/.exec(message);
  if (match === null) return null;
  const requestedCount = BigInt(match[1]!);
  return requestedCount > UINT64_MAX ? null : { requestedCount };
}

export function isGuildTerritoryBoosterContributeCandidate(message: string | undefined): boolean {
  return parseGuildTerritoryBoosterContributeCommand(message) !== null;
}

export function normalizeGuildTerritoryBoosterContributeDispatchMessage(message: string): string {
  return parseGuildTerritoryBoosterContributeCommand(message) === null ? message : COMMAND;
}

// 성공 응답을 안정된 길드·회원 누적값으로 구성합니다.
export function formatGuildTerritoryBoosterContribution(input: {
  displayName: string;
  guildName: string;
  requestedCount: bigint;
  guildBoosterAfter: bigint;
  memberContributionAfter: bigint;
}): string {
  return `✅ [${input.displayName}] 님이 [${input.guildName}] 길드에 길드영지 부스터🔮 ${input.requestedCount}개를 공헌했습니다.\n🏰 길드 보유 부스터: ${input.guildBoosterAfter}개\n🌟 누적 부스터 공헌: ${input.memberContributionAfter}개`;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | GuildTerritoryBoosterContributeResult): GuildTerritoryBoosterContributeResult {
  return typeof value === "string" ? JSON.parse(value) as GuildTerritoryBoosterContributeResult : value;
}

function kstDate(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// 회원·길드·아이템을 잠그고 공헌과 모든 증거를 한 transaction으로 반영합니다.
export class GuildTerritoryBoosterContributeService {
  constructor(private readonly database: DatabaseClient) {}

  async handleDispatchedIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({
      eventId: input.eventId,
      message: normalizeGuildTerritoryBoosterContributeDispatchMessage(input.message),
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.handleIris(input);
    return result === null ? { status: "handled_no_reply" } : { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<GuildTerritoryBoosterContributeResult | null> {
    const command = parseGuildTerritoryBoosterContributeCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_GUILD_TERRITORY_BOOSTER_CONTRIBUTE_COMMAND", "길드부스터공헌 명령 형식이 올바르지 않습니다.", 422);
    return this.contribute({ ...input, command });
  }

  async contribute(input: { externalUserId: string; channelId: string; eventId: string; command: GuildTerritoryBoosterContributeCommand }): Promise<GuildTerritoryBoosterContributeResult | null> {
    const key = eventKey(input.eventId);
    return withContributionRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | GuildTerritoryBoosterContributeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='guild.territory.booster_contribute' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (previous?.result_json != null) return stored(previous.result_json);

      const actor = (await transaction.query<ActorRow[]>(
        "SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,membership.guild_id,guild.display_name guild_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN guild_members membership ON membership.player_id=player.id LEFT JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",
        [input.externalUserId],
      ))[0];
      if (actor === undefined) return null;

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.territory.booster_contribute',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id],
      );
      const zero = { inventoryBefore: 0n, inventoryAfter: 0n, guildBoosterBefore: 0n, guildBoosterAfter: 0n, memberContributionBefore: 0n, memberContributionAfter: 0n, dailyCountBefore: 0n, dailyCountAfter: 0n };

      if (input.command.requestedCount === null) return complete(transaction, operation.insertId, input, actor, "usage", "사용법: /길드부스터공헌 [개수]", 0n, zero);
      if (input.command.requestedCount <= 0n) return complete(transaction, operation.insertId, input, actor, "invalid_count", "공헌 개수는 1개 이상이어야 합니다.", input.command.requestedCount, zero);
      if (actor.guild_id === null || actor.guild_name === null) return complete(transaction, operation.insertId, input, actor, "guild_required", "길드에 가입한 회원만 공헌할 수 있습니다.", input.command.requestedCount, zero);

      const member = (await transaction.query<MemberRow[]>(
        "SELECT territory_booster_contribution,version FROM guild_members WHERE guild_id=? AND player_id=? FOR UPDATE",
        [actor.guild_id, actor.player_id],
      ))[0];
      const profile = (await transaction.query<ProfileRow[]>(
        "SELECT territory_booster,version FROM guild_profile_details WHERE guild_id=? FOR UPDATE",
        [actor.guild_id],
      ))[0];
      if (member === undefined || profile === undefined) throw new Error("Guild booster contribution aggregate is incomplete.");

      const item = (await transaction.query<ItemRow[]>(
        "SELECT definition.id item_id,definition.display_name,COALESCE(stack.quantity,0) quantity,COALESCE(stack.version,0) version FROM item_definitions definition LEFT JOIN inventory_stacks stack ON stack.item_id=definition.id AND stack.player_id=? WHERE definition.code=? AND definition.active=TRUE FOR UPDATE",
        [actor.player_id, ITEM_CODE],
      ))[0];
      if (item === undefined) throw new Error("Guild territory booster item definition is missing.");

      const periodKey = kstDate();
      await transaction.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,?,?,0,UTC_TIMESTAMP(3))", [actor.player_id, COUNTER_CODE, periodKey]);
      const daily = (await transaction.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code=? AND period_key=? FOR UPDATE", [actor.player_id, COUNTER_CODE, periodKey]))[0]!;
      const state = {
        inventoryBefore: BigInt(item.quantity),
        inventoryAfter: BigInt(item.quantity),
        guildBoosterBefore: BigInt(profile.territory_booster),
        guildBoosterAfter: BigInt(profile.territory_booster),
        memberContributionBefore: BigInt(member.territory_booster_contribution),
        memberContributionAfter: BigInt(member.territory_booster_contribution),
        dailyCountBefore: BigInt(daily.value),
        dailyCountAfter: BigInt(daily.value),
      };
      if (state.inventoryBefore < input.command.requestedCount) return complete(transaction, operation.insertId, input, actor, "item_shortage", `${item.display_name} 보유 수량이 부족합니다.`, input.command.requestedCount, state);

      state.inventoryAfter -= input.command.requestedCount;
      state.guildBoosterAfter += input.command.requestedCount;
      state.memberContributionAfter += input.command.requestedCount;
      state.dailyCountAfter += 1n;

      const stackChanged = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?", [state.inventoryAfter, actor.player_id, item.item_id, item.version, input.command.requestedCount]);
      if (stackChanged.affectedRows !== 1n) throw new Error("Guild booster contribution inventory conflict.");
      const profileChanged = await transaction.execute("UPDATE guild_profile_details SET territory_booster=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?", [state.guildBoosterAfter, actor.guild_id, profile.version]);
      if (profileChanged.affectedRows !== 1n) throw new Error("Guild booster contribution profile conflict.");
      const memberChanged = await transaction.execute("UPDATE guild_members SET territory_booster_contribution=?,version=version+1 WHERE guild_id=? AND player_id=? AND version=?", [state.memberContributionAfter, actor.guild_id, actor.player_id, member.version]);
      if (memberChanged.affectedRows !== 1n) throw new Error("Guild booster contribution member conflict.");
      await transaction.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code=? AND period_key=? AND value=?", [state.dailyCountAfter, actor.player_id, COUNTER_CODE, periodKey, state.dailyCountBefore]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'GUILD_TERRITORY_BOOSTER_CONTRIBUTE')", [operation.insertId, actor.player_id, item.item_id, -input.command.requestedCount]);
      await transaction.execute("INSERT INTO guild_territory_booster_ledger(operation_id,guild_id,player_id,quantity_delta,guild_balance_after,member_contribution_after,reason_code) VALUES (?,?,?,?,?,?,'GUILD_TERRITORY_BOOSTER_CONTRIBUTE')", [operation.insertId, actor.guild_id, actor.player_id, input.command.requestedCount, state.guildBoosterAfter, state.memberContributionAfter]);
      await transaction.execute("INSERT INTO guild_territory_booster_contribution_runs(operation_id,event_key,player_id,guild_id,item_id,requested_count,inventory_before,inventory_after,guild_booster_before,guild_booster_after,member_contribution_before,member_contribution_after,daily_count_before,daily_count_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, key, actor.player_id, actor.guild_id, item.item_id, input.command.requestedCount, state.inventoryBefore, state.inventoryAfter, state.guildBoosterBefore, state.guildBoosterAfter, state.memberContributionBefore, state.memberContributionAfter, state.dailyCountBefore, state.dailyCountAfter]);

      const data = formatGuildTerritoryBoosterContribution({ displayName: actor.display_name, guildName: actor.guild_name, requestedCount: input.command.requestedCount, guildBoosterAfter: state.guildBoosterAfter, memberContributionAfter: state.memberContributionAfter });
      return complete(transaction, operation.insertId, input, actor, "contributed", data, input.command.requestedCount, state);
    }));
  }
}

async function complete(transaction: DatabaseTransaction, operationId: bigint, input: { eventId: string; channelId: string }, actor: ActorRow, status: GuildTerritoryBoosterContributeResult["status"], data: string, requestedCount: bigint, state: { inventoryBefore: bigint; inventoryAfter: bigint; guildBoosterBefore: bigint; guildBoosterAfter: bigint; memberContributionBefore: bigint; memberContributionAfter: bigint; dailyCountBefore: bigint; dailyCountAfter: bigint }): Promise<GuildTerritoryBoosterContributeResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.channelId, JSON.stringify({ data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operationId, status]);
  const summary = { requestedCount: requestedCount.toString(), inventoryBefore: state.inventoryBefore.toString(), inventoryAfter: state.inventoryAfter.toString(), guildBoosterBefore: state.guildBoosterBefore.toString(), guildBoosterAfter: state.guildBoosterAfter.toString(), memberContributionBefore: state.memberContributionBefore.toString(), memberContributionAfter: state.memberContributionAfter.toString(), dailyCountBefore: state.dailyCountBefore.toString(), dailyCountAfter: state.dailyCountAfter.toString() };
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.territory.booster_contribute',?,'Iris /길드부스터공헌',?,UTC_TIMESTAMP(3))", [operationId, actor.identity_id, actor.guild_id ?? actor.player_id, status, JSON.stringify(summary)]);
  const result: GuildTerritoryBoosterContributeResult = { status, ...summary, data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  return result;
}

async function withContributionRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await work(); } catch (error) {
      const value = error as { code?: unknown; errno?: unknown };
      const retryable = value.code === "ER_LOCK_DEADLOCK" || value.code === "ER_LOCK_WAIT_TIMEOUT" || value.code === "ER_DUP_ENTRY" || value.errno === 1213 || value.errno === 1205 || value.errno === 1062;
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Guild territory booster contribution retry exhausted.");
}
