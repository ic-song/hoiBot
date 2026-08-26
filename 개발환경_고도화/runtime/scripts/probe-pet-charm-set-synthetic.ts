import mariadb from "mariadb";

const pool=mariadb.createPool({host:process.env.DB_HOST??"127.0.0.1",port:Number(process.env.DB_PORT??"3306"),user:process.env.DB_USER??"hoibot",password:process.env.DB_PASSWORD??"hoibot",database:process.env.DB_NAME??"hoibot",connectionLimit:2,bigIntAsNumber:false});
const connection=await pool.getConnection();
try{
  await connection.beginTransaction();
  const suffix=Date.now().toString(),name=`매력합성-${suffix}`;
  const player=await connection.query("INSERT INTO players(status) VALUES ('active')");
  const playerId=player.insertId as bigint;
  await connection.query("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,?,?)",[playerId,name,"seed"]);
  const pet=await connection.query("INSERT INTO player_pets(player_id,display_name,pet_type_code,image_value,experience) VALUES (?,?,'legacy-egg','🪺',0)",[playerId,"합성펫"]);
  const definitions=await connection.query("SELECT code,display_name,metadata_json FROM pet_definitions WHERE code IN ('legacy-egg','legacy-sky','legacy-land','legacy-sea') ORDER BY code");
  if(definitions.length!==4)throw new Error(`definition count mismatch: ${definitions.length}`);
  const sky=definitions.find((row:{code:string})=>row.code==="legacy-sky");
  const metadata=typeof sky.metadata_json==="string"?JSON.parse(sky.metadata_json):sky.metadata_json;
  if(!Array.isArray(metadata.normalEmojis)||!Array.isArray(metadata.uniqueEmojis))throw new Error("emoji pools missing");
  const update=await connection.query("UPDATE player_pets SET experience=10,pet_type_code='legacy-sky',image_value=?,version=version+1 WHERE id=? AND version=1",[metadata.normalEmojis[0],pet.insertId]);
  if(Number(update.affectedRows)!==1)throw new Error("pet version update failed");
  const rows=await connection.query("SELECT experience,pet_type_code,image_value,version FROM player_pets WHERE id=?",[pet.insertId]);
  if(rows[0].experience!==10n||rows[0].pet_type_code!=="legacy-sky"||rows[0].version!==2n)throw new Error("pet projection mismatch");
  await connection.rollback();
  const residue=await connection.query("SELECT COUNT(*) count FROM player_profiles WHERE current_display_name=?",[name]);
  if(Number(residue[0].count)!==0)throw new Error("rollback residue detected");
  console.log("pet-charm-set probe PASS: fixture=1, definition4/experience/evolution/version/rollback=PASS");
}finally{connection.release();await pool.end();}
