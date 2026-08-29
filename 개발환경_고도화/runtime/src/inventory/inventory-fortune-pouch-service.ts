import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { parseInventoryFortunePouchCommand } from "./inventory-fortune-pouch-command.js";

const SAMPLE_DENOMINATOR = 0x10000000000000;
type Actor = { identity_id: bigint; player_id: bigint; rank_display: string };
type Config = { id: bigint; content_hash: string; total_weight: bigint; consume_item_id: bigint };
type Inventory = { quantity: bigint | null; version: bigint | null };
type Stack = { item_id: bigint; quantity: bigint; version: bigint };
export type InventoryFortunePouchTier = { tier_ordinal: number; weight_value: bigint; item_id: bigint; item_code: string; display_name: string; reward_quantity: bigint };
export type InventoryFortunePouchRoll = { ordinal: bigint; sample: number; tier: InventoryFortunePouchTier };
export type InventoryFortunePouchAggregate = { itemId: bigint; itemCode: string; displayName: string; quantity: bigint };
export interface InventoryFortunePouchReply { outboxId: string; room: string; data: string }
export interface InventoryFortunePouchResult {
  status: "success" | "insufficient" | "silent";
  data?: string; outboxId?: string; replies?: InventoryFortunePouchReply[]; replayed?: boolean;
  requestedCount?: string; inventoryBefore?: string; inventoryAfter?: string;
  rewards?: Array<{ itemCode: string; displayName: string; quantity: string }>;
}

// 긴 event ID를 operation unique key 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// event·player·요청 횟수·DB 확률 버전에 고정된 seed를 만듭니다.
export function createInventoryFortunePouchSeed(contentHash: string, eventId: string, playerId: string, count: bigint): string {
  return `${contentHash}|${eventKey(eventId)}|${playerId}|${count.toString()}`;
}

// seed와 회차에서 0 이상 1 미만의 결정적 표본을 계산합니다.
export function inventoryFortunePouchSample(seed: string, ordinal: bigint): number {
  const hash = createHash("sha256").update(`${seed}|${ordinal.toString()}|reward`).digest("hex");
  return Number.parseInt(hash.slice(0, 13), 16) / SAMPLE_DENOMINATOR;
}

// v2.400의 7단계 단일 표본 누적 확률을 적용합니다.
export function resolveInventoryFortunePouchRoll(sample: number, totalWeight: bigint, tiers: readonly InventoryFortunePouchTier[], ordinal = 1n): InventoryFortunePouchRoll {
  const ordered = tiers.slice().sort((a, b) => a.tier_ordinal - b.tier_ordinal);
  if (totalWeight !== 100000000n || ordered.length !== 7 || ordered.reduce((sum, tier) => sum + tier.weight_value, 0n) !== totalWeight) {
    throw new Error("복주머니 v2.400 확률 DB seed가 다릅니다.");
  }
  let cumulative = 0n;
  let selected = ordered[ordered.length - 1]!;
  for (const tier of ordered) {
    cumulative += tier.weight_value;
    if (sample < Number(cumulative) / Number(totalWeight)) { selected = tier; break; }
  }
  return { ordinal, sample, tier: selected };
}

// 첫 당첨 순서대로 보상을 합산합니다.
export function aggregateInventoryFortunePouchRolls(rolls: readonly InventoryFortunePouchRoll[]): InventoryFortunePouchAggregate[] {
  const aggregate = new Map<string, InventoryFortunePouchAggregate>();
  for (const roll of rolls) {
    const key = roll.tier.item_id.toString();
    const current = aggregate.get(key);
    if (current === undefined) aggregate.set(key, { itemId: roll.tier.item_id, itemCode: roll.tier.item_code, displayName: roll.tier.display_name, quantity: roll.tier.reward_quantity });
    else current.quantity += roll.tier.reward_quantity;
  }
  return [...aggregate.values()];
}

// v2.400의 결과 집계 순서와 줄바꿈을 보존합니다.
export function formatInventoryFortunePouchReply(rankDisplay: string, countDisplay: string, rewards: readonly InventoryFortunePouchAggregate[]): string {
  let result = `[${rankDisplay}]의 복주머니🧧(${countDisplay}회)\n\n오픈결과:\n\n`;
  for (const reward of rewards) result += `${reward.displayName} ${reward.quantity.toString()}개\n`;
  return result + "\n축하해요 복받으세용 데헷! 🎉";
}

function isRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK")));
}

