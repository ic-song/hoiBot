import { createHash } from "node:crypto";
import type { DatabaseTransaction } from "../database.js";

export const PLAYER_ADMIN_CUSTOM_SCOPE = "PLAYER_ADMIN_CUSTOM";
export const PLAYER_GIFT_SCOPE = "PLAYER_GIFT";

export interface PlayerTitleDefinitionLink {
  titleId: bigint;
  catalogEntryId: bigint;
  sourceScope: typeof PLAYER_ADMIN_CUSTOM_SCOPE | typeof PLAYER_GIFT_SCOPE;
  stableCode: string;
  displayName: string;
}

export interface PlayerTitleDefinitionLinkRepository {
  ensure(
    transaction: DatabaseTransaction,
    input: { sourceScope: PlayerTitleDefinitionLink["sourceScope"]; stableCode: string; displayName: string },
  ): Promise<PlayerTitleDefinitionLink>;
}

// 동일 표시명도 admin과 gift source scope별 stable code로 분리합니다.
export class PlayerTitleDefinitionLinkProvider {
  public constructor(private readonly repository: PlayerTitleDefinitionLinkRepository) {}

  public ensureAdminCustom(transaction: DatabaseTransaction, displayName: string): Promise<PlayerTitleDefinitionLink> {
    const hash = createHash("sha256").update(displayName).digest("hex");
    return this.repository.ensure(transaction, {
      sourceScope: PLAYER_ADMIN_CUSTOM_SCOPE,
      stableCode: `admin-custom-title:${hash.slice(0, 32)}`,
      displayName,
    });
  }

  public ensureGift(transaction: DatabaseTransaction, displayName: string): Promise<PlayerTitleDefinitionLink> {
    const hash = createHash("sha256").update(displayName).digest("hex");
    return this.repository.ensure(transaction, {
      sourceScope: PLAYER_GIFT_SCOPE,
      stableCode: `player-gift-${hash}`,
      displayName,
    });
  }
}
