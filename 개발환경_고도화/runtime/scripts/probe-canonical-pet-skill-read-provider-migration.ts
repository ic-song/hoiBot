import fs from "node:fs/promises";
import mariadb from "mariadb";

const connection=await mariadb.createConnection({host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,database:process.env.DATABASE_NAME!,multipleStatements:true});
const rollback=await fs.readFile("migrations/rollback/481_canonical_pet_skill_read_provider.rollback.sql","utf8");
try{
  await connection.query("SET FOREIGN_KEY_CHECKS=0; INSERT INTO canonical_owned_pet_skill_equipments(owned_pet_skill_equipment_id,owned_pet_id,player_id,pet_skill_id,slot_number,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('equip040','owned040','player40','skill040',40,'probe','2026-09-07 10:10:00','probe','2026-09-07 10:10:00'); SET FOREIGN_KEY_CHECKS=1");
  let blocked=false;try{await connection.query(rollback);}catch(error){blocked=typeof error==="object"&&error!==null&&"errno" in error&&Number(error.errno)===1242;}
  const tables=await connection.query<Array<{count:string|bigint}>>("SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('canonical_pet_skill_aliases','canonical_pet_skill_draw_grade_policies')");
  const checks=await connection.query<Array<{check_clause:string}>>("SELECT check_clause FROM information_schema.check_constraints WHERE constraint_schema=DATABASE() AND constraint_name='chk_canonical_pet_skill_equipment_slot'");
  if(!blocked||Number(tables[0]?.count)!==2||!checks[0]?.check_clause.includes("40"))throw new Error("CANONICAL_PET_SKILL_ROLLBACK_PREFLIGHT_FAILED");
  await connection.query("DELETE FROM canonical_owned_pet_skill_equipments WHERE owned_pet_skill_equipment_id='equip040'");
  console.log(JSON.stringify({rollbackBlockedBeforeDdl:true,supportTableCount:2,slotCheck:checks[0]!.check_clause}));
}finally{await connection.end();}
