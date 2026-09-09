export const PET_EXPLORE_RECORDS_RESET_COMMAND = "/펫탐험전체전적초기화";

// 파괴적 전체 전적 초기화는 인자 없는 exact 명령만 허용합니다.
export function isPetExploreRecordsResetCommand(message: string | undefined): boolean {
  return message === PET_EXPLORE_RECORDS_RESET_COMMAND;
}

// exact 명령만 DB command registry 대표 별칭으로 전달합니다.
export function normalizePetExploreRecordsResetDispatchMessage(message: string): string {
  return isPetExploreRecordsResetCommand(message) ? PET_EXPLORE_RECORDS_RESET_COMMAND : message;
}
