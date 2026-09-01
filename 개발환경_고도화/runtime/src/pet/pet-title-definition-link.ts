import { createHash } from "node:crypto";
import type { DatabaseTransaction } from "../database.js";

export const PET_ADMIN_CUSTOM_SCOPE = "PET_ADMIN_CUSTOM";
export const PET_USER_CUSTOM_SCOPE = "PET_USER_CUSTOM";

export interface PetTitleDefinitionLink {
  titleId: bigint;
  catalogEntryId: bigint;
  sourceScope: typeof PET_ADMIN_CUSTOM_SCOPE | typeof PET_USER_CUSTOM_SCOPE;
  stableCode: string;
  definitionCode: string;
  displayName: string;
}

export interface PetTitleDefinitionLinkRepository {
  ensure(transaction: DatabaseTransaction, input: Omit<PetTitleDefinitionLink, "titleId" | "catalogEntryId">): Promise<PetTitleDefinitionLink>;
}

// 동일 표시명과 hash도 admin/user source scope별 canonical identity로 분리합니다.
export class PetTitleDefinitionLinkProvider {
  public constructor(private readonly repository: PetTitleDefinitionLinkRepository) {}

  public ensureAdminCustom(transaction: DatabaseTransaction, displayName: string): Promise<PetTitleDefinitionLink> {
    return this.ensure(transaction, PET_ADMIN_CUSTOM_SCOPE, displayName);
  }

  public ensureUserCustom(transaction: DatabaseTransaction, displayName: string): Promise<PetTitleDefinitionLink> {
    return this.ensure(transaction, PET_USER_CUSTOM_SCOPE, displayName);
  }

  private ensure(
    transaction: DatabaseTransaction,
    sourceScope: PetTitleDefinitionLink["sourceScope"],
    displayName: string,
  ): Promise<PetTitleDefinitionLink> {
    const hash = createHash("sha256").update(displayName).digest("hex");
    return this.repository.ensure(transaction, {
      sourceScope,
      stableCode: `${sourceScope}:${hash}`,
      definitionCode: `${sourceScope}_${hash}`,
      displayName,
    });
  }
}
