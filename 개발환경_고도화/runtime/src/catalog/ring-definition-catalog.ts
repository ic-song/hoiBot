export interface RingDefinitionRecord {
  gradeCode: string; objectKey: string; itemCode: string; sourceKey: string;
  gradeDisplayName: string; itemDisplayName: string; gradeOrder: number; emoji: string; names: string[];
  successRate: string | number; dropRate: string | number; itemCost: string | number | bigint;
  pointCost: string | number; maxLevel: string | number | bigint; battleExp: string | number | bigint;
  battleUpgradeExp: string | number | bigint; raidExp: string | number | bigint;
  raidUpgradeExp: string | number | bigint; castleExp: string | number | bigint;
  castleUpgradeExp: string | number | bigint; sourceHash: string; sourceFileHash?: string; catalogVersion: string;
}
export interface RingCatalogSummary { rows: number; uniqueDisplayNames: number; repeatedDisplayGroups: number; repeatedDisplayRows: number; }
function requireStableCode(value: string, pattern: RegExp, field: string): void {
  if (!pattern.test(value)) throw new Error("invalid " + field + ": " + value);
}
function requireUnsigned(value: string | number | bigint, field: string): void {
  const whole = String(value).split(".")[0];
  if (whole === undefined) throw new Error(field + " must have an integer part");
  const parsed = BigInt(whole);
  if (parsed < 0n) throw new Error(field + " must be unsigned");
}
export function assertRingDefinitionCatalog(definitions: readonly RingDefinitionRecord[], expectedRows = 45): RingCatalogSummary {
  if (definitions.length !== expectedRows) throw new Error("ring definition count mismatch: " + definitions.length + "/" + expectedRows);
  const grades = new Set<string>(); const objects = new Set<string>(); const items = new Set<string>();
  const sources = new Set<string>(); const orders = new Set<number>(); const displayCounts = new Map<string, number>();
  for (const definition of definitions) {
    requireStableCode(definition.gradeCode, /^RING-GRADE-\d{3}$/, "gradeCode");
    requireStableCode(definition.objectKey, /^item\.ring\.grade-\d{3}$/, "objectKey");
    requireStableCode(definition.itemCode, /^ITEM-RING-GRADE-\d{3}$/, "itemCode");
    if (definition.sourceKey.trim() === "" || definition.names.length === 0) throw new Error("ring source identity and names are required");
    if (definition.gradeOrder < 1 || definition.gradeOrder > expectedRows) throw new Error("ring grade order out of range: " + definition.gradeOrder);
    const rate = Number(definition.successRate); const drop = Number(definition.dropRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !Number.isFinite(drop) || drop < 0 || drop > 1) throw new Error("ring rates must stay within 0..1");
    const unsignedValues: Array<[string, string | number | bigint]> = [
      ["itemCost", definition.itemCost], ["maxLevel", definition.maxLevel], ["battleExp", definition.battleExp],
      ["battleUpgradeExp", definition.battleUpgradeExp], ["raidExp", definition.raidExp],
      ["raidUpgradeExp", definition.raidUpgradeExp], ["castleExp", definition.castleExp],
      ["castleUpgradeExp", definition.castleUpgradeExp]
    ];
    for (const pair of unsignedValues) requireUnsigned(pair[1], pair[0]);
    if (!/^[a-f0-9]{64}$/.test(definition.sourceHash)) throw new Error("invalid source hash");
    const identities: Array<[Set<string>, string, string]> = [
      [grades, definition.gradeCode, "gradeCode"], [objects, definition.objectKey, "objectKey"],
      [items, definition.itemCode, "itemCode"], [sources, definition.sourceKey, "sourceKey"]
    ];
    for (const identity of identities) {
      if (identity[0].has(identity[1])) throw new Error("duplicate " + identity[2] + ": " + identity[1]);
      identity[0].add(identity[1]);
    }
    if (orders.has(definition.gradeOrder)) throw new Error("duplicate gradeOrder: " + definition.gradeOrder);
    orders.add(definition.gradeOrder);
    displayCounts.set(definition.itemDisplayName, (displayCounts.get(definition.itemDisplayName) || 0) + 1);
  }
  for (let order = 1; order <= expectedRows; order += 1) if (!orders.has(order)) throw new Error("missing gradeOrder: " + order);
  const repeated = [...displayCounts.values()].filter((count) => count > 1);
  return { rows: definitions.length, uniqueDisplayNames: displayCounts.size, repeatedDisplayGroups: repeated.length, repeatedDisplayRows: repeated.reduce((sum, count) => sum + count, 0) };
}
