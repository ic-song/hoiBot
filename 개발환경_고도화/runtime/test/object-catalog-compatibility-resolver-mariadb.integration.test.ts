import assert from "node:assert/strict";
import { after,describe,it } from "node:test";
import { ObjectCatalogCompatibilityResolver } from "../src/catalog/object-catalog-compatibility-resolver.js";
import { createDatabaseClient,type DatabaseClient } from "../src/database.js";

const enabled=process.env.WBS732_CROSSWALK_MARIADB_TEST==="true";
const phase=process.env.WBS732_CROSSWALK_MARIADB_PHASE??"disabled";
const integration=enabled?describe:describe.skip;
integration("WBS732 compatibility crosswalk isolated MariaDB Gate5",()=>{
  let database:DatabaseClient;
  after(async()=>{await database?.close();});
  it("proves exact BIGINT, alias/source uniqueness, fail-closed mapping, read-only behavior, and restart",async()=>{
    database=createDatabaseClient({enabled:true,host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT!),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,name:process.env.DATABASE_NAME!,connectionLimit:5,connectTimeoutMs:5_000});
    if(phase==="prepare"){
      await database.execute("INSERT INTO object_registry(id,object_key,object_type,display_name,metadata_json) VALUES (9007199254740993,'item.diamond_box','ITEM','다이아상자💎(/다이아상자오픈)','{}'),(9007199254740994,'pet.test','PET','테스트펫','{}')");
      await database.execute("INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value) VALUES (9007199254740993,'ITEM','legacy_name','다이아상자💎(/다이아상자오픈)')");
      await database.execute("INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key) VALUES (9007199254740993,'ITEM','LEGACY_JS','member.bag','다이아상자💎(/다이아상자오픈)')");
      await database.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('a1234567','ITEM','WBS732','2026-06-22 23:30:00','WBS732','2026-06-22 23:30:00')");
      await database.execute("INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('b1234567','a1234567','LEGACY_DB','object_registry.id','9007199254740993','WBS732','2026-06-22 23:30:00','WBS732','2026-06-22 23:30:00')");
    }else assert.equal(phase,"restart");
    const before=(await database.query<Array<{count:bigint}>>("SELECT (SELECT COUNT(*) FROM object_registry)+(SELECT COUNT(*) FROM object_aliases)+(SELECT COUNT(*) FROM object_source_bindings)+(SELECT COUNT(*) FROM object_identity_crosswalks) count"))[0]!.count;
    const resolver=new ObjectCatalogCompatibilityResolver(database);
    const byId=await resolver.resolveLegacyObjectId("9007199254740993",{expectedObjectType:"ITEM"});
    assert.deepEqual({status:byId.status,legacyObjectId:byId.legacyObjectId,identity:byId.canonicalObjectIdentityId,name:byId.legacyObjectKey},{status:"RESOLVED",legacyObjectId:"9007199254740993",identity:"a1234567",name:"item.diamond_box"});
    assert.equal((await resolver.resolveAlias("ITEM","legacy_name","다이아상자💎(/다이아상자오픈)")).status,"RESOLVED");
    assert.equal((await resolver.resolveSource({system:"LEGACY_JS",table:"member.bag",key:"다이아상자💎(/다이아상자오픈)"})).status,"RESOLVED");
    assert.equal((await resolver.resolveLegacyObjectId("9007199254740994")).quarantineReason,"LEGACY_OBJECT_IDENTITY_UNMAPPED");
    assert.equal((await resolver.resolveLegacyObjectId("9007199254740993",{expectedObjectType:"PET"})).status,"TYPE_MISMATCH");
    assert.equal((await resolver.resolveLegacyObjectId("09007199254740993")).quarantineReason,"LEGACY_OBJECT_ID_INVALID");
    const afterCount=(await database.query<Array<{count:bigint}>>("SELECT (SELECT COUNT(*) FROM object_registry)+(SELECT COUNT(*) FROM object_aliases)+(SELECT COUNT(*) FROM object_source_bindings)+(SELECT COUNT(*) FROM object_identity_crosswalks) count"))[0]!.count;
    assert.equal(afterCount,before);
    if(phase==="prepare"){
      await assert.rejects(database.execute("INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value) VALUES (9007199254740993,'ITEM','legacy_name','다이아상자💎(/다이아상자오픈)')"));
      await assert.rejects(database.execute("INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key) VALUES (9007199254740993,'ITEM','LEGACY_JS','member.bag','다이아상자💎(/다이아상자오픈)')"));
    }
  });
});
