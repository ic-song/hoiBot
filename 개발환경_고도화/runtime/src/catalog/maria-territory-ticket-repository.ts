import type { DatabaseClient } from "../database.js";
import type { TerritoryTicketRecord, TerritoryTicketScope } from "./territory-ticket-catalog.js";

interface Row {
  ticket_code: string;
  object_key: string;
  item_code: string;
  scope_code: TerritoryTicketScope;
  source_item_key: string;
  display_name: string;
  display_rate_percent: number;
  success_rate: string;
  display_order: number;
  source_hash: string;
  catalog_version: string;
}

const SELECT = "SELECT ticket.ticket_code,registry.object_key,item.code item_code,ticket.scope_code,ticket.source_item_key,ticket.display_name,ticket.display_rate_percent,CAST(ticket.success_rate AS CHAR) success_rate,ticket.display_order,ticket.source_hash,ticket.catalog_version FROM guild_territory_ticket_definitions ticket JOIN object_registry registry ON registry.id=ticket.object_id AND registry.object_type='ITEM' AND registry.active=TRUE JOIN item_definitions item ON item.id=ticket.item_id AND item.active=TRUE WHERE ticket.active=TRUE";

// MariaDB 영지권 행을 공용 카탈로그 형태로 변환한다.
function map(row: Row): TerritoryTicketRecord {
  return {
    ticketCode: row.ticket_code,
    objectKey: row.object_key,
    itemCode: row.item_code,
    scope: row.scope_code,
    sourceKey: row.source_item_key,
    displayName: row.display_name,
    displayRatePercent: Number(row.display_rate_percent),
    successRate: row.success_rate,
    displayOrder: Number(row.display_order),
    sourceHash: row.source_hash,
    catalogVersion: row.catalog_version,
    reusedCanonical: row.item_code === "ITEM-TERRITORY-DEFENSE-50"
  };
}

export class MariaTerritoryTicketRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listActive(): Promise<TerritoryTicketRecord[]> {
    const rows = await this.database.query<Row[]>(`${SELECT} ORDER BY ticket.display_order`);
    return rows.map(map);
  }

  async findBySource(scope: TerritoryTicketScope, sourceKey: string): Promise<TerritoryTicketRecord | undefined> {
    const rows = await this.database.query<Row[]>(`${SELECT} AND ticket.scope_code=? AND ticket.source_item_key=? LIMIT 1`, [scope, sourceKey]);
    return rows[0] === undefined ? undefined : map(rows[0]);
  }
}
