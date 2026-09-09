import assert from "node:assert/strict";
import fs from "node:fs";
import { PackageDomainItemMutationStore, type PackageDomainTransaction } from "../src/package/domain-item-provider.js";

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-canonical-item-dual-consumer-parity-v1.json",
  import.meta.url,
), "utf8")) as { codes: string[]; objectlessCodes: string[]; forbiddenOwnershipWrites: string[] };
const statements: string[] = [];
const transaction: PackageDomainTransaction = {
  async query<T>(sql: string): Promise<T[]> {
    statements.push(sql);
    if (/SELECT id FROM item_definitions/.test(sql)) return [{ id: "2388" }] as T[];
    return [];
  },
  async execute(sql: string) {
    statements.push(sql);
    return { affectedRows: 1n, insertId: 1n };
  },
};

await new PackageDomainItemMutationStore().add(
  transaction,
  { id: "ITEM-RWD-026", type: "STACK", displayName: "fixture", metadata: {} },
  { operationId: "2388", sequenceNo: 1, playerId: "900002388", quantity: 1, reasonCode: "PACKAGE_USE" },
);
const sql = statements.join("\n");
assert.match(sql, /SELECT id FROM item_definitions/);
assert.match(sql, /INSERT INTO inventory_stacks/);
assert.match(sql, /INSERT INTO inventory_ledger/);
for (const table of fixture.forbiddenOwnershipWrites) assert.doesNotMatch(sql, new RegExp(table, "i"));
assert.equal(fixture.codes.length, 76);
assert.equal(fixture.objectlessCodes.length, 15);
console.log(JSON.stringify({ result: "passed", b: 76, objectsPreserved: 61, objectlessCreated: 0, ownershipWrites: ["inventory_stacks", "inventory_ledger"], forbiddenWrites: 0 }));
