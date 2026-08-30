import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { DiamondShopCatalogWebAdapterProvider } from "../src/shop/diamond-shop-catalog-web-adapter-provider.js";

const config = loadConfig();
const operatorId = process.argv[2] ?? "9800002361";
let database = createDatabaseClient(config.database);

// 합성 web adapter의 동시 replay·payload conflict·stable disable·restart와 Iris 무생성을 확인합니다.
async function main(): Promise<void> {
  let provider = new DiamondShopCatalogWebAdapterProvider(database);
  const snapshot = await provider.readSnapshot();
  const addInput = {
    source: "lease2361-probe",
    operatorId,
    idempotencyKey: `probe-add-${snapshot.catalogVersion.toString()}`,
    expectedVersion: snapshot.catalogVersion,
    reason: "Lease2361 synthetic probe",
    displayName: `Lease2361 probe ${snapshot.catalogVersion.toString()}`,
    quantity: 7n,
    price: 73n,
  };
  const concurrent = await Promise.all([provider.add(addInput), provider.add(addInput)]);
  let payloadConflict = false;
  try {
    await provider.add({ ...addInput, price: addInput.price + 1n });
  } catch (error) {
    payloadConflict = error instanceof Error && error.message.includes("다른 요청 payload");
  }
  const disableInput = {
    source: addInput.source,
    operatorId,
    idempotencyKey: `probe-disable-${snapshot.catalogVersion.toString()}`,
    expectedVersion: snapshot.catalogVersion + 1n,
    reason: "Lease2361 synthetic probe disable",
    productId: concurrent[0]!.productId,
  };
  const disabled = await provider.softDisable(disableInput);
  await database.close();
  database = createDatabaseClient(config.database);
  provider = new DiamondShopCatalogWebAdapterProvider(database);
  const restartReplay = await provider.softDisable(disableInput);
  const evidence = (await database.query<Array<{ operations: bigint; events: bigint; audits: bigint; executions: bigint; outboxes: bigint }>>(
    `SELECT
     (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond.shop.catalog.web') operations,
     (SELECT COUNT(*) FROM diamond_shop_catalog_events event JOIN operations operation ON operation.id=event.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') events,
     (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') audits,
     (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id=execution.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') executions,
     (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') outboxes`,
  ))[0]!;
  console.log(JSON.stringify({
    concurrentReplayFlags: concurrent.map((result) => result.replayed).sort(),
    stableProductId: concurrent[0]!.productId === concurrent[1]!.productId && concurrent[0]!.productId === disabled.productId,
    payloadConflict,
    disabled,
    restartReplay,
    evidence,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
