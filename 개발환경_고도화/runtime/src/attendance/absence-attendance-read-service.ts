import type { DatabaseClient } from "../database.js";

export interface AbsenceAttendanceRow {
  sourceOrder: bigint | number | string;
  playerName: string;
  recentYyyymmdd: string;
}

interface AbsenceAttendanceDatabaseRow {
  source_order: bigint | number | string;
  player_name: string;
  recent_yyyymmdd: string;
}

export interface AbsenceAttendanceResult {
  daysAgo: number;
  totalCount: number;
  absentNames: string[];
  replies: [string, string];
}

// 레거시 outer guard와 숫자 인자 형식을 함께 보존합니다.
export function parseAbsenceAttendanceCommand(message: string): number | null {
  if (!message.startsWith("/미출석 ")) return null;
  const matched = message.match(/^\/미출석\s+(\d+)\s*$/);
  if (matched === null) return null;
  return Number.parseInt(matched[1]!, 10);
}

// YYYYMMDD 숫자 뺄셈과 원본 등록 순서를 그대로 사용해 레거시 응답 두 개를 만듭니다.
export function buildAbsenceAttendanceResult(
  rows: readonly AbsenceAttendanceRow[],
  daysAgo: number,
  currentDateYyyymmdd: string
): AbsenceAttendanceResult {
  const threshold = Number(currentDateYyyymmdd) - (daysAgo - 1);
  const orderedRows = rows.slice().sort((a, b) => Number(a.sourceOrder) - Number(b.sourceOrder));
  const absentNames = orderedRows
    .filter((row) => Number(row.recentYyyymmdd || "") < threshold)
    .map((row) => row.playerName);
  const totalCount = orderedRows.length;
  return {
    daysAgo,
    totalCount,
    absentNames,
    replies: [
      `전체 등록인원 ${totalCount}중 ${absentNames.length}명의 사용자가 최근${daysAgo}일 내에 ㅊㅊ하지 않았습니다.\n해당일자내 ㅊㅊ인원 : ${totalCount - absentNames.length}`,
      `미출첵 명단 \n\n${absentNames.join(", ")}`
    ]
  };
}

// 기존 출석 projection을 읽어 관리자용 미출석 명단을 조회합니다.
export class AbsenceAttendanceReadService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: {
    message: string;
    adminAllowed: boolean;
    currentDateYyyymmdd: string;
  }): Promise<AbsenceAttendanceResult | null> {
    const daysAgo = parseAbsenceAttendanceCommand(command.message);
    if (!command.adminAllowed || daysAgo === null) return null;
    const rows = await this.database.query<AbsenceAttendanceDatabaseRow[]>(
      `SELECT source_order, player_name, recent_yyyymmdd
         FROM legacy_absence_attendance_projection
        ORDER BY source_order ASC`
    );
    return buildAbsenceAttendanceResult(rows.map((row) => ({
      sourceOrder: row.source_order,
      playerName: row.player_name,
      recentYyyymmdd: row.recent_yyyymmdd
    })), daysAgo, command.currentDateYyyymmdd);
  }
}

