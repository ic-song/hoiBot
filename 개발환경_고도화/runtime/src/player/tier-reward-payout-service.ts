import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/티어보상지급";
const COMMAND_CODE = "TIER_REWARD_PAYOUT";
const SCOPE = "tier.reward_payout";
const REGULAR_TICKET = "ITEM-RWD-022";
const ADVANCED_TICKET = "tier_advanced_ticket";

type Numeric = bigint | string | number;
interface AuthorityRow { identity_id: bigint; player_id: bigint; display_name: string }
interface StoredRow { result_json: string | TierRewardPayoutResult }
interface ScoreRuleRow { item_id: bigint; code: string; score_units: Numeric }
interface RewardRuleRow { rank_no: Numeric; sequence_no: Numeric; item_id: bigint; code: string; display_name: string; quantity: Numeric }

export interface TierRewardSourceRow { playerId: bigint; displayName: string; itemCode: string; quantity: bigint }
export interface TierRewardRankRow { playerId: bigint; displayName: string; regularQuantity: bigint; advancedQuantity: bigint; score: bigint }
export interface TierRewardPolicyItem { itemCode: "pet_skill_book_fragment" | "ITEM-RWD-053"; quantity: bigint }
export interface TierRewardPayoutResult {
  status: "completed";
  periodKey: string;
  snapshotId: string;
  snapshotEntryCount: string;
  rewardedPlayerCount: string;
  grantCount: string;
  totalItemQuantity: string;
  data: string;
  notice: string;
  outboxId: string;
  noticeOutboxId: string;
}

// 티어보상지급은 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isTierRewardPayoutCommand(message: string | undefined): boolean { return message === COMMAND; }

export function normalizeTierRewardPayoutDispatchMessage(message: string): string { return isTierRewardPayoutCommand(message) ? COMMAND : message; }

// 티켓 수량과 DB 점수 규칙을 합산해 동점자를 이름과 player id 순으로 고정합니다.
export function buildTierRewardRanking(source: readonly TierRewardSourceRow[], scoreRules: ReadonlyMap<string, bigint>): TierRewardRankRow[] {
  const grouped = new Map<string, TierRewardRankRow>();
  for (const row of source) {
    const key = row.playerId.toString();
    const current = grouped.get(key) ?? { playerId: row.playerId, displayName: row.displayName, regularQuantity: 0n, advancedQuantity: 0n, score: 0n };
    const units = scoreRules.get(row.itemCode);
    if (units === undefined) throw new Error(`TIER_REWARD_SCORE_RULE_REQUIRED:${row.itemCode}`);
    if (row.itemCode === REGULAR_TICKET) current.regularQuantity += row.quantity;
    if (row.itemCode === ADVANCED_TICKET) current.advancedQuantity += row.quantity;
    current.score += row.quantity * units;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => {
    if (left.score !== right.score) return left.score > right.score ? -1 : 1;
    const name = left.displayName.localeCompare(right.displayName, "ko");
    if (name !== 0) return name;
    return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
  });
}

// 1~10위의 펫스킬북 조각과 다이아상자 보상표를 순수 정책으로 제공합니다.
export function tierRewardPolicy(rank: number): TierRewardPolicyItem[] {
  const fragment = [5n, 3n, 2n, 1n][rank - 1] ?? 0n;
  const diamond = rank >= 1 && rank <= 10 ? ([3n, 2n][rank - 1] ?? 1n) : 0n;
  const result: TierRewardPolicyItem[] = [];
  if (fragment > 0n) result.push({ itemCode: "pet_skill_book_fragment", quantity: fragment });
  if (diamond > 0n) result.push({ itemCode: "ITEM-RWD-053", quantity: diamond });
  return result;
}

