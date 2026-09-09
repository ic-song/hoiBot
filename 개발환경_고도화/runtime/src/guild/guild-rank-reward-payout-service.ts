import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/길드보상지급";
const COMMAND_CODE = "GUILD_RANK_REWARD_PAYOUT";
const POLICY_KEY = "daily_guild_rank";
const SNAPSHOT_POLICY_KEY = "default";
const SCOPE = "guild.rank_reward.payout";

type Numeric = bigint | string | number;
interface OperatorRow { operator_id: Numeric; identity_id: Numeric }
interface SnapshotRow { id: Numeric; snapshot_version: Numeric; input_hash: string }
interface PolicyRow { policy_version: Numeric; item_id: Numeric; item_code: string; item_display_name: string; maximum_rank: number }
interface RankRow { ordinal_value: number; guild_id: Numeric; guild_name_snapshot: string }
interface RuleRow { ordinal_value: number; reward_quantity: Numeric }
interface MemberRow { ordinal_value: number; guild_id: Numeric; guild_name_snapshot: string; player_id: Numeric; display_name: string }
interface StoredRow { result_json: string | GuildRankRewardPayoutResult }
interface JobRow { id: Numeric; period_key: string | Date; snapshot_id: Numeric; policy_version: Numeric; claim_owner: string; claim_token: string }

export interface GuildRankRewardSummaryRow { ordinalValue: number; guildName: string; memberCount: number; rewardQuantity: bigint }

export interface GuildRankRewardPayoutResult {
  status: "paid"; source: "manual" | "schedule"; operationId: string; periodKey: string; snapshotId: string;
  snapshotVersion: string; policyVersion: string; itemCode: string; itemDisplayName: string; rankedGuildCount: number;
  recipientCount: number; totalRewardQuantity: string; data: string; notice: string; outboxIds: string[];
}

export type GuildRankRewardPayoutIrisResult =
  | { status: "changed"; data: string; outboxId: string }
  | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

export interface GuildRankRewardScheduleClaim { jobId: string; periodKey: string; snapshotId: string; policyVersion: string; claimOwner: string; claimToken: string }

// 길드보상지급은 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isGuildRankRewardPayoutCommand(message: string | undefined): boolean { return message === COMMAND; }

// 길드별 회원 수와 1인당 보상을 운영자 응답으로 직렬화합니다.
export function formatGuildRankRewardPayout(periodKey: string, itemDisplayName: string, rows: readonly GuildRankRewardSummaryRow[]): string {
  const recipientCount = rows.reduce((sum, row) => sum + row.memberCount, 0);
  const total = rows.reduce((sum, row) => sum + row.rewardQuantity * BigInt(row.memberCount), 0n);
  const lines = ["🏆 길드 순위보상 지급 완료", `지급 기준: ${periodKey}`, `지급 대상: ${rows.length}개 길드 · ${recipientCount}명`, ""];
  for (const row of rows) lines.push(`${row.ordinalValue}위 ${row.guildName} - ${row.memberCount}명 · 1인당 ${itemDisplayName} ${row.rewardQuantity.toLocaleString("en-US")}개`);
  if (rows.length === 0) lines.push("지급 대상 길드원이 없습니다.");
  lines.push("", `총 지급: ${itemDisplayName} ${total.toLocaleString("en-US")}개`);
  return lines.join("\n");
}

// SHADOW dispatch와 manual/scheduler 지급을 하나의 snapshot-pinned provider로 제공합니다.
export class GuildRankRewardPayoutService {
  public constructor(private readonly database: DatabaseClient, private readonly period: () => string = defaultKstPeriod) {}

  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildRankRewardPayoutIrisResult> {
    if (!isGuildRankRewardPayoutCommand(input.message)) return { status: "legacy_fallback" };
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || !rollout.enabled || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.payoutManual(input);
    return { status: "changed", data: result.data, outboxId: result.outboxIds[0] ?? "" };
  }

