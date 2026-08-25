import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  ParadiseBoxOpenCommand,
  ParadiseBoxOpenRandomSource,
  ParadiseBoxOpenRepository,
  ParadiseBoxOpenResult
} from "./paradise-box-open-service.js";

const BOX_CODE = "paradise_point_box";

interface ActorRow { identity_id: bigint; player_id: bigint; rank_label: string; }
interface RateRow {
  version_code: string;
  min_units: bigint;
  max_units: bigint;
  unit_point: bigint;
  max_open_count: bigint;
}
interface DefinitionRow { item_id: bigint; }
interface StackRow { quantity: bigint; version: bigint; }
interface AccountRow { balance: string; version: bigint; }

// 긴 provider event ID를 operation 멱등 키 길이 안에서 안정적으로 보존합니다.
function operationKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 동일 이벤트 재실행 결과로 복원합니다.
function storedResult(value: string | ParadiseBoxOpenResult): ParadiseBoxOpenResult {
  return typeof value === "string" ? JSON.parse(value) as ParadiseBoxOpenResult : value;
}

// 정수 DECIMAL 포인트를 손실 없는 bigint로 변환합니다.
function integer(value: string): bigint {
  const match = /^(\d+)(?:\.0+)?$/.exec(value);
  if (match === null) {
    throw new ApplicationError("PARADISE_BOX_OPEN_POINT_INVALID", "포인트 잔액을 정수로 확인할 수 없습니다.", 409);
  }
  return BigInt(match[1]!);
}

// 숫자를 레거시 응답과 같은 쉼표 형식으로 표시합니다.
function comma(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 0~1 난수를 DB 버전의 inclusive 정수 포인트 보상으로 변환합니다.
function rollPoint(
  random: ParadiseBoxOpenRandomSource,
  minimumUnits: bigint,
  maximumUnits: bigint,
  unitPoint: bigint
): { raw: number; point: bigint } {
  const raw = random.next();
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new ApplicationError("PARADISE_BOX_OPEN_RANDOM_INVALID", "극락상자 확률 입력값이 올바르지 않습니다.", 500);
  }
  const normalized = raw === 1 ? 1 - Number.EPSILON : raw;
  const width = Number(maximumUnits - minimumUnits + 1n);
  const units = minimumUnits + BigInt(Math.floor(normalized * width));
  return { raw, point: units * unitPoint };
}

