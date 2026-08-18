export interface PetInfoView {
  playerId: string;
  displayName: string;
  tierCode: string | null;
  pet: { name: string; typeCode: string | null; typeName: string | null; image: string | null; personality: string | null; experience: string; enhancement: string };
  title: string | null;
  elemental: { name: string; grade: string; enhancement: string } | null;
  pendant: { name: string; grade: string; durability: string | null; maxDurability: string | null; enhancement: string } | null;
  miniPet: { name: string; emoji: string | null; grade: string | null; battleCharm: string; enhancement: string } | null;
  home: { name: string; charm: string; floorArea: string } | null;
  intimacy: { level: string; progress: string; charm: string; rank: string | null };
  skill: { equipped: string; slots: string };
  charm: { raid: string; castle: string; total: string; effectiveEnhancement: string; criticalChance: string; criticalMultiplier: string; rank: string | null };
  daily: {
    towerAttempts: string; towerFloor: string; castleAttempts: string; castleScore: string; castleRank: string | null;
    miniAttempts: string; miniWins: string; miniLosses: string; exploreAttempts: string; exploreWins: string; exploreLosses: string;
    dailyQuestRewarded: boolean; weeklyQuestCount: string; petHomeCommentCount: string; feedPostCount: string; homeAlertOpenCount: string;
  };
  pass: { base: boolean; premium: boolean };
}

export interface PetInfoRepository {
  findByExternalIdentity(providerCode: string, externalUserId: string): Promise<PetInfoView | null>;
}
