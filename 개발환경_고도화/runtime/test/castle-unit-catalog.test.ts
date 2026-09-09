import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assertCastleUnitCatalog, type CastleUnitRecord } from "../src/catalog/castle-unit-catalog.js";
import { MariaCastleUnitRepository } from "../src/catalog/maria-castle-unit-repository.js";

const fixture=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-castle-units-v1.json",import.meta.url),"utf8")) as {rows:CastleUnitRecord[]};

test("castle unit catalog preserves all ten source identities",()=>{
  assert.deepEqual(assertCastleUnitCatalog(fixture.rows),{rows:10,reusedCanonical:7,newCanonical:3,totalCharm:9661});
});

test("source exp maps exactly to charm per unit",()=>{
  assert.deepEqual(fixture.rows.map((row)=>Number(row.charmPerUnit)),[1,10,50,200,100,300,500,1000,1500,6000]);
});

test("only seven exact existing item codes are reused",()=>{
  assert.deepEqual(fixture.rows.filter((row)=>row.reusedCanonical).map((row)=>row.itemCode),["ITEM-RWD-CASTLE-ADVANCED","ITEM-RWD-CASTLE-UNIQUE","ITEM-RWD-CASTLE-RARE","ITEM-RWD-CASTLE-HERO","ITEM-RWD-CASTLE-LEGEND","ITEM-RWD-CASTLE-MYTH","ITEM-RWD-CASTLE-IMMORTAL"]);
});

test("catalog rejects a duplicate source identity",()=>{
  const rows=fixture.rows.map((row)=>({...row}));
  const first=rows[0],last=rows[9];
  assert.ok(first!==undefined&&last!==undefined);
  rows[9]={...last,sourceKey:first.sourceKey};
  assert.throws(()=>assertCastleUnitCatalog(rows),/duplicate sourceKey/);
});

test("Maria repository reuses bonus table and canonical object aliases",async()=>{
  const statements:Array<{sql:string;params?:readonly unknown[]}>=[];
  const db={query:async<T>(sql:string,params?:readonly unknown[]):Promise<T>=>{statements.push({sql,params});return [] as T;}};
  const repository=new MariaCastleUnitRepository(db as never);
  await repository.listActive();
  await repository.findBySource("item_9");
  const list=statements[0],find=statements[1];
  assert.ok(list!==undefined&&find!==undefined);
  assert.match(list.sql,/castle_battle_item_bonus_definitions/);
  assert.match(list.sql,/object_aliases/);
  assert.match(list.sql,/binding\.source_table='data\/itemInfo\.json#castleItem'/);
  assert.match(find.sql,/binding\.source_key=\?/);
  assert.deepEqual(find.params,["item_9"]);
});