// 극락상자 차감과 포인트 지급, RNG·원장·응답을 한 트랜잭션으로 확정합니다.
async function executeOpen(
  transaction: DatabaseTransaction,
  command: ParadiseBoxOpenCommand,
  requestedCount: bigint,
  random: ParadiseBoxOpenRandomSource
): Promise<ParadiseBoxOpenResult> {
  const siege = await transaction.query<Array<{ active_count: bigint }>>(
    "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
  );
  if ((siege[0]?.active_count ?? 0n) > 0n) {
    throw new ApplicationError("PARADISE_BOX_OPEN_CASTLE_SIEGE", "성 점령전 진행 중에는 극락상자를 개봉할 수 없습니다.", 409);
  }

  const actors = await transaction.query<ActorRow[]>(
    `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
     FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
     WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
       AND identity.player_id IS NOT NULL FOR UPDATE`,
    [command.externalUserId]
  );
  const actor = actors[0];
  if (actor === undefined) {
    throw new ApplicationError("PARADISE_BOX_OPEN_ACTOR_REQUIRED", "가입된 사용자만 극락상자를 개봉할 수 있습니다.", 409);
  }
  await transaction.query<Array<{ id: bigint }>>("SELECT id FROM players WHERE id = ? FOR UPDATE", [actor.player_id]);

  const scope = `inventory.paradise-box-open:${actor.identity_id.toString()}`;
  const key = operationKey(command.eventId);
  const prior = await transaction.query<Array<{ result_json: string | ParadiseBoxOpenResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
    [scope, key]
  );
  if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
    return { ...storedResult(prior[0].result_json), duplicate: true };
  }

  const rates = await transaction.query<RateRow[]>(
    `SELECT version_code, min_units, max_units, unit_point, max_open_count
     FROM paradise_box_open_rate_versions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1 FOR UPDATE`
  );
  const rate = rates[0];
  if (rate === undefined) {
    throw new ApplicationError("PARADISE_BOX_OPEN_RATE_REQUIRED", "극락상자 포인트 설정을 찾을 수 없습니다.", 409);
  }
  if (requestedCount > rate.max_open_count) {
    throw new ApplicationError("PARADISE_BOX_OPEN_COUNT_LIMIT", `한 번에 최대 ${rate.max_open_count.toString()}개까지 개봉할 수 있습니다.`, 422);
  }

  const definitions = await transaction.query<DefinitionRow[]>(
    "SELECT id AS item_id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE",
    [BOX_CODE]
  );
  const definition = definitions[0];
  if (definition === undefined) {
    throw new ApplicationError("PARADISE_BOX_OPEN_CATALOG_REQUIRED", "극락상자 아이템 설정을 찾을 수 없습니다.", 409);
  }
  const stacks = await transaction.query<StackRow[]>(
    "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
    [actor.player_id, definition.item_id]
  );
  const stack = stacks[0];
  if (stack === undefined || stack.quantity < 1n) {
    throw new ApplicationError("PARADISE_BOX_OPEN_EMPTY", "극락상자👹를 이미 모두 사용했습니다.", 409);
  }
  const openedCount = stack.quantity < requestedCount ? stack.quantity : requestedCount;
  const draws: Array<{ raw: number; point: bigint }> = [];
  let totalPoint = 0n;
  for (let ordinal = 0n; ordinal < openedCount; ordinal++) {
    const draw = rollPoint(random, rate.min_units, rate.max_units, rate.unit_point);
    draws.push(draw);
    totalPoint += draw.point;
  }

  await transaction.execute(
    "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)",
    [actor.player_id]
  );
  const accounts = await transaction.query<AccountRow[]>(
    "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
    [actor.player_id]
  );
  const account = accounts[0];
  if (account === undefined) {
    throw new ApplicationError("PARADISE_BOX_OPEN_ACCOUNT_REQUIRED", "포인트 계정을 준비하지 못했습니다.", 409);
  }
  const balanceBefore = integer(account.balance);
  const balanceAfter = balanceBefore + totalPoint;

  const operation = await transaction.execute(
    `INSERT INTO operations
       (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
     VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', NULL, UTC_TIMESTAMP(3))`,
    [randomUUID(), scope, key, actor.identity_id]
  );
  const boxAfter = stack.quantity - openedCount;
  const boxWrite = boxAfter === 0n
    ? await transaction.execute(
      "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
      [actor.player_id, definition.item_id, stack.version]
    )
    : await transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [boxAfter, actor.player_id, definition.item_id, stack.version]
    );
  if (boxWrite.affectedRows !== 1n) {
    throw new ApplicationError("PARADISE_BOX_OPEN_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
  }
  const pointWrite = await transaction.execute(
    "UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point' AND version = ?",
    [balanceAfter, actor.player_id, account.version]
  );
  if (pointWrite.affectedRows !== 1n) {
    throw new ApplicationError("PARADISE_BOX_OPEN_POINT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
  }

  await transaction.execute(
    "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'paradise_box_open')",
    [operation.insertId, actor.player_id, definition.item_id, -openedCount]
  );
  await transaction.execute(
    "INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'paradise_box_open')",
    [operation.insertId, actor.player_id, totalPoint, balanceAfter]
  );
  await transaction.execute(
    `INSERT INTO paradise_box_open_executions
       (operation_id, player_id, rate_version_code, requested_count, opened_count, total_point, balance_before, balance_after, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.player_id, rate.version_code, requestedCount, openedCount, totalPoint, balanceBefore, balanceAfter]
  );
  for (let index = 0; index < draws.length; index++) {
    const draw = draws[index]!;
    await transaction.execute(
      "INSERT INTO paradise_box_open_draws (operation_id, ordinal, random_value, reward_point) VALUES (?, ?, ?, ?)",
      [operation.insertId, index + 1, draw.raw.toPrecision(17), draw.point]
    );
  }
  await transaction.execute(
    "INSERT INTO paradise_box_open_grants (operation_id, player_id, currency_code, balance_before, amount, balance_after, created_at) VALUES (?, ?, 'point', ?, ?, ?, UTC_TIMESTAMP(3))",
    [operation.insertId, actor.player_id, balanceBefore, totalPoint, balanceAfter]
  );

  const detail = draws.map((draw, index) => `${index + 1}. 👹 ${comma(draw.point)}`).join("\n");
  const data = `[${actor.rank_label}]님의 극락상자👹 ${openedCount.toString()}개 오픈\n${detail}\n👹 오픈 획득 포인트: 🅟${comma(totalPoint)}획득👹`;
  const outbox = await transaction.execute(
    `INSERT INTO outbox_messages
       (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [operation.insertId, command.channelId, JSON.stringify({ data, sequence: 1 })]
  );
  await transaction.execute(
    `INSERT INTO command_executions
       (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
     VALUES (?, 'paradise_box_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [command.eventId, operation.insertId]
  );
  const audit = await transaction.execute(
    `INSERT INTO command_audit
       (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
     VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.paradise_box_open', 'success', 'Iris /극락오픈', ?, UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.identity_id, actor.player_id, JSON.stringify({
      rateVersion: rate.version_code,
      requestedCount: requestedCount.toString(),
      openedCount: openedCount.toString(),
      boxAfter: boxAfter.toString(),
      totalPoint: totalPoint.toString(),
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      drawPoints: draws.map((draw) => draw.point.toString())
    })]
  );
  const result: ParadiseBoxOpenResult = {
    status: "opened",
    playerId: actor.player_id.toString(),
    data,
    outboxId: outbox.insertId.toString(),
    auditId: audit.insertId.toString(),
    rateVersion: rate.version_code,
    requestedCount: requestedCount.toString(),
    openedCount: openedCount.toString(),
    totalPoint: totalPoint.toString(),
    balanceAfter: balanceAfter.toString(),
    drawPoints: draws.map((draw) => draw.point.toString())
  };
  await transaction.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(result), operation.insertId]
  );
  return result;
}

// MariaDB stale snapshot 충돌만 한 번 재시도합니다.
function retryable(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("code" in error && error.code === "ER_CHECKREAD") || ("errno" in error && error.errno === 1020));
}

export class MariaParadiseBoxOpenRepository implements ParadiseBoxOpenRepository {
  constructor(private readonly database: DatabaseClient) {}

  async open(
    command: ParadiseBoxOpenCommand,
    requestedCount: bigint,
    random: ParadiseBoxOpenRandomSource
  ): Promise<ParadiseBoxOpenResult> {
    try {
      return await this.database.withTransaction((transaction) => executeOpen(transaction, command, requestedCount, random));
    } catch (error) {
      if (!retryable(error)) throw error;
      return this.database.withTransaction((transaction) => executeOpen(transaction, command, requestedCount, random));
    }
  }
}
