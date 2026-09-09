export type HoiPassCommand =
  | { action: "add"; target: string; option: "permanent" | "dated"; endDate: string | null; rawEndDate: string }
  | { action: "delete"; target: string };

const ADD = "/호이패스추가";
const DELETE = "/호이패스삭제";

// 호이패스 추가·삭제 후보를 legacy의 쉼표 포함 완전 입력형식으로 제한합니다.
export function isHoiPassCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/호이패스(?:추가|삭제),\s*.+$/.test(message);
}

function validDate(raw: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
}

// 쉼표 뒤 대상과 선택적 종료일·영구권을 해석합니다.
export function parseHoiPassCommand(message: string): HoiPassCommand | null {
  if (!isHoiPassCommandCandidate(message)) return null;
  const comma = message.indexOf(",");
  const body = message.slice(comma + 1).trim();
  if (!body) return null;
  if (message.startsWith(`${DELETE},`)) return { action: "delete", target: body };
  const parts = body.split(/\s+/);
  const last = parts.at(-1)!;
  if (last === "영구권") {
    const target = parts.slice(0, -1).join(" ").trim();
    return target ? { action: "add", target, option: "permanent", endDate: null, rawEndDate: "영구권" } : null;
  }
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(last)) {
    const target = parts.slice(0, -1).join(" ").trim();
    const endDate = validDate(last);
    return target && endDate ? { action: "add", target, option: "dated", endDate, rawEndDate: last } : null;
  }
  return { action: "add", target: body, option: "permanent", endDate: null, rawEndDate: "영구권" };
}

// parameterized 명령을 DB registry 대표 alias로 정규화합니다.
export function normalizeHoiPassDispatchMessage(message: string): string {
  const command = parseHoiPassCommand(message);
  return command?.action === "add" ? ADD : command?.action === "delete" ? DELETE : message;
}
