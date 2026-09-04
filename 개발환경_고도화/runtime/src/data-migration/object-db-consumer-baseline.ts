import { readFileSync } from "node:fs";

export const OBJECT_DB_CONSUMER_BASELINE_COMMIT = "f97be62292c3f7e8ea79b2d6f302dd25517584d4" as const;

export function canonicalizeObjectDbConsumerSourceText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function readCanonicalObjectDbConsumerSource(path: string | URL): string {
  return canonicalizeObjectDbConsumerSourceText(readFileSync(path, "utf8"));
}
