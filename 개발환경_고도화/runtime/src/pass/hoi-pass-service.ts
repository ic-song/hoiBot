import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHoiPassCommand } from "./hoi-pass-command.js";

type Operator = { operator_id: bigint; display_name: string };
type Target = { player_id: bigint; display_name: string };
type PassRow = { id: bigint; entitlement_kind: "permanent" | "dated"; end_date: Date | string | null; status: "active" | "revoked" | "expired"; version: bigint };
type ItemRow = { id: bigint };
type StackRow = { quantity: bigint; version: bigint };

export type HoiPassResult = {
  status: "changed" | "unchanged";
  action: "add" | "delete";
  target: string;
  ticketDelta: string;
  data: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
};

const scope = "support.pass.hoi.registry";
const code = "HOI_PASS_REGISTRY";
const ticketName = "자동탐험권🌄";
const key = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | HoiPassResult): HoiPassResult => typeof value === "string" ? JSON.parse(value) as HoiPassResult : value;
const dateText = (value: Date | string | null): string | null => value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

function todayKst(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// 호이패스 entitlement와 자동탐험권 stack·ledger를 하나의 관리자 트랜잭션으로 처리합니다.
export class HoiPassService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HoiPassResult> {
    const command = parseHoiPassCommand(input.message);
    if (!command) throw new ApplicationError("HOI_PASS_COMMAND_INVALID", "호이패스 명령 형식을 확인해 주세요.", 422);
    const operator = (await this.database.query<Operator[]>(`SELECT mapping.operator_id,operator.display_name FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`, [input.externalUserId]))[0];
    if (operator?.display_name !== "호이 남") throw new ApplicationError("HOI_PASS_FORBIDDEN", "호이패스 관리 권한이 없습니다.", 403);
    const targets = await this.database.query<Target[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' WHERE profile.current_display_name=? LIMIT 2`, [command.target]);
    if (targets.length !== 1) throw new ApplicationError("HOI_PASS_TARGET_NOT_FOUND", "❌ 해당 유저를 찾을 수 없습니다.", 404);
    const target = targets[0]!;
    if (command.action === "add" && command.endDate !== null && command.endDate < todayKst()) {
      throw new ApplicationError("HOI_PASS_PAST_DATE", `❌ 지난 날짜로 패스를 추가할 수 없습니다.\n오늘 이후 날짜를 입력해주세요.\n예) /호이패스추가, ${command.target} 26.06.21`, 422);
    }

    return this.database.withTransaction(async (tx) => {
      const idKey = key(input.eventId);
      const prior = (await tx.query<Array<{ result_json: string | HoiPassResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, idKey]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, idKey, operator.operator_id])).insertId;
      const before = (await tx.query<PassRow[]>("SELECT id,entitlement_kind,end_date,status,version FROM player_support_passes WHERE player_id=? AND pass_code='hoi' FOR UPDATE", [target.player_id]))[0];
      const ticketRows = await tx.query<ItemRow[]>("SELECT id FROM item_definitions WHERE display_name=? AND active=TRUE ORDER BY id LIMIT 2 FOR UPDATE", [ticketName]);
      if (ticketRows.length !== 1) throw new ApplicationError("HOI_PASS_TICKET_DEFINITION_INVALID", "자동탐험권 정의를 하나로 확인할 수 없습니다.", 500);
      const ticketId = ticketRows[0]!.id;
      let changed = false;
      let passId = before?.id ?? 0n;
      let ticketDelta = 0n;
      let data: string;

      if (command.action === "add") {
        const existing = before?.status === "active";
        await tx.execute(`INSERT INTO player_support_passes(player_id,pass_code,entitlement_kind,end_date,status,version,created_operation_id,updated_operation_id,created_at,updated_at) VALUES (?,'hoi',?,?,'active',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE entitlement_kind=VALUES(entitlement_kind),end_date=VALUES(end_date),status='active',version=version+1,updated_operation_id=VALUES(updated_operation_id),updated_at=UTC_TIMESTAMP(3)`, [target.player_id, command.option, command.endDate, operationId, operationId]);
        passId = (await tx.query<Array<{ id: bigint }>>("SELECT id FROM player_support_passes WHERE player_id=? AND pass_code='hoi'", [target.player_id]))[0]!.id;
        const stack = (await tx.query<StackRow[]>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.player_id, ticketId]))[0];
        if (stack === undefined) await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1)", [target.player_id, ticketId]);
        else await tx.execute("UPDATE inventory_stacks SET quantity=quantity+1,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [target.player_id, ticketId, stack.version]);
        await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,1,?,?,NULL,1,'HOI_PASS_TICKET_GRANT')", [operationId, target.player_id, ticketId]);
        const ticketCount = (await tx.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [target.player_id, ticketId]))[0]!.quantity;
        ticketDelta = 1n;
        changed = true;
        const period = command.option === "permanent" ? "영구권" : `${command.rawEndDate}까지`;
        data = `${existing ? "⚠️ 이미 해당 패스를 보유 중입니다.\n기존 종료일을 새 종료일로 갱신합니다." : `${target.display_name} 사용자에게 패스가 추가되었습니다.`}\n패스 기간: ${period}\n자동탐험권🌄 1개가 지급되었습니다.\n저장확인: 패스 저장 완료 (${period})\n저장확인: 자동탐험권🌄 ${ticketCount}개`;
      } else if (before?.status !== "active") {
        data = "❌ 해당 유저는 해당 패스를 보유하고 있지 않습니다.";
      } else {
        await tx.execute("UPDATE player_support_passes SET status='revoked',version=version+1,updated_operation_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND version=?", [operationId, before.id, before.version]);
        const other = (await tx.query<Array<{ active_count: bigint }>>(`SELECT (SELECT COUNT(*) FROM player_support_passes WHERE player_id=? AND pass_code IN ('newbie','premium') AND status='active' AND (entitlement_kind='permanent' OR end_date>=?)) + (SELECT COUNT(*) FROM player_passes WHERE player_id=? AND pass_code IN ('newbie','premium') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) active_count`, [target.player_id, todayKst(), target.player_id]))[0]?.active_count ?? 0n;
        const stack = (await tx.query<StackRow[]>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.player_id, ticketId]))[0];
        if (other === 0n && stack !== undefined && stack.quantity > 0n) {
          ticketDelta = -BigInt(stack.quantity);
          await tx.execute("UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [target.player_id, ticketId, stack.version]);
          await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,1,?,?,NULL,?,'HOI_PASS_TICKET_REVOKE')", [operationId, target.player_id, ticketId, ticketDelta.toString()]);
        }
        changed = true;
        const ticketLine = other > 0n ? "다른 자동탐험 패스가 유효하여 자동탐험권🌄을 유지합니다." : "자동탐험권🌄을 모두 회수했습니다.";
        const saveLine = other > 0n ? "저장확인: 다른 자동탐험 패스가 유효하여 자동탐험권🌄 유지" : "저장확인: 자동탐험권🌄 회수 완료";
        data = `${target.display_name} 사용자의 패스가 삭제되었습니다.\n${ticketLine}\n저장확인: 패스 삭제 저장 완료\n${saveLine}`;
      }

      await tx.execute("INSERT INTO support_pass_change_events(operation_id,pass_id,player_id,pass_code,action_code,previous_status,previous_kind,previous_end_date,next_status,next_kind,next_end_date,changed,created_at) VALUES (?,?,?,'hoi',?,?,?,?,?,?,?, ?,UTC_TIMESTAMP(3))", [operationId, passId === 0n ? null : passId, target.player_id, command.action, before?.status ?? null, before?.entitlement_kind ?? null, dateText(before?.end_date ?? null), command.action === "add" ? "active" : before?.status === "active" ? "revoked" : before?.status ?? "missing", command.action === "add" ? command.option : before?.entitlement_kind ?? null, command.action === "add" ? command.endDate : dateText(before?.end_date ?? null), changed]);
      const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'support.pass.hoi.registry',?,'Iris 호이패스 관리',?,UTC_TIMESTAMP(3))", [operationId, operator.operator_id, target.player_id, changed ? "changed" : "unchanged", JSON.stringify({ action: command.action, target: target.display_name, changed, ticketDelta: ticketDelta.toString() })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, code, operationId, changed ? "changed" : "unchanged"]);
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
      const result: HoiPassResult = { status: changed ? "changed" : "unchanged", action: command.action, target: target.display_name, ticketDelta: ticketDelta.toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), replayed: false };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
