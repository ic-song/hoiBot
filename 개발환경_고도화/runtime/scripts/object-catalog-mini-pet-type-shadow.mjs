import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33396"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_mini_pet_type_probe"
});

try {
  await connection.beginTransaction();
  const insert = await connection.query(
    "INSERT INTO object_registry(object_key,object_type,display_name,metadata_json) VALUES ('mini_pet.synthetic_shadow_check','MINI_PET','합성 미니펫 Shadow',JSON_OBJECT('synthetic',TRUE))"
  );
  await connection.query("INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value) VALUES (?,'MINI_PET','legacy_name','합성 미니펫 Shadow')", [insert.insertId]);
  await connection.query("INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key) VALUES (?,'MINI_PET','LEGACY_JSON','miniPetData.miniPet','synthetic-shadow-check')", [insert.insertId]);
  const rows = await connection.query(`SELECT r.object_key,r.object_type,r.active,a.alias_value,s.source_table,s.source_key
    FROM object_registry r
    JOIN object_aliases a ON a.object_id=r.id AND a.object_type=r.object_type
    JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type
    WHERE r.object_key='mini_pet.synthetic_shadow_check'`);
  const value = rows[0];
  if (rows.length !== 1 || value.object_type !== "MINI_PET" || value.alias_value !== "합성 미니펫 Shadow" || value.source_table !== "miniPetData.miniPet" || value.source_key !== "synthetic-shadow-check" || !value.active) throw new Error("MINI_PET Shadow mismatch");
  await connection.rollback();
  const residual = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_key='mini_pet.synthetic_shadow_check'"))[0];
  if (Number(residual.total) !== 0) throw new Error("MINI_PET Shadow rollback mismatch");
  console.log(JSON.stringify({ result: "passed", shadowChecks: ["registry", "typed-alias", "source-binding", "active", "rollback"], objectType: "MINI_PET", persistedObjects: 0 }));
} finally {
  await connection.end();
}
