import type { DatabaseClient } from "../database.js";
import { ChangePlayerServerService } from "../player/change-player-server-service.js";
import { ApplicationError } from "../shared/application-error.js";

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
         AND permission.permission_code = 'player.server.change' LIMIT 1`,
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
}
