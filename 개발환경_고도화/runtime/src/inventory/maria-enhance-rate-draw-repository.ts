import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  EnhanceRateDrawCommand,
  EnhanceRateDrawRandomSource,
  EnhanceRateDrawRepository,
  EnhanceRateDrawResult
} from "./enhance-rate-draw-service.js";

const TICKET_CODE = "enhance_rate_draw_ticket";

interface ActorRow { identity_id: bigint; player_id: bigint; rank_label: string; }
interface RateRow { version_code: string; max_draw_count: bigint; }
interface RewardRow {
  item_id: bigint;
  item_code: string;
  display_name: string;
  draw_order: bigint;
  upper_bound_bps: bigint;
  output_sort: bigint;
}
interface DefinitionRow { item_id: bigint; code: string; }
interface StackRow { item_id: bigint; quantity: bigint; version: bigint; }

// provider event ID를 operation 멱등 키 길이 안에서 안정적으로 정규화합니다.
function operationKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// 저장된 결과 JSON을 connector 반환 형식과 무관하게 복원합니다.
function parseStored(value: string | EnhanceRateDrawResult): EnhanceRateDrawResult {
  return typeof value === "string" ? JSON.parse(value) as EnhanceRateDrawResult : value;
}

// 0~1 난수를 버전 고정 basis-point 확률 구간의 보상으로 변환합니다.
function selectReward(random: EnhanceRateDrawRandomSource, rewards: RewardRow[]): { raw: number; reward: RewardRow } {
  const raw = random.next();
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_RANDOM_INVALID", "강화 확률 입력값이 올바르지 않습니다.", 500);
  }
  const normalized = raw === 1 ? 1 - Number.EPSILON : raw;
  const point = BigInt(Math.floor(normalized * 10_000));
  const reward = rewards.find((candidate) => point < candidate.upper_bound_bps);
  if (reward === undefined) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_RATE_INVALID", "강화 확률표 구간이 완전하지 않습니다.", 500);
  }
  return { raw, reward };
}

