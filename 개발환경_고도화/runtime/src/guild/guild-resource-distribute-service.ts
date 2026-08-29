import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드분배";
const COMMAND_CODE = "GUILD_RESOURCE_DISTRIBUTE";
const SCOPE = "guild.resource.distribute";
const TICKET_CODE = "guild_resource_distribution_ticket";
const MAX = 18_446_744_073_709_551_615n;

const CURRENCY_RESOURCES = [
  { code: "guild_fund", label: "길드자금" },
  { code: "diamond", label: "다이아" },
] as const;
const ITEM_RESOURCES = [
  { code: "pet_skill_book", label: "펫스킬북" },
  { code: "guild_pendant_stock", label: "펜던트" },
  { code: "pet_enhance_stone", label: "펫 강화석" },
  { code: "mini_pet_enhance_stone", label: "미니펫 강화석" },
] as const;

export type GuildResourceDistributeCommand = { kind: "all" } | { kind: "selected"; memberNumbers: number[] };
export interface GuildResourceSummary { code: string; label: string; storage: "currency" | "item"; before: string; perMember: string; debited: string; remainder: string }
export interface GuildResourceDistributeResult {
  status: "distributed";
  guildId: string;
  guildName: string;
  leaderPlayerId: string;
  recipientCount: number;
  recipientPlayerIds: string[];
  memberOrderHash: string;
  ticketBefore: string;
  ticketAfter: string;
  resources: GuildResourceSummary[];
  data: string;
  outboxId: string;
}

interface ActorRow { identity_id: bigint; player_id: bigint; display_name: string; guild_id: bigint; guild_name: string; guild_version: bigint; role_code: string }
interface MemberRow { player_id: bigint; display_name: string | null; role_code: string; contribution_value: bigint; joined_at: string | Date | null; player_status: string | null; deleted_at: string | Date | null; projected_guild_id: bigint | null }
interface ItemDefinitionRow { id: bigint; code: string; display_name: string }
interface StackRow { player_id: bigint; item_id: bigint; quantity: bigint; version: bigint }
interface AccountRow { player_id: bigint; currency_code: string; balance: string; version: bigint }
interface GuildAccountRow { currency_code: string; balance: string; version: bigint }
interface GuildStackRow { item_id: bigint; quantity: bigint; version: bigint }

// exact 명령 또는 공백으로 구분된 양의 회원 번호 목록만 실행 후보로 파싱합니다.
export function parseGuildResourceDistributeCommand(message: string | undefined): GuildResourceDistributeCommand | null {
  if (message === COMMAND) return { kind: "all" };
  if (message === undefined || !/^\/길드분배(?:\s+[1-9]\d{0,5})+$/.test(message)) return null;
  return { kind: "selected", memberNumbers: message.slice(COMMAND.length).trim().split(/\s+/).map(Number) };
}

export function isGuildResourceDistributeCandidate(message: string | undefined): boolean { return parseGuildResourceDistributeCommand(message) !== null; }
export function normalizeGuildResourceDistributeDispatchMessage(message: string): string { return parseGuildResourceDistributeCommand(message) === null ? message : COMMAND; }

// 선택 회원과 자원별 1인 지급량·잔여량을 고정 순서로 표시합니다.
export function formatGuildResourceDistribution(input: { guildName: string; recipientNames: readonly string[]; resources: readonly GuildResourceSummary[] }): string {
  const lines = [`✅ [${input.guildName}] 길드 자원 분배가 완료되었습니다.`, `지급 대상: ${input.recipientNames.length}명 (${input.recipientNames.join(", ")})`, ""];
  for (const resource of input.resources) lines.push(`${resource.label}: 1인당 ${comma(BigInt(resource.perMember))} · 총 ${comma(BigInt(resource.debited))} · 잔여 ${comma(BigInt(resource.remainder))}`);
  return lines.join("\n");
}

function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildResourceDistributeResult): GuildResourceDistributeResult { return typeof value === "string" ? JSON.parse(value) as GuildResourceDistributeResult : value; }
function integer(value: string | bigint): bigint { return typeof value === "bigint" ? value : BigInt(value.split(".")[0]!); }
function memberHash(rows: readonly MemberRow[]): string { return createHash("sha256").update(rows.map((row, index) => `${index + 1}:${row.player_id}:${row.role_code}:${row.contribution_value}`).join("|")).digest("hex"); }

// 길드·회원·창고·개인 계정을 ordered lock하고 분배권과 6종 자원을 한 transaction으로 분배합니다.
export class GuildResourceDistributeService {
  constructor(private readonly database: DatabaseClient) {}

