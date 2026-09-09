import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService, type AdminStackGrantCommand, type AdminStackGrantResult } from "./admin-stack-grant-service.js";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const ITEM_CODE = "ITEM-LEGENDARY-STONE-DRAW-TICKET";
const ITEM_NAME = "전설의돌 뽑기🩶[2](/전돌뽑기 숫자)";

// 동일 이벤트의 동시 insert 충돌만 짧게 재시도해 저장된 완료 결과로 수렴시킵니다.
function isRetryableIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ER_LOCK_DEADLOCK" || code === "ER_DUP_ENTRY" || code === "ER_LOCK_WAIT_TIMEOUT";
}

// trim된 `/전돌[수량], 대상키` 전체 형식만 관리자 지급 후보로 허용합니다.
export function isLegendaryStoneTicketGrantCandidate(message: string | undefined): boolean {
  if (message === undefined) return false;
  return /^\/전돌\d*,\s*\S(?:.*\S)?$/.test(message.trim());
}

// 생략 수량 1과 공백을 포함할 수 있는 대상 회원 키를 보존해 파싱합니다.
export function parseLegendaryStoneTicketGrantCommand(message: string): AdminStackGrantCommand {
  const match = /^\/전돌(\d*)?,\s*(.+)$/.exec(message.trim());
  if (match === null) return null;
  const targetLegacyKey = match[2]!.trim();
  if (targetLegacyKey === "") return null;
  const amount = BigInt(match[1] === undefined || match[1] === "" ? "1" : match[1]);
  if (amount > MAX_UINT64) return null;
  return { amount, targetLegacyKey };
}

// 인자형 명령을 DB command alias로 정규화합니다.
export function normalizeLegendaryStoneTicketGrantDispatchMessage(message: string): string {
  return isLegendaryStoneTicketGrantCandidate(message) ? "/전돌," : message;
}

// 총괄 운영자 권한 확인 후 공용 stack 지급 provider로 전설의돌 뽑기 티켓을 원자 지급합니다.
export class LegendaryStoneTicketGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: { eventId: string; destinationId: string; externalUserId: string; message: string }): Promise<AdminStackGrantResult | null> {
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(`SELECT mapping.operator_id
      FROM external_identities identity
      JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id
      JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
      JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        AND operator.status='active' AND permission.permission_code='inventory.legendary_stone_ticket.grant'
      ORDER BY mapping.operator_id LIMIT 1`, [input.externalUserId]);
    const operator = operators[0];
    if (operator === undefined) return null;
    return this.grantAuthorized({ eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id.toString(), message: input.message });
  }

  async grantAuthorized(input: { eventId: string; destinationId: string; operatorId: string; message: string }): Promise<AdminStackGrantResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await new AdminStackGrantService(this.database).grant(
          {
            eventId: input.eventId,
            destinationId: input.destinationId,
            operatorId: input.operatorId,
            command: parseLegendaryStoneTicketGrantCommand(input.message)
          },
          {
            commandCode: "ADMIN_LEGENDARY_STONE_TICKET_GRANT",
            itemCode: ITEM_CODE,
            itemName: ITEM_NAME,
            idempotencyScope: "admin.legendary_stone_ticket.grant",
            actionCode: "inventory.legendary_stone_ticket.grant",
            reasonCode: "ADMIN_LEGENDARY_STONE_TICKET_GRANT",
            auditReason: "Iris 총괄 운영자 /전돌,",
            usageMessage: "올바른 형식으로 입력해 주세요. 예: /전돌10, 유저아이디",
            invalidAmountMessage: "지급 개수는 1개 이상이어야 합니다.",
            noTargetMessage: "유저 아이디를 확인해 주세요.",
            formatGranted: (target, amount) => `${target}님에게 ${ITEM_NAME} ${amount.toString()}개를 지급했습니다.`
          }
        );
      } catch (error) {
        if (!isRetryableIdempotencyConflict(error) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    throw new Error("전설의돌 티켓 지급 재시도 한도를 초과했습니다.");
  }
}
