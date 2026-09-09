export const HOME_SOCIAL_BADGE_MIGRATION_COMMAND = "/펫홈소셜뱃지마이그레이션";

// 레거시 운영 명령과 동일하게 인자 없는 정확 일치만 허용합니다.
export function isHomeSocialBadgeMigrationCommand(message: string | undefined): boolean {
  return message === HOME_SOCIAL_BADGE_MIGRATION_COMMAND;
}

export function normalizeHomeSocialBadgeMigrationDispatchMessage(message: string): string {
  return isHomeSocialBadgeMigrationCommand(message) ? HOME_SOCIAL_BADGE_MIGRATION_COMMAND : message;
}
