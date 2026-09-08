import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const evidenceRoot=new URL("../../migration-control/evidence/legacy-rank-label-side-effect-certificate-lease2606/isolated-mariadb-20260908/",import.meta.url);

interface Receipt {
  payload:{
    contract:string;
    image:{reference:string;repositoryDigest:string;serverVersion:string};
    isolation:{containerName:string;containerId:string;host:string;dynamicPort:number;database:string;user:string;operationalDatabaseUsed:boolean;operationalPort3306BoundByHarness:boolean};
    migrations:{count:number;names:string[];reapply:string};
    foreignKeys:string[];
    readiness:{sqlExecuted:boolean;result:{ready:boolean;reasonCode:string}};
    restart:{containerIdentityStable:boolean;preState:string;postState:string};
    rollback:{populatedRefusal:string;populatedRowsPreserved:string;emptyRollback:string};
    transcriptSha256:string;
  };
  payloadSha256:string;
}

test("WBS778 isolated MariaDB receipt and transcript are immutable and complete",async()=>{
  const receipt=JSON.parse(await readFile(new URL("isolated-mariadb-receipt.json",evidenceRoot),"utf8")) as Receipt;
  const transcript=await readFile(new URL("isolated-mariadb-transcript.log",evidenceRoot),"utf8");
  assert.equal(receipt.payload.contract,"WBS778_ISOLATED_MARIADB_RECEIPT_V1");
  assert.equal(sha256(JSON.stringify(receipt.payload)),receipt.payloadSha256);
  assert.equal(sha256(transcript),receipt.payload.transcriptSha256);
  assert.match(receipt.payload.image.repositoryDigest,/^mariadb@sha256:[0-9a-f]{64}$/);
  assert.match(receipt.payload.image.serverVersion,/^11\.4\./);
  assert.equal(receipt.payload.isolation.database,"hoibot_wbs778");
  assert.equal(receipt.payload.isolation.user,"wbs778");
  assert.equal(receipt.payload.isolation.host,"127.0.0.1");
  assert.notEqual(receipt.payload.isolation.dynamicPort,3306);
  assert.equal(receipt.payload.isolation.operationalDatabaseUsed,false);
  assert.equal(receipt.payload.isolation.operationalPort3306BoundByHarness,false);
  const migrationNames=(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>/^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  assert.equal(receipt.payload.migrations.count,476);
  assert.deepEqual(receipt.payload.migrations.names,migrationNames);
  assert.equal(receipt.payload.migrations.reapply,"PASS");
  assert.deepEqual(receipt.payload.foreignKeys,[
    "fk_legacy_rank_label_certificate_player|legacy_rank_label_side_effect_certificates.player_id->canonical_players.player_id",
    "fk_legacy_rank_label_certificate_run|legacy_rank_label_side_effect_certificates.legacy_rank_label_validation_run_id->legacy_rank_label_validation_runs.legacy_rank_label_validation_run_id",
    "fk_legacy_rank_label_validation_import_run|legacy_rank_label_validation_runs.object_domain_import_run_id->data_migration_object_domain_import_runs.object_domain_import_run_id",
    "fk_legacy_rank_label_validation_raw_run|legacy_rank_label_validation_runs.raw_landing_run_id->data_migration_raw_runs.raw_landing_run_id",
    "fk_legacy_rank_label_validation_staging_run|legacy_rank_label_validation_runs.common_staging_run_id->data_migration_common_staging_runs.common_staging_run_id",
  ]);
  assert.deepEqual(receipt.payload.readiness,{sqlExecuted:true,result:{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"}});
  assert.equal(receipt.payload.restart.containerIdentityStable,true);
  assert.equal(receipt.payload.restart.preState,receipt.payload.restart.postState);
  assert.deepEqual(receipt.payload.rollback,{populatedRefusal:"ROLLBACK_489_DATA_PRESENT",populatedRowsPreserved:"1|1",emptyRollback:"PASS"});
  for(const marker of ["migration.count=476","readiness.sql.execute=PASS","restart.container_identity=STABLE","rollback.populated.rows_preserved=1|1","rollback.empty=PASS","migration.reapply=PASS:1|2"])assert.match(transcript,new RegExp(marker.replace(/[.|]/g,"\\$&")));
});
