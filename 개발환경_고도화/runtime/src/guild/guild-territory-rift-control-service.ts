import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;

export type GuildTerritoryRiftControlKind =
  | "rift_guide"
  | "instability_up"
  | "instability_down"
  | "great_rift_guide";

export interface GuildTerritoryRiftControlCommand {
  kind: GuildTerritoryRiftControlKind;
  commandText: "/균열" | "/불안정" | "/안정" | "/대균열";
  requestedCount: bigint;
}

export interface GuildTerritoryRiftControlResult {
  status:
    | "changed"
    | "war_inactive"
    | "guild_required"
    | "guild_not_ready"
    | "authority_required"
    | "guild_eliminated"
    | "invalid_count"
    | "already_used"
    | "item_shortage"
    | "limit_reached";
  kind: GuildTerritoryRiftControlKind;
  requestedCount: string;
  appliedCount: string;
  beforeValue?: string;
  afterValue?: string;
  data: string;
  outboxId: string;
}

interface PolicyRow {
  type_code: GuildTerritoryRiftControlKind;
  command_text: GuildTerritoryRiftControlCommand["commandText"];
  item_code: string;
  adjustment_target: "instability_adjust" | "rift_bias";
  adjustment_per_unit: string;
  minimum_value: string;
  maximum_value: string;
  maximum_batch: bigint;
  count_argument_allowed: number;
}

interface ActorRow {
  identity_id: bigint;
  player_id: bigint;
  guild_id: bigint | null;
  guild_name: string | null;
}

interface WarRow {
  id: bigint;
  active: number;
  instability_adjust: string;
  rift_bias: string;
  version: bigint;
}

const COMMANDS: Record<string, GuildTerritoryRiftControlKind> = {
  균열: "rift_guide",
  불안정: "instability_up",
  안정: "instability_down",
};

// 네 명령의 exact 또는 허용된 단일 수량 형식만 파싱합니다.
export function parseGuildTerritoryRiftControlCommand(
  message: string | undefined,
): GuildTerritoryRiftControlCommand | null {
  if (message === "/대균열") {
    return { kind: "great_rift_guide", commandText: "/대균열", requestedCount: 1n };
  }
  if (message === undefined) return null;
  const match = /^\/(균열|불안정|안정)(?:\s+(\d{1,20}))?$/.exec(message);
  if (match === null) return null;
  const requestedCount = BigInt(match[2] ?? "1");
  if (requestedCount > UINT64_MAX) return null;
  const token = match[1]!;
  return {
    kind: COMMANDS[token]!,
    commandText: ("/" + token) as GuildTerritoryRiftControlCommand["commandText"],
    requestedCount,
  };
}

export function isGuildTerritoryRiftControlCandidate(message: string | undefined): boolean {
  return parseGuildTerritoryRiftControlCommand(message) !== null;
}

export function normalizeGuildTerritoryRiftControlDispatchMessage(message: string): string {
  return parseGuildTerritoryRiftControlCommand(message)?.commandText ?? message;
}

// DECIMAL(10,3)을 부동소수점 없이 천분율 정수로 변환합니다.
export function decimalToMilli(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (match === null) throw new Error("Invalid DECIMAL(10,3): " + value);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const absolute = BigInt(match[2]!) * 1000n + BigInt(fraction || "0");
  return match[1] === "-" ? -absolute : absolute;
}

export function milliToDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return sign + (absolute / 1000n).toString() + "." + (absolute % 1000n).toString().padStart(3, "0");
}

// 정책 한계·보유량·요청량 중 실제 적용 가능한 최소 수량을 계산합니다.
export function calculateAppliedCount(input: {
  requested: bigint;
  available: bigint;
  currentMilli: bigint;
  adjustmentMilli: bigint;
  minimumMilli: bigint;
  maximumMilli: bigint;
}): bigint {
  const room =
    input.adjustmentMilli > 0n
      ? (input.maximumMilli - input.currentMilli) / input.adjustmentMilli
      : (input.currentMilli - input.minimumMilli) / -input.adjustmentMilli;
  return [input.requested, input.available, room].reduce(
    (minimum, value) => (value < minimum ? value : minimum),
  );
}

