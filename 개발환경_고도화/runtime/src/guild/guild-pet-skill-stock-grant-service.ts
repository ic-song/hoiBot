import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ITEM_CODE = "pet_skill_book_fragment";
const ITEM_LABEL = "펫스킬북 조각📙";
const USAGE = "사용법: /길드펫스킬창고 [길드명] [숫자]\n예) /길드펫스킬창고 대머리 100\n※ 길드창고에 펫스킬북 조각📙을 지급합니다.";
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

export type GuildPetSkillStockGrantCommand = { kind: "usage" } | { kind: "grant"; guildName: string; amount: bigint };
export interface GuildPetSkillStockGrantResult {
  status: "silent" | "usage" | "granted";
  guildId?: string;
  before?: string;
  after?: string;
  reply: { outboxId: string; room: string; data: string } | null;
}

// exact 사용법과 자유형 길드명 뒤 양의 정수 수량을 분리합니다.
export function parseGuildPetSkillStockGrantCommand(message: string | undefined): GuildPetSkillStockGrantCommand | null {
  if (message === "/길드펫스킬창고") return { kind: "usage" };
  if (!/^\/길드펫스킬창고\s+.+$/.test(message ?? "")) return null;
  const match = /^\/길드펫스킬창고\s+(.+?)\s+(\d+)$/.exec(message ?? "");
  if (match === null) return { kind: "usage" };
  const amount = BigInt(match[2]!);
  return amount <= 0n || amount > MAX_UNSIGNED_BIGINT ? { kind: "usage" } : { kind: "grant", guildName: match[1]!.trim(), amount };
}

// 인자 후보를 대표 alias로 정규화해 malformed 입력도 레거시 사용법 응답으로 보냅니다.
export function normalizeGuildPetSkillStockGrantDispatchMessage(message: string): string {
  return message === "/길드펫스킬창고" ? message : "/길드펫스킬창고 [길드명] [수량]";
}

// 레거시 outer guard와 동일한 exact 또는 공백 인자 후보만 허용합니다.
export function isGuildPetSkillStockGrantCandidate(message: string | undefined): boolean {
  return message === "/길드펫스킬창고" || /^\/길드펫스킬창고\s+.+$/.test(message ?? "");
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildPetSkillStockGrantResult): GuildPetSkillStockGrantResult { return typeof value === "string" ? JSON.parse(value) as GuildPetSkillStockGrantResult : value; }
function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 운영자 권한과 stable 길드·아이템을 확인해 창고 수량·원장·감사·응답을 원자 지급합니다.
export class GuildPetSkillStockGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<GuildPetSkillStockGrantResult> {
    const command = parseGuildPetSkillStockGrantCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_GUILD_PET_SKILL_STOCK_COMMAND", USAGE, 422);
    return this.database.withTransaction(async transaction => {
      const operators = await transaction.query<Array<{ identity_id: bigint; operator_id: bigint }>>(
        `SELECT identity.id identity_id,operator.id operator_id FROM external_identities identity
          JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
          JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
          JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
          JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('manager','super_admin') AND role.active=TRUE
          JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='guild.warehouse.pet_skill_book_fragment.grant'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         ORDER BY role.code='super_admin' DESC LIMIT 1 FOR UPDATE`, [input.externalUserId],
      );
      const operator = operators[0];
      if (operator === undefined) return { status: "silent", reply: null };
      const scope = `guild.pet-skill-stock.grant:${operator.operator_id}`;
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | GuildPetSkillStockGrantResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key],
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);

      let guild: { id: bigint; display_name: string; mark: string | null } | null = null;
      if (command.kind === "grant") {
        const guilds = await transaction.query<Array<{ id: bigint; display_name: string; mark: string | null }>>(
          "SELECT id,display_name,mark FROM guilds WHERE display_name=? AND status='active' ORDER BY id LIMIT 2 FOR UPDATE", [command.guildName],
        );
        if (guilds.length === 0) throw new ApplicationError("GUILD_NOT_FOUND", "길드를 찾을 수 없습니다.", 404);
        if (guilds.length > 1) throw new ApplicationError("GUILD_NAME_AMBIGUOUS", "동일한 이름의 길드가 여러 개입니다.", 409);
        guild = guilds[0]!;
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,operator.operator_id],
      );
      let result: GuildPetSkillStockGrantResult;
      if (command.kind === "usage") {
        const outbox = await this.queue(transaction,operation.insertId,input.destinationId,USAGE);
        result = { status:"usage",reply:{outboxId:outbox.toString(),room:input.destinationId,data:USAGE} };
      } else {
        const items = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE LIMIT 1",[ITEM_CODE]);
        const item = items[0]; if (item === undefined) throw new ApplicationError("GUILD_STOCK_ITEM_NOT_FOUND","펫스킬북 조각 기준정보를 찾을 수 없습니다.",404);
        await transaction.execute("INSERT IGNORE INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,0,0)",[guild!.id,item.id]);
        const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=? FOR UPDATE",[guild!.id,item.id]);
        const stack=stacks[0]!; const after=stack.quantity+command.amount;
        if(after>MAX_UNSIGNED_BIGINT)throw new ApplicationError("GUILD_STOCK_OVERFLOW","길드 창고 수량 한도를 초과합니다.",409);
        const changed=await transaction.execute("UPDATE guild_warehouse_stacks SET quantity=?,version=version+1 WHERE guild_id=? AND item_id=? AND version=?",[after,guild!.id,item.id,stack.version]);
        if(changed.affectedRows!==1n)throw new ApplicationError("GUILD_STOCK_VERSION_CONFLICT","길드 창고가 먼저 변경되었습니다.",409);
        await transaction.execute("INSERT INTO guild_warehouse_ledger(operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code) VALUES (?,1,?,?,?,?, 'ADMIN_GUILD_PET_SKILL_STOCK_GRANT')",[operation.insertId,guild!.id,item.id,command.amount,after]);
        const data=`✅ 길드창고에 자원이 지급되었습니다.\n길드: ${guild!.display_name}(${guild!.mark ?? ""})\n자원: ${ITEM_LABEL}\n기존: ${comma(stack.quantity)}\n추가: +${comma(command.amount)}\n현재: ${comma(after)}`;
        const outbox=await this.queue(transaction,operation.insertId,input.destinationId,data);
        result={status:"granted",guildId:guild!.id.toString(),before:stack.quantity.toString(),after:after.toString(),reply:{outboxId:outbox.toString(),room:input.destinationId,data}};
      }
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_GUILD_PET_SKILL_STOCK_GRANT',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,result.status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'guild',?,'guild.warehouse.pet_skill_book_fragment.grant','success',?,?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,guild?.id??null,`Iris ${input.message}`,JSON.stringify({status:result.status,itemCode:ITEM_CODE,amount:command.kind==='grant'?command.amount.toString():null,before:result.before??null,after:result.after??null})]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }

  private async queue(transaction: DatabaseTransaction,operationId: bigint,room: string,data: string): Promise<bigint> {
    return (await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,room,JSON.stringify({data})])).insertId;
  }
}
