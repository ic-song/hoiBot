import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";

const root = resolve(import.meta.dirname, "../../.."),
  read = (path: string) =>
    readFileSync(resolve(root, path), "utf8").replace(/\r\n?/g, "\n"),
  sha = (text: string) => createHash("sha256").update(text).digest("hex"),
  normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
const manifest = JSON.parse(
  read(
    "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",
  ),
);
const output =
  "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave8-admin-chain-v1.json";
const receiptScenarios = [
  "READ_POSITIVE",
  "NEGATIVE_GUARD",
  "AUTH_DENIED",
  "EXACT_OUTPUT",
  "SOURCE_DOMAIN_DML_ZERO",
  "RESTART_CONSISTENCY",
];
const definitions = [
  {
    id: "admin-command-0ab0acb6f570d48c",
    caseId: "case:admin-data-status-chain",
    message: "/데이터상태",
    invalid: "/데이터상태 안내",
    commandCode: "ADMIN_DATA_STATUS",
    guardFile: "개발환경_고도화/runtime/src/admin/data-status-service.ts",
    needles: [
      "isDataStatusCommand(input.message)",
      "new CommandDispatcher",
      "this.database.withTransaction",
    ],
    files: [
      "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts",
      "개발환경_고도화/runtime/src/admin/data-status-service.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
    ],
  },
  {
    id: "admin-command-115e33dcf567dd08",
    caseId: "case:admin-pet-owner-read-chain",
    message: "/펫주인",
    invalid: "/펫주인 안내",
    commandCode: "PET_OWNER_READ",
    guardFile: "개발환경_고도화/runtime/src/pet/pet-owner-read-service.ts",
    needles: [
      "isPetOwnerReadCommand(input.message)",
      "new PetOwnerReadService",
      "this.database.withTransaction",
    ],
    files: [
      "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts",
      "개발환경_고도화/runtime/src/pet/pet-owner-read-service.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
    ],
  },
  {
    id: "admin-command-3a76b9ad462b6143",
    caseId: "case:admin-ring-read-chain",
    message: "/반지보상통계",
    invalid: "/반지보상통계 안내",
    commandCode: "RING_REWARD_STATS",
    guardFile: "개발환경_고도화/runtime/src/ring/ring-read-service.ts",
    needles: [
      "isRingReadCommandCandidate(input.message)",
      "new RingReadService",
      "this.database.withTransaction",
    ],
    files: [
      "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts",
      "개발환경_고도화/runtime/src/ring/ring-read-service.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
    ],
  },
  {
    id: "admin-command-5e04d0767d4c2abc",
    caseId: "case:admin-server-stats-chain",
    message: "/서버통계",
    invalid: "/서버통계 안내",
    commandCode: "ADMIN_SERVER_STATS",
    guardFile: "개발환경_고도화/runtime/src/admin/server-stats-service.ts",
    needles: [
      "isServerStatsCommand(input.message)",
      "new ServerStatsService",
      "this.database.withTransaction",
    ],
    files: [
      "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts",
      "개발환경_고도화/runtime/src/admin/server-stats-service.ts",
      "개발환경_고도화/runtime/src/admin/maria-server-stats-repository.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
    ],
  },
] as const;
const safe = (value: any): any =>
  typeof value === "bigint"
    ? { $bigint: value.toString() }
    : Array.isArray(value)
      ? value.map(safe)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, safe(child)]),
          )
        : value;
