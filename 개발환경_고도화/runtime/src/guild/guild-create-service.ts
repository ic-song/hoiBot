import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const CREATE_COST = 20_000_000_000n;
const CREATE_TICKET_CODE = "ITEM-GUILD-CREATE-TICKET";

export interface GuildCreateIrisInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export type GuildCreateCommand =
  | { action: "start"; commandCode: "GUILD_CREATE_START" }
  | { action: "cancel"; commandCode: "GUILD_CREATE_CANCEL" }
  | { action: "commit"; commandCode: "GUILD_CREATE_COMMIT"; name: string; normalizedName: string; mark: string };
export interface GuildCreateResult {
  status: "started" | "cancelled" | "created";
  action: GuildCreateCommand["action"];
  playerId: string;
  guildId: string | null;
  guildName: string | null;
  mark: string | null;
  pointBefore: string | null;
  pointAfter: string | null;
  ticketQuantity: string | null;
  sessionVersion: string | null;
  data: string;
  outboxId: string;
  auditId: string;
}

// 길드 생성 3단계 명령만 공용 dispatch 후보로 판정합니다.
export function isGuildCreateCandidate(message: string | undefined): boolean {
  return message === "/길드생성" || message === "/길드안만들꼬임" || message === "/길드만들기" ||
    (message !== undefined && message.startsWith("/길드만들기 "));
}

// 시작·생성·취소 명령을 고정된 길이와 공백 없는 이름·마크 계약으로 해석합니다.
export function parseGuildCreateCommand(message: string): GuildCreateCommand {
  if (message === "/길드생성") return { action: "start", commandCode: "GUILD_CREATE_START" };
  if (message === "/길드안만들꼬임") return { action: "cancel", commandCode: "GUILD_CREATE_CANCEL" };
  if (!isGuildCreateCandidate(message)) throw new ApplicationError("INVALID_GUILD_CREATE_COMMAND", "길드 생성 명령 형식이 올바르지 않습니다.", 422);
  const body = message.slice("/길드만들기".length).trim();
  if (/[\r\n]/.test(body)) throw new ApplicationError("INVALID_GUILD_CREATE_COMMAND", "길드 생성 명령 형식이 올바르지 않습니다.", 422);
  const fields = body.split(/\s+/);
  if (fields.length !== 2 || fields[0] === "" || fields[1] === "") {
    throw new ApplicationError("GUILD_CREATE_USAGE", "사용법: /길드만들기 [길드명] [마크]", 422);
  }
  const name = fields[0]!.normalize("NFC");
  const mark = fields[1]!;
  if (name.length < 1 || name.length > 30 || /\s|[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApplicationError("GUILD_CREATE_NAME_INVALID", "❌ 길드명은 공백 없이 1~30자로 입력해주세요.", 422);
  }
  if (mark.length < 1 || mark.length > 10 || /\s|[\u0000-\u001f\u007f]/.test(mark)) {
    throw new ApplicationError("GUILD_CREATE_MARK_INVALID", "❌ 길드 마크는 공백 없이 1~10자로 입력해주세요.", 422);
  }
  return { action: "commit", commandCode: "GUILD_CREATE_COMMIT", name, normalizedName: name, mark };
}

// 긴 event ID를 operations idempotency 키 길이에 맞게 고정합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// DECIMAL 포인트를 정수 bigint로 안전하게 변환합니다.
function whole(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  if (!/^-?\d+$/.test(integer ?? "") || !/^0*$/.test(fraction)) throw new Error("point balance must be an integer decimal");
  return BigInt(integer!);
}

// MariaDB JSON 결과를 재실행 응답으로 복원합니다.
function stored(value: string | GuildCreateResult): GuildCreateResult {
  return typeof value === "string" ? JSON.parse(value) as GuildCreateResult : value;
}

interface ActorRow { identity_id: bigint; player_id: bigint; guild_id: bigint | null; }
interface SessionRow { status: string; version: bigint; expires_active?: number; }

// 길드 생성 결과와 공용 실행·감사·outbox를 같은 transaction에서 완료합니다.
async function complete(
  tx: DatabaseTransaction,
  input: GuildCreateIrisInput,
  command: GuildCreateCommand,
  operationId: bigint,
  actor: ActorRow,
  detail: Omit<GuildCreateResult, "status" | "action" | "playerId" | "data" | "outboxId" | "auditId"> & { status: GuildCreateResult["status"]; data: string }
): Promise<GuildCreateResult> {
  const outbox = await tx.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [operationId, input.channelId, JSON.stringify({ data: detail.data })]
  );
  await tx.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, command.commandCode, operationId, detail.status]
  );
  const audit = await tx.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,?,?,'Iris 길드 생성',?,UTC_TIMESTAMP(3))",
    [operationId, actor.player_id, detail.guildId, `guild.create.${command.action}`, detail.status, JSON.stringify({ action: command.action, guildId: detail.guildId, guildName: detail.guildName, mark: detail.mark, pointBefore: detail.pointBefore, pointAfter: detail.pointAfter, ticketQuantity: detail.ticketQuantity, sessionVersion: detail.sessionVersion })]
  );
  const result: GuildCreateResult = {
    status: detail.status, action: command.action, playerId: actor.player_id.toString(), guildId: detail.guildId,
    guildName: detail.guildName, mark: detail.mark, pointBefore: detail.pointBefore, pointAfter: detail.pointAfter,
    ticketQuantity: detail.ticketQuantity, sessionVersion: detail.sessionVersion, data: detail.data,
    outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
  };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  return result;
}

