export type BeginnerPassCommand =
  | { action: "add"; target: string; option: "permanent" | "dated"; endDate: string | null; rawEndDate: string }
  | { action: "delete"; target: string };

const ADD = "/초보추가";
const DELETE = "/초보삭제";

// 초보패스 추가·삭제의 완전한 쉼표 명령만 실행 후보로 분류합니다.
export function isBeginnerPassCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/초보(?:패스)?(?:추가|삭제),\s*.+$/.test(message);
}

// YY.MM.DD 종료일을 검증해 DB DATE 형식으로 변환합니다.
function parseDate(raw: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(raw);
  if (match === null) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 대상 이름과 선택적 종료일·영구권을 초보패스 명령 계약으로 해석합니다.
export function parseBeginnerPassCommand(message: string): BeginnerPassCommand | null {
  if (!isBeginnerPassCommandCandidate(message)) return null;
  const comma = message.indexOf(",");
  const body = message.slice(comma + 1).trim();
  if (body === "") return null;
  if (/^\/초보(?:패스)?삭제,/.test(message)) return { action: "delete", target: body };
  const parts = body.split(/\s+/);
  const last = parts.at(-1)!;
  if (last === "영구권") {
    const target = parts.slice(0, -1).join(" ").trim();
    return target === "" ? null : { action: "add", target, option: "permanent", endDate: null, rawEndDate: "영구권" };
  }
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(last)) {
    const target = parts.slice(0, -1).join(" ").trim();
    const endDate = parseDate(last);
    return target === "" || endDate === null ? null : { action: "add", target, option: "dated", endDate, rawEndDate: last };
  }
  return { action: "add", target: body, option: "permanent", endDate: null, rawEndDate: "영구권" };
}

// 인자형 초보패스 명령을 DB registry 대표 alias로 정규화합니다.
export function normalizeBeginnerPassDispatchMessage(message: string): string {
  const command = parseBeginnerPassCommand(message);
  return command?.action === "add" ? ADD : command?.action === "delete" ? DELETE : message;
}