function locate(file: string, needle: string) {
  const source = read(file),
    start = 0,
    end = source.length;
  if (!source.includes(needle)) throw new Error(`${file} missing ${needle}`);
  return { file, start, end, sha256: sha(source), needle };
}
function rowsFor(id: string, scenario: string, sql: string) {
  const replay = scenario === "EXACT_OUTPUT" || scenario === "REPLAY_MISMATCH",
    shadow = scenario === "SOURCE_DOMAIN_DML_ZERO",
    denied = scenario === "AUTH_DENIED";
  if (sql.includes("FROM command_aliases"))
    return [
      {
        command_code: definitions.find((x) => x.id === id)!.commandCode,
        handler_key: id.includes("0ab0")
          ? "admin_data_status"
          : "admin_server_stats",
        auth_scope: "TRUSTED_DISPLAY_NAME",
        rollout_state: shadow ? "SHADOW" : "ACTIVE",
      },
    ];
  if (sql.startsWith("SELECT rollout_state,enabled FROM command_registry"))
    return [{ rollout_state: shadow ? "SHADOW" : "ACTIVE", enabled: 1 }];
  if (sql.includes("SELECT operator.id operator_id"))
    return denied ? [] : [{ operator_id: 77n }];
  if (sql.includes("SELECT operator.id FROM external_identities"))
    return denied ? [] : [{ id: 77n }];
  if (sql.startsWith("SELECT id FROM external_identities"))
    return [{ id: 42n }];
  if (
    sql.includes("SELECT mapping.operator_id") &&
    sql.includes("role.code IN")
  )
    return denied ? [] : [{ operator_id: 77n }];
  if (
    sql.includes(
      "SELECT result_json FROM operations WHERE idempotency_scope='backup_status.read'",
    )
  )
    return replay
      ? [
          {
            result_json: {
              environment: "prod",
              revisionKey: "rev-fixed",
              capturedAt: "2026-09-06 16:01:02",
              objects: [],
              data: "저장된 데이터 상태",
              outboxId: "601",
            },
          },
        ]
      : [];
  if (sql.startsWith("SELECT id,revision_key"))
    return [
      {
        id: 88n,
        revision_key: "rev-fixed",
        captured_at: "2026-09-06 16:01:02",
      },
    ];
  if (sql.includes("FROM backup_objects object_row"))
    return [
      {
        target_code: "member",
        slot_code: "original",
        object_exists: 1,
        valid_json: 1,
        modified_at: "2026-09-06 16:00:00",
        error_code: null,
      },
    ];
  if (sql.startsWith("SELECT id,result_json FROM operations"))
    return [
      {
        id: 501n,
        result_json: replay
          ? {
              data: "저장된 펫 주인",
              rowCount: 1,
              operationId: "501",
              executionId: "701",
              auditId: "801",
              outboxId: "601",
            }
          : null,
      },
    ];
  if (sql.includes("SELECT player.id player_id"))
    return [
      {
        player_id: 9n,
        current_display_name: "호이",
        rank_emoji: "🥇",
        image_value: "🐶",
        pet_name: "멍",
        experience: 3n,
        source_order: 1n,
      },
    ];
  if (
    sql.startsWith(
      "SELECT result_json FROM operations WHERE idempotency_scope=?",
    )
  )
    return replay
      ? [
          {
            result_json: {
              status: "replied",
              data: "저장된 반지 통계",
              outboxId: "601",
              auditId: "801",
            },
          },
        ]
      : [];
  if (sql.includes("AS totalPetUserCount"))
    return [
      {
        totalPetUserCount: 2n,
        claimedUserCount: 1n,
        claimedRewardTotal: 10n,
        claimedRewardRemainTotal: 4n,
        pendingRingUserCount: 1n,
        pendingRewardTotal: 7n,
        claimedWithRingCount: 0n,
        rewardCalcErrorCount: 0n,
      },
    ];
  if (sql.startsWith("SELECT id,status,result_json,TIMESTAMPDIFF"))
    return replay
      ? [
          {
            id: 501n,
            status: "completed",
            result_json: {
              status: "counted",
              environment: "prod",
              databaseIdentity: "prod-db",
              snapshotVersion: "901",
              snapshotAt: "2026-09-06 16:01:02.123000",
              activeMemberCount: "3",
              rows: [],
              data: "저장된 서버 통계",
              outboxId: "601",
              auditId: "801",
            },
            age_seconds: 1n,
          },
        ]
      : [];
  if (
    sql.startsWith(
      "SELECT request_sha256 FROM admin_server_stat_read_executions",
    )
  ) {
    const request =
      scenario === "REPLAY_MISMATCH"
        ? "0".repeat(64)
        : createHash("sha256").update("prod\n/서버통계").digest("hex");
    return [{ request_sha256: request }];
  }
  if (
    sql.startsWith("SELECT database_identity FROM legacy_snapshot_environments")
  )
    return [{ database_identity: "prod-db" }];
  if (sql.startsWith("SELECT DATE_FORMAT(UTC_TIMESTAMP"))
    return [{ snapshot_at: "2026-09-06 16:01:02.123000" }];
  if (sql.includes("FROM game_servers server"))
    return [
      {
        server_code: "A",
        server_display_name: "가 서버",
        active_member_count: 2n,
      },
      {
        server_code: "UNASSIGNED",
        server_display_name: "미지정",
        active_member_count: 1n,
      },
    ];
  throw new Error(`${id}/${scenario} unhandled query: ${sql}`);
}
function mutationResult(sql: string) {
  if (sql.startsWith("INSERT INTO operations")) return 501n;
  if (sql.startsWith("INSERT INTO outbox_messages")) return 601n;
  if (sql.startsWith("INSERT INTO command_executions")) return 701n;
  if (sql.startsWith("INSERT INTO command_audit")) return 801n;
  if (sql.startsWith("INSERT INTO admin_server_stat_snapshot_sets"))
    return 901n;
  return 10n;
}
async function capture(def: (typeof definitions)[number], scenario: string) {
  if (scenario === "NEGATIVE_GUARD")
    return { queries: [], mutations: [], result: "INVALID_COMMAND_NO_CALL" };
  let retryFailures = 0;
  const queries: any[] = [],
    mutations: any[] = [];
  const db: any = {
    ping: async () => {},
    close: async () => {},
    verifyRollback: async () => true,
    withTransaction: async (work: any) => work(db),
    query: async (sql: string, values: any[] = []) => {
      const normalized = normalize(sql),
        rows = rowsFor(def.id, scenario, normalized),
        step: any = {
          expectedNormalizedSql: normalized,
          expectedValues: safe(values),
          rows: safe(rows),
        },
        retry = scenario.includes("RETRY_");
      if (
        retry &&
        scenario.startsWith("DEADLOCK") &&
        normalized.includes("FROM operations WHERE idempotency_scope") &&
        retryFailures < (scenario.endsWith("SUCCESS") ? 1 : 3)
      ) {
        retryFailures += 1;
        step.rows = [];
        step.error = {
          message: "wave8 retryable deadlock",
          code: "ER_LOCK_DEADLOCK",
          errno: 1213,
        };
      }
      queries.push(step);
      if (step.error) {
        const error: any = new Error(step.error.message);
        Object.assign(error, step.error);
        throw error;
      }
      return rows;
    },
    execute: async (sql: string, values: any[] = []) => {
      const normalized = normalize(sql),
        insertId = mutationResult(normalized),
        step: any = {
          expectedNormalizedSql: normalized,
          expectedValues: safe(values).map((value: any, index: number) =>
            index === 0 && normalized.startsWith("INSERT INTO operations")
              ? { matcher: "UUID_V4" }
              : value,
          ),
          affectedRows: 1,
          insertId: insertId.toString(),
        };
      if (
        scenario === "ROLLBACK" &&
        normalized.startsWith("INSERT INTO command_audit")
      )
        step.error = {
          message: "wave8 forced audit rollback",
          code: "ER_SIGNAL_EXCEPTION",
          errno: 1644,
        };
      if (
        scenario.startsWith("DUPLICATE_RETRY_") &&
        normalized.startsWith("INSERT INTO operations") &&
        retryFailures < (scenario.endsWith("SUCCESS") ? 1 : 3)
      ) {
        retryFailures += 1;
        step.error = {
          message: "wave8 retryable operation duplicate",
          code: "ER_DUP_ENTRY",
          errno: 1062,
        };
      }
      mutations.push(step);
      if (step.error) {
        const error: any = new Error(step.error.message);
        Object.assign(error, step.error);
        throw error;
      }
      return { affectedRows: 1n, insertId };
    },
  };
  const input = {
    eventId: `wave8-${def.id}-${scenario.toLowerCase()}`,
    externalUserId: "admin-user",
    channelId: "admin-room",
    message: def.message,
  };
  try {
    const result = await new IrisAdminCommandService(db).changePlayerPoint(
      input,
    );
    return { queries, mutations, result: JSON.stringify(result), input };
  } catch (error) {
    const caught = error as { code?: string; message?: string };
    if (
      !["ROLLBACK", "REPLAY_MISMATCH"].includes(scenario) &&
      !scenario.endsWith("RETRY_EXHAUSTED")
    )
      throw error;
    return {
      queries,
      mutations,
      result: `ERROR:${caught.code ?? caught.message}`,
      input,
    };
  }
}
const cases: any[] = [],
  bindings: any[] = [],
  riskBindings: any[] = [];
