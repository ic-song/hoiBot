import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "GUILD_TERRITORY_RANK_REWARD_PAYOUT";
const POLICY_KEY = "daily_guild_rank";
const SNAPSHOT_POLICY_KEY = "default";
const SCOPE = "guild.territory.rank_reward.payout";
const COMMANDS = new Set(["/길드영지보상지급", "/영지순위보상지급"]);

type Numeric = bigint | string | number;
interface OperatorRow { operator_id: Numeric; identity_id: Numeric }
interface SnapshotRow { id: Numeric; snapshot_version: Numeric; input_hash: string; status: string }
interface PolicyRow { policy_version: Numeric; currency_code: string; maximum_rank: number }
interface RankRow { ordinal_value: number; guild_id: Numeric; guild_name_snapshot: string; total_charm: Numeric }
interface RuleRow { ordinal_value: number; reward_amount: string }
interface StoredRow { result_json: string | GuildTerritoryRankRewardPayoutResult }
interface AccountRow { balance: string; version: Numeric }
interface JobRow { id: Numeric; period_key: string | Date; snapshot_id: Numeric; policy_version: Numeric; claim_owner: string; claim_token: string; status: string }

export interface GuildTerritoryRankRewardPayoutResult {
  status: "paid";
  source: "manual" | "schedule";
  operationId: string;
  periodKey: string;
  snapshotId: string;
  snapshotVersion: string;
  policyVersion: string;
  currencyCode: string;
  recipientCount: number;
  totalRewardAmount: string;
  data: string;
  notice: string;
  outboxIds: string[];
}

export type GuildTerritoryRankRewardPayoutIrisResult =
  | { status: "changed"; data: string; outboxId: string }
  | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

export interface GuildTerritoryRankRewardScheduleClaim {
  jobId: string;
  periodKey: string;
  snapshotId: string;
  policyVersion: string;
  claimOwner: string;
  claimToken: string;
}

// 두 legacy 별칭은 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isGuildTerritoryRankRewardPayoutCommand(message: string | undefined): boolean {
  return message !== undefined && COMMANDS.has(message);
}

// snapshot 순위와 버전형 정책 금액을 운영자 응답으로 직렬화합니다.
export function formatGuildTerritoryRankRewardPayout(periodKey: string, currencyCode: string, rows: readonly RankRow[], rewards: readonly string[]): string {
  const lines = ["🏆 길드 영지 순위보상 지급 완료", `지급 기준: ${periodKey}`, `지급 대상: ${rows.length}개 길드`, ""];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    lines.push(`${row.ordinal_value}위 ${row.guild_name_snapshot} - ${currencyCode} ${displayDecimal(rewards[index]!)}`);
  }
  if (rows.length === 0) lines.push("지급 대상 길드가 없습니다.");
  lines.push("", `총 지급: ${currencyCode} ${displayDecimal(formatDecimal3(rewards.reduce((sum, value) => sum + parseDecimal3(value), 0n)))}`);
  return lines.join("\n");
}

