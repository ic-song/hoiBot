import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CommonStagingRecord } from "../../src/data-migration/common-staging-extractor.js";

export const SOURCE_CONTENT_SHA256 = "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc";

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

export function stringNumbers(value: unknown): unknown {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(stringNumbers);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, stringNumbers(child)]));
  }
  return value;
}

export function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}

export function readRepositoryJson<T>(relativePath: string): T {
  return JSON.parse(readRepositoryFile(relativePath)) as T;
}

export function payloadAt(source: Record<string, unknown>, pointer: string): Record<string, unknown> {
  return pointer.split("/").slice(1).reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], source) as Record<string, unknown>;
}

export function buildItem25StagingRecords(): CommonStagingRecord[] {
  const definitions = [
    ...Array.from({ length: 9 }, (_, index) => ({ sourcePointer: `/raidSpecialItem/dept${index < 8 ? "1" : "2"}/item_${index < 8 ? index : 0}`, recordKind: "RAID_ITEM_DEFINITION" })),
    ...Array.from({ length: 6 }, (_, index) => ({ sourcePointer: `/castlePremiumItem/${index < 3 ? "offense" : "defense"}/item_${index % 3}`, recordKind: "TERRITORY_ITEM_DEFINITION" })),
    ...Array.from({ length: 10 }, (_, index) => ({ sourcePointer: `/castleItem/item_${index}`, recordKind: "CASTLE_ITEM_DEFINITION" }))
  ];
  const source = readRepositoryJson<Record<string, unknown>>("data/itemInfo.json");
  return definitions.map((definition, occurrenceIndex) => {
    const payloadJson = JSON.stringify(payloadAt(source, definition.sourcePointer));
    return {
      sourceSystem: "LEGACY_JSON",
      sourceNamespace: "itemInfo.json",
      sourcePathSha256: sha256("data/itemInfo.json"),
      sourceContentSha256: SOURCE_CONTENT_SHA256,
      logicalSourceName: "data/itemInfo.json",
      sourcePointer: definition.sourcePointer,
      identityPointer: definition.sourcePointer,
      sourceLocatorSha256: sha256(`data/itemInfo.json\0${definition.sourcePointer}\0${definition.recordKind}\0${definition.sourcePointer}`),
      ownerLocatorSha256: null,
      occurrenceIndex,
      projectionLocator: definition.sourcePointer,
      recordDomain: "ITEM",
      recordKind: definition.recordKind,
      projectionStatus: "PROJECT",
      quarantineReason: null,
      quantityValue: null,
      observedTime: null,
      payloadJson,
      payloadFingerprint: sha256(stable(JSON.parse(payloadJson)))
    };
  });
}
