export const HOME_FURNITURE_EQUIP_SYNC_COMMAND = "/장착가구동기화";

// 레거시와 동일하게 인자 없는 정확한 동기화 명령만 허용합니다.
export function isHomeFurnitureEquipSyncCommand(message: string | undefined): boolean {
  return message === HOME_FURNITURE_EQUIP_SYNC_COMMAND;
}

export function normalizeHomeFurnitureEquipSyncDispatchMessage(message: string): string {
  return isHomeFurnitureEquipSyncCommand(message) ? HOME_FURNITURE_EQUIP_SYNC_COMMAND : message;
}
