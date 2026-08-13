import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import {
  extractRetainedContent,
  RetainedEventContentService
} from "../src/integration/retained-event-content-service.js";

function databaseStub(input: {
  execute?: DatabaseClient["execute"];
  query?: DatabaseClient["query"];
}): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: input.query ?? (async () => [] as never),
    execute: input.execute ?? (async () => ({ affectedRows: 1n, insertId: 1n })),
    withTransaction: async () => { throw new Error("Unexpected transaction."); },
    close: async () => undefined
  };
}

describe("retained event content", () => {
  it("extracts only approved live reply content and ignores ordinary text", () => {
    const replyPayload = {
      msg: "새 답글",
      json: {
        id: "92233720368547758070",
        type: "26",
        attachment: "{\"src_logId\":92233720368547758071,\"src_message\":\"원래 글\"}",
        v: "{\"origin\":\"MSG\",\"isMine\":false}"
      }
    };
    const reply = normalizeIrisEvent(replyPayload);
    const ordinary = normalizeIrisEvent({ msg: "일반 대화", json: { id: "2", type: "1", v: "{\"origin\":\"MSG\"}" } });

    assert.deepEqual(extractRetainedContent(replyPayload, reply), [{
      sequenceNo: 0, kind: "reply", messageText: "새 답글", replySourceText: "원래 글"
    }]);
    assert.deepEqual(extractRetainedContent({ msg: "일반 대화" }, ordinary), []);
    assert.equal(reply.targetProviderEventId, "92233720368547758071");
  });

  it("downloads a trusted image into private storage and records only its storage key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hoibot-retained-"));
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const database = databaseStub({
      execute: async (sql, values = []) => {
        writes.push({ sql, values });
        return { affectedRows: 1n, insertId: 1n };
      }
    });
    const imageData = Buffer.from("verified-image-data");
    const fetcher = async () => new Response(imageData, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(imageData.byteLength) }
    });
    const service = new RetainedEventContentService(database, {
      enabled: true, retentionDays: 7, storageDirectory: directory,
      maxBytes: 1024, downloadTimeoutMs: 1_000
    }, fetcher as typeof fetch);
    const payload = {
      msg: "사진",
      json: {
        id: "image-1", chat_id: "room-1", type: "2",
        attachment: "{\"url\":\"https://example.kakaocdn.net/image.png\",\"w\":100,\"h\":120}",
        v: "{\"origin\":\"MSG\",\"isMine\":false}"
      }
    };

    try {
      assert.equal(await service.retain(payload, normalizeIrisEvent(payload)), 1);
      assert.equal(writes.length, 2);
      const storageKey = String(writes[1]!.values[0]);
      assert.deepEqual(await readFile(path.join(directory, storageKey)), imageData);
      assert.match(writes[1]!.sql, /status = 'stored'/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks expired content purged after deleting its stored file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hoibot-purge-"));
    const storageKey = "expired.png";
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(directory, storageKey), "expired"));
    const writes: string[] = [];
    const database = databaseStub({
      query: async <T>() => [{ id: 9n, storage_key: storageKey }] as T,
      execute: async (sql) => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; }
    });
    const service = new RetainedEventContentService(database, {
      enabled: true, retentionDays: 7, storageDirectory: directory,
      maxBytes: 1024, downloadTimeoutMs: 1_000
    });

    try {
      assert.equal(await service.purgeExpired(), 1);
      await assert.rejects(readFile(path.join(directory, storageKey)));
      assert.match(writes[0]!, /status = 'purged'/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns retained details without a filesystem path and audits the read", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const database = databaseStub({
      query: async <T>() => [{
        id: 11n, content_kind: "reply", message_text: "답글 본문",
        reply_source_text: "답글 대상", storage_key: null, mime_type: null,
        byte_size: null, status: "stored", expires_at: new Date("2026-08-14T00:00:00.000Z")
      }] as T,
      execute: async (sql, values = []) => {
        writes.push({ sql, values });
        return { affectedRows: 1n, insertId: 1n };
      }
    });
    const service = new RetainedEventContentService(database, {
      enabled: true, retentionDays: 7, storageDirectory: "./private",
      maxBytes: 1024, downloadTimeoutMs: 1_000
    });

    const detail = await service.readDetail("11", "7");

    assert.equal(detail?.messageText, "답글 본문");
    assert.equal("storageKey" in (detail ?? {}), false);
    assert.match(writes[0]!.sql, /retained_content_access_log/);
    assert.deepEqual(writes[0]!.values.slice(0, 3), [11n, "7", "detail"]);
  });
});
