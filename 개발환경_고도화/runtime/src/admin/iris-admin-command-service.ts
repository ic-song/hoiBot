import type { DatabaseClient } from "../database.js";
import { CurrencyService } from "../currency/currency-service.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ChangePlayerServerService } from "../player/change-player-server-service.js";
import { ApplicationError } from "../shared/application-error.js";
import { HoiLandEditService } from "./hoiland-edit-service.js";
import { LordIncomeService } from "./lord-income-service.js";

// 기존 `/서버이동 대상 서버명`을 같은 Application Service로 실행합니다.
export class IrisAdminCommandService {
  constructor(private readonly database: DatabaseClient) {}

  async changePlayerServer(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<{ data: string; outboxId: string }> {
    if (!/^\/서버이동\s+\S.+$/.test(input.message)) {
      throw new ApplicationError("INVALID_SERVER_CHANGE_COMMAND", "서버이동 명령 형식이 올바르지 않습니다.", 422);
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
         AND permission.permission_code = 'player.server.assign' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "서버이동 권한이 없습니다.", 403);

    const servers = await this.database.query<Array<{ code: string; display_name: string }>>(
      "SELECT code, display_name FROM game_servers WHERE active = TRUE ORDER BY CHAR_LENGTH(display_name) DESC"
    );
    const commandBody = input.message.replace(/^\/서버이동\s+/, "").trim();
    const server = servers.find((candidate) => commandBody.endsWith(candidate.display_name));
    if (server === undefined) throw new ApplicationError("INVALID_SERVER", `❌ 유효하지 않은 서버입니다.\n\n가능 서버:\n- ${servers.map((item) => item.display_name).join("\n- ")}`, 422);
    const targetName = commandBody.slice(0, -server.display_name.length).trim();
    const targets = await this.database.query<Array<{ player_id: bigint; version: bigint }>>(
      `SELECT player_id, version FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2`,
      [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 관리자 화면에서 player ID로 변경해야 합니다.", 409);
    const responseText = `✅ [${targetName}] 님의 서버가 [${server.display_name}] 로 이동되었습니다.`;
    const result = await new ChangePlayerServerService(this.database).execute({
      playerId: targets[0]!.player_id.toString(), serverCode: server.code,
      expectedVersion: targets[0]!.version.toString(), reason: "Iris 관리자 /서버이동",
      idempotencyKey: input.eventId, actorId: operators[0].operator_id.toString(), sourceCode: "iris",
      irisReply: { destinationId: input.channelId, data: responseText }, sourceEventId: input.eventId
    });
    if (result.replyOutboxId === undefined) throw new Error("Iris server-change reply outbox was not created.");
    return { data: responseText, outboxId: result.replyOutboxId };
  }

  // rollout 상태와 관리자 권한을 확인한 뒤 회원 포인트를 절대값으로 설정합니다.
  async changePlayerPoint(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    if (isLordIncomeCommandCandidate(input.message)) return this.handleLordIncomeCommand(input);
    if (isHoiLandEditCommandCandidate(input.message)) return this.changeHoiLandAmount(input);
    const match = /^\/포인트수정\s+(.+?)\s+(\d{1,27})$/.exec(input.message);
    if (match === null) throw new ApplicationError("INVALID_POINT_EDIT_COMMAND", "포인트수정 명령 형식이 올바르지 않습니다.", 422);
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state, enabled FROM command_registry WHERE command_code = 'ADMIN_POINT_EDIT' LIMIT 1"
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
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
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "포인트수정 권한이 없습니다.", 403);
    const targetName = match[1]!.trim();
    const targets = await this.database.query<Array<{ player_id: bigint }>>(
      "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2", [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    const result = await new CurrencyService(this.database).setAbsolute({
      playerId: targets[0]!.player_id.toString(), targetDisplayName: targetName, currencyCode: "point", balance: match[2]!,
      reasonCode: "admin_point_edit", reason: "Iris 총괄 운영자 /포인트수정", idempotencyKey: input.eventId,
      actor: { type: "admin_operator", id: operators[0]!.operator_id.toString() }, sourceCode: "iris",
      sourceEventId: input.eventId, irisReplyDestinationId: input.channelId
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // rollout과 운영자 권한을 확인한 뒤 회원의 모든 호이랜드 카테고리 수치를 설정합니다.
  async changeHoiLandAmount(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const match = /^\/수정\s+(.+?)\s+(\d{1,27})$/.exec(input.message);
    if (match === null) throw new ApplicationError("INVALID_HOILAND_EDIT_COMMAND", "수정 명령 형식이 올바르지 않습니다.", 422);
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state, enabled FROM command_registry WHERE command_code='ADMIN_HOILAND_EDIT' LIMIT 1"
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
         AND permission.permission_code='game.currency.change' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "수정 권한이 없습니다.", 403);
    const targetName = match[1]!.trim();
    const targets = await this.database.query<Array<{ player_id: bigint }>>(
      "SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2", [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `${targetName}은(는) 등록되어 있지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    const result = await new HoiLandEditService(this.database).setAbsolute({
      playerId: targets[0]!.player_id.toString(), targetDisplayName: targetName, amount: match[2]!,
      idempotencyKey: input.eventId, operatorId: operators[0]!.operator_id.toString(), sourceEventId: input.eventId,
      irisReplyDestinationId: input.channelId
    });
    if (result === null || result.outboxIds[0] === undefined) {
      throw new ApplicationError("HOILAND_ENTRY_NOT_FOUND", "변경할 호이랜드 항목이 없습니다.", 404);
    }
    return { status: "changed", data: result.data, outboxId: result.outboxIds[0] };
  }

  // 영주 수익 순위 조회와 총괄 운영자 전역 초기화를 같은 rollout 경계에서 처리합니다.
  async handleLordIncomeCommand(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const reset = input.message === "/영주수익순위초기화";
    const commandCode = reset ? "ADMIN_LORD_INCOME_RESET" : "LORD_INCOME_RANK_READ";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const service = new LordIncomeService(this.database);
    if (!reset) {
      const result = await service.readRanking({ idempotencyKey: input.eventId, sourceEventId: input.eventId,
        destinationId: input.channelId, externalUserId: input.externalUserId });
      return { status: "changed", data: result.data, outboxId: result.outboxId };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='game.currency.change' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "영주수익순위 초기화 권한이 없습니다.", 403);
    const result = await service.reset({ idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }
}

// 포인트수정 후보를 전체 형식으로 제한해 접미 문구 실행을 막습니다.
export function isPointEditCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (/^\/포인트수정\s+.+?\s+\d{1,27}$/.test(message) || isHoiLandEditCommandCandidate(message) || isLordIncomeCommandCandidate(message));
}

// 운영 수정 후보를 공백이 포함된 대상명과 마지막 정수의 전체 형식으로 제한합니다.
export function isHoiLandEditCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/수정\s+.+?\s+\d{1,27}$/.test(message);
}

// 영주 수익 순위 조회와 초기화는 두 정확 일치 명령만 후보로 허용합니다.
export function isLordIncomeCommandCandidate(message: string | undefined): boolean {
  return message === "/영주수익순위" || message === "/영주수익순위초기화";
}
