import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPassCanonicalOwnershipRepository } from "../src/pass/maria-pass-canonical-ownership-repository.js";
import { PassCanonicalOwnershipProvider } from "../src/pass/pass-canonical-ownership-provider.js";
import { PassCanonicalOwnershipService } from "../src/pass/pass-canonical-ownership-service.js";

test("pass canonical ownership MariaDB normal repeat conflict remove expiry-null replay rollback reconnect",{skip:process.env.RUN_PASS_CANONICAL_MARIADB!=="1"},async()=>{
 let database=createDatabaseClient(loadConfig().database);let playerId=0n;
 try{
  playerId=(await database.execute("INSERT INTO players(status,version,created_at,updated_at) VALUES ('active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")).insertId;
  await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,starts_at,ends_at) VALUES (?,'support',TRUE,FALSE,UTC_TIMESTAMP(3),NULL)",[playerId]);
  const repository=new MariaPassCanonicalOwnershipRepository();const provider=new PassCanonicalOwnershipProvider(database,repository);const service=new PassCanonicalOwnershipService(provider);
  assert.equal((await provider.read(playerId,"hoi"))?.source,"COMPATIBILITY");
  const normal=await service.execute({playerId:playerId.toString(),semanticCode:"hoi",action:"grant",endDate:null,expectedVersion:"0",idempotencyKey:`normal-${playerId}`});assert.equal(normal.changed,true);assert.equal(normal.entitlementKind,"permanent");assert.equal(normal.version,"1");
  const replay=await service.execute({playerId:playerId.toString(),semanticCode:"hoi",action:"grant",endDate:null,expectedVersion:"0",idempotencyKey:`normal-${playerId}`});assert.equal(replay.replayed,true);
  const repeat=await service.execute({playerId:playerId.toString(),semanticCode:"hoi",action:"grant",endDate:null,expectedVersion:"1",idempotencyKey:`repeat-${playerId}`});assert.equal(repeat.changed,false);assert.equal(repeat.version,"1");
  await assert.rejects(()=>service.execute({playerId:playerId.toString(),semanticCode:"hoi",action:"remove",expectedVersion:"0",idempotencyKey:`conflict-${playerId}`}),error=>(error as {code?:string}).code==="PASS_OWNERSHIP_VERSION_CONFLICT");
  const removed=await service.execute({playerId:playerId.toString(),semanticCode:"hoi",action:"remove",expectedVersion:"1",idempotencyKey:`remove-${playerId}`});assert.equal(removed.status,"revoked");assert.equal(removed.version,"2");
  await database.execute("CREATE TRIGGER lease2416_pass_rollback BEFORE INSERT ON support_pass_change_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
  await assert.rejects(()=>service.execute({playerId:playerId.toString(),semanticCode:"newbie",action:"grant",endDate:null,idempotencyKey:`rollback-${playerId}`}));
  await database.execute("DROP TRIGGER lease2416_pass_rollback");
  assert.equal(Number((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_support_passes WHERE player_id=? AND pass_code='newbie'",[playerId]))[0]?.c),0);
  await database.close();database=createDatabaseClient(loadConfig().database);const reconnected=new PassCanonicalOwnershipProvider(database,new MariaPassCanonicalOwnershipRepository());assert.equal((await reconnected.read(playerId,"hoi"))?.status,"revoked");
 }finally{await database.execute("DROP TRIGGER IF EXISTS lease2416_pass_rollback");if(playerId!==0n){await database.execute("DELETE e FROM support_pass_change_events e JOIN operations o ON o.id=e.operation_id WHERE e.player_id=?",[playerId]);await database.execute("DELETE FROM player_support_passes WHERE player_id=?",[playerId]);await database.execute("DELETE FROM player_passes WHERE player_id=?",[playerId]);await database.execute("DELETE FROM operations WHERE idempotency_scope='support.pass.canonical.ownership' AND JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.playerId'))=?",[playerId.toString()]);await database.execute("DELETE FROM players WHERE id=?",[playerId]);}await database.close();}
});