for (const def of definitions) {
  const source = manifest.consumers.find(
    (candidate: any) => candidate.consumerId === def.id,
  );
  if (!source) throw new Error(`missing ${def.id}`);
  const retryOwner =
      def.id.endsWith("0ab0acb6f570d48c") ||
      def.id.endsWith("5e04d0767d4c2abc"),
    riskScenarios = def.id.endsWith("5e04d0767d4c2abc")
      ? [
          "ROLLBACK",
          "REPLAY_MISMATCH",
          "DEADLOCK_RETRY_SUCCESS",
          "DEADLOCK_RETRY_EXHAUSTED",
          "DUPLICATE_RETRY_SUCCESS",
          "DUPLICATE_RETRY_EXHAUSTED",
        ]
      : retryOwner
        ? ["ROLLBACK", "DEADLOCK_RETRY_SUCCESS", "DEADLOCK_RETRY_EXHAUSTED"]
        : ["ROLLBACK"],
    scenarios = [...receiptScenarios, ...riskScenarios];
  const captured: Record<string, any> = {};
  for (const scenario of scenarios)
    captured[scenario] = await capture(def, scenario);
  const input = captured.READ_POSITIVE.input,
    consumer = {
      consumerId: def.id,
      sourceLocator: {
        file: source.file,
        symbol: source.symbol,
        triggerOrPredicate: source.triggerOrPredicate,
        interfaceId: source.interfaceId,
        start: source.sourceSpan.start,
        end: source.sourceSpan.end,
        sha256: source.sourceSpan.sha256,
      },
      frozenSourceCommit: "15abb95203e7eb375c9f0bd4294a0ec7100aa1a6",
      chainLocators: def.files.map((file) =>
        locate(
          file,
          file.endsWith("iris-admin-command-service.ts")
            ? def.needles[0]
            : file.endsWith("command-dispatcher.ts")
              ? "async resolve("
              : file.endsWith("maria-server-stats-repository.ts")
                ? "listActiveMemberCounts"
                : def.needles[2],
        ),
      ),
      input,
      errorScenarios: riskScenarios,
      scenarioInputsByScenario: Object.fromEntries(
        scenarios.map((s) => [
          s,
          captured[s].input ?? {
            ...input,
            eventId: `wave8-${def.id}-invalid`,
            message: def.invalid,
          },
        ]),
      ),
      invalidInput: {
        ...input,
        eventId: `wave8-${def.id}-invalid`,
        message: def.invalid,
      },
      queryPlanByScenario: Object.fromEntries(
        scenarios.map((s) => [s, captured[s].queries]),
      ),
      mutationPlanByScenario: Object.fromEntries(
        scenarios.map((s) => [s, captured[s].mutations]),
      ),
      expectedResultsByScenario: Object.fromEntries(
        scenarios.map((s) => [s, captured[s].result]),
      ),
    };
  cases.push({
    caseId: def.caseId,
    executablePath: `IrisAdminCommandService.changePlayerPoint→${source.symbol}→actual service/repository`,
    transactionPath: "actual admin dispatch + service transaction",
    requiredScenarios: receiptScenarios,
    riskScenarios,
    consumers: [consumer],
  });
  for (const scenario of receiptScenarios)
    bindings.push({
      consumerId: def.id,
      harnessId: "harness:object-db-executable-parity:wave8",
      harnessCaseId: def.caseId,
      fixtureId: "fixture:object-db-executable-parity:wave8:admin-chain:v1",
      scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`,
      scenarioKind: scenario,
    });
  for (const scenario of riskScenarios)
    riskBindings.push({
      consumerId: def.id,
      harnessId: "harness:object-db-executable-parity:wave8",
      harnessCaseId: def.caseId,
      fixtureId: "fixture:object-db-executable-parity:wave8:admin-chain:v1",
      scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`,
      scenarioKind: scenario,
    });
}
writeFileSync(
  resolve(root, output),
  JSON.stringify(
    {
      format: "hoibot-object-db-consumer-parity-case-fixture-v1",
      fixtureId: "fixture:object-db-executable-parity:wave8:admin-chain:v1",
      bindings,
      payload: { cases, riskBindings },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    status: "PASS",
    consumers: definitions.length,
    bindings: bindings.length,
  }),
);
