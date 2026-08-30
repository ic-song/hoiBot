export interface RaidItemBonusRecord {
  bonusCode: string; objectKey: string; itemCode: string; department: string; sourceKey: string;
  displayName: string; raidExpBonus: string | number | bigint; displayOrder: number;
  sourceHash: string; sourceFileHash?: string; catalogVersion: string; reusedCanonical?: boolean;
}
export interface RaidItemBonusSummary { rows: number; dept1: number; dept2: number; reusedCanonical: number; }
export function assertRaidItemBonusCatalog(rows: readonly RaidItemBonusRecord[], expectedRows=9): RaidItemBonusSummary {
  if(rows.length!==expectedRows)throw new Error("raid item count mismatch: "+rows.length+"/"+expectedRows);
  const bonuses=new Set<string>();const objects=new Set<string>();const items=new Set<string>();const sources=new Set<string>();const orders=new Set<number>();
  let dept1=0;let dept2=0;let reused=0;
  for(const row of rows){
    if(!/^RAID-SPECIAL-DEPT[12]-ITEM-\d+$/.test(row.bonusCode))throw new Error("invalid bonusCode: "+row.bonusCode);
    if(!/^item\.raid\.special-dept[12]-item-\d+$/.test(row.objectKey))throw new Error("invalid objectKey: "+row.objectKey);
    if(row.department!=="dept1"&&row.department!=="dept2")throw new Error("invalid department");
    const sourceIdentity=row.department+"/"+row.sourceKey;
    for(const entry of [[bonuses,row.bonusCode,"bonusCode"],[objects,row.objectKey,"objectKey"],[items,row.itemCode,"itemCode"],[sources,sourceIdentity,"sourceIdentity"]] as const){
      if(entry[0].has(entry[1]))throw new Error("duplicate "+entry[2]+": "+entry[1]);entry[0].add(entry[1]);
    }
    if(orders.has(row.displayOrder))throw new Error("duplicate displayOrder");orders.add(row.displayOrder);
    if(BigInt(String(row.raidExpBonus))<0n)throw new Error("raidExpBonus must be unsigned");
    if(!/^[a-f0-9]{64}$/.test(row.sourceHash))throw new Error("invalid source hash");
    if(row.department==="dept1")dept1+=1;else dept2+=1;
    if(row.reusedCanonical===true)reused+=1;
  }
  for(let order=1;order<=expectedRows;order+=1)if(!orders.has(order))throw new Error("missing displayOrder: "+order);
  if(dept1!==8||dept2!==1)throw new Error("department count mismatch");
  return {rows:rows.length,dept1,dept2,reusedCanonical:reused};
}