// 시작·생성·취소를 재시작 가능한 MariaDB 길드 생성 transaction으로 처리합니다.
export class GuildCreateService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildCreateIrisInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    const command = parseGuildCreateCommand(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]
    ))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.execute(input, command);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async execute(input: GuildCreateIrisInput, command = parseGuildCreateCommand(input.message)): Promise<GuildCreateResult> {
    return this.database.withTransaction(async (tx) => {
      const actor = (await tx.query<ActorRow[]>(
        `SELECT identity.id identity_id,identity.player_id,membership.guild_id
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
         LEFT JOIN guild_members membership ON membership.player_id=player.id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL
         LIMIT 1 FOR UPDATE`, [input.externalUserId]
      ))[0];
      if (actor === undefined) throw new ApplicationError("GUILD_CREATE_PLAYER_REQUIRED", "회원 데이터가 존재하지 않습니다.", 404);
      const scope = `guild.create:${actor.player_id}`;
      const key = eventKey(input.eventId);
      const prior = (await tx.query<Array<{ result_json: string | GuildCreateResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      ))[0];
      if (prior?.result_json !== undefined && prior.result_json !== null) return stored(prior.result_json);
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, actor.player_id]
      );

      if (command.action === "cancel") {
        const session = (await tx.query<SessionRow[]>("SELECT status,version FROM guild_create_sessions WHERE player_id=? FOR UPDATE", [actor.player_id]))[0];
        if (session !== undefined) await tx.execute("UPDATE guild_create_sessions SET status='cancelled',version=version+1,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE player_id=?", [actor.player_id]);
        const version = session === undefined ? null : (session.version + 1n).toString();
        await tx.execute("INSERT INTO guild_creation_runs(operation_id,player_id,action_code,session_version) VALUES (?,?,'cancel',?)", [operation.insertId, actor.player_id, version]);
        return complete(tx, input, command, operation.insertId, actor, { status: "cancelled", guildId: null, guildName: null, mark: null, pointBefore: null, pointAfter: null, ticketQuantity: null, sessionVersion: version, data: "❌ 길드 생성을 취소했습니다." });
      }

      if (actor.guild_id !== null) throw new ApplicationError("ALREADY_GUILD_MEMBER", "❌ 이미 길드에 가입되어 있습니다.", 409);
      const account = (await tx.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0];
      if (account === undefined || whole(account.balance) < CREATE_COST) throw new ApplicationError("GUILD_CREATE_POINT_REQUIRED", "❌ 길드 생성에는 200억 포인트가 필요합니다.", 409);

      if (command.action === "start") {
        await tx.execute(
          `INSERT INTO guild_create_sessions(player_id,status,started_event_id,version,expires_at,completed_at,created_at,updated_at)
           VALUES (?,'active',?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE),NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE status='active',started_event_id=VALUES(started_event_id),version=version+1,expires_at=VALUES(expires_at),completed_at=NULL,updated_at=UTC_TIMESTAMP(3)`,
          [actor.player_id, key]
        );
        const session = (await tx.query<SessionRow[]>("SELECT status,version FROM guild_create_sessions WHERE player_id=? FOR UPDATE", [actor.player_id]))[0]!;
        await tx.execute("INSERT INTO guild_creation_runs(operation_id,player_id,action_code,point_before,point_after,session_version) VALUES (?,?,'start',?,?,?)", [operation.insertId, actor.player_id, account.balance, account.balance, session.version]);
        const data = "✅ 길드 생성 준비가 시작되었습니다.\n사용법: /길드만들기 [길드명] [마크]\n취소: /길드안만들꼬임";
        return complete(tx, input, command, operation.insertId, actor, { status: "started", guildId: null, guildName: null, mark: null, pointBefore: whole(account.balance).toString(), pointAfter: whole(account.balance).toString(), ticketQuantity: null, sessionVersion: session.version.toString(), data });
      }

      const session = (await tx.query<SessionRow[]>("SELECT status,version,(expires_at>UTC_TIMESTAMP(3)) expires_active FROM guild_create_sessions WHERE player_id=? FOR UPDATE", [actor.player_id]))[0];
      if (session === undefined || session.status !== "active" || Number(session.expires_active) !== 1) throw new ApplicationError("GUILD_CREATE_SESSION_REQUIRED", "❌ 먼저 /길드생성을 입력해주세요.", 409);
      const duplicate = (await tx.query<Array<{ guild_id: bigint }>>("SELECT guild_id FROM guild_name_registry WHERE normalized_name=? FOR UPDATE", [command.normalizedName]))[0];
      if (duplicate !== undefined) throw new ApplicationError("GUILD_NAME_DUPLICATE", "❌ 이미 사용 중인 길드명입니다.", 409);
      const ticket = (await tx.query<Array<{ quantity: bigint; version: bigint }>>(
        `SELECT stack.quantity,stack.version FROM item_definitions definition
         JOIN inventory_stacks stack ON stack.item_id=definition.id AND stack.player_id=?
         WHERE definition.code=? AND definition.active=TRUE FOR UPDATE`, [actor.player_id, CREATE_TICKET_CODE]
      ))[0];
      if (ticket === undefined || ticket.quantity < 1n) throw new ApplicationError("GUILD_CREATE_TICKET_REQUIRED", "❌ 길드생성권이 없습니다.", 409);
      const before = whole(account.balance);
      const after = before - CREATE_COST;
      const guild = await tx.execute("INSERT INTO guilds(code,display_name,mark,status,version) VALUES (?,?,?,'active',1)", [`GUILD-${randomUUID()}`, command.name, command.mark]);
      await tx.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'leader',UTC_TIMESTAMP(3))", [guild.insertId, actor.player_id]);
      await tx.execute("INSERT INTO guild_name_registry(guild_id,normalized_name,display_name,version,updated_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))", [guild.insertId, command.normalizedName, command.name, 1]);
      await tx.execute("INSERT INTO guild_profile_details(guild_id) VALUES (?)", [guild.insertId]);
      const pointWrite = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [after.toString(), actor.player_id, account.version]);
      if (pointWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_CREATE_POINT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
      await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'GUILD_CREATE_COST')", [operation.insertId, actor.player_id, (-CREATE_COST).toString(), after.toString()]);
      await tx.execute("UPDATE guild_create_sessions SET status='completed',version=version+1,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?", [actor.player_id, session.version]);
      const resultingSessionVersion = session.version + 1n;
      await tx.execute(
        "INSERT INTO guild_creation_runs(operation_id,player_id,guild_id,action_code,normalized_name,display_name,mark,point_before,point_after,ticket_quantity,session_version) VALUES (?,?,?,'commit',?,?,?,?,?,?,?)",
        [operation.insertId, actor.player_id, guild.insertId, command.normalizedName, command.name, command.mark, before.toString(), after.toString(), ticket.quantity, resultingSessionVersion]
      );
      const data = `✅ [${command.name}] 길드가 생성되었습니다.\n길드 마크: ${command.mark}`;
      return complete(tx, input, command, operation.insertId, actor, { status: "created", guildId: guild.insertId.toString(), guildName: command.name, mark: command.mark, pointBefore: before.toString(), pointAfter: after.toString(), ticketQuantity: ticket.quantity.toString(), sessionVersion: resultingSessionVersion.toString(), data });
    });
  }
}
