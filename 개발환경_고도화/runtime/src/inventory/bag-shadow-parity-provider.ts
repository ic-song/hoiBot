import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";

import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { BagItemView, BagView } from "./bag.js";
import { compareLegacyBagItems, formatLegacyBag, orderLegacyBagItems } from "./legacy-bag-formatter.js";

export type BagShadowSide = "LEGACY" | "CANONICAL";

export const BAG_SHADOW_PRESENTATION_SCOPE = Object.freeze({
  header: "OUT_OF_SCOPE" as const,
  ownerLabel: "OUT_OF_SCOPE" as const,
  advertisement: "OUT_OF_SCOPE" as const,
  itemOrderPreviewOnly: true as const,
});
export const BAG_SHADOW_LIMITATIONS: readonly string[] = Object.freeze([]);

export type BagFrozenDomainName = "players" | "items" | "pets" | "equipment";
export interface BagFrozenDomainRecord {
  readonly recordKind: string;
  readonly recordId: string;
  readonly definitionId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}
export interface BagFrozenDomainCoverage {
  readonly schemaVersion: "item-bag-frozen-domain.v1";
  readonly outputNeutralDomains: readonly ["pets", "equipment"];
  readonly domains: Readonly<Record<BagFrozenDomainName, readonly BagFrozenDomainRecord[]>>;
  readonly parity: boolean;
  readonly fingerprint: string;
}

export interface BagShadowUnsupportedDomainRecord {
  readonly side: BagShadowSide;
  readonly recordId: string;
  readonly displayName: string;
  readonly reasonCode: "DUPLICATE_DISPLAY_NAME" | "DUPLICATE_SPECIAL_ORDER" | "NON_STACKABLE_DEFINITION" | "ITEM_INSTANCE_LINEAGE_UNPROVEN" | "FROZEN_DOMAIN_PLAYER_MISSING" | "FROZEN_DOMAIN_DEFINITION_MISSING" | "FROZEN_DOMAIN_STATE_INVALID";
}

export interface BagShadowQuantityMismatch {
  readonly displayName: string;
  readonly legacyQuantity: string;
  readonly canonicalQuantity: string;
}

export interface BagShadowOrderMismatch {
  readonly displayName: string;
  readonly legacyIndex: number;
  readonly canonicalIndex: number;
  readonly legacyBagOrder: number | null;
  readonly canonicalLegacyBagOrder: number | null;
}

export interface BagShadowParityResult {
  readonly scope: "STACK_BAG";
  readonly presentationScope: typeof BAG_SHADOW_PRESENTATION_SCOPE;
  readonly limitations: typeof BAG_SHADOW_LIMITATIONS;
  readonly parity: boolean;
  readonly hasOutOfScopeRecords: boolean;
  readonly cutoverReady: boolean;
  readonly legacyPlayerId: string;
  readonly canonicalPlayerId: string;
  readonly legacyBag: BagView;
  readonly canonicalBag: BagView;
  readonly legacyItemOrderPreview: string;
  readonly canonicalItemOrderPreview: string;
  readonly legacyFingerprint: string;
  readonly canonicalFingerprint: string;
  readonly resultFingerprint: string;
  readonly missingItems: readonly string[];
  readonly extraItems: readonly string[];
  readonly quantityMismatches: readonly BagShadowQuantityMismatch[];
  readonly orderMismatches: readonly BagShadowOrderMismatch[];
  readonly unsupportedDomainRecords: readonly BagShadowUnsupportedDomainRecord[];
  readonly frozenDomainCoverage: BagFrozenDomainCoverage;
}

interface IdentityRow {
  legacy_player_id: bigint | number | string | null;
  display_name: string | null;
  legacy_identity_status: string;
  canonical_player_id: string | null;
  crosswalk_status: string | null;
}

interface LegacyStackRow {
  record_id: bigint | number | string;
  display_name: string;
  quantity: bigint | number | string;
  legacy_bag_order: bigint | number | string | null;
  stackable_flag: bigint | number | boolean | string;
}

interface CanonicalInstanceRow {
  record_id: string;
  player_id: string;
  item_id: string;
  display_name: string;
  ownership_status: string;
  legacy_bag_order: bigint | number | string | null;
  stackable_flag: bigint | number | boolean | string;
}

interface CanonicalStackRow {
  record_id: string;
  player_id: string;
  item_id: string;
  display_name: string;
  quantity: bigint | number | string;
  legacy_bag_order: bigint | number | string | null;
  stackable_flag: bigint | number | boolean | string;
}