// 결과·실행·감사·outbox·operation 완료를 같은 transaction에 기록합니다.
async function complete(tx: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; resultCode: string; data: string; result: InventoryFortunePouchResult; summary: Record<string, unknown> }): Promise<InventoryFortunePouchResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'INVENTORY_FORTUNE_POUCH_OPEN',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.fortune_pouch_open',?,'Iris 복주머니 개봉',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.actor.player_id, input.resultCode, JSON.stringify(input.summary)]);
  const reply = { outboxId: outbox.insertId.toString(), room: input.destinationId, data: input.data };
  const result: InventoryFortunePouchResult = { ...input.result, data: input.data, outboxId: reply.outboxId, replies: [reply], replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 복주머니 재고·7단계 RNG·다중 보상 지급을 원자적으로 처리합니다.
export class InventoryFortunePouchService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<InventoryFortunePouchResult> {
    const command = parseInventoryFortunePouchCommand(input.message);
    if (command === null) return { status: "silent" };
    const actor = (await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) return { status: "silent" };
    const scope = "inventory.fortune_pouch_open", key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async tx => {
        const prior = (await tx.query<Array<{ result_json: string | InventoryFortunePouchResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as InventoryFortunePouchResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        const siege = (await tx.query<Array<{ active: number }>>("SELECT active FROM guild_territory_wars WHERE active=TRUE LIMIT 1 FOR UPDATE"))[0];
        if (siege?.active === 1) return { status: "silent" };
        const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id])).insertId;
        await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
        const config = (await tx.query<Config[]>("SELECT config.id,config.content_hash,config.total_weight,config.consume_item_id FROM inventory_fortune_pouch_config_versions config WHERE config.status='shadow' ORDER BY config.effective_at DESC,config.id DESC LIMIT 1 FOR UPDATE"))[0];
        if (config === undefined) throw new Error("복주머니 v2.400 DB seed가 필요합니다.");
        const tiers = await tx.query<InventoryFortunePouchTier[]>(`SELECT tier.tier_ordinal,tier.weight_value,tier.item_id,item.code item_code,item.display_name,tier.reward_quantity FROM inventory_fortune_pouch_reward_tiers tier JOIN item_definitions item ON item.id=tier.item_id AND item.active=TRUE WHERE tier.config_version_id=? ORDER BY tier.tier_ordinal`, [config.id]);
        const inventory = (await tx.query<Inventory[]>("SELECT stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.id=? FOR UPDATE", [actor.player_id, config.consume_item_id]))[0];
        const held = inventory?.quantity ?? 0n;
        if (held <= 0n || command.count === null || held < command.count) {
          const data = `[${actor.rank_display}]님 복주머니🧧가 부족합니다.`;
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "insufficient", data, result: { status: "insufficient", requestedCount: command.count?.toString(), inventoryBefore: held.toString(), inventoryAfter: held.toString() }, summary: { mutation: false, sourceContract: "v2.400", parseNaN: command.count === null } });
        }
        const count = command.count;
        const seed = createInventoryFortunePouchSeed(config.content_hash, input.eventId, actor.player_id.toString(), count);
        const rolls: InventoryFortunePouchRoll[] = [];
        for (let ordinal = 1n; ordinal <= count; ordinal++) {
          const sample = inventoryFortunePouchSample(seed, ordinal);
          const roll = resolveInventoryFortunePouchRoll(sample, config.total_weight, tiers, ordinal);
          rolls.push(roll);
          await tx.execute("INSERT INTO inventory_fortune_pouch_rolls(operation_id,roll_ordinal,sample,reward_tier_ordinal,item_id,reward_quantity) VALUES (?,?,?,?,?,?)", [operationId, ordinal, sample.toFixed(19), roll.tier.tier_ordinal, roll.tier.item_id, roll.tier.reward_quantity]);
        }
        const rewards = aggregateInventoryFortunePouchRolls(rolls);
        const inventoryAfter = held - count;
        let ledgerSequence = 1;
        if (count !== 0n) {
          const changed = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [inventoryAfter, actor.player_id, config.consume_item_id, inventory?.version ?? 0n]);
          if (changed.affectedRows !== 1n) throw new Error("복주머니 재고가 먼저 변경되었습니다.");
          await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'INVENTORY_FORTUNE_POUCH_OPEN')", [operationId, ledgerSequence++, actor.player_id, config.consume_item_id, -count]);
        }
        if (rewards.length > 0) {
          const placeholders = rewards.map(() => "?").join(",");
          const stacks = await tx.query<Stack[]>(`SELECT item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id IN (${placeholders}) ORDER BY item_id FOR UPDATE`, [actor.player_id, ...rewards.map(reward => reward.itemId)]);
          const byItem = new Map(stacks.map(stack => [stack.item_id.toString(), stack]));
          for (const reward of rewards) {
            const stack = byItem.get(reward.itemId.toString());
            if (stack === undefined) await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [actor.player_id, reward.itemId, reward.quantity]);
            else {
              const changed = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [stack.quantity + reward.quantity, actor.player_id, reward.itemId, stack.version]);
              if (changed.affectedRows !== 1n) throw new Error("복주머니 보상 재고가 먼저 변경되었습니다.");
            }
            await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'INVENTORY_FORTUNE_POUCH_REWARD')", [operationId, ledgerSequence++, actor.player_id, reward.itemId, reward.quantity]);
          }
        }
        await tx.execute("INSERT INTO inventory_fortune_pouch_executions(operation_id,player_id,config_version_id,requested_count,inventory_before,inventory_after,roll_count,reward_summary_json) VALUES (?,?,?,?,?,?,?,?)", [operationId, actor.player_id, config.id, count, held, inventoryAfter, rolls.length, JSON.stringify(rewards.map(reward => ({ itemCode: reward.itemCode, displayName: reward.displayName, quantity: reward.quantity.toString() })))]);
        const data = formatInventoryFortunePouchReply(actor.rank_display, command.displayCount!, rewards);
        return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "success", data, result: { status: "success", requestedCount: count.toString(), inventoryBefore: held.toString(), inventoryAfter: inventoryAfter.toString(), rewards: rewards.map(reward => ({ itemCode: reward.itemCode, displayName: reward.displayName, quantity: reward.quantity.toString() })) }, summary: { mutation: count !== 0n || rewards.length > 0, sourceContract: "v2.400", configVersionId: config.id.toString(), contentHash: config.content_hash, requestedCount: count.toString(), rollCount: rolls.length, rngSeedHash: createHash("sha256").update(seed).digest("hex") } });
      });
    } catch (error) {
      if (!isRace(error)) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const prior = (await this.database.query<Array<{ result_json: string | InventoryFortunePouchResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as InventoryFortunePouchResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw error;
    }
  }
}
