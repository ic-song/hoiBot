export const ADMIN_DRAW_GRANT_COMMAND = "/부방상여";
export const ADMIN_DRAW_GRANT_ACTOR_NAME = "호이 남";
export const ADMIN_DRAW_GRANT_QUANTITY = 1000n;

export interface AdminDrawGrantCommand {
  externalUserId: string;
  actorDisplayName?: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface AdminDrawGrantResult {
  status: "granted" | "ignored_forbidden";
  data?: string;
  operatorId?: string;
  itemCode?: string;
  quantityDelta?: string;
  recipients?: Array<{ playerId: string; displayName: string; quantity: string }>;
  outboxId?: string;
  auditId?: string;
}

export interface AdminDrawGrantRepository {
  grant(command: AdminDrawGrantCommand): Promise<AdminDrawGrantResult>;
}

// exact `/부방상여` 명령 후보만 반환합니다.
export function isAdminDrawGrantCommand(message: string | undefined): boolean {
  return message === ADMIN_DRAW_GRANT_COMMAND;
}

// legacy 고정 발신자 이름을 먼저 확인한 뒤 DB 원자 지급을 실행합니다.
export class AdminDrawGrantService {
  constructor(private readonly repository: AdminDrawGrantRepository) {}

  async handle(command: AdminDrawGrantCommand): Promise<AdminDrawGrantResult> {
    if (!isAdminDrawGrantCommand(command.message) || command.actorDisplayName !== ADMIN_DRAW_GRANT_ACTOR_NAME) {
      return { status: "ignored_forbidden" };
    }
    return this.repository.grant(command);
  }
}