type FrozenRow = Record<string, unknown>;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("BAG_SHADOW_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("BAG_SHADOW_VALUE_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function integer(value: unknown, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`BAG_SHADOW_DECIMAL_INVALID:${label}`);
  const text = typeof value === "bigint" || typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw new Error(`BAG_SHADOW_DECIMAL_INVALID:${label}`);
  return BigInt(text).toString();
}

function bagOrder(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "bigint" || typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw new Error(`BAG_SHADOW_ORDER_INVALID:${label}`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`BAG_SHADOW_ORDER_INVALID:${label}`);
  return parsed;
}

function enabled(value: unknown, label: string): boolean {
  if (value === true || value === 1 || value === 1n || value === "1") return true;
  if (value === false || value === 0 || value === 0n || value === "0") return false;
  throw new Error(`BAG_SHADOW_BOOLEAN_INVALID:${label}`);
}

function canonicalIdentifier(value: unknown, label: string): string {
  const result = String(value ?? "");
  if (!/^[a-z][a-z0-9]{7}$/.test(result)) throw new Error(`BAG_SHADOW_CANONICAL_IDENTIFIER_INVALID:${label}`);
  return result;
}

function normalizeFrozenValue(value: unknown, jsonColumn = false): unknown {
  if (jsonColumn && typeof value === "string") {
    try { return normalizeFrozenValue(parseLossless(value), false); }
    catch { throw new Error("BAG_SHADOW_CANONICAL_JSON_INVALID"); }
  }
  if (isLosslessNumber(value)) return value.toString();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("BAG_SHADOW_CANONICAL_NUMBER_INVALID");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("BAG_SHADOW_CANONICAL_NUMBER_UNSAFE");
    return jsonColumn ? String(value) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeFrozenValue(entry, jsonColumn));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, entry]) => [key, normalizeFrozenValue(entry, jsonColumn)]));
  throw new Error("BAG_SHADOW_CANONICAL_VALUE_INVALID");
}

function frozenRecord(recordKind: string, idColumn: string, definitionColumn: string | null, row: FrozenRow): BagFrozenDomainRecord {
  const recordId = canonicalIdentifier(row[idColumn], `${recordKind}.${idColumn}`);
  const definitionId = definitionColumn === null ? null : canonicalIdentifier(row[definitionColumn], `${recordKind}.${definitionColumn}`);
  const attributes: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort(compareText)) {
    if (key === idColumn || key === definitionColumn || key === "display_name" || key === "legacy_bag_order" || key === "stackable_flag" || key === "instance_options") continue;
    attributes[key] = key.endsWith("_flag") ? enabled(row[key], `${recordKind}.${key}`) : normalizeFrozenValue(row[key], key === "definition_options");
  }
  return Object.freeze({ recordKind, recordId, definitionId, attributes: Object.freeze(attributes) });
}

function compareFrozenRecord(left: BagFrozenDomainRecord, right: BagFrozenDomainRecord): number {
  return compareText(`${left.recordKind}\0${left.recordId}\0${canonicalJson(left.attributes)}`, `${right.recordKind}\0${right.recordId}\0${canonicalJson(right.attributes)}`);
}

