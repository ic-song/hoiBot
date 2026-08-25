import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  EnhanceBoxOpenCommand,
  EnhanceBoxOpenRandomSource,
  EnhanceBoxOpenRepository,
  EnhanceBoxOpenResult
} from "./enhance-box-open-service.js";

const BOX_CODE = "enhance_dungeon_box";
const REWARD_CODE = "pet_enhance_stone";

interface ActorRow { identity_id: bigint; player_id: bigint; rank_label: string; }
interface RateRow { version_code: string; min_reward: bigint; max_reward: bigint; max_open_count: bigint; }
interface ItemDefinitionRow { item_id: bigint; code: string; }
interface StackRow { item_id: bigint; quantity: bigint; version: bigint; }
interface ItemRow extends ItemDefinitionRow { quantity: bigint | null; version: bigint | null; }

// 긴 provider event ID도 operation 멱등 키 제한 안에서 안정적으로 보존합니다.
function operationKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// 저장된 JSON 결과를 connector 반환 형식과 무관하게 복원합니다.
function parseStoredResult(value: string | EnhanceBoxOpenResult): EnhanceBoxOpenResult {
  return typeof value === "string" ? JSON.parse(value) as EnhanceBoxOpenResult : value;
}

// 유효 범위의 난수를 inclusive 정수 보상으로 변환합니다.
function rollReward(random: EnhanceBoxOpenRandomSource, minimum: bigint, maximum: bigint): { raw: number; reward: bigint } {
  const raw = random.next();
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_RANDOM_INVALID", "강화박스 확률 입력값이 올바르지 않습니다.", 500);
  }
  const normalized = raw === 1 ? 1 - Number.EPSILON : raw;
  const width = Number(maximum - minimum + 1n);
  return { raw, reward: minimum + BigInt(Math.floor(normalized * width)) };
}