// 지급 결과와 전체방 보상 알림을 legacy 문구 기준으로 만듭니다.
export function formatTierRewardPayoutMessages(periodKey: string, recipients: readonly TierRewardRankRow[], rewards: ReadonlyMap<number, readonly { displayName: string; quantity: bigint }[]>): { data: string; notice: string } {
  if (recipients.length === 0) {
    const empty = "현재 티어순위 데이터가 없어 보상을 지급할 수 없습니다.";
    return { data: empty, notice: empty };
  }
  const summary = ["🏆 티어순위 보상 지급 완료", `지급 기준: ${periodKey}`, `지급 대상: ${recipients.length}명`, ""];
  const notice = ["[보상알림]", "🎟티어 보상 지급이 완료되었습니다.🎫", "(/티어순위) 를 기준으로 1등-10등 보상됩니다.", ""];
  const medals = ["🥇", "🥈", "🥉"];
  for (let index = 0; index < recipients.length; index += 1) {
    const rank = index + 1;
    const row = recipients[index]!;
    const rewardText = (rewards.get(rank) ?? []).map((reward) => `${reward.displayName} ${reward.quantity.toLocaleString("en-US")}개`).join(", ");
    summary.push(`${rank}위 [${row.displayName}] 점수 ${row.score.toLocaleString("en-US")} - ${rewardText}`);
    notice.push(`${medals[index] ?? `${rank}위`} [${row.displayName}] - ${rewardText}`);
  }
  return { data: summary.join("\n"), notice: notice.join("\n") };
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | TierRewardPayoutResult): TierRewardPayoutResult { return typeof value === "string" ? JSON.parse(value) as TierRewardPayoutResult : value; }
function defaultKstPeriod(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

// KST 일자별 전체 순위 snapshot, 상위 10명 보상, ledger, 감사와 두 outbox를 한 transaction으로 확정합니다.
export class TierRewardPayoutService {
  public constructor(private readonly database: DatabaseClient, private readonly period: () => string = defaultKstPeriod) {}

  public async handle(input: { eventId: string; externalUserId: string; channelId?: string; destinationId?: string; message: string }): Promise<TierRewardPayoutResult> {
    if (!isTierRewardPayoutCommand(input.message)) throw new ApplicationError("TIER_REWARD_PAYOUT_COMMAND_INVALID", "정확한 /티어보상지급 명령을 입력해주세요.", 422);
    const periodKey = this.period();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) throw new Error("TIER_REWARD_PAYOUT_PERIOD_INVALID");
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const authority = await this.requireAuthority(transaction, input.externalUserId);
      await transaction.execute("INSERT IGNORE INTO tier_reward_payout_period_locks(period_key,version) VALUES (?,0)", [periodKey]);
      await transaction.query("SELECT version FROM tier_reward_payout_period_locks WHERE period_key=? FOR UPDATE", [periodKey]);
      const prior = (await transaction.query<StoredRow[]>("SELECT result_json FROM tier_reward_payout_runs WHERE period_key=? FOR UPDATE", [periodKey]))[0];
      if (prior !== undefined) return stored(prior.result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, authority.identity_id]);
      const scoreRows = await transaction.query<ScoreRuleRow[]>("SELECT rule.item_id,item.code,rule.score_units FROM tier_reward_score_rules rule JOIN item_definitions item ON item.id=rule.item_id WHERE rule.active=TRUE AND item.active=TRUE ORDER BY item.id FOR UPDATE");
      const scoreRules = new Map(scoreRows.map((row) => [row.code, BigInt(row.score_units)]));
      if (scoreRules.get(REGULAR_TICKET) !== 1n || scoreRules.get(ADVANCED_TICKET) !== 300n) throw new ApplicationError("TIER_REWARD_SCORE_RULE_INVALID", "티어 점수 규칙을 확인할 수 없습니다.", 409);
      const source = await transaction.query<Array<{ player_id: bigint; display_name: string; code: string; quantity: Numeric }>>(
        `SELECT stack.player_id,profile.current_display_name display_name,item.code,stack.quantity
         FROM inventory_stacks stack
         JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE
         JOIN players player ON player.id=stack.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=stack.player_id
         WHERE item.code IN(?,?) AND stack.quantity>0
         ORDER BY stack.player_id,item.id FOR UPDATE`, [REGULAR_TICKET, ADVANCED_TICKET]
      );
      const ranking = buildTierRewardRanking(source.map((row) => ({ playerId: BigInt(row.player_id), displayName: row.display_name, itemCode: row.code, quantity: BigInt(row.quantity) })), scoreRules);
      const snapshot = await transaction.execute("INSERT INTO tier_reward_snapshots(period_key,operation_id,source_player_count,snapshot_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [periodKey, operation.insertId, ranking.length]);
      for (let index = 0; index < ranking.length; index += 1) {
        const row = ranking[index]!;
        await transaction.execute("INSERT INTO tier_reward_snapshot_entries(snapshot_id,rank_no,player_id,display_name,regular_quantity,advanced_quantity,score) VALUES (?,?,?,?,?,?,?)", [snapshot.insertId, index + 1, row.playerId, row.displayName, row.regularQuantity, row.advancedQuantity, row.score]);
      }
      const rewardRows = await transaction.query<RewardRuleRow[]>(`SELECT rule.rank_no,rule.sequence_no,rule.item_id,item.code,item.display_name,rule.quantity FROM tier_reward_rule_items rule JOIN item_definitions item ON item.id=rule.item_id WHERE rule.active=TRUE AND item.active=TRUE AND item.stackable=TRUE ORDER BY rule.rank_no,rule.sequence_no FOR UPDATE`);
      if (rewardRows.length !== 14) throw new ApplicationError("TIER_REWARD_RULE_REQUIRED", "티어 보상 규칙 14행을 확인할 수 없습니다.", 409);
      const recipients = ranking.slice(0, 10);
      const rewardView = new Map<number, Array<{ displayName: string; quantity: bigint }>>();
      let grantCount = 0;
      let totalItemQuantity = 0n;
      for (let index = 0; index < recipients.length; index += 1) {
        const rank = index + 1;
        const recipient = recipients[index]!;
        const rankRules = rewardRows.filter((row) => Number(row.rank_no) === rank);
        if (rankRules.length === 0) throw new ApplicationError("TIER_REWARD_RANK_RULE_REQUIRED", `티어 ${rank}위 보상 규칙이 없습니다.`, 409);
        for (const rule of rankRules) {
          const quantity = BigInt(rule.quantity);
          grantCount += 1;
          totalItemQuantity += quantity;
          await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [recipient.playerId, rule.item_id, quantity]);
          const balance = (await transaction.query<Array<{ quantity: Numeric }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [recipient.playerId, rule.item_id]))[0]!.quantity;
          await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,?,'tier_reward_payout',UTC_TIMESTAMP(3))", [operation.insertId, grantCount, recipient.playerId, rule.item_id, quantity]);
          await transaction.execute("INSERT INTO tier_reward_payout_grants(operation_id,period_key,rank_no,sequence_no,player_id,item_id,quantity,balance_after,snapshot_id) VALUES (?,?,?,?,?,?,?,?,?)", [operation.insertId, periodKey, rank, grantCount, recipient.playerId, rule.item_id, quantity, balance, snapshot.insertId]);
          const view = rewardView.get(rank) ?? [];
          view.push({ displayName: rule.display_name, quantity });
          rewardView.set(rank, view);
        }
      }
      const messages = formatTierRewardPayoutMessages(periodKey, recipients, rewardView);
      const destination = input.channelId ?? input.destinationId ?? "";
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, destination, JSON.stringify({ data: messages.data })]);
      const noticeOutbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, destination, JSON.stringify({ data: messages.notice })]);
      const resultCode = recipients.length === 0 ? "empty" : "paid";
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId, resultCode]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'tier_reward_period',NULL,'tier.reward_payout',?,'Iris /티어보상지급',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, resultCode, JSON.stringify({ periodKey, snapshotId: snapshot.insertId.toString(), snapshotEntryCount: ranking.length, rewardedPlayerCount: recipients.length, grantCount, totalItemQuantity: totalItemQuantity.toString(), scoreUnits: { regular: 1, advanced: 300 } })]);
      const result: TierRewardPayoutResult = { status: "completed", periodKey, snapshotId: snapshot.insertId.toString(), snapshotEntryCount: String(ranking.length), rewardedPlayerCount: String(recipients.length), grantCount: String(grantCount), totalItemQuantity: totalItemQuantity.toString(), data: messages.data, notice: messages.notice, outboxId: outbox.insertId.toString(), noticeOutboxId: noticeOutbox.insertId.toString() };
      await transaction.execute("INSERT INTO tier_reward_payout_runs(operation_id,request_key,period_key,authority_identity_id,snapshot_id,snapshot_entry_count,rewarded_player_count,grant_count,total_item_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)", [operation.insertId, requestKey, periodKey, authority.identity_id, snapshot.insertId, ranking.length, recipients.length, grantCount, totalItemQuantity, JSON.stringify(result)]);
      await transaction.execute("UPDATE tier_reward_payout_period_locks SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE period_key=?", [periodKey]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  // legacy의 두 허용 sender 이름을 연결 identity의 DB allowlist로 확인합니다.
  private async requireAuthority(transaction: DatabaseTransaction, externalUserId: string): Promise<AuthorityRow> {
    const authority = (await transaction.query<AuthorityRow[]>(`SELECT identity.id identity_id,identity.player_id,identity.display_name FROM external_identities identity JOIN tier_reward_payout_authorities authority ON authority.display_name=identity.display_name AND authority.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.id LIMIT 1 FOR UPDATE`, [externalUserId]))[0];
    if (authority === undefined) throw new ApplicationError("TIER_REWARD_PAYOUT_FORBIDDEN", "티어 보상 지급 권한이 없습니다.", 403);
    return authority;
  }
}
