export interface PendantUpgradeLevelPolicy {
  targetLevel: number;
  successRate: string;
  charmIncrement: bigint;
  exploreIncrement: string;
  pointCost: bigint;
  stoneCost: bigint;
}

export interface PendantUpgradePolicyCatalog {
  policyCode: string;
  policyVersion: number;
  publishState: "PUBLISHED";
  sourceHash: string;
  levels: readonly PendantUpgradeLevelPolicy[];
}

export interface PendantPolicyCatalogRepository {
  findPublished(policyCode: string): Promise<PendantUpgradePolicyCatalog | undefined>;
}

export class PendantPolicyCatalogReadProvider {
  public constructor(private readonly repository: PendantPolicyCatalogRepository) {}

  // 지정 policy의 현재 published version과 30단계 canonical row를 조회합니다.
  public async readPublished(policyCode = "PENDANT_ENHANCE_LEGACY"): Promise<PendantUpgradePolicyCatalog> {
    const policy = await this.repository.findPublished(policyCode);
    if (!policy) throw new Error(`PENDANT_POLICY_NOT_FOUND:${policyCode}`);
    if (policy.levels.length !== 30) throw new Error(`PENDANT_POLICY_LEVEL_COUNT:${policy.levels.length}`);
    return policy;
  }
}
