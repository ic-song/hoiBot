import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseBeginnerPassCommand } from "./beginner-pass-command.js";

type Operator = { operator_id: bigint; display_name: string };
type Target = { player_id: bigint; display_name: string };
type Policy = { pass_code: string; ticket_item_id: bigint; ticket_name: string; grant_quantity: bigint };
type PassRow = { id: bigint; entitlement_kind: "permanent" | "dated"; end_date: Date | string | null; status: "active" | "revoked" | "expired"; version: bigint };
export type BeginnerPassResult = {
  status: "changed" | "unchanged";
  action: "add" | "delete";
  target: string;
  ticketDelta: string;
  ticketBalance: string;
  data: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
};

const SCOPE = "support.pass.beginner.registry";
const COMMAND_CODE = "BEGINNER_PASS_REGISTRY";

// 긴 provider 이벤트 ID를 operations 키 길이에 맞게 안정적으로 축약합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 저장된 멱등 결과를 typed 결과로 복원합니다.
function stored(value: string | BeginnerPassResult): BeginnerPassResult {
  return typeof value === "string" ? JSON.parse(value) as BeginnerPassResult : value;
}

// DB DATE 또는 Date 값을 비교 가능한 YYYY-MM-DD 문자열로 정규화합니다.
function dateText(value: Date | string | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// 현재 KST 날짜를 과거 종료일 차단 기준으로 반환합니다.
function todayKst(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// 초보패스와 자동탐험권 지급·조건부 회수를 하나의 MariaDB transaction으로 처리합니다.
export class BeginnerPassService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<BeginnerPassResult> {
    const command = parseBeginnerPassCommand(input.message);
    if (command === null) throw new ApplicationError("BEGINNER_PASS_COMMAND_INVALID", "초보패스 명령 형식을 확인해 주세요.", 422);
    if (command.action === "add" && command.endDate !== null && command.endDate < todayKst()) {
      throw new ApplicationError("BEGINNER_PASS_PAST_DATE", `❌ 지난 날짜로 패스를 추가할 수 없습니다.\n오늘 이후 날짜를 입력해주세요.\n예) /초보추가, ${command.target} 26.06.21`, 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const operators = await transaction.query<Operator[]>(`SELECT mapping.operator_id,operator.display_name
        FROM external_identities identity
        JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
        JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        ORDER BY mapping.operator_id LIMIT 2 FOR UPDATE`, [input.externalUserId]);
      const operator = operators[0];
      if (operators.length !== 1 || operator?.display_name !== "호이 남") {
        throw new ApplicationError("BEGINNER_PASS_FORBIDDEN", "초보패스 관리 권한이 없습니다.", 403);
      }

      const idempotencyKey = eventKey(input.eventId);
      const previousOperation = (await transaction.query<Array<{ result_json: string | BeginnerPassResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [SCOPE, idempotencyKey]
      ))[0];
      if (previousOperation?.result_json != null) return { ...stored(previousOperation.result_json), replayed: true };

      const targets = await transaction.query<Target[]>(`SELECT player.id player_id,profile.current_display_name display_name
        FROM player_profiles profile
        JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL
        WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2 FOR UPDATE`, [command.target]);
      if (targets.length !== 1) throw new ApplicationError("BEGINNER_PASS_TARGET_NOT_FOUND", "❌ 해당 유저를 찾을 수 없습니다.", 404);
      const target = targets[0]!;

      const policies = await transaction.query<Policy[]>(`SELECT policy.pass_code,policy.ticket_item_id,definition.display_name ticket_name,policy.grant_quantity
        FROM beginner_pass_policy policy
        JOIN support_pass_definitions pass_definition ON pass_definition.pass_code=policy.pass_code AND pass_definition.active=TRUE
        JOIN item_definitions definition ON definition.id=policy.ticket_item_id AND definition.active=TRUE AND definition.stackable=TRUE
        WHERE policy.policy_key='default' AND policy.active=TRUE LIMIT 2 FOR UPDATE`);
      if (policies.length !== 1) throw new ApplicationError("BEGINNER_PASS_POLICY_INVALID", "초보패스 DB 정책을 확인해 주세요.", 500);
      const policy = policies[0]!;

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, idempotencyKey, operator.operator_id]
      );
      const before = (await transaction.query<PassRow[]>(
        "SELECT id,entitlement_kind,end_date,status,version FROM player_support_passes WHERE player_id=? AND pass_code=? FOR UPDATE",
        [target.player_id, policy.pass_code]
      ))[0];

      let passId: bigint | null = before?.id ?? null;
      let passChanged = false;
      let ticketDelta = 0n;
      let otherAutoPassCount = 0n;
      let data: string;

      if (command.action === "add") {
        passChanged = before?.status !== "active" || before.entitlement_kind !== command.option || dateText(before.end_date) !== command.endDate;
        await transaction.execute(`INSERT INTO player_support_passes
          (player_id,pass_code,entitlement_kind,end_date,status,version,created_operation_id,updated_operation_id,created_at,updated_at)
          VALUES (?,?,?,?,'active',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE entitlement_kind=VALUES(entitlement_kind),end_date=VALUES(end_date),status='active',version=version+1,updated_operation_id=VALUES(updated_operation_id),updated_at=UTC_TIMESTAMP(3)`,
        [target.player_id, policy.pass_code, command.option, command.endDate, operation.insertId, operation.insertId]);
        passId = (await transaction.query<Array<{ id: bigint }>>(
          "SELECT id FROM player_support_passes WHERE player_id=? AND pass_code=?",
          [target.player_id, policy.pass_code]
        ))[0]!.id;
        await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [target.player_id, policy.ticket_item_id]);
        const stack = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
          "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
          [target.player_id, policy.ticket_item_id]
        ))[0]!;
        const write = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
          [policy.grant_quantity, target.player_id, policy.ticket_item_id, stack.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("BEGINNER_PASS_TICKET_CONFLICT", "자동탐험권 수량이 먼저 변경되었습니다.", 409);
        ticketDelta = BigInt(policy.grant_quantity);
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'BEGINNER_PASS_TICKET_GRANT')",
          [operation.insertId, target.player_id, policy.ticket_item_id, ticketDelta]
        );
        data = `${target.display_name} 사용자에게 초보패스가 ${before?.status === "active" ? "갱신" : "추가"}되었습니다.\n패스 기간: ${command.option === "permanent" ? "영구권" : `${command.rawEndDate}까지`}\n${policy.ticket_name} ${ticketDelta.toString()}개 지급`;
      } else if (before?.status !== "active") {
        data = "❌ 해당 유저는 초보패스를 보유하고 있지 않습니다.";
      } else {
        const write = await transaction.execute(
          "UPDATE player_support_passes SET status='revoked',version=version+1,updated_operation_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND version=?",
          [operation.insertId, before.id, before.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("BEGINNER_PASS_CONFLICT", "초보패스 정보가 먼저 변경되었습니다.", 409);
        passChanged = true;
        otherAutoPassCount = BigInt((await transaction.query<Array<{ count_value: bigint }>>(`SELECT COUNT(*) count_value
          FROM player_passes legacy_pass
          JOIN beginner_pass_auto_explore_compatibility compatibility ON compatibility.pass_code=legacy_pass.pass_code AND compatibility.active=TRUE
          WHERE legacy_pass.player_id=? AND legacy_pass.enabled=TRUE AND (legacy_pass.permanent=TRUE OR legacy_pass.ends_at>=UTC_TIMESTAMP(3))
          FOR UPDATE`, [target.player_id]))[0]?.count_value ?? 0n);
        if (otherAutoPassCount === 0n) {
          const stack = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
            "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
            [target.player_id, policy.ticket_item_id]
          ))[0];
          if (stack !== undefined && BigInt(stack.quantity) > 0n) {
            const quantity = BigInt(stack.quantity);
            const ticketWrite = await transaction.execute(
              "UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
              [target.player_id, policy.ticket_item_id, stack.version]
            );
            if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("BEGINNER_PASS_TICKET_CONFLICT", "자동탐험권 수량이 먼저 변경되었습니다.", 409);
            ticketDelta = -quantity;
            await transaction.execute(
              "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'BEGINNER_PASS_TICKET_REVOKE')",
              [operation.insertId, target.player_id, policy.ticket_item_id, ticketDelta]
            );
          }
        }
        data = `${target.display_name} 사용자의 초보패스가 삭제되었습니다.${ticketDelta < 0n ? `\n${policy.ticket_name} ${(-ticketDelta).toString()}개 회수` : "\n다른 자동탐험 패스가 있어 자동탐험권을 유지합니다."}`;
      }

      const balance = BigInt((await transaction.query<Array<{ quantity: bigint }>>(
        "SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?",
        [target.player_id, policy.ticket_item_id]
      ))[0]?.quantity ?? 0n);
      const overallChanged = command.action === "add" || passChanged;
      await transaction.execute(`INSERT INTO support_pass_change_events
        (operation_id,pass_id,player_id,pass_code,action_code,previous_status,previous_kind,previous_end_date,next_status,next_kind,next_end_date,changed,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, [
        operation.insertId, passId, target.player_id, policy.pass_code, command.action,
        before?.status ?? null, before?.entitlement_kind ?? null, dateText(before?.end_date ?? null),
        command.action === "add" ? "active" : before?.status === "active" ? "revoked" : before?.status ?? "missing",
        command.action === "add" ? command.option : before?.entitlement_kind ?? null,
        command.action === "add" ? command.endDate : dateText(before?.end_date ?? null), passChanged
      ]);
      await transaction.execute(`INSERT INTO beginner_pass_registry_events
        (operation_id,pass_id,player_id,action_code,pass_changed,ticket_item_id,ticket_delta,ticket_balance_after,other_auto_pass_count,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, [operation.insertId, passId, target.player_id, command.action, passChanged, policy.ticket_item_id, ticketDelta, balance, otherAutoPassCount]);
      const audit = await transaction.execute(`INSERT INTO command_audit
        (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
        VALUES (?,'admin_operator',?,'player',?,'support.pass.beginner.registry',?,'Iris 초보패스 관리',?,UTC_TIMESTAMP(3))`, [
        operation.insertId, operator.operator_id, target.player_id, overallChanged ? "changed" : "unchanged",
        JSON.stringify({ action: command.action, target: target.display_name, passChanged, ticketDelta: ticketDelta.toString(), ticketBalance: balance.toString(), otherAutoPassCount: otherAutoPassCount.toString() })
      ]);
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, COMMAND_CODE, operation.insertId, overallChanged ? "changed" : "unchanged"]
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: BeginnerPassResult = {
        status: overallChanged ? "changed" : "unchanged",
        action: command.action,
        target: target.display_name,
        ticketDelta: ticketDelta.toString(),
        ticketBalance: balance.toString(),
        data,
        outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(),
        replayed: false
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
