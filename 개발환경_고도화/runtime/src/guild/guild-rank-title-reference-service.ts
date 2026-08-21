export type GuildRankTitleReferenceResult =
  | { status: "ignored" }
  | { status: "completed"; data: string };

const COMMAND = "/길드계급표";
const OUTER_RANK_TITLE = "외곽민◻︎";

// 길드계급표의 정확한 단일 명령만 신규 runtime 대상으로 분류합니다.
export function isGuildRankTitleReferenceCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// 현행 Rhino helper의 rank별 계급명 반환 동작을 그대로 보존합니다.
export function getLegacyGuildMasterRankTitle(rank: number): string {
  if (rank === 1) return "황제☬";
  if (rank === 2) return "국왕♔";
  if (rank === 3) return "대공♛";
  if (rank === 4) return "공작♕";
  if (rank === 5) return "후작⚝";
  if (rank === 6) return "백작❁";
  if (rank === 7) return "자작⌺";
  if (rank === 8) return "남작⍌";
  if (rank === 9) return "기사⍫";
  if (rank === 10) return "준기사⚔︎";
  if (rank === 11) return "종사⚚";
  if (rank === 12) return "시종✥";
  if (rank === 13) return "영주민❖";
  if (rank === 14) return "시민◈";
  if (rank === 15) return "상인◉";
  if (rank === 16) return "주민◍";
  if (rank === 17) return "일꾼◌";
  if (rank === 18) return "견습생△";
  if (rank === 19) return "떠돌이◇";
  return OUTER_RANK_TITLE;
}

// 현행 /길드계급표의 1~20위 출력 순서와 안내 문구를 만듭니다.
export function buildGuildRankTitleReferenceMessage(): string {
  let out = "👑 길드 계급표 👑\n\n";
  out += "길드 순위를 기준으로 계급이 결정됩니다.\n\n";
  for (let rank = 1; rank <= 20; rank += 1) {
    out += getLegacyGuildMasterRankTitle(rank) + "  " + rank + "등\n";
  }
  out += "\n21등 이후부터는 길드계급표시가 없습니다.";
  return out;
}

// 정적 길드 계급표 조회를 저장 변경 없이 처리합니다.
export class GuildRankTitleReferenceService {
  handle(message: string | undefined): GuildRankTitleReferenceResult {
    if (!isGuildRankTitleReferenceCommand(message)) return { status: "ignored" };
    return { status: "completed", data: buildGuildRankTitleReferenceMessage() };
  }
}
