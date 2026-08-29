import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { parseInventoryWalletRngOpenCommand } from "./inventory-wallet-rng-open-command.js";

const SAMPLE_DENOMINATOR = 0x10000000000000;
const ALLSEE = "\u200b".repeat(500);
type Actor = { identity_id: bigint; player_id: bigint; rank_display: string };
type Config = { id: bigint; content_hash: string; empty_weight: bigint; total_weight: bigint; item_id: bigint };
type Account = { balance: string; version: bigint };
type Inventory = { quantity: bigint | null; version: bigint | null };
export type InventoryWalletRngPayoutTier = { tier_ordinal: number; weight_value: bigint; payout_amount: bigint; result_text: string };
export type InventoryWalletRngRoll = { ordinal: bigint; firstSample: number; secondSample: number | null; tier: InventoryWalletRngPayoutTier | null; payout: bigint };
export interface InventoryWalletRngReply { outboxId: string; room: string; data: string }
export interface InventoryWalletRngResult {
  status: "success" | "empty_stock" | "silent";
  data?: string; outboxId?: string; replies?: InventoryWalletRngReply[]; replayed?: boolean;
  requestedCount?: string; usedCount?: string; emptyCount?: string; payoutCount?: string;
  totalGain?: string; inventoryBefore?: string; inventoryAfter?: string; pointBefore?: string; pointAfter?: string;
}

// 긴 provider event ID를 operation unique key 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// event·player·요청 횟수·DB 확률 버전에 고정된 재시작 안전 seed를 만듭니다.
export function createInventoryWalletRngSeed(contentHash: string, eventId: string, playerId: string, count: bigint): string {
  return `${contentHash}|${eventKey(eventId)}|${playerId}|${count.toString()}`;
}

// seed·회차·단계에서 0 이상 1 미만의 결정적 표본을 계산합니다.
export function inventoryWalletRngSample(seed: string, ordinal: bigint, stage: "empty" | "payout"): number {
  const hash = createHash("sha256").update(`${seed}|${ordinal.toString()}|${stage}`).digest("hex");
  return Number.parseInt(hash.slice(0, 13), 16) / SAMPLE_DENOMINATOR;
}

// v2.400의 70% 빈 지갑과 성공 내부 6단계 누적 확률을 적용합니다.
export function resolveInventoryWalletRngRoll(firstSample: number, secondSample: number, emptyWeight: bigint, totalWeight: bigint, tiers: readonly InventoryWalletRngPayoutTier[], ordinal = 1n): InventoryWalletRngRoll {
  if (totalWeight !== 100000000n || emptyWeight !== 70000000n) throw new Error("호이지갑 1차 확률 DB seed가 v2.400과 다릅니다.");
  if (BigInt(Math.floor(firstSample * Number(totalWeight))) < emptyWeight) return { ordinal, firstSample, secondSample: null, tier: null, payout: 0n };
  const ordered = tiers.slice().sort((a, b) => a.tier_ordinal - b.tier_ordinal);
  const payoutWeight = ordered.reduce((sum, row) => sum + row.weight_value, 0n);
  if (ordered.length !== 6 || payoutWeight !== totalWeight) throw new Error("호이지갑 성공 내부 확률 6단계 합계가 100%가 아닙니다.");
  const scaled = BigInt(Math.floor(secondSample * Number(totalWeight)));
  let cumulative = 0n;
  let tier = ordered[ordered.length - 1]!;
  for (const row of ordered) { cumulative += row.weight_value; if (scaled < cumulative) { tier = row; break; } }
  return { ordinal, firstSample, secondSample, tier, payout: tier.payout_amount };
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function whole(value: string): bigint { return BigInt(value.split(".")[0] ?? "0"); }

// 단일·일괄 결과를 v2.400 문구와 고득점 순서로 출력합니다.
export function formatInventoryWalletRngReply(rankDisplay: string, rolls: readonly InventoryWalletRngRoll[], totalGain: bigint): string {
  if (rolls.length === 1) {
    const roll = rolls[0]!;
    const head = `[${rankDisplay}] 님이 호이의 지갑을 슬쩍 시도합니다 👛🕵️\n\n`;
    return roll.tier === null
      ? head + "앗… 텅 빈 지갑이네..? 💨 호이한테 두들겨 맞습니다!"
      : head + roll.tier.result_text + `\n🅟+${commas(roll.payout)} 포인트 겟!`;
  }
  const sorted = rolls.slice().sort((a, b) => a.payout === b.payout ? Number(a.ordinal - b.ordinal) : a.payout > b.payout ? -1 : 1);
  const lines = sorted.map((roll, index) => `${index + 1}. ${roll.tier === null ? "👛 빈 지갑… 이번 판은 꽝 💨  🅟0" : `👛 ${roll.tier.result_text}  🅟${commas(roll.payout)}`}`);
  const result = `👛 ${rolls.length}회 호이🤪 지갑털이 결과 (고득점 순 정렬) 👛\n\n총 획득 포인트: 🅟${commas(totalGain)}\n`;
  return lines.length > 10 ? result + lines.slice(0, 10).join("\n") + ALLSEE + "\n" + lines.slice(10).join("\n") : result + lines.join("\n");
}

function isRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK")));
}