// 길드·전쟁·권한·아이템을 잠근 뒤 사용 이력과 조정값을 한 transaction으로 반영합니다.
export class GuildTerritoryRiftControlService {
  constructor(private readonly database: DatabaseClient) {}

  async handleDispatchedIris(input: {
    externalUserId: string;
    channelId: string;
    message: string;
    eventId: string;
  }): Promise<
    | { status: "changed"; data: string; outboxId: string }
    | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({
      eventId: input.eventId,
      message: normalizeGuildTerritoryRiftControlDispatchMessage(input.message),
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.handleIris(input);
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async handleIris(input: {
    externalUserId: string;
    channelId: string;
    message: string;
    eventId: string;
  }): Promise<GuildTerritoryRiftControlResult | null> {
    const command = parseGuildTerritoryRiftControlCommand(input.message);
    if (command === null) {
      throw new ApplicationError("INVALID_GUILD_RIFT_CONTROL_COMMAND", "균열 제어 명령 형식이 올바르지 않습니다.", 422);
    }
    return this.execute({
      eventId: input.eventId,
      externalUserId: input.externalUserId,
      destinationId: input.channelId,
      command,
    });
  }

  async execute(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
    command: GuildTerritoryRiftControlCommand;
  }): Promise<GuildTerritoryRiftControlResult | null> {
    const eventKey =
      input.eventId.length <= 191
        ? input.eventId
        : "sha256:" + createHash("sha256").update(input.eventId).digest("hex");
    return withRiftControlRetry(() =>
      this.database.withTransaction(async (transaction) => {
        const previous = (
          await transaction.query<Array<{ result_json: string | GuildTerritoryRiftControlResult | null }>>(
            "SELECT result_json FROM operations WHERE idempotency_scope='guild.territory.rift_control' AND idempotency_key=? FOR UPDATE",
            [eventKey],
          )
        )[0];
        if (previous?.result_json != null) {
          return typeof previous.result_json === "string"
            ? JSON.parse(previous.result_json)
            : previous.result_json;
        }

        const actor = (
          await transaction.query<ActorRow[]>(
            "SELECT identity.id identity_id,identity.player_id,membership.guild_id,guild.display_name guild_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' LEFT JOIN guild_members membership ON membership.player_id=identity.player_id LEFT JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1 FOR UPDATE",
            [input.externalUserId],
          )
        )[0];
        if (actor === undefined) return null;
        const policy = (
          await transaction.query<PolicyRow[]>(
            "SELECT type_code,command_text,item_code,adjustment_target,CAST(adjustment_per_unit AS CHAR) adjustment_per_unit,CAST(minimum_value AS CHAR) minimum_value,CAST(maximum_value AS CHAR) maximum_value,maximum_batch,count_argument_allowed FROM guild_territory_rift_command_types WHERE type_code=? AND active=TRUE FOR UPDATE",
            [input.command.kind],
          )
        )[0];
        if (policy === undefined) throw new Error("Guild territory rift command policy is missing.");
        const operation = await transaction.execute(
          "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.territory.rift_control',?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), eventKey, actor.player_id],
        );

        const complete = async (
          status: GuildTerritoryRiftControlResult["status"],
          data: string,
          appliedCount = 0n,
          beforeValue?: string,
          afterValue?: string,
          summary: Record<string, unknown> = {},
        ): Promise<GuildTerritoryRiftControlResult> => {
          const outbox = await transaction.execute(
            "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [operation.insertId, input.destinationId, JSON.stringify({ data })],
          );
          await transaction.execute(
            "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_TERRITORY_RIFT_CONTROL',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [input.eventId, operation.insertId, status],
          );
          await transaction.execute(
            "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.territory.rift_control',?,'Iris guild territory rift control',?,UTC_TIMESTAMP(3))",
            [
              operation.insertId,
              actor.player_id,
              actor.guild_id ?? actor.player_id,
              status,
              JSON.stringify({
                kind: input.command.kind,
                requestedCount: input.command.requestedCount.toString(),
                appliedCount: appliedCount.toString(),
                ...summary,
              }),
            ],
          );
          const result: GuildTerritoryRiftControlResult = {
            status,
            kind: input.command.kind,
            requestedCount: input.command.requestedCount.toString(),
            appliedCount: appliedCount.toString(),
            ...(beforeValue === undefined ? {} : { beforeValue }),
            ...(afterValue === undefined ? {} : { afterValue }),
            data,
            outboxId: outbox.insertId.toString(),
          };
          await transaction.execute(
            "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
            [JSON.stringify(result), operation.insertId],
          );
          return result;
        };

        if (actor.guild_id === null || actor.guild_name === null) {
          return complete("guild_required", "길드에 가입한 회원만 사용할 수 있습니다.");
        }
        const wars = await transaction.query<WarRow[]>(
          "SELECT id,active,CAST(instability_adjust AS CHAR) instability_adjust,CAST(rift_bias AS CHAR) rift_bias,version FROM guild_territory_wars WHERE active=TRUE ORDER BY id DESC LIMIT 2 FOR UPDATE",
        );
        if (wars.length === 0) return complete("war_inactive", "현재 진행 중인 길드 영지전이 없습니다.");
        if (wars.length > 1) throw new Error("Multiple active guild territory wars detected.");
        const war = wars[0]!;
        const ready = (
          await transaction.query<Array<{ ready: number; eliminated_at: string | null }>>(
            "SELECT ready,DATE_FORMAT(eliminated_at,'%Y-%m-%d %H:%i:%s') eliminated_at FROM guild_territory_ready_guilds WHERE war_id=? AND guild_id=? FOR UPDATE",
            [war.id, actor.guild_id],
          )
        )[0];
        if (ready === undefined || ready.ready !== 1) {
          return complete("guild_not_ready", "영지전 참가 준비가 완료된 길드만 사용할 수 있습니다.");
        }
        if (ready.eliminated_at !== null) {
          return complete("guild_eliminated", "이미 영지전에서 탈락한 길드는 사용할 수 없습니다.");
        }
        const authorization = (
          await transaction.query<Array<{ authority_code: string }>>(
            "SELECT authority_code FROM guild_territory_rift_authorizations WHERE guild_id=? AND player_id=? AND active=TRUE ORDER BY authority_code LIMIT 1 FOR UPDATE",
            [actor.guild_id, actor.player_id],
          )
        )[0];
        if (authorization === undefined) {
          return complete("authority_required", "소드마스터 또는 전투형 지휘관만 사용할 수 있습니다.");
        }
        if (
          input.command.requestedCount === 0n ||
          input.command.requestedCount > BigInt(policy.maximum_batch) ||
          (policy.count_argument_allowed !== 1 && input.command.requestedCount !== 1n)
        ) {
          return complete(
            "invalid_count",
            policy.count_argument_allowed === 1
              ? "사용 수량은 1~" + policy.maximum_batch.toString() + "개여야 합니다."
              : policy.command_text + " 명령은 수량을 입력할 수 없습니다.",
          );
        }
        const priorUse = (
          await transaction.query<Array<{ operation_id: bigint }>>(
            "SELECT operation_id FROM guild_territory_rift_command_uses WHERE war_id=? AND guild_id=? AND command_type=? FOR UPDATE",
            [war.id, actor.guild_id, policy.type_code],
          )
        )[0];
        if (priorUse !== undefined) {
          return complete("already_used", "이번 영지전에서 해당 균열 제어 아이템은 이미 사용했습니다.");
        }
        const item = (
          await transaction.query<
            Array<{ item_id: bigint; display_name: string; quantity: bigint; version: bigint }>
          >(
            "SELECT item.id item_id,item.display_name,COALESCE(stack.quantity,0) quantity,COALESCE(stack.version,0) version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE FOR UPDATE",
            [actor.player_id, policy.item_code],
          )
        )[0];
        if (item === undefined || BigInt(item.quantity) === 0n) {
          return complete("item_shortage", "사용할 균열 제어 아이템이 없습니다.");
        }
        const currentText =
          policy.adjustment_target === "instability_adjust" ? war.instability_adjust : war.rift_bias;
        const currentMilli = decimalToMilli(currentText);
        const adjustmentMilli = decimalToMilli(policy.adjustment_per_unit);
        const minimumMilli = decimalToMilli(policy.minimum_value);
        const maximumMilli = decimalToMilli(policy.maximum_value);
        const appliedCount = calculateAppliedCount({
          requested: input.command.requestedCount,
          available: BigInt(item.quantity),
          currentMilli,
          adjustmentMilli,
          minimumMilli,
          maximumMilli,
        });
        if (appliedCount <= 0n) {
          return complete("limit_reached", "해당 균열 제어 수치는 이미 적용 한도에 도달했습니다.");
        }
        const afterMilli = currentMilli + adjustmentMilli * appliedCount;
        const afterText = milliToDecimal(afterMilli);
        const stackChanged = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?",
          [appliedCount, actor.player_id, item.item_id, item.version, appliedCount],
        );
        if (stackChanged.affectedRows !== 1n) throw new Error("Guild rift control inventory conflict.");
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'GUILD_TERRITORY_RIFT_CONTROL_USE')",
          [operation.insertId, actor.player_id, item.item_id, -appliedCount],
        );
        const warChanged =
          policy.adjustment_target === "instability_adjust"
            ? await transaction.execute(
                "UPDATE guild_territory_wars SET instability_adjust=?,version=version+1 WHERE id=? AND version=?",
                [afterText, war.id, war.version],
              )
            : await transaction.execute(
                "UPDATE guild_territory_wars SET rift_bias=?,version=version+1 WHERE id=? AND version=?",
                [afterText, war.id, war.version],
              );
        if (warChanged.affectedRows !== 1n) throw new Error("Guild territory war version conflict.");
        await transaction.execute(
          "INSERT INTO guild_territory_rift_command_uses(war_id,guild_id,command_type,operation_id,player_id,item_id,requested_count,applied_count,before_value,after_value,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",
          [
            war.id,
            actor.guild_id,
            policy.type_code,
            operation.insertId,
            actor.player_id,
            item.item_id,
            input.command.requestedCount,
            appliedCount,
            currentText,
            afterText,
          ],
        );
        const data =
          "✅ [" +
          actor.guild_name +
          "] 길드가 " +
          item.display_name +
          " " +
          appliedCount.toString() +
          "개를 사용했습니다.\n" +
          (policy.adjustment_target === "rift_bias" ? "균열 편향" : "전쟁불안정 조정") +
          ": " +
          currentText +
          "% → " +
          afterText +
          "%";
        return complete("changed", data, appliedCount, currentText, afterText, {
          warId: war.id.toString(),
          guildId: actor.guild_id.toString(),
          authorityCode: authorization.authority_code,
          itemCode: policy.item_code,
          adjustmentTarget: policy.adjustment_target,
        });
      }),
    );
  }
}

async function withRiftControlRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const value = error as { code?: unknown; errno?: unknown };
      const retryable =
        value.code === "ER_LOCK_DEADLOCK" ||
        value.code === "ER_LOCK_WAIT_TIMEOUT" ||
        value.code === "ER_DUP_ENTRY" ||
        value.errno === 1213 ||
        value.errno === 1205 ||
        value.errno === 1062;
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Guild territory rift control retry exhausted.");
}
