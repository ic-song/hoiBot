import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe,it } from "node:test";

const migration=fs.readFileSync(new URL("../migrations/481_canonical_pet_skill_read_provider.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../migrations/rollback/481_canonical_pet_skill_read_provider.rollback.sql",import.meta.url),"utf8");

describe("canonical pet skill read provider schema",()=>{
  it("adds named CUID identities, matching FKs, audit columns, and declarative metadata only",()=>{
    for(const token of ["legacy_source_key","base_draw_rate","fixed_draw_rate_flag","openable_flag","required_tier_name","tier_exclusive_flag","equip_description","CREATE TABLE canonical_pet_skill_aliases","pet_skill_alias_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin","FOREIGN KEY (pet_skill_id) REFERENCES canonical_pet_skill_definitions (pet_skill_id)","CREATE TABLE canonical_pet_skill_draw_grade_policies","pet_skill_draw_grade_policy_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin","slot_number BETWEEN 1 AND 40"])assert.ok(migration.includes(token),token);
    assert.equal((migration.match(/INSERT_USER VARCHAR\(100\)/g)??[]).length,2);assert.equal((migration.match(/INSERT_TIME CHAR\(19\)/g)??[]).length,2);
    assert.doesNotMatch(migration,/javascript|executable_payload|script_body/i);
  });
  it("rolls back only when no live slot 31..40 would violate the restored check",()=>{
    assert.match(rollback,/WHERE slot_number BETWEEN 31 AND 40/);assert.match(rollback,/UNION ALL\s+SELECT 2 WHERE EXISTS/);
    assert.match(rollback,/slot_number BETWEEN 1 AND 30/);assert.ok(rollback.indexOf("rollback_preflight_guard")<rollback.indexOf("ALTER TABLE"));
  });
  it("does not activate pet-skill commands or alter applied migrations",()=>{
    assert.equal(migration.includes("command_registry"),false);assert.equal(migration.includes("command_aliases"),false);
    const pinned:Record<string,string>={"184_pet_skill_read.sql":"230feb2d662ca4d421b1b52fa64fe8dc533117b26362b5de9b999cbceeea99f7","185_pet_skill_read_aggregate.sql":"b50326113487d017ac7db65a99af3ccc0d8e11fd52b0f9195e9feaa1874ee96d","390_pet_skill_definition_seed.sql":"7b74f7459165ac0b9c78ec34ab76728fbd8c08f71b8b83545bec881f29eb5045","408_pet_skill_post_freeze_seed.sql":"779f8649192457b45271fcbdf9dd9b265a85982135dcd553beafd677cec31e4a","449_canonical_pet_skill.sql":"0689bb72c87456e00e6e1e7b510c7dc6eed65b5d87f6bd808722b5a61196d942"};
    for(const [file,hash] of Object.entries(pinned))assert.equal(crypto.createHash("sha256").update(fs.readFileSync(new URL(`../migrations/${file}`,import.meta.url))).digest("hex"),hash,file);
  });
});
