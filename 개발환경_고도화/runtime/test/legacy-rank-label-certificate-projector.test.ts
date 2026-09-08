import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { LegacyRankLabelSideEffectCertificateProjector } from "../src/data-migration/legacy-rank-label-side-effect-certificate-projector.js";

const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const memberPath=sha("member.json"),guildPath=sha("guildData.json"),writeResult:DatabaseWriteResult={affectedRows:1n,insertId:0n};
class ProjectorDb implements DatabaseClient,DatabaseTransaction{
  readonly writes:Array<{sql:string;values:readonly unknown[]}>=[];readonly queries:string[]=[];existing:unknown[]=[];rollbackActive=false;
  constructor(readonly member:unknown,readonly guild:unknown,readonly bindings:unknown[]){}
  async withTransaction<T>(work:(transaction:DatabaseTransaction)=>Promise<T>):Promise<T>{return work(this);}
  async query<T>(sql:string):Promise<T>{
    this.queries.push(sql);
    const memberPayload=Buffer.from(JSON.stringify(this.member)),guildPayload=Buffer.from(JSON.stringify(this.guild));
    if(sql.includes("FROM data_migration_object_domain_import_runs"))return [{object_domain_import_run_id:"i0000001",common_staging_run_id:"s0000001",run_status:"COMPLETE",raw_bundle_sha256:"b".repeat(64),snapshot_manifest_sha256:"c".repeat(64)}] as T;
    if(sql.includes("FROM data_migration_raw_runs"))return [{raw_landing_run_id:"r0000001",run_status:"COMPLETE",bundle_sha256:"b".repeat(64),snapshot_manifest_sha256:"c".repeat(64),source_path_sha256:memberPath,source_content_sha256:sha(memberPayload),payload:memberPayload},{raw_landing_run_id:"r0000001",run_status:"COMPLETE",bundle_sha256:"b".repeat(64),snapshot_manifest_sha256:"c".repeat(64),source_path_sha256:guildPath,source_content_sha256:sha(guildPayload),payload:guildPayload}] as T;
    if(sql.includes("FROM data_migration_object_domain_import_records receipt"))return this.bindings as T;
    if(sql.includes("FROM player_pet_skill_rank_marker_projections"))return [{assignment_status:"UNASSIGNED",source_fingerprint:"a".repeat(64),player_id:null}] as T;
    if(sql.includes("WHERE raw_landing_run_id=?"))return this.existing as T;
    if(sql.startsWith("SELECT active_flag"))return [{active_flag:this.rollbackActive}] as T;
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }
  async execute(sql:string,values:readonly unknown[]=[]):Promise<DatabaseWriteResult>{this.writes.push({sql,values});return writeResult;}
  async ping(){} async verifyRollback(){return true;} async close(){}
}
const input={rawLandingRunId:"r0000001",objectDomainImportRunId:"i0000001",memberSourcePathSha256:memberPath,guildSourcePathSha256:guildPath,actor:"lease2606"};

test("projector creates immutable clean certificates and exact replay performs zero DML",async()=>{
  const db=new ProjectorDb({member:{Alice:{guild:{id:"g1"}},Bob:{}},HoiCastle:{lord:"Alice"}},{guilds:{g1:{members:{Alice:true}}}},[{source_player_key_sha256:sha("Alice"),player_id:"p0000001"},{source_player_key_sha256:sha("Bob"),player_id:"p0000002"}]);
  const candidates=["v0000001","c0000001","c0000002"];
  const projector=new LegacyRankLabelSideEffectCertificateProjector(db,()=>candidates.shift()!,()=>new Date("2026-09-08T03:00:00Z"));
  const first=await projector.project(input);assert.deepEqual(first,{validationRunId:"v0000001",status:"COMPLETE",expectedSubjectCount:2,wouldDeleteCount:0,unmappedCount:0,replayed:false});
  assert.equal(db.queries.some(sql=>sql.includes("data_migration_object_domain_import_records receipt")),true);
  assert.equal(db.queries.some(sql=>sql.includes("current_display_name")),false);
  const runInsert=db.writes.find(row=>row.sql.startsWith("INSERT INTO legacy_rank_label_validation_runs"))!;
  db.existing=[{legacy_rank_label_validation_run_id:"v0000001",validation_fingerprint:runInsert.values[13],certificate_set_sha256:runInsert.values[12],run_status:"COMPLETE",active_flag:true}];
  const before=db.writes.length,second=await projector.project(input);
  assert.equal(second.replayed,true);assert.equal(db.writes.length,before);
  db.existing=[{...db.existing[0] as object,validation_fingerprint:"f".repeat(64)}];
  await assert.rejects(projector.project(input),/CERTIFICATE_REPLAY_DRIFT/);assert.equal(db.writes.length,before);
});

test("dual stale-and-unmapped cause preserves WOULD_DELETE and cannot activate",async()=>{
  const db=new ProjectorDb({member:{Alice:{guild:{id:"missing"}}}},{guilds:{}},[]);
  const candidates=["v0000002","c0000003"];
  const result=await new LegacyRankLabelSideEffectCertificateProjector(db,()=>candidates.shift()!,()=>new Date("2026-09-08T03:00:00Z")).project(input);
  assert.equal(result.status,"REJECTED");assert.equal(result.wouldDeleteCount,1);assert.equal(result.unmappedCount,0);
  const certificate=db.writes.find(row=>row.sql.startsWith("INSERT INTO legacy_rank_label_side_effect_certificates"))!;
  assert.equal(certificate.values[5],"STALE_GUILD");assert.equal(certificate.values[6],"WOULD_DELETE");assert.equal(certificate.values[2],null);
  assert.equal(db.writes.some(row=>row.sql.startsWith("UPDATE legacy_rank_label_validation_runs SET active_flag=TRUE")),false);
});

test("rollback deletes only an inactive exact run and refuses the active certificate",async()=>{
  const db=new ProjectorDb({member:{}},{guilds:{}},[]),projector=new LegacyRankLabelSideEffectCertificateProjector(db);
  await projector.rollback("v0000009");assert.equal(db.writes.at(-1)?.sql,"DELETE FROM legacy_rank_label_validation_runs WHERE legacy_rank_label_validation_run_id=?");
  db.rollbackActive=true;await assert.rejects(projector.rollback("v0000009"),/ACTIVE_CERTIFICATE_ROLLBACK_FORBIDDEN/);
});
