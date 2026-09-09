import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMigrationSqlBatches } from "../scripts/migration-sql-batches.js";

describe("migration SQL delimiter-aware batches", () => {
  it("preserves an ordinary semicolon migration as one multiple-statements batch", () => {
    const sql = "CREATE TABLE alpha(value VARCHAR(20));\nINSERT INTO alpha VALUES ('a;b');";
    assert.deepEqual(createMigrationSqlBatches(sql), [sql]);
  });

  it("removes client directives and keeps routine and trigger bodies as single statements", () => {
    const sql = `-- DELIMITER $$ is a comment
CREATE TABLE alpha(value VARCHAR(30));
DELIMITER //
CREATE PROCEDURE p_alpha()
BEGIN
  INSERT INTO alpha VALUES ('literal // ; DELIMITER $$');
  /* // inside block comment */
END//
CREATE TRIGGER t_alpha BEFORE INSERT ON alpha FOR EACH ROW
BEGIN
  SET NEW.value = CONCAT(NEW.value, "//");
END//
DELIMITER ;
CALL p_alpha();`;
    const batches = createMigrationSqlBatches(sql);
    assert.equal(batches.length, 4);
    assert.match(batches[0]!, /CREATE TABLE alpha/);
    assert.match(batches[1]!, /^CREATE PROCEDURE[\s\S]*END$/);
    assert.match(batches[2]!, /^CREATE TRIGGER[\s\S]*END$/);
    assert.equal(batches[3], "CALL p_alpha();");
    assert.equal(batches.some((batch) => /^\s*DELIMITER\s/im.test(batch)), false);
  });

  it("parses migration 490 without changing its source or sending DELIMITER", () => {
    const sql = readFileSync(new URL("../migrations/490_item_bag_import_baseline_ordering.sql", import.meta.url), "utf8");
    const batches = createMigrationSqlBatches(sql);
    assert.equal(batches.length, 5);
    assert.equal(batches.some((batch) => /^\s*DELIMITER\s/im.test(batch)), false);
    assert.match(batches[1]!, /^CREATE PROCEDURE[\s\S]*END$/);
    assert.match(batches[3]!, /^CREATE TRIGGER[\s\S]*END$/);
  });

  it("fails closed on unterminated custom statements, quotes, block comments and directives", () => {
    assert.throws(() => createMigrationSqlBatches("DELIMITER //\nCREATE PROCEDURE broken() BEGIN SELECT 1; END"), /MIGRATION_SQL_UNTERMINATED_STATEMENT/);
    assert.throws(() => createMigrationSqlBatches("SELECT 'broken;"), /MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT/);
    assert.throws(() => createMigrationSqlBatches("SELECT 1; /* broken"), /MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT/);
    assert.throws(() => createMigrationSqlBatches("DELIMITER\nSELECT 1;"), /MIGRATION_DELIMITER_DIRECTIVE_INVALID/);
  });
});