// 강화 확률 뽑기의 소비, 지급, draw 증거와 두 단계 발송을 한 트랜잭션으로 확정합니다.
async function executeDraw(
  transaction: DatabaseTransaction,
  command: EnhanceRateDrawCommand,
  requestedCount: bigint,
  random: EnhanceRateDrawRandomSource
): Promise<EnhanceRateDrawResult> {
  const actors = await transaction.query<ActorRow[]>(
    `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
     FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
     WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
       AND identity.player_id IS NOT NULL FOR UPDATE`,
    [command.externalUserId]
  );
  const actor = actors[0];
  if (actor === undefined) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_ACTOR_REQUIRED", "가입된 사용자만 강화뽑기를 이용할 수 있습니다.", 409);
  }
  await transaction.query<Array<{ id: bigint }>>("SELECT id FROM players WHERE id = ? FOR UPDATE", [actor.player_id]);

  const scope = `inventory.enhance-rate-draw:${actor.identity_id.toString()}`;
  const key = operationKey(command.eventId);
  const stored = await transaction.query<Array<{ result_json: string | EnhanceRateDrawResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
    [scope, key]
  );
  if (stored[0]?.result_json !== undefined && stored[0].result_json !== null) {
    return { ...parseStored(stored[0].result_json), duplicate: true };
  }

  const rates = await transaction.query<RateRow[]>(
    `SELECT version_code, max_draw_count FROM enhance_rate_draw_versions
     WHERE status = 'published' ORDER BY published_at DESC LIMIT 1 FOR UPDATE`
  );
  const rate = rates[0];
  if (rate === undefined) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_RATE_REQUIRED", "강화뽑기 확률표를 찾을 수 없습니다.", 409);
  }
  if (requestedCount > rate.max_draw_count) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_COUNT_LIMIT", `한 번에 최대 ${rate.max_draw_count.toString()}회까지 뽑을 수 있습니다.`, 422);
  }
  const rewardRows = await transaction.query<RewardRow[]>(
    `SELECT item.id AS item_id, item.code AS item_code, item.display_name,
            reward.draw_order, reward.upper_bound_bps, reward.output_sort
     FROM enhance_rate_draw_rewards reward JOIN item_definitions item ON item.code = reward.item_code
     WHERE reward.version_code = ? AND item.active = TRUE AND item.stackable = TRUE
     ORDER BY reward.draw_order`,
    [rate.version_code]
  );
  const rewards = rewardRows.map((reward) => ({
    ...reward,
    upper_bound_bps: BigInt(reward.upper_bound_bps),
    output_sort: BigInt(reward.output_sort)
  }));
  if (rewards.length === 0 || rewards.at(-1)?.upper_bound_bps !== 10_000n) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_RATE_INVALID", "강화뽑기 확률표 구간이 완전하지 않습니다.", 409);
  }
  const ticketDefinitions = await transaction.query<DefinitionRow[]>(
    "SELECT id AS item_id, code FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE",
    [TICKET_CODE]
  );
  const ticket = ticketDefinitions[0];
  if (ticket === undefined) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_CATALOG_REQUIRED", "강화확률뽑기 티켓 설정을 찾을 수 없습니다.", 409);
  }

  const itemIds = [ticket.item_id, ...rewards.map((reward) => reward.item_id)];
  const stacks = await transaction.query<StackRow[]>(
    `SELECT item_id, quantity, version FROM inventory_stacks
     WHERE player_id = ? AND item_id IN (${itemIds.map(() => "?").join(", ")}) FOR UPDATE`,
    [actor.player_id, ...itemIds]
  );
  const stackByItem = new Map(stacks.map((stack) => [stack.item_id.toString(), stack]));
  const ticketStack = stackByItem.get(ticket.item_id.toString());
  if (ticketStack === undefined || ticketStack.quantity < requestedCount) {
    throw new ApplicationError(
      "ENHANCE_RATE_DRAW_TICKET_SHORTAGE",
      `강화확률뽑기⚒️(/강화뽑기)가 ${requestedCount.toString()}개 필요합니다.`,
      409
    );
  }

  const draws: Array<{ raw: number; reward: RewardRow }> = [];
  const counts = new Map<string, bigint>();
  for (let ordinal = 0n; ordinal < requestedCount; ordinal++) {
    const draw = selectReward(random, rewards);
    draws.push(draw);
    counts.set(draw.reward.item_code, (counts.get(draw.reward.item_code) ?? 0n) + 1n);
  }

  const operation = await transaction.execute(
    `INSERT INTO operations
       (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
     VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', NULL, UTC_TIMESTAMP(3))`,
    [randomUUID(), scope, key, actor.identity_id]
  );
  const ticketAfter = ticketStack.quantity - requestedCount;
  const ticketWrite = ticketAfter === 0n
    ? await transaction.execute(
      "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
      [actor.player_id, ticket.item_id, ticketStack.version]
    )
    : await transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [ticketAfter, actor.player_id, ticket.item_id, ticketStack.version]
    );
  if (ticketWrite.affectedRows !== 1n) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
  }
  await transaction.execute(
    "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'enhance_rate_draw')",
    [operation.insertId, actor.player_id, ticket.item_id, -requestedCount]
  );

  let sequence = 1;
  const outputRewards = [...rewards].sort((left, right) => Number(left.output_sort - right.output_sort));
  for (const reward of outputRewards) {
    const count = counts.get(reward.item_code) ?? 0n;
    if (count === 0n) continue;
    const stack = stackByItem.get(reward.item_id.toString());
    const after = (stack?.quantity ?? 0n) + count;
    if (stack === undefined) {
      await transaction.execute(
        "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
        [actor.player_id, reward.item_id, after]
      );
    } else {
      const write = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [after, actor.player_id, reward.item_id, stack.version]
      );
      if (write.affectedRows !== 1n) {
        throw new ApplicationError("ENHANCE_RATE_DRAW_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
    }
    sequence++;
    await transaction.execute(
      "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'enhance_rate_draw')",
      [operation.insertId, sequence, actor.player_id, reward.item_id, count]
    );
  }

  await transaction.execute(
    `INSERT INTO enhance_rate_draw_executions
       (operation_id, player_id, rate_version_code, requested_count, status, created_at)
     VALUES (?, ?, ?, ?, 'completed', UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.player_id, rate.version_code, requestedCount]
  );
  for (let index = 0; index < draws.length; index++) {
    const draw = draws[index]!;
    await transaction.execute(
      `INSERT INTO enhance_rate_draws
         (operation_id, ordinal, random_value, reward_item_id, reward_code_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
      [operation.insertId, index + 1, draw.raw.toPrecision(17), draw.reward.item_id, draw.reward.item_code]
    );
  }

  const opening = `[${actor.rank_label}]님의 강화뽑기 ${requestedCount.toString()}회를 시작합니다.`;
  const resultLines = outputRewards
    .filter((reward) => (counts.get(reward.item_code) ?? 0n) > 0n)
    .map((reward) => `${reward.display_name} x${counts.get(reward.item_code)!.toString()}`);
  const resultData = `[${actor.rank_label}]님의 강화뽑기 결과\n${resultLines.join("\n")}`;
  const openingOutbox = await transaction.execute(
    `INSERT INTO outbox_messages
       (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [operation.insertId, command.channelId, JSON.stringify({ data: opening, sequence: 1 })]
  );
  const resultOutbox = await transaction.execute(
    `INSERT INTO outbox_messages
       (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 800000 MICROSECOND), UTC_TIMESTAMP(3))`,
    [operation.insertId, command.channelId, JSON.stringify({ data: resultData, sequence: 2, delayMs: 800 })]
  );
  await transaction.execute(
    `INSERT INTO command_executions
       (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
     VALUES (?, 'enhance_rate_draw', ?, 'completed', 'replies_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [command.eventId, operation.insertId]
  );
  const rewardCounts = Object.fromEntries([...counts].map(([code, count]) => [code, count.toString()]));
  const audit = await transaction.execute(
    `INSERT INTO command_audit
       (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
     VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.enhance_rate_draw', 'success', 'Iris /강화뽑기', ?, UTC_TIMESTAMP(3))`,
    [operation.insertId, actor.identity_id, actor.player_id, JSON.stringify({
      rateVersion: rate.version_code,
      requestedCount: requestedCount.toString(),
      ticketAfter: ticketAfter.toString(),
      rewardCounts,
      drawRewardCodes: draws.map((draw) => draw.reward.item_code),
      resultDelayMs: 800
    })]
  );
  const result: EnhanceRateDrawResult = {
    status: "drawn",
    playerId: actor.player_id.toString(),
    data: opening,
    resultData,
    outboxId: openingOutbox.insertId.toString(),
    resultOutboxId: resultOutbox.insertId.toString(),
    auditId: audit.insertId.toString(),
    rateVersion: rate.version_code,
    requestedCount: requestedCount.toString(),
    drawRewardCodes: draws.map((draw) => draw.reward.item_code),
    rewardCounts
  };
  await transaction.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(result), operation.insertId]
  );
  return result;
}

export class MariaEnhanceRateDrawRepository implements EnhanceRateDrawRepository {
  constructor(private readonly database: DatabaseClient) {}

  async draw(
    command: EnhanceRateDrawCommand,
    requestedCount: bigint,
    random: EnhanceRateDrawRandomSource
  ): Promise<EnhanceRateDrawResult> {
    try {
      return await this.database.withTransaction((transaction) => executeDraw(transaction, command, requestedCount, random));
    } catch (error) {
      const retryable = typeof error === "object" && error !== null
        && (("code" in error && error.code === "ER_CHECKREAD") || ("errno" in error && error.errno === 1020));
      if (!retryable) throw error;
      return this.database.withTransaction((transaction) => executeDraw(transaction, command, requestedCount, random));
    }
  }
}
