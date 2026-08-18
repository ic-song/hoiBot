import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("mini-pet integration batch", () => {
  it("keeps every integrated command on one dispatch path", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    const dispatches = [
      ["CollectionCreationOpenService", "isCollectionCreationOpenCommand"],
      ["CollectionGenesisOpenService", "isCollectionGenesisOpenCommand"],
      ["GenesisTicketCraftService", "isGenesisTicketCraftCommand"],
      ["GradeCombineService", "isGradeCombineCommand"],
      ["GuaranteedCreationOpenService", "isGuaranteedCreationOpenCommand"]
    ] as const;

    for (const [service, guard] of dispatches) {
      assert.equal(app.match(new RegExp(`new ${service}\\(database!\\)`, "g"))?.length, 1, service);
      assert.equal(app.match(new RegExp(`${guard}\\(normalizedEvent\\.message\\)`, "g"))?.length, 1, guard);
    }
  });

  it("keeps migrations 034-036 unique and the shared fixture verify-only path available", async () => {
    const migrations = (await readdir(resolve("migrations"))).filter((name) => /^03[4-6]_/.test(name)).sort();
    assert.deepEqual(migrations, [
      "034_collection_creation_open.sql",
      "035_collection_genesis_open.sql",
      "036_guaranteed_creation_open.sql"
    ]);

    const loader = await readFile(resolve("scripts/load-synthetic-relational.ts"), "utf8");
    assert.match(loader, /--verify-only/);
    assert.match(loader, /fixtures\/synthetic-relational\/functional-v1\.sql/);
    await readFile(resolve("../migration-control/fixtures/synthetic-relational/functional-v1.sql"), "utf8");
  });
});
