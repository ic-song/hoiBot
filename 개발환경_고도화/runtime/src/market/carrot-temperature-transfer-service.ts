import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ITEM_CODE = "carrot_thermometer";
const ITEM_DISPLAY_NAME = "당근온도기";
const MAX_TRANSFER_QUANTITY = 1000000n;

interface ParsedTemperatureCommand { targetName: string; quantity: bigint; }
export interface CarrotTemperatureTransferCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface CarrotTemperatureTransferResult {
  status: "transferred"; senderPlayerId: string; targetPlayerId: string; targetName: string;
  quantity: string; senderItemQuantity: string; targetTemperature: string;
  outboxId: string; auditId: string; data: string; replayed?: boolean;
}

// 대상명이 포함된 온도기 전달 명령만 실행 대상으로 인정합니다.
export function isCarrotTemperatureTransferCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/온도\s+\S(?:.*\S)?$/.test(message);
}

// 마지막 완전 숫자 token을 선택 수량으로, 나머지를 다중 단어 대상명으로 해석합니다.
function parseTemperatureCommand(message: string): ParsedTemperatureCommand {
  if (!isCarrotTemperatureTransferCommand(message)) throw new ApplicationError("INVALID_TEMPERATURE_TRANSFER_COMMAND", "정확한 /온도 [닉네임] [개수]를 입력해주세요.", 422);
  const tokens = message.slice(4).trim().split(/\s+/);
  let quantity = 1n;
  if (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1]!)) quantity = BigInt(tokens.pop()!);
  const targetName = tokens.join(" ");
  if (targetName === "") throw new ApplicationError("INVALID_TEMPERATURE_TRANSFER_COMMAND", "전달할 회원을 입력해주세요.", 422);
  if (quantity < 1n || quantity > MAX_TRANSFER_QUANTITY) throw new ApplicationError("TEMPERATURE_TRANSFER_LIMIT", "온도기는 1~1,000,000개만 전달할 수 있습니다.", 422);
  return { targetName, quantity };
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | CarrotTemperatureTransferResult): CarrotTemperatureTransferResult {
  const result = typeof value === "string" ? JSON.parse(value) as CarrotTemperatureTransferResult : value;
  return { ...result, replayed: true };
}

// 온도기 차감·온도 포인트 증가·원장·응답을 한 트랜잭션으로 저장합니다.
export class CarrotTemperatureTransferService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: CarrotTemperatureTransferCommand): Promise<CarrotTemperatureTransferResult> {
    const parsed = parseTemperatureCommand(command.message);
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity.id identity_id,identity.player_id FROM external_identities identity
         JOIN players player ON player.id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND player.status='active' LIMIT 1`, [command.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("PLAYER_NOT_REGISTERED", "가입된 회원만 온도기를 전달할 수 있습니다.", 404);
      const scope = `market.carrot-temperature-transfer:${actor.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CarrotTemperatureTransferResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        const replay = parseStoredResult(prior[0].result_json);
        if (replay.targetName !== parsed.targetName || replay.quantity !== parsed.quantity.toString()) {
          throw new ApplicationError("TEMPERATURE_TRANSFER_REPLAY_MISMATCH", "같은 이벤트의 온도기 전달 내용이 이전 요청과 다릅니다.", 409);
        }
        return replay;
      }
      const targets = await transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2", [parsed.targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${parsed.targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 전달할 수 없습니다.", 409);
      const target = targets[0]!;
      if (target.player_id === actor.player_id) throw new ApplicationError("SELF_TEMPERATURE_TRANSFER", "자신에게는 온도기를 전달할 수 없습니다.", 422);
      const lockedPlayers = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM players WHERE id IN (?,?) ORDER BY id FOR UPDATE", [actor.player_id, target.player_id]
      );
      if (lockedPlayers.length !== 2) throw new ApplicationError("PLAYER_NOT_FOUND", "전달 회원 상태를 확인할 수 없습니다.", 404);
      const items = await transaction.query<Array<{ id: bigint; display_name: string }>>(
        "SELECT id,display_name FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE", [ITEM_CODE]
      );
      const item = items[0];
      if (item === undefined || item.display_name !== ITEM_DISPLAY_NAME) throw new ApplicationError("TEMPERATURE_ITEM_REQUIRED", "당근온도기 설정을 찾을 수 없습니다.", 409);
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [actor.player_id, item.id]
      );
      const stack = stacks[0];
      if (stack === undefined || stack.quantity < parsed.quantity) throw new ApplicationError("INSUFFICIENT_TEMPERATURE_ITEM", "당근온도기가 부족합니다.", 409);
      await transaction.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value) VALUES(?,'thermo','lifetime',0)", [target.player_id]);
      const counters = await transaction.query<Array<{ value: bigint }>>(
        "SELECT value FROM player_counters WHERE player_id=? AND counter_code='thermo' AND period_key='lifetime' FOR UPDATE", [target.player_id]
      );
      const counter = counters[0]!;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(), scope, eventKey, actor.player_id]
      );
      const senderItemQuantity = stack.quantity - parsed.quantity;
      const targetTemperature = counter.value + parsed.quantity;
      const stackUpdated = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [senderItemQuantity, actor.player_id, item.id, stack.version]
      );
      if (stackUpdated.affectedRows !== 1n) throw new ApplicationError("TEMPERATURE_STACK_CONFLICT", "온도기 수량이 먼저 변경되었습니다.", 409);
      await transaction.execute(
        "UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='thermo' AND period_key='lifetime'",
        [targetTemperature, target.player_id]
      );
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES(?,1,?,?,?,'carrot_temperature_transfer')",
        [operation.insertId, actor.player_id, item.id, -parsed.quantity]
      );
      const data = `✅ [${parsed.targetName}] 님에게 당근온도기 ${parsed.quantity}개를 전달했습니다. (온도 ${targetTemperature})`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'market_carrot_temperature_transfer',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'player',?,'player',?,'market.carrot-temperature.transfer','success','Iris /온도',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, actor.player_id, target.player_id, JSON.stringify({ itemCode: ITEM_CODE, quantity: parsed.quantity.toString(), senderItemQuantity: senderItemQuantity.toString(), targetTemperature: targetTemperature.toString() })]
      );
      const result: CarrotTemperatureTransferResult = { status: "transferred", senderPlayerId: actor.player_id.toString(), targetPlayerId: target.player_id.toString(), targetName: parsed.targetName,
        quantity: parsed.quantity.toString(), senderItemQuantity: senderItemQuantity.toString(), targetTemperature: targetTemperature.toString(), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
