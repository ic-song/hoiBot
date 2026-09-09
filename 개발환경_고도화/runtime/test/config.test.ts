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
      () => loadConfig({ ...BASE_ENV, DATABASE_ENABLED: "true", HOIBOT_ENVIRONMENT_CODE: "dev" }),
      /DATABASE_HOST/
    );
  });

  it("requires an explicit dev or prod environment for an enabled database without NODE_ENV inference", () => {
    const database = {
      DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_USER: "hoibot_app",
      DATABASE_PASSWORD: "test-password",
      DATABASE_NAME: "hoibot"
    };
    assert.throws(() => loadConfig({ ...BASE_ENV, ...database }), /HOIBOT_ENVIRONMENT_CODE/);
    assert.throws(() => loadConfig({
      ...BASE_ENV,
      ...database,
      NODE_ENV: "production",
      USER_VERIFICATION_PEPPER: "production-user-verification-pepper"
    }), /HOIBOT_ENVIRONMENT_CODE/);
    assert.throws(() => loadConfig({ ...BASE_ENV, ...database, HOIBOT_ENVIRONMENT_CODE: "development" }), /HOIBOT_ENVIRONMENT_CODE/);
  });

  it("loads explicit MariaDB connection values", () => {
    const config = loadConfig({
      ...BASE_ENV,
      DATABASE_ENABLED: "true",
      HOIBOT_ENVIRONMENT_CODE: "dev",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "3308",
      DATABASE_USER: "hoibot_app",
      DATABASE_PASSWORD: "test-password",
      DATABASE_NAME: "hoibot"
    });

    assert.equal(config.database.enabled, true);
    assert.equal(config.environmentCode, "dev");
    assert.equal(config.database.port, 3308);
    assert.equal(config.database.name, "hoibot");
  });

  it("loads unique designated open-chat ids without numeric conversion", () => {
    const config = loadConfig({
      ...BASE_ENV,
      IRIS_ALLOWED_OPEN_CHAT_IDS: "18490428324717856, 92233720368547758070,18490428324717856"
    });

    assert.deepEqual(config.irisAllowedOpenChatIds, ["18490428324717856", "92233720368547758070"]);
  });

  it("defaults to designated-only and accepts the first-stage all-open observation mode", () => {
    assert.equal(loadConfig(BASE_ENV).irisOpenChatObservationMode, "designated_only");
    assert.equal(loadConfig({ ...BASE_ENV, IRIS_OPEN_CHAT_OBSERVATION_MODE: "observe_all_open" })
      .irisOpenChatObservationMode, "observe_all_open");
    assert.throws(
      () => loadConfig({ ...BASE_ENV, IRIS_OPEN_CHAT_OBSERVATION_MODE: "all" }),
      /IRIS_OPEN_CHAT_OBSERVATION_MODE/
    );
  });

  it("keeps content retention opt-in with a seven-day default", () => {
    const disabled = loadConfig(BASE_ENV);
    const enabled = loadConfig({
      ...BASE_ENV,
      RETAINED_EVENT_CONTENT_ENABLED: "true",
      RETAINED_EVENT_CONTENT_DAYS: "7",
      RETAINED_EVENT_CONTENT_CHANNEL_IDS: "18490428324717856,92233720368547758070",
      RETAINED_EVENT_CONTENT_SCOPE: "all_verified_open",
      RETAINED_EVENT_CONTENT_STORAGE_DIRECTORY: "./private-content"
    });

    assert.equal(disabled.retainedEventContentEnabled, false);
    assert.equal(enabled.retainedEventContentEnabled, true);
    assert.equal(enabled.retainedEventContentDays, 7);
    assert.equal(enabled.retainedEventContentStorageDirectory, "./private-content");
    assert.deepEqual(enabled.retainedEventContentChannelIds, ["18490428324717856", "92233720368547758070"]);
    assert.equal(enabled.retainedEventContentScope, "all_verified_open");
  });

  it("rejects an unknown retained-content scope", () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, RETAINED_EVENT_CONTENT_SCOPE: "all_rooms" }),
      /RETAINED_EVENT_CONTENT_SCOPE/
    );
  });

  it("falls back to operational room ids only when a separate retention list is omitted", () => {
    const config = loadConfig({ ...BASE_ENV, IRIS_ALLOWED_OPEN_CHAT_IDS: "room-a,room-b" });
    const explicitlyEmpty = loadConfig({
      ...BASE_ENV,
      IRIS_ALLOWED_OPEN_CHAT_IDS: "room-a,room-b",
      RETAINED_EVENT_CONTENT_CHANNEL_IDS: ""
    });

    assert.deepEqual(config.retainedEventContentChannelIds, ["room-a", "room-b"]);
    assert.deepEqual(explicitlyEmpty.retainedEventContentChannelIds, []);
  });
});
