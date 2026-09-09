import type { DatabaseTransaction } from "../database.js";
import { sortServerStatCounts, type ServerStatCount, type ServerStatsRepository } from "./server-stats-repository.js";

// 활성 서버별 활성 회원과 서버 미지정 활성 회원을 pagination 없이 한 snapshot으로 집계합니다.
export class MariaServerStatsRepository implements ServerStatsRepository {
  constructor(private readonly database: Pick<DatabaseTransaction,"query">) {}

  async listActiveMemberCounts(): Promise<ServerStatCount[]> {
    const rows=await this.database.query<Array<{server_code:string;server_display_name:string;active_member_count:bigint}>>(
      `SELECT server.code server_code,server.display_name server_display_name,COUNT(player.id) active_member_count
         FROM game_servers server
         LEFT JOIN player_profiles profile ON profile.game_server_id=server.id
         LEFT JOIN players player ON player.id=profile.player_id AND player.status='active'
        WHERE server.active=TRUE
        GROUP BY server.id,server.code,server.display_name
       UNION ALL
       SELECT '__unknown__' server_code,'미지정' server_display_name,COUNT(player.id) active_member_count
         FROM players player
         JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN game_servers server ON server.id=profile.game_server_id
        WHERE player.status='active' AND (profile.game_server_id IS NULL OR server.id IS NULL OR server.active=FALSE)
       HAVING COUNT(player.id)>0`
    );
    return sortServerStatCounts(rows.map(row=>({serverCode:row.server_code,serverDisplayName:row.server_display_name,activeMemberCount:BigInt(row.active_member_count)})));
  }
}