  public async payoutManual(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildRankRewardPayoutResult> {
    if (!isGuildRankRewardPayoutCommand(input.message)) throw new ApplicationError("GUILD_RANK_REWARD_COMMAND_INVALID", "정확한 /길드보상지급 명령을 입력해주세요.", 422);
    const periodKey = this.period();
    assertPeriod(periodKey);
    return this.payout({ source: "manual", periodKey, eventId: input.eventId, externalUserId: input.externalUserId, channelId: input.channelId });
  }

  // 지정한 활성 스케줄의 일자별 durable job을 중복 없이 생성합니다.
  public async enqueueDueSchedule(scheduleKey: string, periodKey: string, availableAt = new Date()): Promise<string> {
    assertScheduleKey(scheduleKey); assertPeriod(periodKey);
    const write = await this.database.execute(
      `INSERT INTO guild_rank_reward_schedule_jobs(schedule_key,period_key,status,available_at)
       SELECT schedule_key,?,'PENDING',? FROM guild_rank_reward_schedules WHERE schedule_key=? AND enabled=TRUE
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [periodKey, availableAt, scheduleKey]
    );
    if (write.insertId === 0n) throw new ApplicationError("GUILD_RANK_REWARD_SCHEDULE_DISABLED", "길드 순위보상 스케줄이 활성화되지 않았습니다.", 409);
    return write.insertId.toString();
  }

  // due job 하나를 SKIP LOCKED로 claim하고 현재 snapshot과 정책 버전을 고정합니다.
  public async claimDueSchedule(workerId: string, leaseSeconds = 60): Promise<GuildRankRewardScheduleClaim | null> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId) || !Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) throw new Error("GUILD_RANK_REWARD_CLAIM_INVALID");
    return this.database.withTransaction(async (transaction) => {
      const job = (await transaction.query<Array<{ id: Numeric; period_key: string | Date }>>(
        `SELECT id,period_key FROM guild_rank_reward_schedule_jobs WHERE available_at<=UTC_TIMESTAMP(3)
         AND (status IN('PENDING','RETRY') OR (status='RUNNING' AND lease_until<UTC_TIMESTAMP(3)))
         ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`
      ))[0];
      if (job === undefined) return null;
      const snapshot = await this.requireSnapshot(transaction);
      const policy = await this.requirePolicy(transaction);
      const token = randomUUID();
      const updated = await transaction.execute(
        "UPDATE guild_rank_reward_schedule_jobs SET status='RUNNING',snapshot_id=?,policy_version=?,claim_owner=?,claim_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),attempt_count=attempt_count+1,last_error_code=NULL WHERE id=?",
        [snapshot.id, policy.policy_version, workerId, token, leaseSeconds, job.id]
      );
      if (updated.affectedRows !== 1n) throw new Error("GUILD_RANK_REWARD_CLAIM_CONFLICT");
      return { jobId: String(job.id), periodKey: periodText(job.period_key), snapshotId: String(snapshot.id), policyVersion: String(policy.policy_version), claimOwner: workerId, claimToken: token };
    });
  }

  // claim에 고정된 snapshot/policy로 지급하고 crash 후 재시도에도 period 중복 지급을 막습니다.
  public async runClaimedSchedule(claim: GuildRankRewardScheduleClaim): Promise<GuildRankRewardPayoutResult> {
    const job = (await this.database.query<JobRow[]>(
      "SELECT id,period_key,snapshot_id,policy_version,claim_owner,claim_token FROM guild_rank_reward_schedule_jobs WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING' AND lease_until>=UTC_TIMESTAMP(3) LIMIT 1",
      [claim.jobId, claim.claimOwner, claim.claimToken]
    ))[0];
    if (job === undefined) throw new ApplicationError("GUILD_RANK_REWARD_CLAIM_LOST", "길드 순위보상 스케줄 Lease가 만료되었거나 다른 작업자가 인계받았습니다.", 409);
    const eventId = `guild-rank-reward-job:${job.id}:${periodText(job.period_key)}`;
    await this.database.execute(
      "INSERT INTO event_inbox(event_id,provider_code,provider_event_id,external_channel_id,event_kind,event_origin,direction,payload_hash,processing_status,received_at) VALUES (?,'iris',?,?,'schedule','runtime','incoming',REPEAT('f',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
      [eventId, eventId, `schedule:${job.id}`]
    );
    try {
      const result = await this.payout({ source: "schedule", periodKey: periodText(job.period_key), eventId, snapshotId: String(job.snapshot_id), policyVersion: String(job.policy_version), scheduleJobId: String(job.id) });
      const completed = await this.database.execute("UPDATE guild_rank_reward_schedule_jobs SET status='COMPLETED',operation_id=?,lease_until=NULL,last_error_code=NULL WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING'", [result.operationId, job.id, claim.claimOwner, claim.claimToken]);
      if (completed.affectedRows !== 1n) throw new Error("GUILD_RANK_REWARD_COMPLETE_CONFLICT");
      return result;
    } catch (error) {
      await this.database.execute("UPDATE guild_rank_reward_schedule_jobs SET status='RETRY',lease_until=NULL,last_error_code=? WHERE id=? AND claim_owner=? AND claim_token=? AND status='RUNNING'", [errorCode(error), job.id, claim.claimOwner, claim.claimToken]);
      throw error;
    }
  }

  private async payout(input: { source: "manual" | "schedule"; periodKey: string; eventId: string; externalUserId?: string; channelId?: string; snapshotId?: string; policyVersion?: string; scheduleJobId?: string }): Promise<GuildRankRewardPayoutResult> {
    return this.database.withTransaction(async (transaction) => {
      const authority = input.source === "manual" ? await this.requireManualAuthority(transaction, input.externalUserId ?? "", input.channelId ?? "") : undefined;
      await transaction.execute("INSERT IGNORE INTO guild_rank_reward_period_locks(period_key,version) VALUES (?,0)", [input.periodKey]);
      await transaction.query("SELECT version FROM guild_rank_reward_period_locks WHERE period_key=? FOR UPDATE", [input.periodKey]);
      const prior = (await transaction.query<StoredRow[]>("SELECT result_json FROM guild_rank_reward_runs WHERE period_key=? FOR UPDATE", [input.periodKey]))[0];
      if (prior !== undefined) return stored(prior.result_json);

      const snapshot = await this.requireSnapshot(transaction, input.snapshotId);
      const policy = await this.requirePolicy(transaction, input.policyVersion);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, key(input.eventId), authority === undefined ? "system" : "external_identity", authority?.identity_id ?? null]
      );
      const ranked = await transaction.query<RankRow[]>("SELECT ordinal_value,guild_id,guild_name_snapshot FROM guild_rank_snapshot_rows WHERE snapshot_id=? AND ordinal_value<=? ORDER BY ordinal_value FOR UPDATE", [snapshot.id, policy.maximum_rank]);
      const rules = await transaction.query<RuleRow[]>("SELECT ordinal_value,reward_quantity FROM guild_rank_reward_rules WHERE policy_version=? AND ordinal_value<=? ORDER BY ordinal_value FOR UPDATE", [policy.policy_version, policy.maximum_rank]);
      const rewardByRank = new Map(rules.map((rule) => [Number(rule.ordinal_value), BigInt(rule.reward_quantity)]));
      for (const row of ranked) if (!rewardByRank.has(Number(row.ordinal_value))) throw new ApplicationError("GUILD_RANK_REWARD_RULE_REQUIRED", `길드 ${row.ordinal_value}위 보상 규칙이 없습니다.`, 409);

      const guildIds = ranked.map((row) => row.guild_id);
      const members = guildIds.length === 0 ? [] : await transaction.query<MemberRow[]>(
        `SELECT rank_row.ordinal_value,member.guild_id,rank_row.guild_name_snapshot,member.player_id,profile.current_display_name display_name
         FROM guild_rank_snapshot_rows rank_row JOIN guilds guild_row ON guild_row.id=rank_row.guild_id AND guild_row.status='active'
         JOIN guild_members member ON member.guild_id=guild_row.id
         JOIN players player ON player.id=member.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=player.id
         WHERE rank_row.snapshot_id=? AND rank_row.ordinal_value<=? AND member.guild_id IN (${guildIds.map(() => "?").join(",")})
         ORDER BY rank_row.ordinal_value,member.player_id FOR UPDATE`, [snapshot.id, policy.maximum_rank, ...guildIds]
      );

      let total = 0n; let sequence = 0;
      const memberCountByRank = new Map<number, number>();
      for (const member of members) {
        sequence += 1;
        const ordinal = Number(member.ordinal_value);
        const quantity = rewardByRank.get(ordinal)!;
        const beforeRow = (await transaction.query<Array<{ quantity: Numeric }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [member.player_id, policy.item_id]))[0];
        const before = beforeRow === undefined ? 0n : BigInt(beforeRow.quantity);
        await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [member.player_id, policy.item_id, quantity]);
        const after = before + quantity;
        const ledger = await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,?,'guild_rank_reward_payout',UTC_TIMESTAMP(3))", [operation.insertId, sequence, member.player_id, policy.item_id, quantity]);
        await transaction.execute("INSERT INTO guild_rank_reward_recipients(operation_id,sequence_no,ordinal_value,guild_id,player_id,snapshot_id,item_id,reward_quantity,balance_before,balance_after,inventory_ledger_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, sequence, ordinal, member.guild_id, member.player_id, snapshot.id, policy.item_id, quantity, before, after, ledger.insertId]);
        memberCountByRank.set(ordinal, (memberCountByRank.get(ordinal) ?? 0) + 1);
        total += quantity;
      }

      const summaries = ranked.map((row) => ({ ordinalValue: Number(row.ordinal_value), guildName: row.guild_name_snapshot, memberCount: memberCountByRank.get(Number(row.ordinal_value)) ?? 0, rewardQuantity: rewardByRank.get(Number(row.ordinal_value))! }));
      const data = formatGuildRankRewardPayout(input.periodKey, policy.item_display_name, summaries);
      const notice = `📢 ${input.periodKey} 길드 순위보상 지급이 완료되었습니다.\n지급 대상: ${ranked.length}개 길드 · ${members.length}명\n총 지급: ${policy.item_display_name} ${total.toLocaleString("en-US")}개`;
      const outboxIds: string[] = [];
      if (input.source === "manual") outboxIds.push(await this.writeOutbox(transaction, operation.insertId, input.channelId ?? "", data));
      const destinations = await transaction.query<Array<{ destination_id: string }>>("SELECT destination_id FROM guild_rank_reward_destinations WHERE destination_kind='notice' AND active=TRUE ORDER BY display_order,id FOR UPDATE");
      for (const destination of destinations) outboxIds.push(await this.writeOutbox(transaction, operation.insertId, destination.destination_id, notice));

      const result: GuildRankRewardPayoutResult = {
        status: "paid", source: input.source, operationId: operation.insertId.toString(), periodKey: input.periodKey, snapshotId: String(snapshot.id), snapshotVersion: String(snapshot.snapshot_version),
        policyVersion: String(policy.policy_version), itemCode: policy.item_code, itemDisplayName: policy.item_display_name, rankedGuildCount: ranked.length,
        recipientCount: members.length, totalRewardQuantity: total.toString(), data, notice, outboxIds
      };
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','paid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,?,?,'guild_rank_period',NULL,?,'paid','Iris /길드보상지급',?,UTC_TIMESTAMP(3))",
        [operation.insertId, authority === undefined ? "system" : "external_identity", authority?.identity_id ?? null, SCOPE, JSON.stringify({ periodKey: input.periodKey, source: input.source, snapshotId: String(snapshot.id), policyVersion: String(policy.policy_version), itemCode: policy.item_code, rankedGuildCount: ranked.length, recipientCount: members.length, totalRewardQuantity: total.toString() })]
      );
      await transaction.execute(
        "INSERT INTO guild_rank_reward_runs(operation_id,request_key,period_key,source_kind,authority_operator_id,schedule_job_id,snapshot_id,snapshot_version,snapshot_input_hash,policy_version,item_id,item_code,ranked_guild_count,recipient_count,total_reward_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [operation.insertId, key(input.eventId), input.periodKey, input.source, authority?.operator_id ?? null, input.scheduleJobId ?? null, snapshot.id, snapshot.snapshot_version, snapshot.input_hash, policy.policy_version, policy.item_id, policy.item_code, ranked.length, members.length, total, JSON.stringify(result)]
      );
      await transaction.execute("UPDATE guild_rank_reward_period_locks SET version=version+1 WHERE period_key=?", [input.periodKey]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async requireManualAuthority(transaction: DatabaseTransaction, externalUserId: string, channelId: string): Promise<OperatorRow> {
    const operator = (await transaction.query<OperatorRow[]>(
      `SELECT operator_row.id operator_id,identity.id identity_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active'
       JOIN guild_rank_reward_operator_allowlist allowlist ON allowlist.operator_id=operator_row.id AND allowlist.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator_row.id LIMIT 1 FOR UPDATE`, [externalUserId]
    ))[0];
    if (operator === undefined) throw new ApplicationError("GUILD_RANK_REWARD_FORBIDDEN", "길드 순위보상 지급 권한이 없습니다.", 403);
    const room = (await transaction.query<Array<{ id: Numeric }>>("SELECT id FROM guild_rank_reward_destinations WHERE destination_id=? AND destination_kind='operator' AND active=TRUE LIMIT 1 FOR UPDATE", [channelId]))[0];
    if (room === undefined) throw new ApplicationError("GUILD_RANK_REWARD_ROOM_FORBIDDEN", "허용된 운영 채널에서만 길드 순위보상을 지급할 수 있습니다.", 403);
    return operator;
  }

  private async requireSnapshot(transaction: DatabaseTransaction, snapshotId?: string): Promise<SnapshotRow> {
    const rows = snapshotId === undefined
      ? await transaction.query<SnapshotRow[]>("SELECT snapshot.id,snapshot.snapshot_version,snapshot.input_hash FROM guild_rank_snapshot_current current_row JOIN guild_rank_snapshots snapshot ON snapshot.id=current_row.snapshot_id WHERE current_row.policy_key=? AND snapshot.status='published' LIMIT 1 FOR UPDATE", [SNAPSHOT_POLICY_KEY])
      : await transaction.query<SnapshotRow[]>("SELECT id,snapshot_version,input_hash FROM guild_rank_snapshots WHERE id=? AND status='published' LIMIT 1 FOR UPDATE", [snapshotId]);
    if (rows[0] === undefined) throw new ApplicationError("GUILD_RANK_REWARD_SNAPSHOT_MISSING", "발행된 길드 순위 스냅샷이 없습니다.", 409);
    return rows[0];
  }

  private async requirePolicy(transaction: DatabaseTransaction, policyVersion?: string): Promise<PolicyRow> {
    const sql = `SELECT policy.policy_version,item.id item_id,item.code item_code,item.display_name item_display_name,policy.maximum_rank
                 FROM guild_rank_reward_policies policy JOIN item_definitions item ON item.code=policy.item_code AND item.active=TRUE AND item.stackable=TRUE
                 WHERE ${policyVersion === undefined ? "policy.policy_key=?" : "policy.policy_version=? AND policy.policy_key=?"} AND policy.enabled=TRUE ORDER BY policy.policy_version DESC LIMIT 1 FOR UPDATE`;
    const params = policyVersion === undefined ? [POLICY_KEY] : [policyVersion, POLICY_KEY];
    const row = (await transaction.query<PolicyRow[]>(sql, params))[0];
    if (row === undefined) throw new ApplicationError("GUILD_RANK_REWARD_POLICY_INACTIVE", "길드 순위보상 아이템과 정책이 아직 활성화되지 않았습니다.", 409);
    return row;
  }

  private async writeOutbox(transaction: DatabaseTransaction, operationId: Numeric, destinationId: string, data: string): Promise<string> {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, destinationId, JSON.stringify({ data })]);
    return outbox.insertId.toString();
  }
}

function defaultKstPeriod(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function assertPeriod(value: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("GUILD_RANK_REWARD_PERIOD_INVALID"); }
function assertScheduleKey(value: string): void { if (!/^[A-Za-z0-9._:-]{1,64}$/.test(value)) throw new Error("GUILD_RANK_REWARD_SCHEDULE_KEY_INVALID"); }
function periodText(value: string | Date): string { return value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10); }
function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildRankRewardPayoutResult): GuildRankRewardPayoutResult { return typeof value === "string" ? JSON.parse(value) as GuildRankRewardPayoutResult : value; }
function errorCode(error: unknown): string { return error instanceof ApplicationError ? error.code.slice(0, 128) : error instanceof Error ? error.message.slice(0, 128) : "UNKNOWN"; }
