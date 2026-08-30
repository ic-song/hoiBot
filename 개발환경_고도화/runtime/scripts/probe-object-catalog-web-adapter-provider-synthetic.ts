import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ObjectCatalogWebAdapterProvider } from "../src/catalog/object-catalog-web-adapter-provider.js";

const config = loadConfig();
const operatorId = process.argv[2] ?? "9800002373";
let database = createDatabaseClient(config.database);

// 격리 합성 DB에서 replay·payload conflict·active toggle·restart와 원자 evidence를 확인합니다.
async function main(): Promise<void> {
  const suffix = Date.now().toString();
  const currencyCode = `lease2373_probe_${suffix}`;
  const objectKey = `currency.lease2373_probe_${suffix}`;
  await database.execute(
    "INSERT INTO currency_definitions(code,display_name,scale_digits,active) VALUES (?, ?, 0, TRUE)",
    [currencyCode, `Lease2373 probe ${suffix}`],
  );
  let provider = new ObjectCatalogWebAdapterProvider(database);
  const registerInput = {
    source: "lease2373-probe",
    operatorId,
    idempotencyKey: `register-${suffix}`,
    reason: "Lease2373 synthetic probe register",
    objectKey,
    objectType: "CURRENCY" as const,
    displayName: `Lease2373 probe ${suffix}`,
    sourceBindings: [{ system: "RUNTIME_DB" as const, table: "currency_definitions", key: currencyCode }],
  };
  const concurrent = await Promise.all([provider.register(registerInput), provider.register(registerInput)]);
  let payloadConflict = false;
  try {
    await provider.register({ ...registerInput, displayName: "different payload" });
  } catch (value) {
    payloadConflict = value instanceof Error && value.message.includes("다른 요청 payload");
  }
  const activeInput = {
    source: registerInput.source,
    operatorId,
    idempotencyKey: `disable-${suffix}`,
    reason: "Lease2373 synthetic probe disable",
    objectKey,
    objectType: registerInput.objectType,
    expectedVersion: concurrent[0]!.object.version,
    active: false,
  };
  const disabled = await provider.setActive(activeInput);
  await database.close();
  database = createDatabaseClient(config.database);
  provider = new ObjectCatalogWebAdapterProvider(database);
  const restartReplay = await provider.setActive(activeInput);
  const evidence = (await database.query<Array<{ operations: bigint; changes: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT
     (SELECT COUNT(*) FROM operations WHERE idempotency_scope='object.catalog.web' AND actor_id=?) operations,
     (SELECT COUNT(*) FROM object_catalog_change_log change_log JOIN object_registry object ON object.id=change_log.object_id WHERE object.object_key=?) changes,
     (SELECT COUNT(*) FROM command_audit WHERE target_id=?) audits,
     (SELECT COUNT(*) FROM outbox_messages WHERE destination_id=? AND message_type='object_catalog.changed') outboxes`,
    [operatorId, objectKey, objectKey, objectKey],
  ))[0]!;
  console.log(JSON.stringify({
    concurrentReplayFlags: concurrent.map((value) => value.replayed).sort(),
    stableObjectKey: concurrent[0]!.object.objectKey === concurrent[1]!.object.objectKey && disabled.object.objectKey === objectKey,
    payloadConflict,
    disabled,
    restartReplay,
    evidence,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
