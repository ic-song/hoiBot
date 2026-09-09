export interface ProfileView {
  playerId: string;
  displayName: string;
  profileVersion: string;
  server: { code: string; displayName: string } | null;
  joinedAt: string | null;
  level: string;
  accumulatedLevel: string;
  experience: { current: string; next: string | null };
  rebirthCount: string;
  termsAgreed: boolean;
  firstSponsor: boolean;
  passes: Array<{ code: string; enabled: boolean; permanent: boolean; endsAt: string | null }>;
  currencies: Record<string, string>;
  currencyAccounts: Array<{ code: string; balance: string; version: string }>;
  counters: Record<string, string>;
  activeTitle: string | null;
  titleCount: string;
  petTitleCount: string;
  guild: { id: string; name: string; mark: string | null; roleCode: string } | null;
  pet: { name: string | null; typeCode: string | null; imageValue: string | null; experience: string; enhancementLevel: string } | null;
  equippedMiniPet: { name: string; emoji: string | null; gradeCode: string | null; gradeDisplayName: string | null; progress: string; battleExperience: string } | null;
  home: { name: string | null; likes: string; charm: string; floorArea: string } | null;
  ranks: Record<string, string>;
  badges: string[];
}

export interface ProfileRepository {
  findByPlayerId(playerId: string): Promise<ProfileView | null>;
  findByExternalIdentity(providerCode: string, externalUserId: string): Promise<ProfileView | null>;
  list(search: string | undefined, limit: number, offset: number): Promise<ProfileView[]>;
  count(search: string | undefined): Promise<number>;
}
