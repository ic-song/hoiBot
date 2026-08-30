import mariadb from "mariadb";

const expectedTypes = ["ITEM", "PET", "FURNITURE", "TITLE", "PET_TITLE", "PACKAGE", "CURRENCY", "SKILL", "HOME_BUILDING", "MINI_PET"];
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33396"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_mini_pet_type_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

async function constraintClause() {
  const rows = await connection.query(
    "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS " +
    "WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_object_registry_type'"
  );
  return String(rows[0]?.CHECK_CLAUSE ?? "");
}

try {
  await check("ten type constraint", async () => {
    const clause = await constraintClause();
    for (const type of expectedTypes) if (!clause.includes(`'${type}'`)) throw new Error(`missing object type:${type}`);
    const values = [...clause.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    if (values.length !== expectedTypes.length || values.some((value) => !expectedTypes.includes(value))) throw new Error(`unexpected object type constraint:${values.join(",")}`);
    evidence.constraintTypes = values;
  });

  await check("existing registry parity", async () => {
    const rows = await connection.query("SELECT object_type,COUNT(*) total FROM object_registry GROUP BY object_type ORDER BY object_type");
    evidence.registryCounts = Object.fromEntries(rows.map((row) => [row.object_type, Number(row.total)]));
    if (rows.some((row) => !expectedTypes.includes(row.object_type))) throw new Error("unexpected existing registry type");
  });

  await check("no mini pet backfill or link", async () => {
    const row = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM mini_pet_definitions) definitions,
      (SELECT COUNT(*) FROM object_registry WHERE object_type='MINI_PET') objects,
      (SELECT COUNT(*) FROM object_aliases WHERE object_type='MINI_PET') aliases,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='MINI_PET') bindings`))[0];
    if (Number(row.objects) !== 0 || Number(row.aliases) !== 0 || Number(row.bindings) !== 0) throw new Error("MINI_PET backfill or link detected");
    evidence.miniPetDefinitions = Number(row.definitions);
    evidence.miniPetObjects = Number(row.objects);
  });

  await check("transactional mini pet type parity", async () => {
    await connection.beginTransaction();
    const insert = await connection.query(
      "INSERT INTO object_registry(object_key,object_type,display_name,metadata_json) VALUES ('mini_pet.synthetic_type_check','MINI_PET','합성 미니펫',JSON_OBJECT('synthetic',TRUE))"
    );
    await connection.query("INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value) VALUES (?,'MINI_PET','legacy_name','합성 미니펫')", [insert.insertId]);
    await connection.query("INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key) VALUES (?,'MINI_PET','LEGACY_JSON','miniPetData.miniPet','synthetic-type-check')", [insert.insertId]);
    const rows = await connection.query(`SELECT r.object_type,a.alias_value,s.source_table,s.source_key
      FROM object_registry r
      JOIN object_aliases a ON a.object_id=r.id AND a.object_type=r.object_type
      JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type
      WHERE r.object_key='mini_pet.synthetic_type_check'`);
    if (rows.length !== 1 || rows[0].object_type !== "MINI_PET" || rows[0].alias_value !== "합성 미니펫" || rows[0].source_key !== "synthetic-type-check") throw new Error("MINI_PET typed relation mismatch");
    await connection.rollback();
  });

  await check("transaction rollback", async () => {
    const row = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_key='mini_pet.synthetic_type_check') objects,
      (SELECT COUNT(*) FROM object_aliases WHERE object_type='MINI_PET') aliases,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='MINI_PET') bindings`))[0];
    if (Number(row.objects) !== 0 || Number(row.aliases) !== 0 || Number(row.bindings) !== 0) throw new Error("MINI_PET transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  await check("reconnect", async () => {
    const clause = await constraintClause();
    if (!clause.includes("'MINI_PET'")) throw new Error("MINI_PET constraint missing after reconnect");
  });
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}
