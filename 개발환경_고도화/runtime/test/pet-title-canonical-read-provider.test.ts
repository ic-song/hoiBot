import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { PetTitleCanonicalReadProvider } from "../src/pet/pet-title-canonical-read-provider.js";
import { formatPetTitleList } from "../src/pet/pet-title-lifecycle-service.js";

class ReadSnapshot implements AppWiringReadParticipant {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  constructor(private readonly rows: unknown[]) {}
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.calls.push({ sql, values });
    return this.rows as T;
  }
}

describe("PET-TITLE canonical read slice", () => {
  it("reads the current catalog name and occurrence price in stable ownership order", async () => {
    const snapshot = new ReadSnapshot([
      { owned_pet_title_id: "petown01", title_name: "바뀐 이름✨", acquisition_sequence: "9007199254740993", acquired_time: "2026-09-04 10:20:30", acquisition_price: "100000000", base_sale_price: "300000000", selected_flag: "1" },
      { owned_pet_title_id: "petown02", title_name: "두 번째🦊", acquisition_sequence: 9007199254740994n, acquired_time: "2026-09-04 11:20:30", acquisition_price: null, base_sale_price: 400000000n, selected_flag: 0 },
    ]);
    const rows = await new PetTitleCanonicalReadProvider().listOwned(snapshot, "player01");
    assert.deepEqual(rows.map((row) => ({ id: row.instanceId, name: row.displayName, price: row.priceDigits, equipped: row.equipped })), [
      { id: "petown01", name: "바뀐 이름✨", price: "100000000", equipped: true },
      { id: "petown02", name: "두 번째🦊", price: "400000000", equipped: false },
    ]);
    assert.match(snapshot.calls[0]!.sql, /JOIN canonical_pet_title_definitions/);
    assert.match(snapshot.calls[0]!.sql, /ORDER BY owned\.acquisition_sequence,owned\.owned_pet_title_id/);
    assert.doesNotMatch(snapshot.calls[0]!.sql, /player_pet_title_instances|pet_titles/);
    const rendered = formatPetTitleList("⭐사용자", rows, true);
    assert.match(rendered, /☞ 1\. 바뀐 이름✨/);
    assert.match(rendered, /가격: 🅟100,000,000/);
    assert.doesNotMatch(rendered, /petown01/);
  });

  it("rejects a generic or malformed player id before querying", async () => {
    const snapshot = new ReadSnapshot([]);
    await assert.rejects(new PetTitleCanonicalReadProvider().listOwned(snapshot, "1"), /OBJECT_IDENTITY_CANDIDATE_INVALID/);
    assert.equal(snapshot.calls.length, 0);
  });
});
