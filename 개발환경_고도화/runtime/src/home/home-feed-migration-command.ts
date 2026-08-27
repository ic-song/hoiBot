export const HOME_FEED_MIGRATION_COMMAND = "/펫홈피드마이그레이션";

// 파괴적 일괄 이관 명령은 레거시와 동일한 인자 없는 정확 일치만 허용합니다.
export function isHomeFeedMigrationCommand(message: string | undefined): boolean {
  return message === HOME_FEED_MIGRATION_COMMAND;
}

export function normalizeHomeFeedMigrationDispatchMessage(message: string): string {
  return isHomeFeedMigrationCommand(message) ? HOME_FEED_MIGRATION_COMMAND : message;
}
