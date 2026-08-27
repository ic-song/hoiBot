import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const UINT64_MAX = 18446744073709551615n;

export type HomeFurnitureRemoveRequest =
  | { kind: "usage" }
  | { kind: "invalid" }
  | { kind: "valid"; targetName: string; requestedIndex: bigint };

export interface HomeFurnitureRemoveResult {
  status: "removed" | "rejected" | "ignored";
  reply?: string;
  outboxId?: string;
  targetPlayerId?: string;
  furnitureInstanceId?: string;
  requestedIndex?: string;
}

type Operator = { operator_id: bigint };
type Target = { player_id: bigint; display_name: string };
type Furniture = {
  id: bigint;
  display_name: string;
  charm_snapshot: bigint;
  grade_display_name: string;
  version: bigint;
};

// 레거시와 동일하게 '/가구제거 ' 접두사가 있는 입력만 실행 후보로 봅니다.
export function isHomeFurnitureRemoveCandidate(message: string | undefined): boolean {
  return message !== undefined && message.indexOf("/가구제거 ") === 0;
}

export function normalizeHomeFurnitureRemoveDispatchMessage(message: string): string {
  return isHomeFurnitureRemoveCandidate(message) ? "/가구제거" : message;
}

// 레거시 split(" ")와 parseInt(..., 10)의 대상 이름 및 번호 해석을 보존합니다.
export function parseHomeFurnitureRemoveRequest(message: string): HomeFurnitureRemoveRequest | null {
  if (!isHomeFurnitureRemoveCandidate(message)) return null;
  const args = message.split(" ");
  if (args.length < 3) return { kind: "usage" };
  const targetName = args.slice(1, args.length - 1).join(" ").trim();
  const numericPrefix = /^[+-]?\d+/.exec(args[args.length - 1] ?? "");
  if (targetName.length === 0 || numericPrefix === null) return { kind: "invalid" };
  const requestedIndex = BigInt(numericPrefix[0]);
  if (requestedIndex < 1n || requestedIndex > UINT64_MAX) return { kind: "invalid" };
  return { kind: "valid", targetName, requestedIndex };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | HomeFurnitureRemoveResult): HomeFurnitureRemoveResult {
  return typeof value === "string" ? JSON.parse(value) as HomeFurnitureRemoveResult : value;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  destinationId: string;
  operatorId: bigint;
  targetPlayerId: bigint | null;
  resultCode: string;
  reply: string;
  result: Omit<HomeFurnitureRemoveResult, "reply" | "outboxId">;
  summary: Record<string, unknown>;
}): Promise<HomeFurnitureRemoveResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_FURNITURE_REMOVE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'home.furniture_remove',?,'Iris /가구제거',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.targetPlayerId, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, reply: input.reply, outboxId: outbox.insertId.toString() } as HomeFurnitureRemoveResult;
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 활성 관리자가 stable 가구 가방 순번으로 선택한 한 인스턴스만 원자 제거합니다.
export class HomeFurnitureRemoveService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeFurnitureRemoveResult> {
    const request = parseHomeFurnitureRemoveRequest(input.message);
    return this.database.withTransaction(async transaction => {
      const operator = (await transaction.query<Operator[]>(
        "SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if (operator === undefined) return { status: "ignored" };

      const prior = (await transaction.query<Array<{ result_json: string | HomeFurnitureRemoveResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_remove' AND idempotency_key=? FOR UPDATE",
        [eventKey(input.eventId)]
      ))[0];
      if (prior?.result_json != null) return stored(prior.result_json);

      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture_remove',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), eventKey(input.eventId), operator.operator_id]
      )).insertId;
      const reject = (code: string, reply: string, targetPlayerId: bigint | null = null, summary: Record<string, unknown> = {}) => complete(transaction, {
        operationId,
        eventId: input.eventId,
        destinationId: input.destinationId,
        operatorId: operator.operator_id,
        targetPlayerId,
        resultCode: code,
        reply,
        result: { status: "rejected" },
        summary: { mutation: false, ...summary }
      });

      if (request === null || request.kind === "usage") {
        return reject("usage", "명령어 형식이 잘못되었습니다.\n\n사용법:\n/가구제거 닉네임 가구가방번호");
      }
      if (request.kind === "invalid") return reject("invalid_index", "가구가방 번호가 올바르지 않습니다.");

      const target = (await transaction.query<Target[]>(
        "SELECT player.id player_id,profile.current_display_name display_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id WHERE player.status='active' AND player.deleted_at IS NULL AND profile.current_display_name=? ORDER BY player.id LIMIT 1 FOR UPDATE",
        [request.targetName]
      ))[0];
      if (target === undefined) return reject("target_not_found", "해당 유저를 찾을 수 없습니다.", null, { targetName: request.targetName });

      const bag = await transaction.query<Furniture[]>(
        "SELECT instance.id,definition.display_name,instance.charm_snapshot,instance.grade_display_name,instance.version FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='bag' ORDER BY instance.charm_snapshot DESC,definition.display_name COLLATE utf8mb4_unicode_ci,instance.id FOR UPDATE",
        [target.player_id]
      );
      if (bag.length === 0) return reject("empty_bag", "해당 유저의 가구가방이 비어있거나 존재하지 않습니다.", target.player_id);
      if (request.requestedIndex > BigInt(bag.length)) {
        return reject("furniture_not_found", "해당 번호의 가구가 존재하지 않습니다.", target.player_id, { requestedIndex: request.requestedIndex.toString(), bagCount: bag.length });
      }

      const selected = bag[Number(request.requestedIndex - 1n)]!;
      const changed = await transaction.execute(
        "UPDATE furniture_inventory_instances SET status='removed',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='bag' AND version=?",
        [selected.id, target.player_id, selected.version]
      );
      if (changed.affectedRows !== 1n) throw new Error("가구 가방이 먼저 변경되었습니다.");
      await transaction.execute(
        "INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,1,?,?,'bag','removed','HOME_FURNITURE_REMOVE')",
        [operationId, target.player_id, selected.id]
      );
      await transaction.execute(
        "INSERT INTO home_furniture_remove_operations(operation_id,operator_id,target_player_id,furniture_instance_id,requested_index,bag_count_before,bag_count_after,furniture_name_snapshot,charm_snapshot,grade_display_name_snapshot,instance_version_before) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [operationId, operator.operator_id, target.player_id, selected.id, request.requestedIndex.toString(), bag.length, bag.length - 1, selected.display_name, selected.charm_snapshot, selected.grade_display_name, selected.version]
      );

      const removedName = `${selected.display_name}(+${commas(BigInt(selected.charm_snapshot))}💕)[${selected.grade_display_name || "등급없음"}]`;
      const reply = `✅ 가구 삭제 완료\n\n대상 유저: ${target.display_name}\n삭제 번호: ${request.requestedIndex}번\n삭제 가구: ${removedName}\n\n해당 가구가 유저의 가구가방에서 제거되었습니다.`;
      return complete(transaction, {
        operationId,
        eventId: input.eventId,
        destinationId: input.destinationId,
        operatorId: operator.operator_id,
        targetPlayerId: target.player_id,
        resultCode: "removed",
        reply,
        result: { status: "removed", targetPlayerId: target.player_id.toString(), furnitureInstanceId: selected.id.toString(), requestedIndex: request.requestedIndex.toString() },
        summary: { mutation: true, targetPlayerId: target.player_id.toString(), furnitureInstanceId: selected.id.toString(), requestedIndex: request.requestedIndex.toString(), statusBefore: "bag", statusAfter: "removed", bagCountBefore: bag.length, bagCountAfter: bag.length - 1 }
      });
    });
  }
}
