import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUEST_NAMESPACE_MAX_LENGTH,
  assertVerifiedEnvironmentContext,
  buildRequestNamespace,
  createEnvironmentContext,
  resolveLegacyDataRoot
} from "../src/runtime/environment-context.js";

describe("EnvironmentContext", () => {
  it("constructs explicit dev and prod contexts without NODE_ENV inference", () => {
    const dev = createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoibot_dev" });
    const prod = createEnvironmentContext({ environmentCode: "prod", databaseIdentity: "hoibot-prod" });

    assert.deepEqual(dev, {
      environmentCode: "dev",
      databaseIdentity: "hoibot_dev",
      requestNamespace: "hoibot:dev:hoibot_dev"
    });
    assert.deepEqual(prod, {
      environmentCode: "prod",
      databaseIdentity: "hoibot-prod",
      requestNamespace: "hoibot:prod:hoibot-prod"
    });
    assert.equal(resolveLegacyDataRoot(dev), "/sdcard/호이랜드_dev/");
    assert.equal(resolveLegacyDataRoot(prod), "/sdcard/호이랜드/");
  });

  it("publishes the official maximum and derives the namespace deterministically", () => {
    assert.equal(REQUEST_NAMESPACE_MAX_LENGTH, 76);
    assert.equal(buildRequestNamespace("dev", "db_$-01"), "hoibot:dev:db_$-01");
    const longest = createEnvironmentContext({ environmentCode: "prod", databaseIdentity: "d".repeat(64) });
    assert.ok(longest.requestNamespace.length <= REQUEST_NAMESPACE_MAX_LENGTH);
  });

  it("rejects implicit environment aliases and invalid database identities", () => {
    for (const environmentCode of ["development", "production", "test", "", undefined]) {
      assert.throws(
        () => createEnvironmentContext({ environmentCode, databaseIdentity: "hoibot_dev" } as never),
        /explicitly set to dev or prod/
      );
    }
    for (const databaseIdentity of ["", " db", "db ", "db.name", "한글db", "d".repeat(65)]) {
      assert.throws(
        () => createEnvironmentContext({ environmentCode: "dev", databaseIdentity }),
        /databaseIdentity must match/
      );
    }
  });

  it("returns a runtime-immutable context", () => {
    const context = createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoibot_dev" });
    assert.equal(Object.isFrozen(context), true);
    assert.throws(() => {
      (context as { environmentCode: string }).environmentCode = "prod";
    }, TypeError);
    assert.equal(context.environmentCode, "dev");
    assert.equal(context.requestNamespace, "hoibot:dev:hoibot_dev");
  });

  it("does not treat ordinary, frozen manual, or spread contexts as verified", () => {
    const context = createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoibot_dev" });
    const manual = Object.freeze({
      environmentCode: "dev",
      databaseIdentity: "hoibot_dev",
      requestNamespace: "hoibot:dev:hoibot_dev"
    });

    assert.throws(() => assertVerifiedEnvironmentContext(context), /must be issued/);
    assert.throws(() => assertVerifiedEnvironmentContext(manual), /must be issued/);
    assert.throws(() => assertVerifiedEnvironmentContext(Object.freeze({ ...context })), /must be issued/);
  });
});
