export type HomeBadgeEquipCommand =
  | { kind: "equip"; selection: string }
  | { kind: "unequip" };

// 홈뱃지 장착은 숫자 또는 ID 하나만, 해제는 정확 일치만 허용합니다.
export function parseHomeBadgeEquipCommand(message: string | undefined): HomeBadgeEquipCommand | null {
  if (message === "/홈뱃지해제") return { kind: "unequip" };
  if (message === undefined || !/^\/홈뱃지장착\s+(?:\d+|[A-Za-z]{1,4}\d{2,3})$/.test(message)) return null;
  return { kind: "equip", selection: message.replace(/^\/홈뱃지장착\s+/, "") };
}

// parameterized 장착 명령을 공용 dispatch 별칭으로 정규화합니다.
export function normalizeHomeBadgeEquipDispatchMessage(message: string): string {
  return parseHomeBadgeEquipCommand(message)?.kind === "equip" ? "/홈뱃지장착" : message;
}

export function isHomeBadgeEquipCommand(message: string | undefined): boolean {
  return parseHomeBadgeEquipCommand(message) !== null;
}
