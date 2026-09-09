import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/연금지급";
const COMMAND_CODE = "MINI_PET_RANK_REWARD_PAYOUT";
const SCOPE = "mini_pet.rank_reward_payout";
const ITEM_CODE = "pet_enhance_stone";
const ALL_SEE = "\u200b".repeat(500);

type Numeric = bigint | string | number;
interface AuthorityRow { identity_id: bigint; player_id: bigint; display_name: string }
interface StoredRow { result_json: string | MiniPetRankRewardPayoutResult }
interface RuleRow { rank_start: Numeric; rank_end: Numeric; reward_quantity: Numeric }
interface ItemRow { id: bigint }

export interface MiniPetRankSourceRow {
  ownedId: bigint;
  playerId: bigint;
  displayName: string;
  equipped: boolean;
  battleExperience: bigint;
}

export interface MiniPetRankRow {
  playerId: bigint;
  displayName: string;
  equippedCharm: bigint;
  bagCharm: bigint;
  bagPetCount: number;
  totalCharm: bigint;
}

export interface MiniPetRankRewardPayoutResult {
  status: "paid";
  periodKey: string;
  snapshotId: string;
  snapshotEntryCount: string;
  rewardedPlayerCount: string;
  totalRewardQuantity: string;
  data: string;
  notice: string;
  outboxId: string;
  noticeOutboxId: string;
}

// 연금지급은 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isMiniPetRankRewardPayoutCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

export function normalizeMiniPetRankRewardPayoutDispatchMessage(message: string): string {
  return isMiniPetRankRewardPayoutCommand(message) ? COMMAND : message;
}

// 장착 1마리와 가방 경험치 상위 10마리 합계를 고정 순서로 계산합니다.
export function buildMiniPetRankRows(source: readonly MiniPetRankSourceRow[]): MiniPetRankRow[] {
  const grouped = new Map<string, MiniPetRankSourceRow[]>();
  for (const row of source) {
    const key = row.playerId.toString();
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }
  const ranked: MiniPetRankRow[] = [];
  for (const rows of grouped.values()) {
    const stable = [...rows].sort((left, right) => left.ownedId < right.ownedId ? -1 : left.ownedId > right.ownedId ? 1 : 0);
    const equipped = stable.find((row) => row.equipped);
    const bag = stable.filter((row) => !row.equipped).sort((left, right) => {
      if (left.battleExperience !== right.battleExperience) return left.battleExperience > right.battleExperience ? -1 : 1;
      return left.ownedId < right.ownedId ? -1 : left.ownedId > right.ownedId ? 1 : 0;
    });
    const topBag = bag.slice(0, 10);
    const equippedCharm = equipped?.battleExperience ?? 0n;
    const bagCharm = topBag.reduce((sum, row) => sum + row.battleExperience, 0n);
    ranked.push({
      playerId: stable[0]!.playerId,
      displayName: stable[0]!.displayName,
      equippedCharm,
      bagCharm,
      bagPetCount: bag.length,
      totalCharm: equippedCharm + bagCharm
    });
  }
  return ranked.sort((left, right) => {
    if (left.totalCharm !== right.totalCharm) return left.totalCharm > right.totalCharm ? -1 : 1;
    const name = left.displayName.localeCompare(right.displayName, "ko");
    if (name !== 0) return name;
    return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
  });
}

// legacy 1~200위 펫 강화석 보상표를 순수 정책으로 제공합니다.
export function miniPetRankRewardQuantity(rank: number): bigint {
  const fixed = [40n, 30n, 25n, 24n, 23n, 22n, 21n, 20n, 19n, 18n];
  if (rank >= 1 && rank <= 10) return fixed[rank - 1]!;
  if (rank >= 11 && rank <= 170) return BigInt(18 - Math.floor((rank - 1) / 10));
  if (rank >= 171 && rank <= 200) return 1n;
  return 0n;
}