function stableItems(items: readonly BagItemView[]): BagItemView[] {
  return [...items].sort((left, right) => {
    const nameOrder = compareText(left.displayName, right.displayName);
    if (nameOrder !== 0) return nameOrder;
    const bagOrderDifference = (left.legacyBagOrder ?? Number.MAX_SAFE_INTEGER) - (right.legacyBagOrder ?? Number.MAX_SAFE_INTEGER);
    if (bagOrderDifference !== 0) return bagOrderDifference;
    return BigInt(left.quantity) < BigInt(right.quantity) ? -1 : BigInt(left.quantity) > BigInt(right.quantity) ? 1 : 0;
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedNames(values: Iterable<string>): string[] {
  return [...values].sort(compareText);
}

function totalLegacyOrder(left: BagItemView, right: BagItemView): number {
  return compareLegacyBagItems(left, right) || compareText(left.displayName, right.displayName)
    || compareText(left.quantity, right.quantity);
}

function itemOrderPreview(items: readonly BagItemView[]): string {
  const formatted = formatLegacyBag({ playerId: "", ownerLabel: "", advertisement: "", items: [...items].sort(totalLegacyOrder) });
  if (formatted === "가방이 비어 있습니다.") return formatted;
  return formatted.split("\n").filter((line) => /^   [0-9]+\. /.test(line)).join("\n");
}

// app-wiring runner가 제공한 동일 read-only snapshot에서 legacy/canonical stack 가방을 대사합니다.
export class BagShadowParityProvider {
  async compare(database: AppWiringReadParticipant, providerCode: string, externalUserId: string): Promise<BagShadowParityResult> {
    if (providerCode.length === 0 || externalUserId.length === 0) throw new Error("BAG_SHADOW_IDENTITY_INPUT_INVALID");
    const identities = await database.query<IdentityRow[]>(
      `SELECT identity.player_id AS legacy_player_id,identity.display_name,
              identity.status AS legacy_identity_status,crosswalk.player_id AS canonical_player_id,
              crosswalk.crosswalk_status
         FROM external_identities identity
         LEFT JOIN canonical_player_identity_crosswalks crosswalk
           ON crosswalk.provider_code=identity.provider_code AND crosswalk.external_user_id=identity.external_user_id
        WHERE identity.provider_code=? AND identity.external_user_id=?`,
      [providerCode, externalUserId],
    );
    if (identities.length === 0) throw new Error("BAG_SHADOW_IDENTITY_MAPPING_REQUIRED");
    if (identities.length !== 1) throw new Error("BAG_SHADOW_IDENTITY_MAPPING_AMBIGUOUS");
    const identity = identities[0]!;
    if (identity.legacy_identity_status.toUpperCase() !== "LINKED" || identity.crosswalk_status !== "LINKED") throw new Error("BAG_SHADOW_IDENTITY_MAPPING_NOT_LINKED");
    if (identity.legacy_player_id === null || identity.canonical_player_id === null) throw new Error("BAG_SHADOW_IDENTITY_MAPPING_REQUIRED");
    const legacyPlayerId = integer(identity.legacy_player_id, "legacy_player_id");
    if (BigInt(legacyPlayerId) < 0n) throw new Error("BAG_SHADOW_LEGACY_PLAYER_ID_INVALID");
    if (!/^[a-z][a-z0-9]{7}$/.test(identity.canonical_player_id)) throw new Error("BAG_SHADOW_CANONICAL_PLAYER_ID_INVALID");

    const legacyRows = await database.query<LegacyStackRow[]>(
      `SELECT stack.item_id AS record_id,item.display_name,stack.quantity,
              JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.legacyBagOrder')) AS legacy_bag_order,
              item.stackable AS stackable_flag
         FROM inventory_stacks stack
         JOIN item_definitions item ON item.id=stack.item_id
        WHERE stack.player_id=? AND item.active=TRUE`,
      [legacyPlayerId],
    );
    const canonicalRows = await database.query<CanonicalStackRow[]>(
      `SELECT stack.owned_item_stack_id AS record_id,stack.player_id,stack.item_id,item.item_name AS display_name,stack.quantity,
              JSON_UNQUOTE(JSON_EXTRACT(item.definition_options,'$.legacyBagOrder')) AS legacy_bag_order,
              item.stackable_flag
         FROM canonical_owned_item_stacks stack
         JOIN canonical_item_definitions item ON item.item_id=stack.item_id
        WHERE stack.player_id=? AND item.active_flag=TRUE`,
      [identity.canonical_player_id],
    );
    const canonicalInstances = await database.query<CanonicalInstanceRow[]>(
      `SELECT owned.owned_item_id AS record_id,owned.player_id,owned.item_id,owned.ownership_status,
              item.item_name AS display_name,
              JSON_UNQUOTE(JSON_EXTRACT(item.definition_options,'$.legacyBagOrder')) AS legacy_bag_order,
              item.stackable_flag
         FROM canonical_owned_item_instances owned
         JOIN canonical_item_definitions item ON item.item_id=owned.item_id
        WHERE owned.player_id=?`,
      [identity.canonical_player_id],
    );
    const canonicalPlayerRows = await database.query<FrozenRow[]>(
      "SELECT player_id FROM canonical_players WHERE player_id=?",
      [identity.canonical_player_id],
    );
    const canonicalItemDefinitionRows = await database.query<FrozenRow[]>(
      "SELECT item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options FROM canonical_item_definitions",
    );
    const canonicalPetRows = await database.query<FrozenRow[]>(
      "SELECT owned_pet_id,player_id,pet_id,custom_name,enhancement_level,experience_amount,ownership_status FROM canonical_owned_pet_instances WHERE player_id=?",
      [identity.canonical_player_id],
    );
    const canonicalPetDefinitionRows = await database.query<FrozenRow[]>(
      "SELECT pet_id,pet_name,pet_description,pet_grade,base_charm,charm_per_enhancement,active_flag FROM canonical_pet_definitions",
    );
    const canonicalEquipmentRows = await database.query<FrozenRow[]>(
      "SELECT owned_equipment_id,player_id,equipment_id,custom_name,enhancement_level,durability_amount,ownership_status FROM canonical_owned_equipment_instances WHERE player_id=?",
      [identity.canonical_player_id],
    );
    const canonicalEquipmentDefinitionRows = await database.query<FrozenRow[]>(
      "SELECT equipment_id,equipment_name,equipment_description,equipment_slot,equipment_grade,base_charm,charm_per_enhancement,active_flag FROM canonical_equipment_definitions",
    );

    const unsupported: BagShadowUnsupportedDomainRecord[] = [];
    const legacyItems = legacyRows.map((row): BagItemView => ({
      displayName: row.display_name,
      quantity: integer(row.quantity, `legacy.${String(row.record_id)}.quantity`),
      legacyBagOrder: bagOrder(row.legacy_bag_order, `legacy.${String(row.record_id)}.legacyBagOrder`),
    }));
    const canonicalStackItems = canonicalRows.flatMap((row): BagItemView[] => {
      const quantity = integer(row.quantity, `canonical.${row.record_id}.quantity`);
      if (!enabled(row.stackable_flag, `canonical.${row.record_id}.stackableFlag`)) {
        unsupported.push({ side: "CANONICAL", recordId: row.record_id, displayName: row.display_name, reasonCode: "NON_STACKABLE_DEFINITION" });
        return [];
      }
      return [{ displayName: row.display_name, quantity, legacyBagOrder: bagOrder(row.legacy_bag_order, `canonical.${row.record_id}.legacyBagOrder`) }];
    });
    for (const row of canonicalInstances) {
      if (row.ownership_status !== "owned") continue;
      unsupported.push({ side: "CANONICAL", recordId: row.record_id, displayName: row.display_name, reasonCode: "ITEM_INSTANCE_LINEAGE_UNPROVEN" });
    }
    const canonicalItems = canonicalStackItems;
    for (const [side, rows, items] of [["LEGACY", legacyRows, legacyItems], ["CANONICAL", canonicalRows, canonicalStackItems]] as const) {
      const counts = new Map<string, number>();
      for (const item of items) counts.set(item.displayName, (counts.get(item.displayName) ?? 0) + 1);
      for (const name of sortedNames([...counts].filter(([, count]) => count > 1).map(([name]) => name))) {
        for (const row of rows.filter((candidate) => candidate.display_name === name)) unsupported.push({ side, recordId: String(row.record_id), displayName: name, reasonCode: "DUPLICATE_DISPLAY_NAME" });
      }
      const namesBySpecialOrder = new Map<number, Set<string>>();
      for (const item of items) {
        if (item.legacyBagOrder === null) continue;
        const names = namesBySpecialOrder.get(item.legacyBagOrder) ?? new Set<string>();
        names.add(item.displayName);
        namesBySpecialOrder.set(item.legacyBagOrder, names);
      }
      const duplicateSpecialNames = new Set([...namesBySpecialOrder.values()].filter((names) => names.size > 1).flatMap((names) => [...names]));
      for (const row of rows.filter((candidate) => duplicateSpecialNames.has(candidate.display_name))) {
        unsupported.push({ side, recordId: String(row.record_id), displayName: row.display_name, reasonCode: "DUPLICATE_SPECIAL_ORDER" });
      }
    }

    const playerRecords = canonicalPlayerRows.map((row) => frozenRecord("player", "player_id", null, row));
    if (playerRecords.length !== 1 || playerRecords[0]!.recordId !== identity.canonical_player_id) {
      unsupported.push({ side: "CANONICAL", recordId: identity.canonical_player_id, displayName: identity.canonical_player_id, reasonCode: "FROZEN_DOMAIN_PLAYER_MISSING" });
    }
    const itemDefinitionRecords = canonicalItemDefinitionRows.map((row) => frozenRecord("item-definition", "item_id", "item_id", row));
    const itemStackRecords = canonicalRows.map((row) => frozenRecord("item-stack", "record_id", "item_id", row as unknown as FrozenRow));
    const itemInstanceRecords = canonicalInstances.map((row) => frozenRecord("item-instance", "record_id", "item_id", row as unknown as FrozenRow));
    const petDefinitionRecords = canonicalPetDefinitionRows.map((row) => frozenRecord("pet-definition", "pet_id", "pet_id", row));
    const petRecords = canonicalPetRows.map((row) => frozenRecord("pet-instance", "owned_pet_id", "pet_id", row));
    const equipmentDefinitionRecords = canonicalEquipmentDefinitionRows.map((row) => frozenRecord("equipment-definition", "equipment_id", "equipment_id", row));
    const equipmentRecords = canonicalEquipmentRows.map((row) => frozenRecord("equipment-instance", "owned_equipment_id", "equipment_id", row));
    const petDefinitionIds = new Set(petDefinitionRecords.map((record) => record.recordId));
    const equipmentDefinitionIds = new Set(equipmentDefinitionRecords.map((record) => record.recordId));
    const itemDefinitionIds = new Set(itemDefinitionRecords.map((record) => record.recordId));
    const validStatuses = new Set(["owned", "listed", "consumed", "removed"]);
    for (const record of [...petRecords, ...equipmentRecords, ...itemInstanceRecords]) {
      const domainDefinitionIds = record.recordKind === "pet-instance" ? petDefinitionIds : record.recordKind === "equipment-instance" ? equipmentDefinitionIds : itemDefinitionIds;
      if (record.definitionId === null || !domainDefinitionIds.has(record.definitionId)) unsupported.push({ side: "CANONICAL", recordId: record.recordId, displayName: record.recordKind, reasonCode: "FROZEN_DOMAIN_DEFINITION_MISSING" });
      if (record.attributes.player_id !== identity.canonical_player_id || !validStatuses.has(String(record.attributes.ownership_status))) unsupported.push({ side: "CANONICAL", recordId: record.recordId, displayName: record.recordKind, reasonCode: "FROZEN_DOMAIN_STATE_INVALID" });
    }
    const domains: Record<BagFrozenDomainName, BagFrozenDomainRecord[]> = {
      players: playerRecords,
      items: [...itemDefinitionRecords, ...itemStackRecords, ...itemInstanceRecords],
      pets: [...petDefinitionRecords, ...petRecords],
      equipment: [...equipmentDefinitionRecords, ...equipmentRecords],
    };
    for (const records of Object.values(domains)) records.sort(compareFrozenRecord);
    for (const record of itemStackRecords) {
      if (record.definitionId === null || !itemDefinitionIds.has(record.definitionId)) unsupported.push({ side: "CANONICAL", recordId: record.recordId, displayName: record.recordKind, reasonCode: "FROZEN_DOMAIN_DEFINITION_MISSING" });
      if (record.attributes.player_id !== identity.canonical_player_id) unsupported.push({ side: "CANONICAL", recordId: record.recordId, displayName: record.recordKind, reasonCode: "FROZEN_DOMAIN_STATE_INVALID" });
    }

    const supportedLegacy = legacyItems.filter((item) => !unsupported.some((record) => record.side === "LEGACY" && record.displayName === item.displayName));
    const supportedCanonical = canonicalItems.filter((item) => !unsupported.some((record) => record.side === "CANONICAL" && record.displayName === item.displayName));
    const renderedLegacy = orderLegacyBagItems(supportedLegacy);
    const renderedCanonical = orderLegacyBagItems(supportedCanonical);
    const legacyByName = new Map(renderedLegacy.map((item) => [item.displayName, item]));
    const canonicalByName = new Map(renderedCanonical.map((item) => [item.displayName, item]));
    const missingItems = sortedNames([...legacyByName.keys()].filter((name) => !canonicalByName.has(name)));
    const extraItems = sortedNames([...canonicalByName.keys()].filter((name) => !legacyByName.has(name)));
    const sharedNames = sortedNames([...legacyByName.keys()].filter((name) => canonicalByName.has(name)));
    const quantityMismatches = sharedNames.flatMap((displayName): BagShadowQuantityMismatch[] => {
      const legacyQuantity = legacyByName.get(displayName)!.quantity;
      const canonicalQuantity = canonicalByName.get(displayName)!.quantity;
      return legacyQuantity === canonicalQuantity ? [] : [{ displayName, legacyQuantity, canonicalQuantity }];
    });
    const legacyOrder = renderedLegacy.filter((item) => canonicalByName.has(item.displayName));
    const canonicalOrder = renderedCanonical.filter((item) => legacyByName.has(item.displayName));
    const orderMismatches = sharedNames.flatMap((displayName): BagShadowOrderMismatch[] => {
      const legacyIndex = legacyOrder.findIndex((item) => item.displayName === displayName);
      const canonicalIndex = canonicalOrder.findIndex((item) => item.displayName === displayName);
      const legacyItem = legacyByName.get(displayName)!;
      const canonicalItem = canonicalByName.get(displayName)!;
      return legacyIndex === canonicalIndex && legacyItem.legacyBagOrder === canonicalItem.legacyBagOrder ? [] : [{ displayName, legacyIndex: legacyIndex + 1, canonicalIndex: canonicalIndex + 1, legacyBagOrder: legacyItem.legacyBagOrder, canonicalLegacyBagOrder: canonicalItem.legacyBagOrder }];
    });
    unsupported.sort((left, right) => compareText(`${left.side}\0${left.displayName}\0${left.recordId}\0${left.reasonCode}`, `${right.side}\0${right.displayName}\0${right.recordId}\0${right.reasonCode}`));
    const safeOwnerLabel = typeof identity.display_name === "string" ? identity.display_name : "";
    const legacyBag: BagView = { playerId: legacyPlayerId, ownerLabel: safeOwnerLabel, advertisement: "", items: stableItems(supportedLegacy) };
    const canonicalBag: BagView = { playerId: identity.canonical_player_id, ownerLabel: safeOwnerLabel, advertisement: "", items: stableItems(supportedCanonical) };
    const legacyItemOrderPreview = itemOrderPreview(supportedLegacy);
    const canonicalItemOrderPreview = itemOrderPreview(supportedCanonical);
    const legacyFingerprint = fingerprint({ items: stableItems(supportedLegacy), itemOrderPreview: legacyItemOrderPreview });
    const canonicalFingerprint = fingerprint({ items: stableItems(supportedCanonical), itemOrderPreview: canonicalItemOrderPreview });
    const comparison = { missingItems, extraItems, quantityMismatches, orderMismatches, unsupportedDomainRecords: unsupported };
    const frozenDomainParity = unsupported.length === 0;
    const frozenDomains = Object.freeze({
      players: Object.freeze(domains.players),
      items: Object.freeze(domains.items),
      pets: Object.freeze(domains.pets),
      equipment: Object.freeze(domains.equipment),
    });
    const frozenEnvelope = { schemaVersion: "item-bag-frozen-domain.v1" as const, outputNeutralDomains: ["pets", "equipment"] as const, domains: frozenDomains, parity: frozenDomainParity };
    const frozenDomainCoverage: BagFrozenDomainCoverage = Object.freeze({ ...frozenEnvelope, fingerprint: fingerprint(frozenEnvelope) });
    const hasOutOfScopeRecords = unsupported.length > 0;
    const parity = legacyFingerprint === canonicalFingerprint && missingItems.length === 0 && extraItems.length === 0 && quantityMismatches.length === 0 && orderMismatches.length === 0 && unsupported.length === 0 && frozenDomainParity;
    const cutoverReady = parity;
    return Object.freeze({
      scope: "STACK_BAG" as const,
      ...comparison,
      presentationScope: BAG_SHADOW_PRESENTATION_SCOPE,
      limitations: BAG_SHADOW_LIMITATIONS,
      parity,
      hasOutOfScopeRecords,
      cutoverReady,
      legacyPlayerId,
      canonicalPlayerId: identity.canonical_player_id,
      legacyBag,
      canonicalBag,
      legacyItemOrderPreview,
      canonicalItemOrderPreview,
      legacyFingerprint,
      canonicalFingerprint,
      frozenDomainCoverage,
      resultFingerprint: fingerprint({
        scope: "STACK_BAG",
        presentationScope: BAG_SHADOW_PRESENTATION_SCOPE,
        limitations: BAG_SHADOW_LIMITATIONS,
        legacyPlayerId,
        canonicalPlayerId: identity.canonical_player_id,
        comparison,
        parity,
        hasOutOfScopeRecords,
        cutoverReady,
        legacyFingerprint,
        canonicalFingerprint,
        frozenDomainCoverage,
      }),
    });
  }
}

// MariaDB app-wiring 조립에서 도메인 provider 이름을 명시적으로 사용할 수 있게 합니다.
export class MariaBagShadowParityProvider extends BagShadowParityProvider {}
