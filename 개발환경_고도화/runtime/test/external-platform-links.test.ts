import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AdminManagementService } from "../src/admin/management-service.js";
import {
  ExternalPlatformAccessService,
  isPublicExternalPlatformCommand,
  requiresLinkedSiteAccount
} from "../src/user-auth/external-platform-access-service.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";

function writeResult(insertId = 0n): DatabaseWriteResult {
  return { affectedRows: 1n, insertId };
}

describe("external platform link management", () => {
  it("defines append-only link history and backfills existing links", async () => {
    const migration = await readFile(new URL("../migrations/035_external_platform_link_history.sql", import.meta.url), "utf8");
    assert.match(migration, /CREATE TABLE user_account_external_identity_history/);
    assert.match(migration, /INSERT INTO user_account_external_identity_history/);
    assert.match(migration, /ON DELETE SET NULL/);
  });

  it("allows only verification and help diagnostics without a linked site account", () => {
    assert.equal(isPublicExternalPlatformCommand("/가입인증 ABCD2345"), true);
    assert.equal(isPublicExternalPlatformCommand("/계정인증 ABCD2345"), true);
    assert.equal(isPublicExternalPlatformCommand("/도움말"), true);
    assert.equal(requiresLinkedSiteAccount("/help"), true);
    assert.equal(requiresLinkedSiteAccount("/내정보"), true);
    assert.equal(requiresLinkedSiteAccount("/가입"), true);
    assert.equal(requiresLinkedSiteAccount("시작한다"), true);
    assert.equal(requiresLinkedSiteAccount("일반 대화"), false);
  });

  it("checks the active account, identity and link relationship in one read", async () => {
    const sql: string[] = [];
    const database = {
      query: async <T>(statement: string): Promise<T> => { sql.push(statement); return [{ linked: 1 }] as T; }
    } as DatabaseClient;
    assert.equal(await new ExternalPlatformAccessService(database).hasActiveSiteAccount("kakao", "user-1"), true);
    assert.match(sql[0]!, /user_account_external_identities/);
    assert.match(sql[0]!, /account_row\.status = 'active'/);
  });

  it("unlinks the signed-in user's own identity with history, audit and idempotency", async () => {
    const sessionToken = "session-token";
    const csrfToken = "csrf-token";
    const sql: string[] = [];
    let insertId = 100n;
    const transactionQueries: unknown[] = [[], [{ id: 7n, external_identity_id: 8n, status: "active" }]];
    const transaction: DatabaseTransaction = {
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        return transactionQueries.shift() as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => {
        sql.push(statement); insertId += 1n; return writeResult(insertId);
      }
    };
    const database: DatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        return [{
          session_id: 1n, account_id: 2n, player_id: 3n, login_id: "hoibot01",
          system_account_name: "테스 남", csrf_secret_hash: createHash("sha256").update(csrfToken).digest("hex")
        }] as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); return writeResult(); },
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction)
    };
    const result = await new UserAuthService(database, "pepper").unlinkExternalLink({
      sessionToken, csrfToken, linkId: "7", idempotencyKey: "unlink-once"
    });
    assert.equal(result.status, "unlinked");
    assert.ok(sql.some((statement) => statement.includes("SET status = 'unlinked'")));
    assert.ok(sql.some((statement) => statement.includes("user_account_external_identity_history")));
    assert.ok(sql.some((statement) => statement.includes("command_audit")));
    assert.ok(sql.some((statement) => statement.includes("result_json")));
  });

  it("blocks a link through the administrator transaction and keeps a history row", async () => {
    const sql: string[] = [];
    let queryIndex = 0;
    let insertId = 10n;
    const transaction: DatabaseTransaction = {
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        queryIndex += 1;
        if (queryIndex === 1) return [] as T;
        return [{ id: 7n, user_account_id: 2n, external_identity_id: 8n, status: "active" }] as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => {
        sql.push(statement); insertId += 1n; return writeResult(insertId);
      }
    };
    const database = {
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction)
    } as DatabaseClient;
    const result = await new AdminManagementService(database).changeExternalPlatformLinkStatus({
      operatorId: "5", idempotencyKey: "block-once", reason: "운영 정책 위반", linkId: "7", action: "block"
    });
    assert.equal(result.status, "blocked");
    assert.ok(sql.some((statement) => statement.includes("status = ?")));
    assert.ok(sql.some((statement) => statement.includes("user_account_external_identity_history")));
    assert.ok(sql.some((statement) => statement.includes("command_audit")));
  });
});
