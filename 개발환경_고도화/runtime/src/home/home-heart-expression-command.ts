export type HomeHeartExpressionCommandName = "마음" | "사랑해" | "귀여워" | "멋져요" | "응원해";
export interface HomeHeartExpressionCommand { name: HomeHeartExpressionCommandName; remainder: string | null }
const COMMAND_PATTERN = /^\/(마음|사랑해|귀여워|멋져요|응원해)(?:\s+(.+))?$/;

// v2.400의 다섯 마음표현 명령과 선택 인자 경계를 판별합니다.
export function parseHomeHeartExpressionCommand(message: string | undefined): HomeHeartExpressionCommand | null {
  if (message === undefined) return null;
  const match = COMMAND_PATTERN.exec(message);
  return match === null ? null : { name: match[1] as HomeHeartExpressionCommandName, remainder: match[2] ?? null };
}

// 공용 registry가 인자 포함 명령을 대표 별칭으로 조회하게 정규화합니다.
export function normalizeHomeHeartExpressionDispatchMessage(message: string): string {
  const command = parseHomeHeartExpressionCommand(message);
  return command === null ? message : `/${command.name}`;
}

// 공용 dispatch 후보 여부를 exact 명령 패턴으로 확인합니다.
export function isHomeHeartExpressionCommandCandidate(message: string | undefined): boolean {
  return parseHomeHeartExpressionCommand(message) !== null;
}
