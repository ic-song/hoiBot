import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration=readFileSync(new URL("../migrations/471_pet_title_sale_app_wiring.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/rollback/471_pet_title_sale_app_wiring.rollback.sql",import.meta.url),"utf8");

describe("pet title sale app wiring migration",()=>{
  it("adds the exact command in SHADOW without changing migration 180",()=>{
    assert.match(migration,/\('PET_TITLE_SELL','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1\)/);
    assert.match(migration,/\('\/펫타이틀판매 \[번호\]','PET_TITLE_SELL',1\)/);
  });

  it("binds one optional sale currency operation with an exact FK",()=>{
    assert.match(migration,/currency_operation_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
    assert.match(migration,/UNIQUE KEY IF NOT EXISTS uq_odbt_471_00_01 \(currency_operation_id,player_id\)/);
    assert.match(migration,/FOREIGN KEY IF NOT EXISTS \(currency_operation_id,player_id\) REFERENCES canonical_currency_operations \(currency_operation_id,player_id\) ON DELETE RESTRICT/);
    assert.match(migration,/UNIQUE KEY IF NOT EXISTS uq_odbt_471_01_01 \(currency_operation_id\)/);
  });

  it("refuses destructive rollback while a sale receipt exists",()=>{
    assert.match(rollback,/operation_type='SELL' OR currency_operation_id IS NOT NULL/);
    assert.match(rollback,/DROP FOREIGN KEY IF EXISTS fk_odbt_471_01_01/);
  });
});
