import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { PlayerOverallRankReadService, type PlayerOverallRankRow } from "../player/player-overall-rank-read-service.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/보상지급";
const COMMAND_CODE = "OVERALL_RANK_REWARD_PAYOUT";
const POLICY_KEY = "daily_overall_rank";
const REWARD_TYPE = "overall";
const SCOPE = "admin.overall_rank_reward.payout";
const ALLSEE = "\u200b".repeat(500);

type Numeric = bigint | string | number;
interface AuthorityRow { operator_id: Numeric; identity_id: Numeric }
interface PolicyRow { policy_version: Numeric; item_id: Numeric; item_code: string; item_display_name: string; maximum_rank: number }
interface RuleRow { rank_start: Numeric; rank_end: Numeric; reward_quantity: Numeric }
interface StoredRow { result_json: string | OverallRankRewardPayoutResult }

export interface OverallRankRewardPayoutResult {
  status: "paid";
  operationId: string;
  periodKey: string;
  rewardType: string;
  snapshotId: string;
  snapshotVersion: string;
  snapshotInputHash: string;
  policyVersion: string;
  itemCode: string;
  itemDisplayName: string;
  eligiblePlayerCount: number;
  recipientCount: number;
  totalRewardQuantity: string;
  data: string;
  notice: string;
  outboxIds: string[];
}

export type OverallRankRewardPayoutIrisResult =
  | { status: "changed"; data: string; outboxId: string }
  | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

// 종합 순위 보상은 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isOverallRankRewardPayoutCommand(message: string | undefined): boolean { return message === COMMAND; }

// snapshot 순서와 rank별 수량을 10위 allsee 경계로 직렬화합니다.
export function formatOverallRankRewardPayout(periodKey: string, itemDisplayName: string, rows: readonly PlayerOverallRankRow[], rewards: readonly bigint[]): string {
  const total = rewards.reduce((sum, value) => sum + value, 0n);
  const lines = ["🏆 종합 순위 보상 지급 완료", `지급 기준: ${periodKey}`, `지급 대상: ${rewards.length}명`, ""];
  for (let index = 0; index < rewards.length; index += 1) {
    if (index === 10) lines.push(ALLSEE);
    lines.push(`${index + 1}위 [${rows[index]!.displayName}] - ${itemDisplayName} ${rewards[index]!.toLocaleString("en-US")}개`);
  }
  if (rewards.length === 0) lines.push("지급 대상자가 없습니다.");
  lines.push("", `총 지급: ${itemDisplayName} ${total.toLocaleString("en-US")}개`);
  return lines.join("\n");
}

// 공식 종합순위 계산을 snapshot으로 고정해 최대 150명 보상을 기간별 한 번 지급합니다.
export class OverallRankRewardPayoutService {
  public constructor(private readonly database: DatabaseClient, private readonly period: () => string = defaultKstPeriod) {}

  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<OverallRankRewardPayoutIrisResult> {
    if (!isOverallRankRewardPayoutCommand(input.message)) return { status: "legacy_fallback" };
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || !rollout.enabled || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.payout(input);
    return { status: "changed", data: result.data, outboxId: result.outboxIds[0] ?? "" };
  }