// 결과·실행·감사·outbox·operation 완료를 같은 transaction에 기록합니다.
async function complete(tx: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; resultCode: string; data: string; result: InventoryWalletRngResult; summary: Record<string, unknown> }): Promise<InventoryWalletRngResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'INVENTORY_WALLET_RNG_OPEN',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.wallet_rng_open',?,'Iris 호이지갑 개봉',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.actor.player_id, input.resultCode, JSON.stringify(input.summary)]);
  const reply = { outboxId: outbox.insertId.toString(), room: input.destinationId, data: input.data };
  const result: InventoryWalletRngResult = { ...input.result, data: input.data, outboxId: reply.outboxId, replies: [reply], replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 호이지갑 재고 차감·2단계 RNG·포인트 지급을 원자적으로 처리합니다.
export class InventoryWalletRngOpenService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<InventoryWalletRngResult> {
    const command = parseInventoryWalletRngOpenCommand(input.message);
    if (command === null) return { status: "silent" };
    const actor = (await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) return { status: "silent" };
    const scope = "inventory.wallet_rng_open", key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async tx => {
        const prior = (await tx.query<Array<{ result_json: string | InventoryWalletRngResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as InventoryWalletRngResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        const siege = (await tx.query<Array<{ active: number }>>("SELECT active FROM guild_territory_wars WHERE active=TRUE LIMIT 1 FOR UPDATE"))[0];
        if (siege?.active === 1) return { status: "silent" };
        const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id])).insertId;
        await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
        const config = (await tx.query<Config[]>(`SELECT config.id,config.content_hash,config.empty_weight,config.total_weight,item.id item_id FROM inventory_wallet_rng_config_versions config JOIN item_definitions item ON item.code='ITEM-HOI-WALLET' AND item.active=TRUE WHERE config.status='shadow' ORDER BY config.effective_at DESC,config.id DESC LIMIT 1`))[0];
        if (config === undefined) throw new Error("호이지갑 v2.400 DB seed가 필요합니다.");
        const tiers = await tx.query<InventoryWalletRngPayoutTier[]>("SELECT tier_ordinal,weight_value,payout_amount,result_text FROM inventory_wallet_rng_payout_tiers WHERE config_version_id=? ORDER BY tier_ordinal", [config.id]);
        const inventory = (await tx.query<Inventory[]>("SELECT stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.id=? FOR UPDATE", [actor.player_id, config.item_id]))[0];
        const held = inventory?.quantity ?? 0n;
        if (held <= 0n) {
          const data = "형법 제333조(개노답): 재물을 강취하거나 재산상 이익을 취득하면 3년 동안 호이한테 두들겨 맞음";
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "empty_stock", data, result: { status: "empty_stock", requestedCount: command.requestedCount.toString(), usedCount: "0", inventoryBefore: "0", inventoryAfter: "0" }, summary: { mutation: false, sourceContract: "v2.400" } });
        }
        const used = command.requestedCount < held ? command.requestedCount : held;
        const seed = createInventoryWalletRngSeed(config.content_hash, input.eventId, actor.player_id.toString(), command.requestedCount);
        const rolls: InventoryWalletRngRoll[] = [];
        let totalGain = 0n, emptyCount = 0n;
        for (let ordinal = 1n; ordinal <= used; ordinal++) {
          const firstSample = inventoryWalletRngSample(seed, ordinal, "empty");
          const secondSample = inventoryWalletRngSample(seed, ordinal, "payout");
          const roll = resolveInventoryWalletRngRoll(firstSample, secondSample, config.empty_weight, config.total_weight, tiers, ordinal);
          rolls.push(roll); totalGain += roll.payout; if (roll.tier === null) emptyCount++;
          await tx.execute("INSERT INTO inventory_wallet_rng_rolls(operation_id,roll_ordinal,first_sample,second_sample,payout_tier_ordinal,payout_amount,result_code) VALUES (?,?,?,?,?,?,?)", [operationId, ordinal, firstSample.toFixed(19), roll.secondSample?.toFixed(19) ?? null, roll.tier?.tier_ordinal ?? null, roll.payout, roll.tier === null ? "empty" : "payout"]);
        }
        const inventoryAfter = held - used;
        const inventoryWrite = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [inventoryAfter, actor.player_id, config.item_id, inventory?.version ?? 0n]);
        if (inventoryWrite.affectedRows !== 1n) throw new Error("호이지갑 재고가 먼저 변경되었습니다.");
        await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'INVENTORY_WALLET_RNG_OPEN')", [operationId, actor.player_id, config.item_id, -used]);
        await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [actor.player_id]);
        const account = (await tx.query<Account[]>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0]!;
        const pointBefore = whole(account.balance), pointAfter = pointBefore + totalGain;
        if (totalGain > 0n) {
          const pointWrite = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [pointAfter.toString(), actor.player_id, account.version]);
          if (pointWrite.affectedRows !== 1n) throw new Error("포인트 정보가 먼저 변경되었습니다.");
          await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'INVENTORY_WALLET_RNG_OPEN_REWARD')", [operationId, actor.player_id, totalGain.toString(), pointAfter.toString()]);
        }
        await tx.execute("INSERT INTO inventory_wallet_rng_executions(operation_id,player_id,config_version_id,requested_count,used_count,empty_count,payout_count,total_payout,inventory_before,inventory_after,point_before,point_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [operationId, actor.player_id, config.id, command.requestedCount, used, emptyCount, used - emptyCount, totalGain, held, inventoryAfter, pointBefore.toString(), pointAfter.toString()]);
        const data = formatInventoryWalletRngReply(actor.rank_display, rolls, totalGain);
        return complete(tx, {
          operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "success", data,
          result: { status: "success", requestedCount: command.requestedCount.toString(), usedCount: used.toString(), emptyCount: emptyCount.toString(), payoutCount: (used - emptyCount).toString(), totalGain: totalGain.toString(), inventoryBefore: held.toString(), inventoryAfter: inventoryAfter.toString(), pointBefore: pointBefore.toString(), pointAfter: pointAfter.toString() },
          summary: { mutation: true, sourceContract: "v2.400", configVersionId: config.id.toString(), contentHash: config.content_hash, requestedCount: command.requestedCount.toString(), usedCount: used.toString(), emptyCount: emptyCount.toString(), payoutCount: (used - emptyCount).toString(), totalGain: totalGain.toString(), rngSeedHash: createHash("sha256").update(seed).digest("hex") }
        });
      });
    } catch (error) {
      if (!isRace(error)) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const prior = (await this.database.query<Array<{ result_json: string | InventoryWalletRngResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as InventoryWalletRngResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw error;
    }
  }
}
