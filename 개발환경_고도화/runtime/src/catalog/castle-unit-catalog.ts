export interface CastleUnitRecord {
  unitCode: string;
  objectKey: string;
  itemCode: string;
  sourceKey: string;
  displayName: string;
  charmPerUnit: string | number;
  displayOrder: number;
  sourceHash: string;
  sourceFileHash?: string;
  catalogVersion: string;
  reusedCanonical?: boolean;
}

export interface CastleUnitSummary {
  rows: number;
  reusedCanonical: number;
  newCanonical: number;
  totalCharm: number;
}

// 캐슬 유닛 원천 identity와 유닛당 매력 보너스를 검증한다.
export function assertCastleUnitCatalog(rows: readonly CastleUnitRecord[], expectedRows = 10): CastleUnitSummary {
  if (rows.length !== expectedRows) throw new Error(`castle unit count mismatch: ${rows.length}/${expectedRows}`);
  const units = new Set<string>();
  const objects = new Set<string>();
  const items = new Set<string>();
  const sources = new Set<string>();
  const orders = new Set<number>();
  let reusedCanonical = 0;
  let totalCharm = 0;
  for (const row of rows) {
    if (!/^CASTLE-UNIT-ITEM-\d+$/.test(row.unitCode)) throw new Error(`invalid unitCode: ${row.unitCode}`);
    if (!/^item\.castle\.unit-item-\d+$/.test(row.objectKey)) throw new Error(`invalid objectKey: ${row.objectKey}`);
    for (const entry of [[units,row.unitCode,"unitCode"],[objects,row.objectKey,"objectKey"],[items,row.itemCode,"itemCode"],[sources,row.sourceKey,"sourceKey"]] as const) {
      if (entry[0].has(entry[1])) throw new Error(`duplicate ${entry[2]}: ${entry[1]}`);
      entry[0].add(entry[1]);
    }
    if (orders.has(row.displayOrder)) throw new Error("duplicate displayOrder");
    orders.add(row.displayOrder);
    const charm = Number(row.charmPerUnit);
    if (!Number.isSafeInteger(charm) || charm <= 0) throw new Error("invalid charmPerUnit");
    if (!row.displayName.includes(`(+${charm}💕)`)) throw new Error("charm label mismatch");
    if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new Error("invalid source hash");
    totalCharm += charm;
    if (row.reusedCanonical === true) reusedCanonical += 1;
  }
  for (let order=1;order<=expectedRows;order+=1) if (!orders.has(order)) throw new Error(`missing displayOrder: ${order}`);
  return { rows: rows.length, reusedCanonical, newCanonical: rows.length-reusedCanonical, totalCharm };
}
