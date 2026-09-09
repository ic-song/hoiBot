export interface ServerStatCount {
  serverCode: string;
  serverDisplayName: string;
  activeMemberCount: bigint;
}

export interface ServerStatsRepository {
  listActiveMemberCounts(): Promise<ServerStatCount[]>;
}

// 서버 표시명은 기존 한국어 비교 순서로 정렬하고 stable code를 동률 기준으로 사용합니다.
export function sortServerStatCounts(rows: ServerStatCount[]): ServerStatCount[] {
  return [...rows].sort((left,right) => left.serverDisplayName.localeCompare(right.serverDisplayName,"ko") || left.serverCode.localeCompare(right.serverCode));
}
