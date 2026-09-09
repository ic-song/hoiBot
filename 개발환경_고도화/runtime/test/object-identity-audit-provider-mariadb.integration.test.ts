import assert from "node:assert/strict";
import { after,describe,it } from "node:test";
import { createDatabaseClient,type DatabaseClient } from "../src/database.js";
import { MariaObjectIdentityAuditProvider } from "../src/identity/object-identity-audit-provider.js";

const enabled=process.env.WBS731_IDENTITY_MARIADB_TEST==="true";
const phase=process.env.WBS731_IDENTITY_MARIADB_PHASE??"disabled";
const integration=enabled?describe:describe.skip;
const fixedNow=()=>new Date("2026-06-22T14:30:00.000Z");
const input=(sourceIdentifier:string)=>({actor:"WBS731 통합검증",objectType:"ITEM",sourceSystem:"LEGACY_JSON",sourceNamespace:"itemInfo",sourceIdentifier});

integration("WBS731 identity/audit isolated MariaDB Gate5",()=>{
  let database:DatabaseClient;
  after(async()=>{await database?.close();});

  it("proves collision, source uniqueness, KST audit, concurrent replay, and restart persistence",async()=>{
    database=createDatabaseClient({enabled:true,host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT!),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,name:process.env.DATABASE_NAME!,connectionLimit:5,connectTimeoutMs:5_000});
    if(phase==="prepare"){
      const audit=["seed","2026-06-22 23:30:00","seed","2026-06-22 23:30:00"];
      await database.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('a1234567','ITEM',?,?,?,?)",audit);
      const candidates=["a1234567","b1234567","c1234567"];
      const collision=await new MariaObjectIdentityAuditProvider(database,()=>candidates.shift()!,3,fixedNow).registerCrosswalk(input("다이아상자💎(/다이아상자오픈)"));
      assert.deepEqual([collision.objectIdentityId,collision.objectIdentityCrosswalkId,collision.replayed],["b1234567","c1234567",false]);
      assert.deepEqual(collision.audit,{INSERT_USER:"WBS731 통합검증",INSERT_TIME:"2026-06-22 23:30:00",UPDATE_USER:"WBS731 통합검증",UPDATE_TIME:"2026-06-22 23:30:00"});
      const firstIds=["d1234567","e1234567","h1234567","j1234567","k1234567","m1234567","n1234567","p1234567"],secondIds=["f1234567","g1234567","q1234567","r1234567","s1234567","t1234567","u1234567","v1234567"];
      const [first,second]=await Promise.all([
        new MariaObjectIdentityAuditProvider(database,()=>firstIds.shift()!,4,fixedNow).registerCrosswalk(input("동시성🔒")),
        new MariaObjectIdentityAuditProvider(database,()=>secondIds.shift()!,4,fixedNow).registerCrosswalk(input("동시성🔒")),
      ]);
      assert.equal(first.objectIdentityId,second.objectIdentityId);assert.equal(first.objectIdentityCrosswalkId,second.objectIdentityCrosswalkId);assert.equal([first,second].filter(result=>result.replayed).length,1);
      await assert.rejects(database.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('z1234567','ITEM','bad','2026-06-22 24:00:00','bad','2026-06-22 24:00:00')"));
    }else{
      assert.equal(phase,"restart");
      const before=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM object_identity_crosswalks"))[0]!.count;
      const replay=await new MariaObjectIdentityAuditProvider(database,()=>"h1234567",4,fixedNow).registerCrosswalk(input("다이아상자💎(/다이아상자오픈)"));
      assert.equal(replay.replayed,true);assert.deepEqual([replay.objectIdentityId,replay.objectIdentityCrosswalkId],["b1234567","c1234567"]);
      const afterCount=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM object_identity_crosswalks"))[0]!.count;
      assert.equal(afterCount,before);
      const row=(await database.query<Array<{source_identifier:string;INSERT_TIME:string;UPDATE_TIME:string}>>("SELECT source_identifier,INSERT_TIME,UPDATE_TIME FROM object_identity_crosswalks WHERE object_identity_crosswalk_id='c1234567'"))[0]!;
      assert.equal(row.source_identifier,"다이아상자💎(/다이아상자오픈)");assert.equal(row.INSERT_TIME,"2026-06-22 23:30:00");assert.equal(row.UPDATE_TIME,"2026-06-22 23:30:00");
    }
  });
});
