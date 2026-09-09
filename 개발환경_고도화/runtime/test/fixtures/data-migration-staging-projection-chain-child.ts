import { loadConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/database.js";
import { MariaCatalogProjectionRepository } from "../../src/data-migration/catalog-projection-provider.js";
import { MariaCommonStagingRepository } from "../../src/data-migration/common-staging-extractor.js";
import { createStagingProjectionChainFixture } from "./data-migration-staging-projection-chain.fixture.js";

const nonce = process.env.LEASE2620_CHAIN_NONCE ?? "";
const expectedRunId = process.env.LEASE2620_COMMON_RUN_ID ?? "";
if (nonce === "" || expectedRunId === "") throw new Error("LEASE2620_CHILD_INPUT_REQUIRED");
const database = createDatabaseClient(loadConfig().database);
try {
  const initial = createStagingProjectionChainFixture(nonce, expectedRunId);
  const staging = await new MariaCommonStagingRepository(database).extractAndStage(initial.commonManifest);
  const fixture = createStagingProjectionChainFixture(nonce, staging.commonStagingRunId);
  const projection = await new MariaCatalogProjectionRepository(database).project(fixture.catalogManifest, fixture.policy);
  process.stdout.write(JSON.stringify({ staging, projection, stagingSha256: fixture.catalogManifest.commonStagingSha256, payloadFingerprints: fixture.payloadFingerprints }));
} finally {
  await database.close();
}
