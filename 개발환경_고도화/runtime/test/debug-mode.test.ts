import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { isDebugModeCommand, normalizeDebugModeDispatchMessage } from "../src/admin/debug-mode-command.js";
import { buildDebugModeMessage, DebugModeService } from "../src/admin/debug-mode-service.js";

describe("admin debug mode", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isDebugModeCommand("/디버깅모드"), true);
    for (const value of [undefined, "디버깅모드", "/디버깅모드 ", "/디버깅모드 1", "/디버깅모드켜줘"]) {
      assert.equal(isDebugModeCommand(value), false, String(value));
    }
  });

  it("normalizes only the exact DB alias", () => {
    assert.equal(normalizeDebugModeDispatchMessage("/디버깅모드"), "/디버깅모드");
    assert.equal(normalizeDebugModeDispatchMessage("/디버깅모드 ON"), "/디버깅모드 ON");
  });

  it("preserves the exact ON and OFF replies", () => {
    assert.equal(buildDebugModeMessage(true), "디버깅 모드 : ON");
    assert.equal(buildDebugModeMessage(false), "디버깅 모드 : OFF");
  });

  it("reads an existing process state", async () => {
    const database = { query: async () => [{ enabled: 1 }] } as unknown as DatabaseClient;
    assert.equal(await new DebugModeService(database, "process-a").isEnabled(), true);
  });

  it("treats a missing process row as restart-default OFF", async () => {
    const database = { query: async () => [] } as unknown as DatabaseClient;
    assert.equal(await new DebugModeService(database, "process-b").isEnabled(), false);
  });
});
