import type { DatabaseClient } from "../database.js";
import { CurrencyService } from "../currency/currency-service.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

type DiamondEditMode = "add" | "subtract";

// 관리자 다이아 증감 명령을 권한·대상·rollout 검증 후 공용 통화 트랜잭션으로 실행합니다.
export class AdminDiamondEditService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const parsed = parseAdminDiamondEditCommand(input.message);
    if (parsed === undefined) throw new ApplicationError("INVALID_DIAMOND_EDIT_COMMAND", "다이아 명령 형식이 올바르지 않습니다.", 422);
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state, enabled FROM command_registry WHERE command_code = 'ADMIN_DIAMOND_EDIT' LIMIT 1"
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "ADMIN_DIAMOND_EDIT", handlerKey: "admin_diamond_edit" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_DIAMOND_EDIT", handlerKey: "admin_diamond_edit" });
      return { status: "shadow" };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND operator.status = 'active'
         AND permission.permission_code = 'game.currency.change' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "다이아 변경 권한이 없습니다.", 403);
    const targets = await this.database.query<Array<{ player_id: bigint }>>(
      "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2", [parsed.targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${parsed.targetName}] 님은 존재하지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    const result = await new CurrencyService(this.database).adjustByAdmin({
      playerId: targets[0]!.player_id.toString(), targetDisplayName: parsed.targetName, currencyCode: "diamond",
      mode: parsed.mode, amount: parsed.amount, reasonCode: parsed.mode === "add" ? "admin_diamond_add" : "admin_diamond_subtract",
      reason: parsed.mode === "add" ? "Iris 총괄 운영자 /다이아추가" : "Iris 총괄 운영자 /다이아차감",
      idempotencyKey: input.eventId, actor: { type: "admin_operator", id: operators[0]!.operator_id.toString() },
      sourceCode: "iris", sourceEventId: input.eventId, irisReplyDestinationId: input.channelId
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }
}

// 전체 명령 형식에서 공백 포함 대상명과 양의 정수 수량을 분리합니다.
function parseAdminDiamondEditCommand(message: string): { mode: DiamondEditMode; targetName: string; amount: string } | undefined {
  const match = /^\/다이아(추가|차감)\s+(.+?)\s+([1-9]\d{0,26})$/.exec(message);
  if (match === null) return undefined;
  return { mode: match[1] === "추가" ? "add" : "subtract", targetName: match[2]!.trim(), amount: match[3]! };
}

// 다이아 증감 후보를 전체 패턴으로 제한해 접미 문구와 0 수량 실행을 차단합니다.
export function isAdminDiamondEditCommand(message: string | undefined): boolean {
  return message !== undefined && parseAdminDiamondEditCommand(message) !== undefined;
}

// 인자형 명령을 DB command_aliases의 기본 명령어로 정규화합니다.
export function normalizeAdminDiamondEditDispatchMessage(message: string): string {
  const parsed = parseAdminDiamondEditCommand(message);
  return parsed?.mode === "add" ? "/다이아추가" : parsed?.mode === "subtract" ? "/다이아차감" : message;
}
