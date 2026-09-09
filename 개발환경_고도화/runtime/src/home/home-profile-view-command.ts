export type HomeProfileViewCommand = { targetName: string | null };

// exact 자기 홈과 공백 뒤 완전한 대상명 형식만 펫홈 후보로 허용합니다.
export function isHomeProfileViewCandidate(message: string | undefined): boolean {
  if (message === undefined || !message.startsWith("/펫홈")) return false;
  return message.trim() === "/펫홈" || /^\/펫홈\s+\S(?:.*\S)?$/.test(message);
}

// 내부 공백을 하나로 접어 다단어 대상명을 안정적으로 해석합니다.
export function parseHomeProfileViewCommand(message: string): HomeProfileViewCommand | null {
  if (!isHomeProfileViewCandidate(message)) return null;
  const rest = message.slice(3).trim();
  return { targetName: rest === "" ? null : rest.split(/\s+/).join(" ") };
}

// parameterized 펫홈 조회를 exact DB alias로 정규화합니다.
export function normalizeHomeProfileViewDispatchMessage(message: string): string {
  return isHomeProfileViewCandidate(message) ? "/펫홈" : message;
}
