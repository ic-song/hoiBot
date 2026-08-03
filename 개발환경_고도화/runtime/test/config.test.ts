import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

const BASE_ENV = {
  NODE_ENV: "test",
  IRIS_SHARED_TOKEN: "test-shared-token-1234"
};

describe("server configuration", () => {
  it("keeps MariaDB disabled unless explicitly enabled", () => {
    const config = loadConfig(BASE_ENV);

    assert.equal(config.database.enabled, false);
  });

  it("requires MariaDB connection values when enabled", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, DATABASE_ENABLED: "true" }),
      /DATABASE_HOST/
    );
  });

  it("loads explicit MariaDB connection values", () => {
    const config = loadConfig({
      ...BASE_ENV,
      DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "3307",
      DATABASE_USER: "hoibot_app",
      DATABASE_PASSWORD: "test-password",
      DATABASE_NAME: "hoibot"
    });

    assert.equal(config.database.enabled, true);
    assert.equal(config.database.port, 3307);
    assert.equal(config.database.name, "hoibot");
  });
});