// 상위 10명 뒤 allsee를 두고 지급 순위와 합계를 운영자에게 보여줍니다.
export function formatMiniPetRankRewardReply(periodKey: string, rows: readonly MiniPetRankRow[], rewards: readonly bigint[]): string {
  const lines = ["🏆 미니펫 순위 연금 지급 완료", `지급 기준: ${periodKey}`, `지급 대상: ${rewards.length}명`, ""];
  for (let index = 0; index < rewards.length; index += 1) {
    if (index === 10) lines.push(ALL_SEE);
    const row = rows[index]!;
    lines.push(`${index + 1}위 [${row.displayName}] 매력도 ${row.totalCharm.toLocaleString("en-US")} - 펫 강화석⭐ ${rewards[index]!.toLocaleString("en-US")}개`);
  }
  if (rewards.length === 0) lines.push("지급 대상자가 없습니다.");
  lines.push("", `총 지급: 펫 강화석⭐ ${rewards.reduce((sum, value) => sum + value, 0n).toLocaleString("en-US")}개`);
  return lines.join("\n");
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | MiniPetRankRewardPayoutResult): MiniPetRankRewardPayoutResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetRankRewardPayoutResult : value;
}

function defaultKstPeriod(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// KST 일자별 snapshot, 200명 보상, ledger, 감사와 두 outbox를 한 transaction으로 확정합니다.
export class MiniPetRankRewardPayoutService {
  public constructor(private readonly database: DatabaseClient, private readonly period: () => string = defaultKstPeriod) {}

  public async handle(input: { eventId: string; externalUserId: string; channelId?: string; destinationId?: string; message: string }): Promise<MiniPetRankRewardPayoutResult> {
    if (!isMiniPetRankRewardPayoutCommand(input.message)) {
      throw new ApplicationError("MINI_PET_RANK_REWARD_COMMAND_INVALID", "정확한 /연금지급 명령을 입력해주세요.", 422);
    }
    const periodKey = this.period();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) throw new Error("MINI_PET_RANK_REWARD_PERIOD_INVALID");
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const authority = await this.requireAuthority(transaction, input.externalUserId);
      await transaction.execute("INSERT IGNORE INTO mini_pet_rank_reward_period_locks(period_key,version) VALUES (?,0)", [periodKey]);
      await transaction.query("SELECT version FROM mini_pet_rank_reward_period_locks WHERE period_key=? FOR UPDATE", [periodKey]);
      const prior = (await transaction.query<StoredRow[]>("SELECT result_json FROM mini_pet_rank_reward_runs WHERE period_key=? FOR UPDATE", [periodKey]))[0];
      if (prior !== undefined) return stored(prior.result_json);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, requestKey, authority.identity_id]
      );
      const source = await transaction.query<Array<{ owned_id: bigint; player_id: bigint; display_name: string; equipped: Numeric; battle_experience: Numeric }>>(
        `SELECT pet.id owned_id,pet.player_id,profile.current_display_name display_name,pet.equipped,pet.battle_experience
         FROM owned_mini_pets pet
         JOIN players player ON player.id=pet.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=pet.player_id
         ORDER BY pet.player_id,pet.id FOR UPDATE`
      );
      const ranking = buildMiniPetRankRows(source.map((row) => ({
        ownedId: BigInt(row.owned_id), playerId: BigInt(row.player_id), displayName: row.display_name,
        equipped: Number(row.equipped) === 1, battleExperience: BigInt(row.battle_experience)
      })));
      const snapshot = await transaction.execute(
        "INSERT INTO mini_pet_rank_reward_snapshots(period_key,operation_id,source_player_count,snapshot_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
        [periodKey, operation.insertId, ranking.length]
      );
      for (let index = 0; index < ranking.length; index += 1) {
        const row = ranking[index]!;
        await transaction.execute(
          "INSERT INTO mini_pet_rank_reward_snapshot_entries(snapshot_id,rank_no,player_id,display_name,equipped_charm,bag_charm,bag_pet_count,total_charm) VALUES (?,?,?,?,?,?,?,?)",
          [snapshot.insertId, index + 1, row.playerId, row.displayName, row.equippedCharm, row.bagCharm, row.bagPetCount, row.totalCharm]
        );
      }

      const item = (await transaction.query<ItemRow[]>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE FOR UPDATE", [ITEM_CODE]))[0];
      if (item === undefined) throw new ApplicationError("MINI_PET_RANK_REWARD_ITEM_REQUIRED", "펫 강화석 정의를 확인할 수 없습니다.", 409);
      const rules = await transaction.query<RuleRow[]>("SELECT rank_start,rank_end,reward_quantity FROM mini_pet_rank_reward_rules WHERE active=TRUE ORDER BY rank_start FOR UPDATE");
      const recipients = ranking.slice(0, 200);
      const rewards: bigint[] = [];
      let total = 0n;
      for (let index = 0; index < recipients.length; index += 1) {
        const rank = index + 1;
        const rule = rules.find((candidate) => rank >= Number(candidate.rank_start) && rank <= Number(candidate.rank_end));
        if (rule === undefined) throw new ApplicationError("MINI_PET_RANK_REWARD_RULE_REQUIRED", `미니펫 연금 ${rank}위 보상 규칙이 없습니다.`, 409);
        const quantity = BigInt(rule.reward_quantity);
        const recipient = recipients[index]!;
        rewards.push(quantity);
        total += quantity;
        await transaction.execute(
          "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1",
          [recipient.playerId, item.id, quantity]
        );
        const balance = (await transaction.query<Array<{ quantity: Numeric }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [recipient.playerId, item.id]))[0]!.quantity;
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,?,'mini_pet_rank_reward_payout',UTC_TIMESTAMP(3))",
          [operation.insertId, rank, recipient.playerId, item.id, quantity]
        );
        await transaction.execute(
          "INSERT INTO mini_pet_rank_reward_grants(operation_id,period_key,rank_no,player_id,item_id,reward_quantity,balance_after,snapshot_id) VALUES (?,?,?,?,?,?,?,?)",
          [operation.insertId, periodKey, rank, recipient.playerId, item.id, quantity, balance, snapshot.insertId]
        );
      }

      const data = formatMiniPetRankRewardReply(periodKey, recipients, rewards);
      const notice = `📢 ${periodKey} 미니펫 순위 연금 지급이 완료되었습니다.\n지급 대상: ${recipients.length}명\n총 지급: 펫 강화석⭐ ${total.toLocaleString("en-US")}개`;
      const destination = input.channelId ?? input.destinationId ?? "";
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, destination, JSON.stringify({ data })]
      );
      const noticeOutbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, destination, JSON.stringify({ data: notice })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','paid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, COMMAND_CODE, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'mini_pet_rank_period',NULL,'mini_pet.rank_reward_payout','paid','Iris /연금지급',?,UTC_TIMESTAMP(3))",
        [operation.insertId, authority.identity_id, JSON.stringify({ periodKey, snapshotId: snapshot.insertId.toString(), snapshotEntryCount: ranking.length, rewardedPlayerCount: recipients.length, totalRewardQuantity: total.toString(), itemCode: ITEM_CODE })]
      );
      const result: MiniPetRankRewardPayoutResult = {
        status: "paid", periodKey, snapshotId: snapshot.insertId.toString(), snapshotEntryCount: String(ranking.length),
        rewardedPlayerCount: String(recipients.length), totalRewardQuantity: total.toString(), data, notice,
        outboxId: outbox.insertId.toString(), noticeOutboxId: noticeOutbox.insertId.toString()
      };
      await transaction.execute(
        "INSERT INTO mini_pet_rank_reward_runs(operation_id,request_key,period_key,authority_identity_id,snapshot_id,snapshot_entry_count,rewarded_player_count,total_reward_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?)",
        [operation.insertId, requestKey, periodKey, authority.identity_id, snapshot.insertId, ranking.length, recipients.length, total, JSON.stringify(result)]
      );
      await transaction.execute("UPDATE mini_pet_rank_reward_period_locks SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE period_key=?", [periodKey]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  // legacy의 두 허용 sender 이름을 연결 identity의 DB allowlist로 확인합니다.
  private async requireAuthority(transaction: DatabaseTransaction, externalUserId: string): Promise<AuthorityRow> {
    const authority = (await transaction.query<AuthorityRow[]>(
      `SELECT identity.id identity_id,identity.player_id,identity.display_name
       FROM external_identities identity
       JOIN mini_pet_rank_reward_authorities authority ON authority.display_name=identity.display_name AND authority.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY identity.id LIMIT 1 FOR UPDATE`, [externalUserId]
    ))[0];
    if (authority === undefined) throw new ApplicationError("MINI_PET_RANK_REWARD_FORBIDDEN", "연금 지급 권한이 없습니다.", 403);
    return authority;
  }
}
