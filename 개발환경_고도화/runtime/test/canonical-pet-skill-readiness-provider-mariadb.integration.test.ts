import assert from "node:assert/strict";
import {after,describe,it} from "node:test";
import {createDatabaseClient,hasDatabaseTransactionCapabilities,type DatabaseClient} from "../src/database.js";
import {MariaCanonicalPetSkillReadinessProvider} from "../src/pet/canonical-pet-skill-readiness-provider.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";

const enabled=process.env.WBS768_PET_SKILL_READINESS_MARIADB_TEST==="true";
const required=(name:string)=>process.env[name]??"integration-not-configured";

describe("WBS768 canonical pet skill readiness MariaDB",{skip:!enabled},()=>{
  let database:DatabaseClient|undefined;
  after(async()=>database?.close());
  it("classifies the seeded isolated DEV catalog as READY using SELECT statements only",async()=>{
    const databaseIdentity=required("DATABASE_NAME");
    database=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:databaseIdentity,connectionLimit:3,connectTimeoutMs:5_000});
    const environment=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
    const sql:string[]=[];
    if(!hasDatabaseTransactionCapabilities(database))throw new Error("WBS768_READ_ONLY_SNAPSHOT_REQUIRED");
    const readiness=await database.withReadOnlySnapshot(transaction=>new MariaCanonicalPetSkillReadinessProvider().inspect({query:async<T>(statement:string,values?:readonly unknown[])=>{sql.push(statement);return transaction.query<T>(statement,values);}},environment));
    assert.deepEqual(readiness,{status:"READY",reasonCode:"COMPLETE",counts:{definitions:93,imports:93,aliases:30,policies:4}});
    assert.equal(sql.length,7);
    assert.ok(sql.every(statement=>statement.trimStart().startsWith("SELECT")));
  });
});