  public async payout(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<OverallRankRewardPayoutResult> {
    if (!isOverallRankRewardPayoutCommand(input.message)) throw new ApplicationError("OVERALL_RANK_REWARD_COMMAND_INVALID", "정확한 /보상지급 명령을 입력해주세요.", 422);
    const periodKey = this.period();
    assertPeriod(periodKey);
    return this.database.withTransaction(async (transaction) => {
      const authority = await this.requireAuthority(transaction, input.externalUserId);
      await transaction.execute("INSERT IGNORE INTO overall_rank_reward_period_locks(period_key,reward_type,version) VALUES (?,?,0)", [periodKey, REWARD_TYPE]);
      await transaction.query("SELECT version FROM overall_rank_reward_period_locks WHERE period_key=? AND reward_type=? FOR UPDATE", [periodKey, REWARD_TYPE]);
      const prior = (await transaction.query<StoredRow[]>("SELECT result_json FROM overall_rank_reward_runs WHERE period_key=? AND reward_type=? FOR UPDATE", [periodKey, REWARD_TYPE]))[0];
      if (prior !== undefined) return stored(prior.result_json);

      const policy = await this.requirePolicy(transaction);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, key(input.eventId), authority.identity_id]
      );
      const ranking = await new PlayerOverallRankReadService(this.database).loadRankingRows(transaction);
      const recipients = ranking.slice(0, policy.maximum_rank);
      const inputHash = createHash("sha256").update(JSON.stringify(ranking.map((row) => [row.playerId,row.sourceOrder,row.totalCharm,row.castleCharm,row.raidCharm,row.effectiveEnhancement]))).digest("hex");
      const snapshot = await transaction.execute(
        "INSERT INTO overall_rank_reward_snapshots(operation_id,snapshot_version,input_hash,policy_version,eligible_player_count,entry_count,snapshot_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))",
        [operation.insertId, operation.insertId, inputHash, policy.policy_version, ranking.length, recipients.length]
      );
      for (let index = 0; index < recipients.length; index += 1) {
        const row = recipients[index]!;
        await transaction.execute(
          "INSERT INTO overall_rank_reward_snapshot_entries(snapshot_id,ordinal_value,player_id,display_name_snapshot,source_order,total_charm,castle_charm,raid_charm,effective_enhancement) VALUES (?,?,?,?,?,?,?,?,?)",
          [snapshot.insertId, index + 1, row.playerId, row.displayName, row.sourceOrder, row.totalCharm, row.castleCharm, row.raidCharm, row.effectiveEnhancement]
        );
      }
      const rules = await transaction.query<RuleRow[]>("SELECT rank_start,rank_end,reward_quantity FROM overall_rank_reward_rules WHERE policy_version=? ORDER BY rank_start FOR UPDATE", [policy.policy_version]);
      const rewards: bigint[] = [];
      let total = 0n;
      for (let index = 0; index < recipients.length; index += 1) {
        const rank = index + 1;
        const matches = rules.filter((rule) => rank >= Number(rule.rank_start) && rank <= Number(rule.rank_end));
        if (matches.length !== 1) throw new ApplicationError("OVERALL_RANK_REWARD_RULE_REQUIRED", `종합 순위 ${rank}위 보상 규칙이 하나로 확정되지 않았습니다.`, 409);
        const quantity = BigInt(matches[0]!.reward_quantity);
        const recipient = recipients[index]!;
        const beforeRow = (await transaction.query<Array<{ quantity: Numeric }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [recipient.playerId, policy.item_id]))[0];
        const before = beforeRow === undefined ? 0n : BigInt(beforeRow.quantity);
        await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [recipient.playerId, policy.item_id, quantity]);
        const ledger = await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,?,'overall_rank_reward_payout',UTC_TIMESTAMP(3))", [operation.insertId, rank, recipient.playerId, policy.item_id, quantity]);
        await transaction.execute("INSERT INTO overall_rank_reward_recipients(operation_id,ordinal_value,player_id,snapshot_id,item_id,reward_quantity,balance_before,balance_after,inventory_ledger_id) VALUES (?,?,?,?,?,?,?,?,?)", [operation.insertId, rank, recipient.playerId, snapshot.insertId, policy.item_id, quantity, before, before + quantity, ledger.insertId]);
        await transaction.execute("INSERT INTO overall_rank_reward_status(player_id,reward_type,last_period_key,last_operation_id,last_snapshot_id) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE last_period_key=VALUES(last_period_key),last_operation_id=VALUES(last_operation_id),last_snapshot_id=VALUES(last_snapshot_id),updated_at=UTC_TIMESTAMP(3)", [recipient.playerId, REWARD_TYPE, periodKey, operation.insertId, snapshot.insertId]);
        rewards.push(quantity); total += quantity;
      }

      const data = formatOverallRankRewardPayout(periodKey, policy.item_display_name, recipients, rewards);
      const notice = `📢 ${periodKey} 종합 순위 보상 지급이 완료되었습니다.\n지급 대상: ${recipients.length}명\n총 지급: ${policy.item_display_name} ${total.toLocaleString("en-US")}개`;
      const outboxIds = [await this.writeOutbox(transaction, operation.insertId, input.channelId, data)];
      const destinations = await transaction.query<Array<{ destination_id: string }>>("SELECT destination_id FROM overall_rank_reward_destinations WHERE active=TRUE ORDER BY display_order,id FOR UPDATE");
      for (const destination of destinations) outboxIds.push(await this.writeOutbox(transaction, operation.insertId, destination.destination_id, notice));
      const result: OverallRankRewardPayoutResult = {
        status:"paid",operationId:operation.insertId.toString(),periodKey,rewardType:REWARD_TYPE,snapshotId:snapshot.insertId.toString(),snapshotVersion:operation.insertId.toString(),snapshotInputHash:inputHash,
        policyVersion:String(policy.policy_version),itemCode:policy.item_code,itemDisplayName:policy.item_display_name,eligiblePlayerCount:ranking.length,recipientCount:recipients.length,totalRewardQuantity:total.toString(),data,notice,outboxIds
      };
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','paid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'overall_rank_period',NULL,?,'paid','Iris /보상지급',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, SCOPE, JSON.stringify({periodKey,rewardType:REWARD_TYPE,snapshotId:snapshot.insertId.toString(),inputHash,policyVersion:String(policy.policy_version),itemCode:policy.item_code,eligiblePlayerCount:ranking.length,recipientCount:recipients.length,totalRewardQuantity:total.toString()})]);
      await transaction.execute("INSERT INTO overall_rank_reward_runs(operation_id,request_key,period_key,reward_type,authority_operator_id,snapshot_id,policy_version,item_id,item_code,recipient_count,total_reward_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId,key(input.eventId),periodKey,REWARD_TYPE,authority.operator_id,snapshot.insertId,policy.policy_version,policy.item_id,policy.item_code,recipients.length,total,JSON.stringify(result)]);
      await transaction.execute("UPDATE overall_rank_reward_period_locks SET version=version+1 WHERE period_key=? AND reward_type=?", [periodKey, REWARD_TYPE]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async requireAuthority(transaction: DatabaseTransaction, externalUserId: string): Promise<AuthorityRow> {
    const row = (await transaction.query<AuthorityRow[]>(
      `SELECT operator_row.id operator_id,identity.id identity_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active'
       JOIN overall_rank_reward_operator_allowlist allowlist ON allowlist.operator_id=operator_row.id AND allowlist.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator_row.id LIMIT 1 FOR UPDATE`, [externalUserId]
    ))[0];
    if (row === undefined) throw new ApplicationError("OVERALL_RANK_REWARD_FORBIDDEN", "종합 순위 보상 지급 권한이 없습니다.", 403);
    return row;
  }

  private async requirePolicy(transaction: DatabaseTransaction): Promise<PolicyRow> {
    const row = (await transaction.query<PolicyRow[]>(
      `SELECT policy.policy_version,item.id item_id,item.code item_code,item.display_name item_display_name,policy.maximum_rank
       FROM overall_rank_reward_policies policy JOIN item_definitions item ON item.code=policy.item_code AND item.active=TRUE AND item.stackable=TRUE
       WHERE policy.policy_key=? AND policy.reward_type=? AND policy.enabled=TRUE ORDER BY policy.policy_version DESC LIMIT 1 FOR UPDATE`, [POLICY_KEY, REWARD_TYPE]
    ))[0];
    if (row === undefined) throw new ApplicationError("OVERALL_RANK_REWARD_POLICY_INACTIVE", "종합 순위 보상 정책이 아직 활성화되지 않았습니다.", 409);
    return row;
  }

  private async writeOutbox(transaction: DatabaseTransaction, operationId: Numeric, destinationId: string, data: string): Promise<string> {
    return (await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId,destinationId,JSON.stringify({data})])).insertId.toString();
  }
}

function defaultKstPeriod(): string { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function assertPeriod(value: string): void { if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("OVERALL_RANK_REWARD_PERIOD_INVALID"); }
function key(value: string): string { return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string|OverallRankRewardPayoutResult): OverallRankRewardPayoutResult { return typeof value==="string"?JSON.parse(value) as OverallRankRewardPayoutResult:value; }
