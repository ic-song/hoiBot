export type TerritoryTicketScope = "offense" | "defense";

export interface TerritoryTicketRecord {
  ticketCode: string;
  objectKey: string;
  itemCode: string;
  scope: TerritoryTicketScope;
  sourceKey: string;
  displayName: string;
  displayRatePercent: number;
  successRate: string | number;
  displayOrder: number;
  sourceHash: string;
  sourceFileHash?: string;
  catalogVersion: string;
  reusedCanonical?: boolean;
}

export interface TerritoryTicketSummary {
  rows: number;
  offense: number;
  defense: number;
  reusedCanonical: number;
}

// 영지권 원천 identity와 표시 확률·실제 성공률을 검증한다.
export function assertTerritoryTicketCatalog(rows: readonly TerritoryTicketRecord[], expectedRows = 6): TerritoryTicketSummary {
  if (rows.length !== expectedRows) throw new Error(`territory ticket count mismatch: ${rows.length}/${expectedRows}`);
  const tickets = new Set<string>();
  const objects = new Set<string>();
  const items = new Set<string>();
  const sources = new Set<string>();
  const orders = new Set<number>();
  let offense = 0;
  let defense = 0;
  let reusedCanonical = 0;
  for (const row of rows) {
    if (!/^TERRITORY-TICKET-(OFFENSE|DEFENSE)-ITEM-\d+$/.test(row.ticketCode)) throw new Error(`invalid ticketCode: ${row.ticketCode}`);
    if (!/^item\.guild-territory\.ticket-(offense|defense)-item-\d+$/.test(row.objectKey)) throw new Error(`invalid objectKey: ${row.objectKey}`);
    if (row.scope !== "offense" && row.scope !== "defense") throw new Error("invalid scope");
    const sourceIdentity = `${row.scope}/${row.sourceKey}`;
    for (const entry of [[tickets, row.ticketCode, "ticketCode"], [objects, row.objectKey, "objectKey"], [items, row.itemCode, "itemCode"], [sources, sourceIdentity, "sourceIdentity"]] as const) {
      if (entry[0].has(entry[1])) throw new Error(`duplicate ${entry[2]}: ${entry[1]}`);
      entry[0].add(entry[1]);
    }
    if (orders.has(row.displayOrder)) throw new Error("duplicate displayOrder");
    orders.add(row.displayOrder);
    if (!Number.isInteger(row.displayRatePercent) || row.displayRatePercent < 1 || row.displayRatePercent > 100) throw new Error("invalid displayRatePercent");
    if (!row.displayName.includes(`(${row.displayRatePercent}%)`)) throw new Error("display rate label mismatch");
    const successRate = Number(row.successRate);
    if (!Number.isFinite(successRate) || successRate < 0 || successRate > 1) throw new Error("invalid successRate");
    if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new Error("invalid source hash");
    if (row.scope === "offense") offense += 1; else defense += 1;
    if (row.reusedCanonical === true) reusedCanonical += 1;
  }
  for (let order = 1; order <= expectedRows; order += 1) if (!orders.has(order)) throw new Error(`missing displayOrder: ${order}`);
  if (offense !== 3 || defense !== 3) throw new Error("scope count mismatch");
  return { rows: rows.length, offense, defense, reusedCanonical };
}
