import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const COMMAND_CODE = "ADMIN_GUILD_WAREHOUSE_RESOURCE_GRANT";
type ResourceDefinition = { alias: string; storage: "currency" | "item"; code: string; label: string };
const RESOURCES: readonly ResourceDefinition[] = [
  { alias: "/길드다이아창고", storage: "currency", code: "diamond", label: "다이아" },
  { alias: "/길드자금", storage: "currency", code: "guild_fund", label: "길드자금" },
  { alias: "/길드펜던트창고", storage: "item", code: "guild_pendant_stock", label: "펜던트" },
  { alias: "/길드펫강화석창고", storage: "item", code: "pet_enhance_stone", label: "펫 강화석" },
  { alias: "/길드미니펫강화석창고", storage: "item", code: "mini_pet_enhance_stone", label: "미니펫 강화석" }
];
export type AdminGuildWarehouseGrantCommand = { kind: "usage"; resource: ResourceDefinition } | { kind: "grant"; resource: ResourceDefinition; guildName: string; amount: bigint };
export interface AdminGuildWarehouseGrantResult { status: "silent" | "usage" | "granted"; resourceCode?: string; guildId?: string; before?: string; after?: string; reply: { outboxId: string; room: string; data: string } | null }

// 다섯 운영 명령의 전체 입력을 길드명과 쉼표 허용 양의 정수 수량으로 분리합니다.
export function parseAdminGuildWarehouseGrantCommand(message: string | undefined): AdminGuildWarehouseGrantCommand | null {
  if (message === undefined) return null;
  const resource = RESOURCES.find((entry) => message === entry.alias || message.startsWith(`${entry.alias} `));
  if (resource === undefined) return null;
  if (message === resource.alias) return { kind: "usage", resource };
  const escaped = resource.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s+(.+?)\\s+((?:[1-9]\\d*)|(?:[1-9]\\d{0,2}(?:,\\d{3})+))$`).exec(message);
  if (match === null) return { kind: "usage", resource };
  const amount = BigInt(match[2]!.replace(/,/g, ""));
  return amount > MAX_UNSIGNED_BIGINT ? { kind: "usage", resource } : { kind: "grant", resource, guildName: match[1]!.trim(), amount };
}

// 정확한 명령 또는 공백 인자 후보만 중앙 관리자 라우터에 전달합니다.
export function isAdminGuildWarehouseGrantCommandCandidate(message: string | undefined): boolean { return parseAdminGuildWarehouseGrantCommand(message) !== null; }
// 인자형 입력을 DB command_aliases의 자원별 대표 패턴으로 정규화합니다.
export function normalizeAdminGuildWarehouseGrantDispatchMessage(message: string): string {
  const command = parseAdminGuildWarehouseGrantCommand(message);
  if (command === null || command.kind === "usage") return command?.resource.alias ?? message;
  return `${command.resource.alias} [길드명] [수량]`;
}
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | AdminGuildWarehouseGrantResult): AdminGuildWarehouseGrantResult { return typeof value === "string" ? JSON.parse(value) as AdminGuildWarehouseGrantResult : value; }
function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function usage(resource: ResourceDefinition): string { return `사용법: ${resource.alias} [길드명] [수량]\n예) ${resource.alias} 호이길드 100`; }

// 운영자·길드·자원 버전을 잠근 뒤 계정 또는 스택과 불변 원장·감사·응답을 원자 지급합니다.
export class AdminGuildWarehouseGrantService {
  constructor(private readonly database: DatabaseClient) {}
  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const rows = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
    );
    const definition = rows[0], dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: "admin_guild_warehouse_resource_grant" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: "admin_guild_warehouse_resource_grant" });
      return { status: "shadow" };
    }
    const result = await this.handle({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.channelId, message: input.message });
    if (result.reply === null) return { status: "legacy_fallback" };
    return { status: "changed", data: result.reply.data, outboxId: result.reply.outboxId };
  }

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminGuildWarehouseGrantResult> {
    const command = parseAdminGuildWarehouseGrantCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_ADMIN_GUILD_WAREHOUSE_GRANT_COMMAND", "길드창고 지급 명령 형식이 올바르지 않습니다.", 422);
    return this.database.withTransaction(async (transaction) => {
      const operators = await transaction.query<Array<{ identity_id: bigint; operator_id: bigint }>>(`SELECT identity.id identity_id,operator.id operator_id FROM external_identities identity
        JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
        JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
        JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
        JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('administrator','manager','super_admin') AND role.active=TRUE
        JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='guild.warehouse.resource.grant'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        ORDER BY role.code='super_admin' DESC,role.code='manager' DESC LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const operator = operators[0]; if (operator === undefined) return { status: "silent", reply: null };
      const scope = `admin.guild-warehouse-resource.grant:${operator.operator_id}`, key = eventKey(input.eventId);
      const operation = await transaction.execute("INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),scope,key,operator.operator_id]);
      if (operation.affectedRows === 0n) {
        const prior = await transaction.query<Array<{ result_json: string | AdminGuildWarehouseGrantResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]);
        if (prior[0]?.result_json != null) return stored(prior[0].result_json);
        throw new ApplicationError("GUILD_WAREHOUSE_GRANT_IN_PROGRESS", "동일 지급 요청이 처리 중입니다.", 409);
      }
      let guild: { id: bigint; display_name: string; mark: string | null } | null = null;
      if (command.kind === "grant") {
        const guilds = await transaction.query<Array<{ id: bigint; display_name: string; mark: string | null }>>("SELECT id,display_name,mark FROM guilds WHERE display_name=? AND status='active' ORDER BY id LIMIT 2 FOR UPDATE", [command.guildName]);
        if (guilds.length === 0) throw new ApplicationError("GUILD_NOT_FOUND", "길드를 찾을 수 없습니다.", 404);
        if (guilds.length > 1) throw new ApplicationError("GUILD_NAME_AMBIGUOUS", "동일한 이름의 길드가 여러 개입니다.", 409);
        guild = guilds[0]!;
      }
      let result: AdminGuildWarehouseGrantResult;
      if (command.kind === "usage") {
        const data = usage(command.resource), outboxId = await this.queue(transaction,operation.insertId,input.destinationId,data);
        result = { status: "usage", resourceCode: command.resource.code, reply: { outboxId: outboxId.toString(), room: input.destinationId, data } };
      } else {
        const balances = command.resource.storage === "currency" ? await this.grantCurrency(transaction,operation.insertId,guild!.id,command.resource.code,command.amount) : await this.grantItem(transaction,operation.insertId,guild!.id,command.resource.code,command.amount);
        const data = `✅ 길드창고에 자원이 지급되었습니다.\n길드: ${guild!.display_name}(${guild!.mark ?? ""})\n자원: ${command.resource.label}\n기존: ${comma(balances.before)}\n추가: +${comma(command.amount)}\n현재: ${comma(balances.after)}`;
        const outboxId = await this.queue(transaction,operation.insertId,input.destinationId,data);
        result = { status: "granted", resourceCode: command.resource.code, guildId: guild!.id.toString(), before: balances.before.toString(), after: balances.after.toString(), reply: { outboxId: outboxId.toString(), room: input.destinationId, data } };
      }
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,COMMAND_CODE,operation.insertId,result.status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'guild',?,'guild.warehouse.resource.grant','success',?,?,UTC_TIMESTAMP(3))", [operation.insertId,operator.operator_id,guild?.id ?? null,`Iris ${input.message}`,JSON.stringify({ status: result.status, resourceCode: result.resourceCode, amount: command.kind === "grant" ? command.amount.toString() : null, before: result.before ?? null, after: result.after ?? null })]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
  private async grantCurrency(transaction: DatabaseTransaction,operationId: bigint,guildId: bigint,code: string,amount: bigint): Promise<{ before: bigint; after: bigint }> {
    const definitions = await transaction.query<Array<{ code: string }>>("SELECT code FROM currency_definitions WHERE code=? AND active=TRUE LIMIT 1",[code]);
    if (definitions[0] === undefined) throw new ApplicationError("GUILD_RESOURCE_NOT_FOUND","길드 자원 기준정보를 찾을 수 없습니다.",404);
    await transaction.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,?,0,1)",[guildId,code]);
    const rows = await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code=? FOR UPDATE",[guildId,code]);
    const before = BigInt(rows[0]!.balance.split(".")[0]!), after = before + amount;
    if (after > MAX_UNSIGNED_BIGINT) throw new ApplicationError("GUILD_RESOURCE_OVERFLOW","길드 자원 수량 한도를 초과합니다.",409);
    const changed = await transaction.execute("UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code=? AND version=?",[after.toString(),guildId,code,rows[0]!.version]);
    if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_RESOURCE_VERSION_CONFLICT","길드 자원이 먼저 변경되었습니다.",409);
    await transaction.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,?,?,?, 'ADMIN_GUILD_WAREHOUSE_GRANT')",[operationId,guildId,code,amount.toString(),after.toString()]);
    return { before, after };
  }
  private async grantItem(transaction: DatabaseTransaction,operationId: bigint,guildId: bigint,code: string,amount: bigint): Promise<{ before: bigint; after: bigint }> {
    const definitions = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE LIMIT 1",[code]);
    const item = definitions[0]; if (item === undefined) throw new ApplicationError("GUILD_STOCK_ITEM_NOT_FOUND","길드 창고 아이템 기준정보를 찾을 수 없습니다.",404);
    await transaction.execute("INSERT IGNORE INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,0,1)",[guildId,item.id]);
    const rows = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=? FOR UPDATE",[guildId,item.id]);
    const before = rows[0]!.quantity, after = before + amount;
    if (after > MAX_UNSIGNED_BIGINT) throw new ApplicationError("GUILD_STOCK_OVERFLOW","길드 창고 수량 한도를 초과합니다.",409);
    const changed = await transaction.execute("UPDATE guild_warehouse_stacks SET quantity=?,version=version+1 WHERE guild_id=? AND item_id=? AND version=?",[after,guildId,item.id,rows[0]!.version]);
    if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_STOCK_VERSION_CONFLICT","길드 창고가 먼저 변경되었습니다.",409);
    await transaction.execute("INSERT INTO guild_warehouse_ledger(operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code) VALUES (?,1,?,?,?,?, 'ADMIN_GUILD_WAREHOUSE_GRANT')",[operationId,guildId,item.id,amount,after]);
    return { before, after };
  }
  private async queue(transaction: DatabaseTransaction,operationId: bigint,room: string,data: string): Promise<bigint> { return (await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,room,JSON.stringify({ data })])).insertId; }
}
