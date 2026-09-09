import type { DatabaseClient } from "../database.js";

export interface AttendanceListEntry {
  playerId: bigint | number | string;
  playerName: string;
  tierCode: string | null;
  sourceOrder: bigint | number | string;
  rankEmoji: string;
}

interface AttendanceListDatabaseRow {
  player_id: bigint | number | string;
  player_name: string;
  tier_code: string | null;
  source_order: bigint | number | string;
}

// Info.js의 trim 이후 exact 명령 계약을 보존합니다.
export function isAttendanceListCommand(message: string): boolean {
  return message.trim() === "/출석목록";
}

// 저장된 출석 순서와 10명 allsee 경계를 기존 형식으로 출력합니다.
export function buildAttendanceListMessage(entries: readonly AttendanceListEntry[], allsee: string): string {
  const ordered = entries.slice().sort((a, b) => Number(a.sourceOrder) - Number(b.sourceOrder));
  const rows = ordered.map((entry, index) => `${index + 1}. [${entry.rankEmoji}${entry.playerName}]`);
  let output = "출석한 유저 목록:\n";
  if (rows.length === 0) output += "출석한 유저가 없습니다.\n";
  else output += `${rows.slice(0, 10).join("\n")}\n`;
  output += `${allsee}\n`;
  if (rows.length > 10) output += rows.slice(10).join("\n");
  return output;
}

// 일일 출석 projection을 읽어 레거시 순서의 목록을 반환합니다.
export class AttendanceListReadService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly resolveRankEmoji: (tierCode: string | null, playerName: string) => Promise<string>
  ) {}

  async execute(command: {
    message: string;
    executionAllowed: boolean;
    periodKey: string;
    allsee: string;
  }): Promise<string | null> {
    if (!command.executionAllowed || !isAttendanceListCommand(command.message)) return null;
    const rows = await this.database.query<AttendanceListDatabaseRow[]>(
      `SELECT player_id, player_name, tier_code, source_order
         FROM legacy_attendance_list_projection
        WHERE period_key = ?
        ORDER BY source_order ASC, player_id ASC`,
      [command.periodKey]
    );
    const entries: AttendanceListEntry[] = [];
    for (const row of rows) {
      entries.push({
        playerId: row.player_id,
        playerName: row.player_name,
        tierCode: row.tier_code,
        sourceOrder: row.source_order,
        rankEmoji: await this.resolveRankEmoji(row.tier_code, row.player_name)
      });
    }
    return buildAttendanceListMessage(entries, command.allsee);
  }
}