  async handleDispatchedIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }> {
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({
      eventId: input.eventId,
      message: normalizeGuildResourceDistributeDispatchMessage(input.message),
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.distribute(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async distribute(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<GuildResourceDistributeResult> {
    const command = parseGuildResourceDistributeCommand(input.message);
    if (command === null) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_COMMAND_INVALID", "길드분배 명령 형식이 올바르지 않습니다.", 422);
    const eventKey = key(input.eventId);
    return retry(() => this.database.withTransaction(async (tx) => {
      const prior = (await tx.query<Array<{ result_json: string | GuildResourceDistributeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, eventKey]
      ))[0];
      if (prior?.result_json != null) return stored(prior.result_json);

      const actor = (await tx.query<ActorRow[]>(`SELECT identity.id identity_id,player.id player_id,profile.current_display_name display_name,
        member.guild_id,guild.display_name guild_name,guild.version guild_version,member.role_code
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id JOIN guild_members member ON member.player_id=player.id
        JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (actor === undefined) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_MEMBERSHIP_REQUIRED", "길드에 가입한 회원만 길드 자원을 분배할 수 있습니다.", 403);
      if (actor.role_code !== "master" && actor.role_code !== "leader") throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_LEADER_REQUIRED", "길드마스터만 길드 자원을 분배할 수 있습니다.", 403);

      const members = await tx.query<MemberRow[]>(`SELECT member.player_id,profile.current_display_name display_name,member.role_code,
        COALESCE(detail.contribution_value,0) contribution_value,member.joined_at,player.status player_status,player.deleted_at,projection.guild_id projected_guild_id
        FROM guild_members member LEFT JOIN players player ON player.id=member.player_id
        LEFT JOIN player_profiles profile ON profile.player_id=member.player_id
        LEFT JOIN guild_member_profile_details detail ON detail.guild_id=member.guild_id AND detail.player_id=member.player_id
        LEFT JOIN guild_membership_projections projection ON projection.player_id=member.player_id
        WHERE member.guild_id=? ORDER BY CASE member.role_code WHEN 'master' THEN 0 WHEN 'leader' THEN 0 WHEN 'sub_master' THEN 1 WHEN 'submaster' THEN 1 ELSE 2 END,
        COALESCE(detail.contribution_value,0) DESC,COALESCE(member.joined_at,'9999-12-31'),member.player_id FOR UPDATE`, [actor.guild_id]);
      if (members.length < 5) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_MINIMUM_MEMBERS", "길드원이 5명 이상이어야 자원을 분배할 수 있습니다.", 409);
      if (members.some((row) => row.display_name === null || row.player_status !== "active" || row.deleted_at !== null || row.projected_guild_id === null || row.projected_guild_id !== actor.guild_id)) {
        throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_RECONCILIATION_REQUIRED", "길드 회원 동기화가 필요합니다.", 409);
      }
      const orderHash = memberHash(members);
      const selected = command.kind === "all" ? members : command.memberNumbers.map((number) => {
        const member = members[number - 1];
        if (member === undefined) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_MEMBER_NUMBER_INVALID", "분배할 길드원 번호를 다시 확인해주세요.", 422);
        return member;
      });
      if (new Set(selected.map((row) => row.player_id.toString())).size !== selected.length) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_MEMBER_DUPLICATE", "같은 길드원을 중복 선택할 수 없습니다.", 422);

      const definitions = await tx.query<ItemDefinitionRow[]>(`SELECT id,code,display_name FROM item_definitions WHERE active=TRUE AND stackable=TRUE
        AND code IN (?,?,?,?,?) ORDER BY code FOR UPDATE`, [TICKET_CODE, ...ITEM_RESOURCES.map((row) => row.code)]);
      const itemByCode = new Map(definitions.map((row) => [row.code, row]));
      const ticket = itemByCode.get(TICKET_CODE);
      if (ticket === undefined || ITEM_RESOURCES.some((row) => !itemByCode.has(row.code))) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_DEFINITION_REQUIRED", "길드 분배 자원 기준정보가 필요합니다.", 409);

      const ticketStack = (await tx.query<StackRow[]>("SELECT player_id,item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [actor.player_id, ticket.id]))[0];
      if (ticketStack === undefined || ticketStack.quantity < 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_TICKET_REQUIRED", `${ticket.display_name}이 필요합니다.`, 409);

      for (const resource of CURRENCY_RESOURCES) await tx.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,?,0,1)", [actor.guild_id, resource.code]);
      for (const resource of ITEM_RESOURCES) await tx.execute("INSERT IGNORE INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,0,1)", [actor.guild_id, itemByCode.get(resource.code)!.id]);
      for (const member of [...selected].sort((a, b) => a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0)) {
        for (const resource of CURRENCY_RESOURCES) await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,?,0,1)", [member.player_id, resource.code]);
        for (const resource of ITEM_RESOURCES) await tx.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)", [member.player_id, itemByCode.get(resource.code)!.id]);
      }

      const guildAccounts = await tx.query<GuildAccountRow[]>("SELECT currency_code,balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code IN ('diamond','guild_fund') ORDER BY currency_code FOR UPDATE", [actor.guild_id]);
      const guildStacks = await tx.query<GuildStackRow[]>(`SELECT stack.item_id,stack.quantity,stack.version FROM guild_warehouse_stacks stack
        JOIN item_definitions item ON item.id=stack.item_id WHERE stack.guild_id=? AND item.code IN (?,?,?,?) ORDER BY stack.item_id FOR UPDATE`, [actor.guild_id, ...ITEM_RESOURCES.map((row) => row.code)]);
      const playerIds = [...selected].map((row) => row.player_id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const placeholders = playerIds.map(() => "?").join(",");
      const accounts = await tx.query<AccountRow[]>(`SELECT player_id,currency_code,balance,version FROM currency_accounts WHERE player_id IN (${placeholders}) AND currency_code IN ('diamond','guild_fund') ORDER BY player_id,currency_code FOR UPDATE`, playerIds);
      const stacks = await tx.query<StackRow[]>(`SELECT player_id,item_id,quantity,version FROM inventory_stacks WHERE player_id IN (${placeholders}) AND item_id IN (?,?,?,?) ORDER BY player_id,item_id FOR UPDATE`, [...playerIds, ...ITEM_RESOURCES.map((row) => itemByCode.get(row.code)!.id)]);

      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, eventKey, actor.player_id]);
      await tx.execute("INSERT INTO guild_resource_distribution_runs(operation_id,event_key,guild_id,leader_player_id,member_order_hash,recipient_count,selected_player_ids_json,resource_snapshot_json,result_json) VALUES (?,?,?,?,?,?,?,'[]','{}')", [operation.insertId, eventKey, actor.guild_id, actor.player_id, orderHash, selected.length, JSON.stringify(selected.map((row) => row.player_id.toString()))]);
      const ticketAfter = ticketStack.quantity - 1n;
      const ticketWrite = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=1", [ticketAfter, actor.player_id, ticket.id, ticketStack.version]);
      if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_TICKET_CONFLICT", "길드 분배권이 먼저 변경되었습니다.", 409);
      let inventorySequence = 1, currencySequence = 1, guildCurrencySequence = 1, guildItemSequence = 1, grantSequence = 1;
      await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?, -1,'GUILD_RESOURCE_DISTRIBUTE_TICKET')", [operation.insertId, inventorySequence++, actor.player_id, ticket.id]);

      const accountMap = new Map(accounts.map((row) => [`${row.player_id}:${row.currency_code}`, { balance: integer(row.balance), version: row.version }]));
      const stackMap = new Map(stacks.map((row) => [`${row.player_id}:${row.item_id}`, { quantity: row.quantity, version: row.version }]));
      const summaries: GuildResourceSummary[] = [];
      const count = BigInt(selected.length);

      for (const resource of CURRENCY_RESOURCES) {
        const source = guildAccounts.find((row) => row.currency_code === resource.code)!;
        const before = integer(source.balance), per = before / count, debit = per * count, remainder = before - debit;
        if (debit > 0n) {
          const changed = await tx.execute("UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code=? AND version=?", [remainder.toString(), actor.guild_id, resource.code, source.version]);
          if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_WAREHOUSE_CONFLICT", "길드 창고 자원이 먼저 변경되었습니다.", 409);
          await tx.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,?,?,?,?,?, 'GUILD_RESOURCE_DISTRIBUTE')", [operation.insertId, guildCurrencySequence++, actor.guild_id, resource.code, (-debit).toString(), remainder.toString()]);
        }
        for (const member of selected) {
          const state = accountMap.get(`${member.player_id}:${resource.code}`)!;
          const after = state.balance + per;
          if (after > MAX) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_OVERFLOW", "회원 자원 수량 한도를 초과합니다.", 409);
          if (per > 0n) {
            const changed = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code=? AND version=?", [after.toString(), member.player_id, resource.code, state.version]);
            if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_RECIPIENT_CONFLICT", "회원 자원이 먼저 변경되었습니다.", 409);
            await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,?,?,?,?,?, 'GUILD_RESOURCE_DISTRIBUTE')", [operation.insertId, currencySequence++, member.player_id, resource.code, per.toString(), after.toString()]);
          }
          await recordGrant(tx, operation.insertId, grantSequence++, member.player_id, resource.code, "currency", null, per, state.balance, after);
          state.balance = after; state.version += 1n;
        }
        summaries.push(summary(resource.code, resource.label, "currency", before, per, debit, remainder));
      }

      for (const resource of ITEM_RESOURCES) {
        const definition = itemByCode.get(resource.code)!;
        const source = guildStacks.find((row) => row.item_id === definition.id)!;
        const before = source.quantity, per = before / count, debit = per * count, remainder = before - debit;
        if (debit > 0n) {
          const changed = await tx.execute("UPDATE guild_warehouse_stacks SET quantity=?,version=version+1 WHERE guild_id=? AND item_id=? AND version=?", [remainder, actor.guild_id, definition.id, source.version]);
          if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_WAREHOUSE_CONFLICT", "길드 창고 아이템이 먼저 변경되었습니다.", 409);
          await tx.execute("INSERT INTO guild_warehouse_ledger(operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code) VALUES (?,?,?,?,?,?, 'GUILD_RESOURCE_DISTRIBUTE')", [operation.insertId, guildItemSequence++, actor.guild_id, definition.id, -debit, remainder]);
        }
        for (const member of selected) {
          const state = stackMap.get(`${member.player_id}:${definition.id}`)!;
          const after = state.quantity + per;
          if (after > MAX) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_OVERFLOW", "회원 아이템 수량 한도를 초과합니다.", 409);
          if (per > 0n) {
            const changed = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [after, member.player_id, definition.id, state.version]);
            if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_DISTRIBUTE_RECIPIENT_CONFLICT", "회원 가방이 먼저 변경되었습니다.", 409);
            await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'GUILD_RESOURCE_DISTRIBUTE')", [operation.insertId, inventorySequence++, member.player_id, definition.id, per]);
          }
          await recordGrant(tx, operation.insertId, grantSequence++, member.player_id, resource.code, "item", definition.id, per, state.quantity, after);
          state.quantity = after; state.version += 1n;
        }
        summaries.push(summary(resource.code, resource.label, "item", before, per, debit, remainder));
      }

      const recipientNames = selected.map((row) => row.display_name!);
      const data = formatGuildResourceDistribution({ guildName: actor.guild_name, recipientNames, resources: summaries });
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      const result: GuildResourceDistributeResult = { status: "distributed", guildId: actor.guild_id.toString(), guildName: actor.guild_name, leaderPlayerId: actor.player_id.toString(), recipientCount: selected.length, recipientPlayerIds: selected.map((row) => row.player_id.toString()), memberOrderHash: orderHash, ticketBefore: ticketStack.quantity.toString(), ticketAfter: ticketAfter.toString(), resources: summaries, data, outboxId: outbox.insertId.toString() };
      await tx.execute("UPDATE guild_resource_distribution_runs SET resource_snapshot_json=?,result_json=? WHERE operation_id=?", [JSON.stringify(summaries), JSON.stringify(result), operation.insertId]);
      for (let index = 0; index < selected.length; index += 1) {
        const member = selected[index]!;
        await tx.execute("INSERT INTO guild_resource_distribution_recipients(operation_id,ordinal_value,player_id,display_name_snapshot,role_code_snapshot,contribution_snapshot) VALUES (?,?,?,?,?,?)", [operation.insertId, index + 1, member.player_id, member.display_name, member.role_code, member.contribution_value]);
      }
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','distributed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.resource.distribute','distributed','Iris /길드분배',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.player_id, actor.guild_id, JSON.stringify({ memberOrderHash: orderHash, recipientPlayerIds: result.recipientPlayerIds, ticketBefore: result.ticketBefore, ticketAfter: result.ticketAfter, resources: summaries })]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    }));
  }
}

function summary(code: string, label: string, storage: "currency" | "item", before: bigint, perMember: bigint, debited: bigint, remainder: bigint): GuildResourceSummary {
  return { code, label, storage, before: before.toString(), perMember: perMember.toString(), debited: debited.toString(), remainder: remainder.toString() };
}

async function recordGrant(tx: DatabaseTransaction, operationId: bigint, sequence: number, playerId: bigint, resourceCode: string, storage: "currency" | "item", itemId: bigint | null, amount: bigint, before: bigint, after: bigint): Promise<void> {
  await tx.execute("INSERT INTO guild_resource_distribution_grants(operation_id,sequence_no,player_id,resource_code,storage_kind,item_id,amount,balance_before,balance_after) VALUES (?,?,?,?,?,?,?,?,?)", [operationId, sequence, playerId, resourceCode, storage, itemId, amount, before, after]);
}

async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await work(); } catch (error) {
      const value = error as { code?: unknown; errno?: unknown };
      const retryable = value.code === "ER_LOCK_DEADLOCK" || value.code === "ER_LOCK_WAIT_TIMEOUT" || value.code === "ER_DUP_ENTRY" || value.errno === 1213 || value.errno === 1205 || value.errno === 1062;
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("GUILD_RESOURCE_DISTRIBUTE_RETRY_EXHAUSTED");
}