// 단일 트랜잭션에서 강화박스 차감, 보상, RNG 증거와 발송 기록을 확정합니다.
async function executeOpen(
  transaction: DatabaseTransaction,
  command: EnhanceBoxOpenCommand,
  requestedCount: bigint,
  random: EnhanceBoxOpenRandomSource
): Promise<EnhanceBoxOpenResult> {
  const siege = await transaction.query<Array<{ active_count: bigint }>>(
    "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
  );
  if ((siege[0]?.active_count ?? 0n) > 0n) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_CASTLE_SIEGE", "성 점령전 진행 중에는 강화박스를 개봉할 수 없습니다.", 409);
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
    throw new ApplicationError("ENHANCE_BOX_OPEN_ACTOR_REQUIRED", "가입된 사용자만 강화박스를 개봉할 수 있습니다.", 409);
  }
  await transaction.query<Array<{ id: bigint }>>(
    "SELECT id FROM players WHERE id = ? FOR UPDATE",
    [actor.player_id]
  );

  const scope = `inventory.enhance-box-open:${actor.identity_id.toString()}`;
  const key = operationKey(command.eventId);
  const stored = await transaction.query<Array<{ result_json: string | EnhanceBoxOpenResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
    [scope, key]
  );
  if (stored[0]?.result_json !== undefined && stored[0].result_json !== null) {
    return { ...parseStoredResult(stored[0].result_json), duplicate: true };
  }

  const rates = await transaction.query<RateRow[]>(
    `SELECT version_code, min_reward, max_reward, max_open_count
     FROM enhance_box_open_rate_versions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1 FOR UPDATE`
  );
  const rate = rates[0];
  if (rate === undefined) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_RATE_REQUIRED", "강화박스 보상 설정을 찾을 수 없습니다.", 409);
  }
  if (requestedCount > rate.max_open_count) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_COUNT_LIMIT", `한 번에 최대 ${rate.max_open_count.toString()}개까지 개봉할 수 있습니다.`, 422);
  }

  const definitions = await transaction.query<ItemDefinitionRow[]>(
    `SELECT id AS item_id, code FROM item_definitions
     WHERE code IN (?, ?) AND active = TRUE AND stackable = TRUE ORDER BY code`,
    [BOX_CODE, REWARD_CODE]
  );
  const definitionIds = definitions.map((definition) => definition.item_id);
  const stacks = definitionIds.length === 0 ? [] : await transaction.query<StackRow[]>(
    `SELECT item_id, quantity, version FROM inventory_stacks
     WHERE player_id = ? AND item_id IN (${definitionIds.map(() => "?").join(", ")}) FOR UPDATE`,
    [actor.player_id, ...definitionIds]
  );
  const stackByItem = new Map(stacks.map((stack) => [stack.item_id.toString(), stack]));
  const items: ItemRow[] = definitions.map((definition) => {
    const stack = stackByItem.get(definition.item_id.toString());
    return { ...definition, quantity: stack?.quantity ?? null, version: stack?.version ?? null };
  });
  const itemByCode = new Map(items.map((item) => [item.code, item]));
  const box = itemByCode.get(BOX_CODE);
  const rewardItem = itemByCode.get(REWARD_CODE);
  if (box === undefined || rewardItem === undefined) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_CATALOG_REQUIRED", "강화박스 또는 펫 강화석 설정을 찾을 수 없습니다.", 409);
  }
  const boxQuantity = box.quantity ?? 0n;
  if (boxQuantity < 1n || box.version === null) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_EMPTY", "강화박스⭐가 없습니다.", 409);
  }
  const openedCount = boxQuantity < requestedCount ? boxQuantity : requestedCount;
  const draws: Array<{ raw: number; reward: bigint }> = [];
  let totalReward = 0n;
  for (let ordinal = 0n; ordinal < openedCount; ordinal++) {
    const draw = rollReward(random, rate.min_reward, rate.max_reward);
    draws.push(draw);
    totalReward += draw.reward;
  }

  const operation = await transaction.execute(
    `INSERT INTO operations
       (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
     VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', NULL, UTC_TIMESTAMP(3))`,
    [randomUUID(), scope, key, actor.identity_id]
  );
  const boxAfter = boxQuantity - openedCount;
  const boxWrite = boxAfter === 0n
    ? await transaction.execute(
      "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
      [actor.player_id, box.item_id, box.version]
    )
    : await transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [boxAfter, actor.player_id, box.item_id, box.version]
    );
  if (boxWrite.affectedRows !== 1n) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
  }

  const rewardAfter = (rewardItem.quantity ?? 0n) + totalReward;
  if (rewardItem.quantity === null || rewardItem.version === null) {
    await transaction.execute(
      "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
      [actor.player_id, rewardItem.item_id, rewardAfter]
    );
  } else {
    const rewardWrite = await transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [rewardAfter, actor.player_id, rewardItem.item_id, rewardItem.version]
    );
    if (rewardWrite.affectedRows !== 1n) {
      throw new ApplicationError("ENHANCE_BOX_OPEN_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
    }
  }

  await transaction.execute(
    "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'enhance_box_open')",
    [operation.insertId, actor.player_id, box.item_id, -openedCount]
  );
  await transaction.execute(
    "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 2, ?, ?, ?, 'enhance_box_open')",
    [operation.insertId, actor.player_id, rewardItem.item_id, totalReward]
  );
  await transaction.execute(
    `INSERT INTO enhance_box_open_executions
       (operation_id, player_id, rate_version_code, requested_count, opened_count, total_reward, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.player_id, rate.version_code, requestedCount, openedCount, totalReward]
  );
  for (let index = 0; index < draws.length; index++) {
    const draw = draws[index]!;
    await transaction.execute(
      "INSERT INTO enhance_box_open_draws (operation_id, ordinal, random_value, reward_quantity) VALUES (?, ?, ?, ?)",
      [operation.insertId, index + 1, draw.raw.toPrecision(17), draw.reward]
    );
  }

  const drawRewards = draws.map((draw) => Number(draw.reward));
  const reply = `[${actor.rank_label}]님의 강화박스⭐ ${openedCount.toString()}개를 오픈했습니다.\n펫 강화석⭐ ${totalReward.toString()}개를 획득했습니다.`;
  const outbox = await transaction.execute(
    `INSERT INTO outbox_messages
       (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [operation.insertId, command.channelId, JSON.stringify({ data: reply, sequence: 1 })]
  );
  await transaction.execute(
    `INSERT INTO command_executions
       (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
     VALUES (?, 'enhance_box_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [command.eventId, operation.insertId]
  );
  const audit = await transaction.execute(
    `INSERT INTO command_audit
       (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
     VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.enhance_box_open', 'success', 'Iris /강화박스오픈', ?, UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.identity_id, actor.player_id, JSON.stringify({
      rateVersion: rate.version_code,
      requestedCount: requestedCount.toString(),
      openedCount: openedCount.toString(),
      totalReward: totalReward.toString(),
      drawRewards,
      boxAfter: boxAfter.toString(),
      rewardAfter: rewardAfter.toString()
    })]
  );
  const result: EnhanceBoxOpenResult = {
    status: "opened",
    playerId: actor.player_id.toString(),
    data: reply,
    outboxId: outbox.insertId.toString(),
    auditId: audit.insertId.toString(),
    rateVersion: rate.version_code,
    requestedCount: requestedCount.toString(),
    openedCount: openedCount.toString(),
    totalReward: totalReward.toString(),
    drawRewards
  };
  await transaction.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(result), operation.insertId]
  );
  return result;
}

export class MariaEnhanceBoxOpenRepository implements EnhanceBoxOpenRepository {
  constructor(private readonly database: DatabaseClient) {}

  async open(
    command: EnhanceBoxOpenCommand,
    requestedCount: bigint,
    random: EnhanceBoxOpenRandomSource
  ): Promise<EnhanceBoxOpenResult> {
    try {
      return await this.database.withTransaction((transaction) => executeOpen(transaction, command, requestedCount, random));
    } catch (error) {
      const retryable = typeof error === "object" && error !== null
        && (("code" in error && error.code === "ER_CHECKREAD") || ("errno" in error && error.errno === 1020));
      if (!retryable) throw error;
      return this.database.withTransaction((transaction) => executeOpen(transaction, command, requestedCount, random));
    }
  }
}
