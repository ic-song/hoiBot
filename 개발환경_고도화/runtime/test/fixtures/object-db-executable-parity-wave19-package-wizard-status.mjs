import { randomUUID } from "node:crypto";

import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

const MODULE_EXECUTION_ID = randomUUID();
const normalize = (sql) => String(sql).replace(/\s+/g, " ").trim();
const assert = (value, message) => { if (!value) throw new Error(message); };
const DML = /^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i;
const SOURCE_TABLES = ["package_catalog_wizard_sessions", "package_catalog_wizard_results", "package_catalog_heads", "package_definitions", "package_rewards"];
const STATUS_MESSAGE = [
  "📦 패키지 추가 진행 상태",
  "",
  "단계: REWARD_CHOICE",
  "패키지: 합성 패키지🎁",
  "설명: 상태 조회 합성 설명",
  "보상:",
  "- 포인트 🅟9,007,199,254,740,993",
  "- 다이아상자💎(/다이아상자오픈) x3",
].join("\n");

function makeDatabase(activeSession) {
  const calls = [];
  let insertId = 100n;
  const query = async (sql, values = []) => {
    const normalizedSql = normalize(sql);
    let rows;
    if (normalizedSql.includes("FROM command_aliases a")) {
      rows = values[0] === "/패키지추가상태"
        ? [{ command_code: "PACKAGE_CATALOG_WIZARD_STATUS", handler_key: "PACKAGE_CATALOG_WIZARD_STATUS", auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }]
        : [];
    } else if (normalizedSql === "SELECT id FROM channels WHERE provider_code = ? AND external_channel_id = ?") {
      rows = [{ id: 11n }];
    } else if (normalizedSql === "SELECT id FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?") {
      rows = [{ id: 12n }];
    } else if (normalizedSql.includes("FROM external_identity_names")) {
      rows = [{ display_name: "합성 관리자" }];
    } else if (normalizedSql.includes("JOIN admin_operator_external_identities")) {
      rows = [{ operator_id: 900000783n }];
    } else if (normalizedSql.startsWith("SELECT result_json FROM package_catalog_wizard_results")) {
      rows = [];
    } else if (normalizedSql.includes("FROM package_catalog_wizard_sessions") && !normalizedSql.includes("FOR UPDATE")) {
      rows = activeSession ? [{
        session_id: "wave19-session",
        operator_id: "900000783",
        version: 7n,
        base_catalog_version: 19n,
        expires_at: new Date("2099-01-01T00:00:00.000Z"),
        draft_json: JSON.stringify({ step: "REWARD_CHOICE", name: "합성 패키지🎁", description: "상태 조회 합성 설명", rewards: [
          { rewardType: "POINT", assetCode: "POINT", quantity: { $bigint: "9007199254740993" } },
          { rewardType: "ITEM", assetCode: "다이아상자💎(/다이아상자오픈)", quantity: { $bigint: "3" } },
        ] }),
      }] : [];
    } else if (normalizedSql.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")) {
      rows = [{ next_attempt: 1n }];
    } else {
      rows = [];
    }
    calls.push({ channel: "query", normalizedSql, values, rowCount: rows.length });
    return rows;
  };
  const execute = async (sql, values = []) => {
    const normalizedSql = normalize(sql);
    for (const table of SOURCE_TABLES) {
      if (DML.test(normalizedSql) && new RegExp(`(?:INTO|UPDATE|FROM) ${table}\\b`, "i").test(normalizedSql)) {
        throw new Error(`Wave19 source-domain DML forbidden: ${normalizedSql}`);
      }
    }
    insertId += 1n;
    calls.push({ channel: "execute", normalizedSql, values, rowCount: 1 });
    return { affectedRows: 1n, insertId };
  };
  const transaction = { query, execute, withSavepoint: async (work) => work(transaction) };
  const run = async (work) => work(transaction);
  return {
    database: { query, execute, withTransaction: run, withRootTransaction: run, withConsistentRootTransaction: run, withControlledTransaction: run, withReadOnlySnapshot: async (work) => work({ query }), ping: async () => {}, verifyRollback: async () => true, close: async () => {} },
    calls,
  };
}

export async function executeWave19PackageWizardStatus({ binding }) {
  assert(binding.consumerId === "runtime-dispatch-79ff58fea52c7457", "Wave19 consumer binding drift");
  assert(binding.exportName === "executeWave19PackageWizardStatus", "Wave19 export binding drift");
  assert(binding.harnessCaseId === "case:wave19:package-wizard-status", "Wave19 case binding drift");
  const negative = binding.scenarioKind === "NEGATIVE_GUARD";
  const runtime = makeDatabase(!negative);
  const replies = [];
  const token = "wave19-package-status-token";
  const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "wave19-package-status-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3341", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave19_package_status" });
  process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED = "true";
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  const app = buildApp(config, {
    database: runtime.database,
    inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
    sendIrisTextReply: async (reply) => { replies.push(reply); },
  });
  const message = negative ? "/패키지추가상태 안내" : "/패키지추가상태";
  let response;
  try {
    response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "Wave19 패키지 상태방", sender: "합성 관리자", json: { _id: `wave19-${binding.scenarioKind.toLowerCase()}`, chat_id: "wave19-channel", user_id: "wave19-admin" } } });
  } finally {
    delete process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    await app.close();
  }
  const body = JSON.parse(response.body);
  const reply = replies[0]?.data ?? "NO_REPLY";
  const wizardReads = runtime.calls.filter((call) => call.channel === "query" && SOURCE_TABLES.some((table) => call.normalizedSql.includes(table)));
  const sourceDomainDmlCount = runtime.calls.filter((call) => call.channel === "execute" && SOURCE_TABLES.some((table) => call.normalizedSql.includes(table))).length;
  if (negative) {
    assert(reply === "NO_REPLY", "Wave19 negative guard emitted reply");
    assert(wizardReads.length === 0, "Wave19 negative guard reached wizard repository");
  } else {
    assert(response.statusCode === 202 && body.accepted === true, "Wave19 status route was not accepted");
    assert(reply === STATUS_MESSAGE, `Wave19 exact status output drift: ${reply}`);
    assert(wizardReads.length === 2, "Wave19 status read count drift");
  }
  assert(sourceDomainDmlCount === 0, "Wave19 source-domain DML detected");
  return {
    executedConsumerId: binding.consumerId,
    executedCaseId: binding.harnessCaseId,
    moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: negative ? 4 : 6,
    reply,
    result: JSON.stringify({ statusCode: response.statusCode, accepted: body.accepted === true, ignored: body.ignored ?? false, reply, wizardReadCount: wizardReads.length, sourceDomainDmlCount }),
    databaseEvidence: { calls: runtime.calls, sourceDomainDmlCount },
  };
}
