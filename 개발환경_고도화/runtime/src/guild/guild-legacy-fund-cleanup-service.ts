import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "GUILD_LEGACY_FUND_CLEANUP";
const PERMISSION_CODE = "game.data.cleanup";

export interface GuildLegacyFundCleanupInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface GuildLegacyFundCleanupResult {
  status: "cleaned";
  sourceVersion: string;
  scannedCount: string;
  deletedCount: string;
  skippedCount: string;
  deletedSourceKeys: string[];
  sourceChecksum: string;
  normalizedChecksum: string;
  data: string;
  outboxId: string;
  auditId: string;
}

interface SourceRow { source_key: string; guild_id: bigint | null; source_version: string; row_state: string; legacy_fund_present: number; fund_origin_code: string | null; legacy_fund_json: string | null; non_fund_fields_checksum: string; version: bigint; }
interface ReplayRow { operator_id: bigint; result_json: string | GuildLegacyFundCleanupResult; }
interface OperatorRow { operator_id: bigint; }

// 길드 최상위 fund 정리는 인자 없는 정확 명령만 허용합니다.
export function isGuildLegacyFundCleanupCommand(message: string | undefined): boolean { return message === "/길드fund삭제"; }

// 레거시 응답의 총계와 삭제 목록을 운영자가 대사할 수 있게 투영합니다.
export function buildGuildLegacyFundCleanupMessage(input: { scannedCount: bigint; deletedCount: bigint; skippedCount: bigint; deletedSourceKeys: readonly string[] }): string {
  return ["✅ 길드 legacy fund 정리가 완료되었습니다.", `총 길드 : ${input.scannedCount}`, `삭제 : ${input.deletedCount}`, `건너뜀 : ${input.skippedCount}`, input.deletedSourceKeys.length === 0 ? "삭제 내역 없음" : `[삭제 내역]\n${input.deletedSourceKeys.join("\n")}`].join("\n");
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function hashRows(rows: readonly unknown[]): string { return createHash("sha256").update(JSON.stringify(rows, (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex"); }
function stored(value: string | GuildLegacyFundCleanupResult): GuildLegacyFundCleanupResult { return typeof value === "string" ? JSON.parse(value) as GuildLegacyFundCleanupResult : value; }

// staging source의 top-level fund 표시만 지우고 정규화 자원 checksum 불변을 한 transaction에서 검증합니다.
export class GuildLegacyFundCleanupService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildLegacyFundCleanupInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    if (!isGuildLegacyFundCleanupCommand(input.message)) throw new ApplicationError("INVALID_GUILD_LEGACY_FUND_CLEANUP_COMMAND", "길드 fund 삭제 명령 형식이 올바르지 않습니다.", 422);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.execute(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async execute(input: GuildLegacyFundCleanupInput): Promise<GuildLegacyFundCleanupResult> {
    if (!isGuildLegacyFundCleanupCommand(input.message)) throw new ApplicationError("INVALID_GUILD_LEGACY_FUND_CLEANUP_COMMAND", "길드 fund 삭제 명령 형식이 올바르지 않습니다.", 422);
    const operator = await this.findOperator(input.externalUserId);
    const key = eventKey(input.eventId);
    const existing = (await this.database.query<ReplayRow[]>("SELECT operator_id,result_json FROM guild_legacy_fund_cleanup_runs WHERE request_key=?", [key]))[0];
    if (existing !== undefined) {
      if (existing.operator_id !== operator.operator_id) throw new ApplicationError("GUILD_LEGACY_FUND_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
      return stored(existing.result_json);
    }
    return this.database.withTransaction(async (tx) => {
      await tx.query("SELECT command_code FROM command_registry WHERE command_code=? FOR UPDATE", [COMMAND_CODE]);
      const replay = (await tx.query<ReplayRow[]>("SELECT operator_id,result_json FROM guild_legacy_fund_cleanup_runs WHERE request_key=? FOR UPDATE", [key]))[0];
      if (replay !== undefined) {
        if (replay.operator_id !== operator.operator_id) throw new ApplicationError("GUILD_LEGACY_FUND_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
        return stored(replay.result_json);
      }
      const sources = await tx.query<SourceRow[]>("SELECT source_key,guild_id,source_version,row_state,legacy_fund_present,fund_origin_code,legacy_fund_json,non_fund_fields_checksum,version FROM guild_legacy_fund_cleanup_sources ORDER BY source_key FOR UPDATE");
      if (sources.length === 0) throw new ApplicationError("GUILD_LEGACY_FUND_SOURCE_REQUIRED", "정리할 길드 source snapshot이 없습니다.", 409);
      const sourceVersions = [...new Set(sources.map((row) => row.source_version))];
      if (sourceVersions.length !== 1) throw new ApplicationError("GUILD_LEGACY_FUND_SOURCE_VERSION_CONFLICT", "길드 source 버전이 하나로 고정되지 않았습니다.", 409);
      const sourceInvariantBefore = hashRows(sources.map((row) => [row.source_key,row.guild_id,row.source_version,row.row_state,row.non_fund_fields_checksum]));
      const normalizedBefore = await this.normalizedChecksum(tx);
      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.guild_legacy_fund_cleanup',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),key,operator.operator_id]);
      const deletedSourceKeys: string[] = [];
      let sequence = 1;
      for (const source of sources) {
        if (source.row_state !== "guild" || source.guild_id === null || source.legacy_fund_present !== 1) continue;
        const write = await tx.execute("UPDATE guild_legacy_fund_cleanup_sources SET legacy_fund_present=0,legacy_fund_json=NULL,version=version+1,cleaned_at=UTC_TIMESTAMP(3) WHERE source_key=? AND version=? AND legacy_fund_present=1", [source.source_key,source.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_LEGACY_FUND_VERSION_CONFLICT", "길드 source가 먼저 변경되었습니다.", 409);
        await tx.execute("INSERT INTO guild_legacy_fund_cleanup_changes(operation_id,sequence_no,source_key,guild_id,fund_origin_code,legacy_fund_json) VALUES (?,?,?,?,?,?)", [operation.insertId,sequence++,source.source_key,source.guild_id,source.fund_origin_code,source.legacy_fund_json]);
        deletedSourceKeys.push(source.source_key);
      }
      const sourcesAfter = await tx.query<SourceRow[]>("SELECT source_key,guild_id,source_version,row_state,legacy_fund_present,fund_origin_code,legacy_fund_json,non_fund_fields_checksum,version FROM guild_legacy_fund_cleanup_sources ORDER BY source_key FOR UPDATE");
      const sourceInvariantAfter = hashRows(sourcesAfter.map((row) => [row.source_key,row.guild_id,row.source_version,row.row_state,row.non_fund_fields_checksum]));
      const normalizedAfter = await this.normalizedChecksum(tx);
      if (sourceInvariantBefore !== sourceInvariantAfter || normalizedBefore !== normalizedAfter) throw new ApplicationError("GUILD_LEGACY_FUND_INVARIANT_CONFLICT", "길드 fund 외 데이터가 함께 변경되었습니다.", 409);
      const scannedCount = BigInt(sources.length), deletedCount = BigInt(deletedSourceKeys.length), skippedCount = scannedCount - deletedCount;
      const data = buildGuildLegacyFundCleanupMessage({scannedCount,deletedCount,skippedCount,deletedSourceKeys});
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId,input.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','cleaned',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,COMMAND_CODE,operation.insertId]);
      const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'legacy_dataset',NULL,'guild.legacy_fund.cleanup','cleaned','Iris 길드 fund 삭제',?,UTC_TIMESTAMP(3))", [operation.insertId,operator.operator_id,JSON.stringify({sourceVersion:sourceVersions[0],scannedCount:scannedCount.toString(),deletedCount:deletedCount.toString(),skippedCount:skippedCount.toString(),deletedSourceKeys,sourceChecksum:sourceInvariantAfter,normalizedChecksum:normalizedAfter})]);
      const result: GuildLegacyFundCleanupResult={status:"cleaned",sourceVersion:sourceVersions[0]!,scannedCount:scannedCount.toString(),deletedCount:deletedCount.toString(),skippedCount:skippedCount.toString(),deletedSourceKeys,sourceChecksum:sourceInvariantAfter,normalizedChecksum:normalizedAfter,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO guild_legacy_fund_cleanup_runs(request_key,operation_id,operator_id,source_version,scanned_count,deleted_count,skipped_count,source_checksum,normalized_checksum,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)", [key,operation.insertId,operator.operator_id,sourceVersions[0],scannedCount,deletedCount,skippedCount,sourceInvariantAfter,normalizedAfter,JSON.stringify(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operation.insertId]);
      return result;
    });
  }

  private async findOperator(externalUserId: string): Promise<OperatorRow> {
    const row=(await this.database.query<OperatorRow[]>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`,[PERMISSION_CODE,externalUserId]))[0];
    if(row===undefined)throw new ApplicationError("GUILD_LEGACY_FUND_PERMISSION_REQUIRED","❌ 데이터 정리 권한이 없습니다.",403);
    return row;
  }

  private async normalizedChecksum(tx: DatabaseTransaction): Promise<string> {
    const guilds=await tx.query<Array<Record<string,unknown>>>(`SELECT guild.id,guild.code,guild.display_name,guild.status,guild.mark,guild.version FROM guild_legacy_fund_cleanup_sources source JOIN guilds guild ON guild.id=source.guild_id ORDER BY guild.id FOR UPDATE`);
    const resources=await tx.query<Array<Record<string,unknown>>>(`SELECT account.guild_id,account.currency_code,CAST(account.balance AS CHAR) balance,account.version FROM guild_legacy_fund_cleanup_sources source JOIN guild_resource_accounts account ON account.guild_id=source.guild_id ORDER BY account.guild_id,account.currency_code FOR UPDATE`);
    const warehouse=await tx.query<Array<Record<string,unknown>>>(`SELECT stack.guild_id,stack.item_id,stack.quantity,stack.version FROM guild_legacy_fund_cleanup_sources source JOIN guild_warehouse_stacks stack ON stack.guild_id=source.guild_id ORDER BY stack.guild_id,stack.item_id FOR UPDATE`);
    return hashRows([guilds,resources,warehouse]);
  }
}
