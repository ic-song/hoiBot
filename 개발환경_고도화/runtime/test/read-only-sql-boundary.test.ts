import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { assertReadOnlySqlStatement } from "../src/database/read-only-sql-boundary.js";

describe("parsed read-only SQL boundary",()=>{
  it("accepts SELECT, SELECT CTE, recursive CTE, and EXPLAIN without interpreting literals",()=>{
    for(const sql of [
      "SELECT player_id FROM canonical_players WHERE player_id=?",
      "WITH ids AS (SELECT player_id FROM canonical_players) SELECT player_id FROM ids",
      "WITH ids(player_id) AS (SELECT player_id FROM canonical_players) SELECT player_id FROM ids",
      "WITH RECURSIVE n AS (SELECT 1 value UNION ALL SELECT value+1 FROM n WHERE value<3) SELECT value FROM n",
      "EXPLAIN FORMAT=JSON SELECT * FROM canonical_players",
      "SELECT 'UPDATE; -- harmless literal', `delete` FROM canonical_players",
    ])assert.doesNotThrow(()=>assertReadOnlySqlStatement(sql));
  });

  it("rejects multi-statements, comments, malformed quoting, and CTE-hidden writes",()=>{
    for(const sql of [
      "SELECT 1; UPDATE canonical_players SET source_system='x'",
      "SELECT 1 -- trailing", "SELECT 1 # trailing", "SELECT 1 /* hidden */", "SELECT 1 /*!50000 FOR UPDATE */",
      "SELECT 'unterminated", "SELECT `unterminated",
      "WITH changed AS (UPDATE canonical_players SET source_system='x' RETURNING player_id) SELECT * FROM changed",
      "WITH rows AS (SELECT player_id FROM canonical_players) DELETE FROM canonical_players",
      "CALL mutate_players()","SELECT mutate_players()","SELECT mutate_players(1) AS result","SELECT app_schema.mutate_players()","SELECT `mutate_players`()","SELECT NEXT VALUE FOR player_sequence","SELECT NEXTVAL(player_sequence)","SELECT @value:=1","RENAME TABLE a TO b","SELECT '\\'; UPDATE canonical_players SET source_system='x'",
    ])assert.throws(()=>assertReadOnlySqlStatement(sql),/APP_WIRING_QUERY_NOT_READ_ONLY/);
  });

  it("rejects side-effect SELECT functions, files, variables, and locks in Shadow mode",()=>{
    for(const sql of [
      "SELECT GET_LOCK('x',1)","SELECT RELEASE_LOCK('x')","SELECT RELEASE_ALL_LOCKS()","SELECT LAST_INSERT_ID()","SELECT SLEEP(1)","SELECT BENCHMARK(1,SHA2('x',256))",
      "SELECT 1 INTO OUTFILE 'x'","SELECT 1 INTO DUMPFILE 'x'","SELECT 1 INTO @value",
    ])assert.throws(()=>assertReadOnlySqlStatement(sql),/APP_WIRING_QUERY_NOT_READ_ONLY/);
    for(const sql of ["SELECT * FROM canonical_players FOR UPDATE","SELECT * FROM canonical_players LOCK IN SHARE MODE"]){
      assert.throws(()=>assertReadOnlySqlStatement(sql),/APP_WIRING_LOCKING_QUERY_FORBIDDEN/);
      assert.doesNotThrow(()=>assertReadOnlySqlStatement(sql,true));
    }
  });

  it("fails closed for non-query roots and unsupported lexical bytes",()=>{
    for(const sql of ["","UPDATE canonical_players SET source_system='x'","DELETE FROM canonical_players","SET @x=1","SELECT 1\0"])
      assert.throws(()=>assertReadOnlySqlStatement(sql),/APP_WIRING_QUERY_NOT_READ_ONLY/);
  });
});
