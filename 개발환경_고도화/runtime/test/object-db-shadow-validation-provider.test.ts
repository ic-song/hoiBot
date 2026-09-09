import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe,it } from "node:test";
import {
  OBJECT_DB_SHADOW_TABLE_PLAN,
  ObjectDbShadowValidationProvider,
  type ShadowRow,
} from "../src/data-migration/object-db-shadow-validation-provider.js";
import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";

type FixtureRow = { legacy: ShadowRow; canonical: ShadowRow };
type Fixture = { cases: Array<{ rowsByTable: Record<string,FixtureRow[]> }> };
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-db-shadow-validation-v1.json",import.meta.url),"utf8")) as Fixture;
function projections(){
  const legacy:Record<string,ShadowRow[]>={};const canonical:Record<string,ShadowRow[]>={};
  for(const entry of fixture.cases)for(const [table,rows] of Object.entries(entry.rowsByTable)){legacy[table]=rows.map(row=>structuredClone(row.legacy));canonical[table]=rows.map(row=>structuredClone(row.canonical));}
  return {legacy,canonical};
}
class ReadOnlyParticipant implements AppWiringReadParticipant {
  readonly statements:string[]=[];
  constructor(private readonly rows:Record<string,ShadowRow[]>){ }
  async query<T>(sql:string,values:readonly unknown[]=[]):Promise<T>{
    assert.deepEqual(values,[]);assert.match(sql,/^SELECT \* FROM [a-z][a-z0-9_]*$/);this.statements.push(sql);
    const table=sql.slice("SELECT * FROM ".length);return structuredClone(this.rows[table]??[]) as T;
  }
}

describe("WBS744 Gate4 read-only Shadow provider",()=>{
  it("executes the fixed 12-domain/45-table plan and is restart deterministic",async()=>{
    const {legacy,canonical}=projections();canonical.canonical_players![0]={...canonical.canonical_players![0]!,INSERT_USER:"fixture",INSERT_TIME:"2026-06-22 23:30:00",UPDATE_USER:"fixture",UPDATE_TIME:"2026-06-22 23:30:00",later_runtime_column:"outside-wbs742-projection"};canonical.canonical_owned_mini_pet_instances![0]={...canonical.canonical_owned_mini_pet_instances![0]!,equipped_flag:0};const db=new ReadOnlyParticipant(canonical);const provider=new ObjectDbShadowValidationProvider();
    const first=await provider.compare(db,{legacyRowsByTable:legacy});
    const restart=await provider.compare(new ReadOnlyParticipant(Object.fromEntries(Object.entries(canonical).reverse())),{legacyRowsByTable:Object.fromEntries(Object.entries(legacy).reverse()),previousRunFingerprint:first.projectionFingerprint});
    assert.equal(OBJECT_DB_SHADOW_TABLE_PLAN.length,45);assert.equal(new Set(OBJECT_DB_SHADOW_TABLE_PLAN.map(plan=>plan.domain)).size,12);
    assert.equal(db.statements.length,45);assert.equal(new Set(db.statements).size,45);
    assert.equal(first.mismatchCount,0);assert.equal(first.promotionAllowed,true);
    assert.equal(restart.mismatches.some(entry=>entry.category==="RESTART_FINGERPRINT_DRIFT"),false);
    const cleanRestart=await provider.compare(new ReadOnlyParticipant(canonical),{legacyRowsByTable:legacy});
    assert.equal(cleanRestart.runFingerprint,first.runFingerprint);
  });

  it("classifies identity, row, multiplicity, field, Unicode, bigint, coverage, restart, and mutation failures",async()=>{
    const {legacy,canonical}=projections();
    const itemTable="canonical_item_definitions";const stackTable="canonical_owned_item_stacks";
    legacy[itemTable]![0]={...legacy[itemTable]![0]!,item_name:"e\u0301상자"};
    canonical[itemTable]![0]={...canonical[itemTable]![0]!,item_name:"é상자"};
    legacy[stackTable]!.push(structuredClone(legacy[stackTable]![0]!));
    canonical.canonical_owned_item_instances=[];
    delete legacy.canonical_owned_item_instances;
    canonical.canonical_currency_definitions![0]={...canonical.canonical_currency_definitions![0]!,decimal_places:99};
    canonical[stackTable]![0]={...canonical[stackTable]![0]!,item_id:"missing1"};
    legacy.unplanned_table=[];
    const result=await new ObjectDbShadowValidationProvider().compare(new ReadOnlyParticipant(canonical),{
      legacyRowsByTable:legacy,
      identityIssues:[{category:"IDENTITY_AMBIGUOUS",locatorFingerprint:"a".repeat(64)},{category:"IDENTITY_PAYLOAD_DRIFT",locatorFingerprint:"b".repeat(64)}],
      previousRunFingerprint:"0".repeat(64),beforeMutationFingerprint:"1".repeat(64),afterMutationFingerprint:"2".repeat(64),
    });
    const categories=new Set(result.mismatches.map(entry=>entry.category));
    for(const category of ["IDENTITY_AMBIGUOUS","IDENTITY_PAYLOAD_DRIFT","ROW_MULTIPLICITY_MISMATCH","UNICODE_BYTE_MISMATCH","FIELD_VALUE_MISMATCH","REFERENCE_CLOSURE_MISMATCH","TABLE_COVERAGE_MISMATCH","RESTART_FINGERPRINT_DRIFT","MUTATION_DETECTED"])assert.ok(categories.has(category as never),category);
    assert.equal(result.promotionAllowed,false);
  });

  it("rejects unsafe integer and malformed tagged bigint values without writing",async()=>{
    const {legacy,canonical}=projections();legacy.canonical_owned_item_stacks![0]={...legacy.canonical_owned_item_stacks![0]!,quantity:Number.MAX_SAFE_INTEGER+1};
    const result=await new ObjectDbShadowValidationProvider().compare(new ReadOnlyParticipant(canonical),{legacyRowsByTable:legacy});
    assert.ok(result.mismatches.some(entry=>entry.category==="BIGINT_ENCODING_INVALID"));
    assert.equal(result.promotionAllowed,false);
  });
});
