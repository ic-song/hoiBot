import type { DatabaseClient } from "../database.js";
import { readKakaoVerificationCommand } from "./policy.js";

const PUBLIC_COMMANDS = new Set(["/도움말", "/ping", "/info"]);

// 외부 플랫폼에서 사이트 연결 없이 사용할 수 있는 공개 명령을 판정합니다.
export function isPublicExternalPlatformCommand(message: string | undefined): boolean {
  return message !== undefined
    && (PUBLIC_COMMANDS.has(message) || readKakaoVerificationCommand(message) !== null);
}

// 현재·향후 슬래시 명령과 기존 가입 동의 응답을 사이트 연결 필요 대상으로 분류합니다.
export function requiresLinkedSiteAccount(message: string | undefined): boolean {
  if (message === undefined || isPublicExternalPlatformCommand(message)) return false;
  return message.startsWith("/") || message === "시작한다" || message === "거절한다";
}

export class ExternalPlatformAccessService {
  constructor(private readonly database: DatabaseClient) {}

  // 활성 사이트 계정과 외부 ID 연결이 모두 유효한지 확인합니다.
  async hasActiveSiteAccount(providerCode: string, externalUserId: string): Promise<boolean> {
    const rows = await this.database.query<Array<{ linked: number }>>(
      `SELECT 1 AS linked
       FROM external_identities identity
       JOIN user_account_external_identities link ON link.external_identity_id = identity.id
       JOIN user_accounts account_row ON account_row.id = link.user_account_id
       WHERE identity.provider_code = ? AND identity.external_user_id = ?
         AND identity.status = 'linked' AND link.status = 'active'
         AND account_row.status = 'active' AND account_row.player_id = identity.player_id
       LIMIT 1`,
      [providerCode, externalUserId]
    );
    return rows[0] !== undefined;
  }
}