// SHADOW dispatch와 manual/scheduler 지급을 하나의 snapshot-pinned provider로 제공합니다.
export class GuildTerritoryRankRewardPayoutService {
  public constructor(private readonly database: DatabaseClient, private readonly period: () => string = defaultKstPeriod) {}

  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildTerritoryRankRewardPayoutIrisResult> {
    if (!isGuildTerritoryRankRewardPayoutCommand(input.message)) return { status: "legacy_fallback" };
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
    ))[0];
    if (rollout === undefined || !rollout.enabled || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.payoutManual(input);
    return { status: "changed", data: result.data, outboxId: result.outboxIds[0] ?? "" };
  }

  public async payoutManual(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildTerritoryRankRewardPayoutResult> {
    if (!isGuildTerritoryRankRewardPayoutCommand(input.message)) throw new ApplicationError("INVALID_GUILD_TERRITORY_RANK_REWARD_COMMAND", "길드 영지 순위보상 지급 명령 형식이 올바르지 않습니다.", 422);
    const periodKey = this.period();
    assertPeriod(periodKey);
    return this.payout({ source: "manual", periodKey, eventId: input.eventId, externalUserId: input.externalUserId, channelId: input.channelId });
  }

  // 활성 22:05 KST 스케줄의 일자별 durable job을 중복 없이 생성합니다.
  public async enqueueDueSchedule(periodKey: string, availableAt = new Date()): Promise<string> {
    assertPeriod(periodKey);
    const write = await this.database.execute(
      `INSERT INTO guild_territory_rank_reward_schedule_jobs(schedule_key,period_key,status,available_at)
       SELECT schedule_key,?,'PENDING',? FROM guild_territory_rank_reward_schedules WHERE schedule_key='daily_2205_kst' AND enabled=TRUE
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [periodKey, availableAt]
    );
    if (write.insertId === 0n) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_SCHEDULE_DISABLED", "길드 영지 순위보상 스케줄이 활성화되지 않았습니다.", 409);
    return write.insertId.toString();
  }

  // due job 하나를 SKIP LOCKED로 claim하고 현재 snapshot과 정책 버전을 고정합니다.
  public async claimDueSchedule(workerId: string, leaseSeconds = 60): Promise<GuildTerritoryRankRewardScheduleClaim | null> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId) || !Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) throw new Error("GUILD_TERRITORY_RANK_REWARD_CLAIM_INVALID");
    return this.database.withTransaction(async (transaction) => {
      const job = (await transaction.query<Array<{ id: Numeric; period_key: string | Date }>>(
        `SELECT id,period_key FROM guild_territory_rank_reward_schedule_jobs
         WHERE available_at<=UTC_TIMESTAMP(3) AND (status IN('PENDING','RETRY') OR (status='RUNNING' AND lease_until<UTC_TIMESTAMP(3)))
         ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`
      ))[0];
      if (job === undefined) return null;
      const snapshot = await this.requireSnapshot(transaction);
      const policy = await this.requirePolicy(transaction);
      const token = randomUUID();
      const updated = await transaction.execute(
        `UPDATE guild_territory_rank_reward_schedule_jobs SET status='RUNNING',snapshot_id=?,policy_version=?,claim_owner=?,claim_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),attempt_count=attempt_count+1,last_error_code=NULL
         WHERE id=?`, [snapshot.id, policy.policy_version, workerId, token, leaseSeconds, job.id]
      );
      if (updated.affectedRows !== 1n) throw new Error("GUILD_TERRITORY_RANK_REWARD_CLAIM_CONFLICT");
      return { jobId: String(job.id), periodKey: periodText(job.period_key), snapshotId: String(snapshot.id), policyVersion: String(policy.policy_version), claimOwner: workerId, claimToken: token };
    });
  }

  // claim에 고정된 snapshot/policy로 지급하고, crash 후 재시도에도 period 중복 지급을 막습니다.
  public async runClaimedSchedule(claim: GuildTerritoryRankRewardScheduleClaim): Promise<GuildTerritoryRankRewardPayoutResult> {
    const job = (await this.database.query<JobRow[]>(
      `SELECT id,period_key,snapshot_id,policy_version,claim_owner,claim_token,status FROM guild_territory_rank_reward_schedule_jobs
       WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING' AND lease_until>=UTC_TIMESTAMP(3) LIMIT 1`,
      [claim.jobId, claim.claimOwner, claim.claimToken]
    ))[0];
    if (job === undefined) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_CLAIM_LOST", "순위보상 스케줄 Lease가 만료되었거나 다른 작업자가 인계받았습니다.", 409);
    try {
      const eventId = `guild-rank-reward-job:${job.id}:${periodText(job.period_key)}`;
      const result = await this.payout({ source: "schedule", periodKey: periodText(job.period_key), eventId, snapshotId: String(job.snapshot_id), policyVersion: String(job.policy_version), scheduleJobId: String(job.id) });
      const completed = await this.database.execute(
        "UPDATE guild_territory_rank_reward_schedule_jobs SET status='COMPLETED',operation_id=?,lease_until=NULL,last_error_code=NULL WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING'",
        [result.operationId, job.id, claim.claimOwner, claim.claimToken]
      );
      if (completed.affectedRows !== 1n) throw new Error("GUILD_TERRITORY_RANK_REWARD_COMPLETE_CONFLICT");
      return result;
    } catch (error) {
      await this.database.execute(
        "UPDATE guild_territory_rank_reward_schedule_jobs SET status='RETRY',lease_until=NULL,last_error_code=? WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING'",
        [errorCode(error), job.id, claim.claimOwner, claim.claimToken]
      );
      throw error;
    }
  }

  private async payout(input: { source: "manual" | "schedule"; periodKey: string; eventId: string; externalUserId?: string; channelId?: string; snapshotId?: string; policyVersion?: string; scheduleJobId?: string }): Promise<GuildTerritoryRankRewardPayoutResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = input.source === "manual" ? await this.requireManualAuthority(transaction, input.externalUserId!, input.channelId!) : null;
      await transaction.execute("INSERT IGNORE INTO guild_territory_rank_reward_period_locks(period_key,version) VALUES (?,0)", [input.periodKey]);
      await transaction.query("SELECT version FROM guild_territory_rank_reward_period_locks WHERE period_key=? FOR UPDATE", [input.periodKey]);
      const prior = (await transaction.query<StoredRow[]>("SELECT result_json FROM guild_territory_rank_reward_runs WHERE period_key=? FOR UPDATE", [input.periodKey]))[0];
      if (prior !== undefined) return stored(prior.result_json);

      const snapshot = input.snapshotId === undefined ? await this.requireSnapshot(transaction) : await this.requireSnapshot(transaction, input.snapshotId);
      const policy = input.policyVersion === undefined ? await this.requirePolicy(transaction) : await this.requirePolicy(transaction, input.policyVersion);
      const ranked = await transaction.query<RankRow[]>(
        `SELECT ordinal_value,guild_id,guild_name_snapshot,total_charm FROM guild_rank_snapshot_rows
         WHERE snapshot_id=? AND ordinal_value<=? ORDER BY ordinal_value FOR UPDATE`, [snapshot.id, policy.maximum_rank]
      );
      const rules = await transaction.query<RuleRow[]>(
        "SELECT ordinal_value,reward_amount FROM guild_territory_rank_reward_rules WHERE policy_version=? AND ordinal_value<=? ORDER BY ordinal_value FOR UPDATE",
        [policy.policy_version, ranked.length]
      );
      if (rules.length !== ranked.length || rules.some((rule, index) => Number(rule.ordinal_value) !== index + 1)) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_POLICY_INCOMPLETE", "길드 영지 순위보상 정책이 현재 순위를 모두 포함하지 않습니다.", 409);

      const requestKey = key(input.eventId);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, requestKey, input.source === "manual" ? "external_identity" : "system", operator?.identity_id ?? null]
      );
      const rewards: string[] = [];
      let total = 0n;
      for (let index = 0; index < ranked.length; index += 1) {
        const row = ranked[index]!, reward = formatDecimal3(parseDecimal3(rules[index]!.reward_amount));
        rewards.push(reward);
        total += parseDecimal3(reward);
        await transaction.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,?,0,1)", [row.guild_id, policy.currency_code]);
        const account = (await transaction.query<AccountRow[]>("SELECT balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code=? FOR UPDATE", [row.guild_id, policy.currency_code]))[0];
        if (account === undefined) throw new Error("GUILD_TERRITORY_RANK_REWARD_ACCOUNT_MISSING");
        const before = parseDecimal3(account.balance), after = before + parseDecimal3(reward), nextVersion = BigInt(account.version) + 1n;
        const accountUpdate = await transaction.execute("UPDATE guild_resource_accounts SET balance=?,version=? WHERE guild_id=? AND currency_code=? AND version=?", [formatDecimal3(after), nextVersion, row.guild_id, policy.currency_code, account.version]);
        if (accountUpdate.affectedRows !== 1n) throw new Error("GUILD_TERRITORY_RANK_REWARD_ACCOUNT_CONFLICT");
        await transaction.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,?,?,?,?,?,?)", [operation.insertId, index + 1, row.guild_id, policy.currency_code, reward, formatDecimal3(after), "guild_territory_rank_reward"]);
        await transaction.execute(
          "INSERT INTO guild_territory_rank_reward_recipients(operation_id,ordinal_value,guild_id,snapshot_id,currency_code,reward_amount,balance_before,balance_after,ledger_sequence_no) VALUES (?,?,?,?,?,?,?,?,?)",
          [operation.insertId, row.ordinal_value, row.guild_id, snapshot.id, policy.currency_code, reward, formatDecimal3(before), formatDecimal3(after), index + 1]
        );
      }

      const data = formatGuildTerritoryRankRewardPayout(input.periodKey, policy.currency_code, ranked, rewards);
      const notice = `📢 ${input.periodKey} 길드 영지 순위보상 지급 완료\n지급 대상: ${ranked.length}개 길드\n총 지급: ${policy.currency_code} ${displayDecimal(formatDecimal3(total))}`;
      const outboxIds: string[] = [];
      if (input.channelId !== undefined) outboxIds.push(await this.writeOutbox(transaction, operation.insertId, input.channelId, data));
      const destinations = await transaction.query<Array<{ destination_id: string }>>("SELECT destination_id FROM guild_territory_rank_reward_destinations WHERE destination_kind='notice' AND active=TRUE ORDER BY display_order,id FOR UPDATE");
      for (const destination of destinations) outboxIds.push(await this.writeOutbox(transaction, operation.insertId, destination.destination_id, notice));

      if (input.source === "schedule") {
        await transaction.execute(
          "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,'system','schedule','incoming',REPEAT('0',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
          [input.eventId, input.eventId, "guild-territory-rank-reward-scheduler"]
        );
      }
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','paid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,?,?,?,?,'guild.territory.rank_reward.payout','paid',?,?,UTC_TIMESTAMP(3))",
        [operation.insertId, input.source === "manual" ? "external_identity" : "system", operator?.identity_id ?? null, "guild_rank_snapshot", snapshot.id, input.source === "manual" ? "Iris 길드 영지 순위보상 지급" : "22:05 KST scheduler", JSON.stringify({ periodKey: input.periodKey, source: input.source, snapshotId: String(snapshot.id), snapshotVersion: String(snapshot.snapshot_version), policyVersion: String(policy.policy_version), currencyCode: policy.currency_code, recipientCount: ranked.length, totalRewardAmount: formatDecimal3(total), stableGuildIds: ranked.map((row) => String(row.guild_id)) })]
      );
      const result: GuildTerritoryRankRewardPayoutResult = {
        status: "paid", source: input.source, operationId: operation.insertId.toString(), periodKey: input.periodKey,
        snapshotId: String(snapshot.id), snapshotVersion: String(snapshot.snapshot_version), policyVersion: String(policy.policy_version),
        currencyCode: policy.currency_code, recipientCount: ranked.length, totalRewardAmount: formatDecimal3(total), data, notice, outboxIds
      };
      await transaction.execute(
        "INSERT INTO guild_territory_rank_reward_runs(operation_id,request_key,period_key,source_kind,authority_operator_id,schedule_job_id,snapshot_id,snapshot_version,snapshot_input_hash,policy_version,currency_code,recipient_count,total_reward_amount,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [operation.insertId, requestKey, input.periodKey, input.source, operator?.operator_id ?? null, input.scheduleJobId ?? null, snapshot.id, snapshot.snapshot_version, snapshot.input_hash, policy.policy_version, policy.currency_code, ranked.length, formatDecimal3(total), JSON.stringify(result)]
      );
      await transaction.execute("UPDATE guild_territory_rank_reward_period_locks SET version=version+1 WHERE period_key=?", [input.periodKey]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async requireManualAuthority(transaction: DatabaseTransaction, externalUserId: string, channelId: string): Promise<OperatorRow> {
    const operator = (await transaction.query<OperatorRow[]>(
      `SELECT operator_row.id operator_id,identity.id identity_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active'
       JOIN guild_territory_rank_reward_operator_allowlist allowlist ON allowlist.operator_id=operator_row.id AND allowlist.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator_row.id LIMIT 1 FOR UPDATE`, [externalUserId]
    ))[0];
    if (operator === undefined) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_FORBIDDEN", "길드 영지 순위보상 지급 권한이 없습니다.", 403);
    const room = (await transaction.query<Array<{ id: Numeric }>>("SELECT id FROM guild_territory_rank_reward_destinations WHERE destination_id=? AND destination_kind='operator' AND active=TRUE LIMIT 1 FOR UPDATE", [channelId]))[0];
    if (room === undefined) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_ROOM_FORBIDDEN", "허용된 운영 채널에서만 순위보상을 지급할 수 있습니다.", 403);
    return operator;
  }

  private async requireSnapshot(transaction: DatabaseTransaction, snapshotId?: string): Promise<SnapshotRow> {
    const rows = snapshotId === undefined
      ? await transaction.query<SnapshotRow[]>("SELECT snapshot.id,snapshot.snapshot_version,snapshot.input_hash,snapshot.status FROM guild_rank_snapshot_current current_row JOIN guild_rank_snapshots snapshot ON snapshot.id=current_row.snapshot_id WHERE current_row.policy_key=? AND snapshot.status='published' LIMIT 1 FOR UPDATE", [SNAPSHOT_POLICY_KEY])
      : await transaction.query<SnapshotRow[]>("SELECT id,snapshot_version,input_hash,status FROM guild_rank_snapshots WHERE id=? AND status='published' LIMIT 1 FOR UPDATE", [snapshotId]);
    if (rows[0] === undefined) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_SNAPSHOT_MISSING", "발행된 길드 순위 스냅샷이 없습니다.", 409);
    return rows[0];
  }

  private async requirePolicy(transaction: DatabaseTransaction, policyVersion?: string): Promise<PolicyRow> {
    const rows = policyVersion === undefined
      ? await transaction.query<PolicyRow[]>("SELECT policy_version,currency_code,maximum_rank FROM guild_territory_rank_reward_policies WHERE policy_key=? AND enabled=TRUE AND currency_code IS NOT NULL ORDER BY policy_version DESC LIMIT 1 FOR UPDATE", [POLICY_KEY])
      : await transaction.query<PolicyRow[]>("SELECT policy_version,currency_code,maximum_rank FROM guild_territory_rank_reward_policies WHERE policy_version=? AND policy_key=? AND enabled=TRUE AND currency_code IS NOT NULL LIMIT 1 FOR UPDATE", [policyVersion, POLICY_KEY]);
    if (rows[0] === undefined) throw new ApplicationError("GUILD_TERRITORY_RANK_REWARD_POLICY_INACTIVE", "길드 영지 순위보상 정책이 아직 활성화되지 않았습니다.", 409);
    return rows[0];
  }

  private async writeOutbox(transaction: DatabaseTransaction, operationId: Numeric, destinationId: string, data: string): Promise<string> {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, destinationId, JSON.stringify({ data })]);
    return outbox.insertId.toString();
  }
}

function defaultKstPeriod(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function assertPeriod(value: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("GUILD_TERRITORY_RANK_REWARD_PERIOD_INVALID"); }
function periodText(value: string | Date): string { return value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10); }
function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildTerritoryRankRewardPayoutResult): GuildTerritoryRankRewardPayoutResult { return typeof value === "string" ? JSON.parse(value) as GuildTerritoryRankRewardPayoutResult : value; }
function parseDecimal3(value: string): bigint { const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value)); if (match === null) throw new Error("GUILD_TERRITORY_RANK_REWARD_AMOUNT_INVALID"); return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0")); }
function formatDecimal3(value: bigint): string { return `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`; }
function displayDecimal(value: string): string { return value.endsWith(".000") ? value.slice(0, -4) : value.replace(/0+$/, "").replace(/\.$/, ""); }
function errorCode(error: unknown): string { return error instanceof ApplicationError ? error.code.slice(0, 128) : error instanceof Error ? error.message.slice(0, 128) : "UNKNOWN"; }
