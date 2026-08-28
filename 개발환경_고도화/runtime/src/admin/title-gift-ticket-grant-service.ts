import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService, type AdminStackGrantCommand, type AdminStackGrantResult } from "./admin-stack-grant-service.js";
import { AdminMemberTitleMutateService, isAdminMemberTitleMutateCandidate, normalizeAdminMemberTitleMutateDispatchMessage, type AdminMemberTitleMutateResult } from "./admin-member-title-mutate-service.js";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const ITEM_NAME = "타이틀선물권💝(/타이틀선물 닉네임 내용)";

// trim된 레거시 outer guard만 재현하고 공백형 타이틀 선택 명령은 제외합니다.
export function isTitleGiftTicketGrantCandidate(message: string | undefined): boolean {
  if (isAdminMemberTitleMutateCandidate(message)) return true;
  if (message === undefined) return false;
  const trimmed = message.trim();
  return trimmed.startsWith("/타이틀,") || /^\/타이틀\d*,/.test(trimmed);
}

// raw 메시지의 `/타이틀[수량], 대상키` 전체 형식과 기본 수량 1을 보존합니다.
export function parseTitleGiftTicketGrantCommand(message: string): AdminStackGrantCommand {
  const match = /^\/타이틀(\d*)?,\s*(.+)$/.exec(message);
  if (match === null) return null;
  const amount = BigInt(match[1] === undefined || match[1] === "" ? "1" : match[1]);
  if (amount > MAX_UINT64) return null;
  return { amount, targetLegacyKey: match[2]!.trim() };
}

// 인자형 명령을 DB의 대표 command alias로 정규화합니다.
export function normalizeTitleGiftTicketGrantDispatchMessage(message: string): string {
  if (isAdminMemberTitleMutateCandidate(message)) return normalizeAdminMemberTitleMutateDispatchMessage(message);
  return isTitleGiftTicketGrantCandidate(message) ? "/타이틀," : message;
}

// 총괄 운영자 권한 확인 후 공용 stack 지급 provider로 타이틀선물권을 원자 지급합니다.
export class TitleGiftTicketGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: { eventId: string; destinationId: string; externalUserId: string; message: string }): Promise<AdminStackGrantResult | AdminMemberTitleMutateResult | null> {
    if (isAdminMemberTitleMutateCandidate(input.message)) return new AdminMemberTitleMutateService(this.database).handle(input);
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(`SELECT mapping.operator_id
      FROM external_identities identity
      JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id
      JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
      JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        AND operator.status='active' AND permission.permission_code='inventory.title_gift_ticket.grant'
      ORDER BY mapping.operator_id LIMIT 1`, [input.externalUserId]);
    const operator = operators[0];
    if (operator === undefined) return null;
    return new AdminStackGrantService(this.database).grant(
      { eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id.toString(), command: parseTitleGiftTicketGrantCommand(input.message) },
      {
        commandCode: "ADMIN_TITLE_GIFT_TICKET_GRANT",
        itemCode: "legacy-title-gift-ticket",
        itemName: ITEM_NAME,
        idempotencyScope: "admin.title_gift_ticket.grant",
        actionCode: "inventory.title_gift_ticket.grant",
        reasonCode: "ADMIN_TITLE_GIFT_TICKET_GRANT",
        auditReason: "Iris 총괄 운영자 /타이틀,",
        usageMessage: "올바른 형식으로 입력해 주세요. 예: /시련10, 유저아이디",
        invalidAmountMessage: "지급 개수는 1개 이상이어야 합니다.",
        noTargetMessage: "유저 아이디를 확인해 주세요.",
        formatGranted: (target, amount) => `${target}님에게 ${ITEM_NAME} ${amount.toString()}개를 지급했습니다.`
      }
    );
  }
}
