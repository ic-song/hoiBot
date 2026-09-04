import { createHash } from "node:crypto";

import type { DatabaseClient } from "../database.js";

export type CommandRoute = "MODERN" | "SHADOW" | "LEGACY_FALLBACK" | "REJECT";
export type RolloutState = "LEGACY_ONLY" | "SHADOW" | "CANARY" | "ACTIVE";
export type AuthScope = "VERIFIED_USER" | "TRUSTED_DISPLAY_NAME";

export interface CommandDefinition {
  commandCode: string;
  handlerKey: string;
  authScope: AuthScope;
  rolloutState: RolloutState;
}

export interface CommandDispatchInput {
  eventId?: string;
  message: string;
  userId?: string;
  hasTrustedDisplayName: boolean;
}

export interface CommandDispatchDecision {
  route: CommandRoute;
  reasonCode: string;
  commandCode?: string;
  handlerKey?: string;
}

export interface CommandDefinitionReader {
  findExact(message: string): Promise<CommandDefinition | undefined>;
}

export interface CommandDecisionWriter {
  record(input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void>;
}

export interface CommandDispatchRepository extends CommandDefinitionReader, CommandDecisionWriter {}

interface CommandRow {
  command_code: string;
  handler_key: string;
  auth_scope: AuthScope;
  rollout_state: RolloutState;
}

export interface CommandDispatcherOptions {
  enabled: boolean;
  allowAllCanaries: boolean;
  canaryUserIds: ReadonlySet<string>;
}

// Claim transaction 안에서도 전역 DB writer 없이 명령 정의만 조회할 수 있습니다.
export class MariaCommandRouteReader implements CommandDefinitionReader {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async findExact(message: string): Promise<CommandDefinition | undefined> {
    const rows = await this.database.query<CommandRow[]>(
      `SELECT r.command_code, r.handler_key, r.auth_scope, r.rollout_state
         FROM command_aliases a
         JOIN command_registry r ON r.command_code = a.command_code
        WHERE a.command_text = ? AND a.active = 1 AND r.enabled = 1
        LIMIT 1`,
      [message]
    );
    const row = rows[0];
    return row === undefined ? undefined : {
      commandCode: row.command_code,
      handlerKey: row.handler_key,
      authScope: row.auth_scope,
      rolloutState: row.rollout_state
    };
  }
}

// 기존 소비자를 위해 read/write repository 표면을 유지합니다.
export class MariaCommandDispatchRepository extends MariaCommandRouteReader implements CommandDispatchRepository {
  constructor(private readonly writerDatabase: Pick<DatabaseClient, "query" | "execute">) {
    super(writerDatabase);
  }

  async record(input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void> {
    if (input.eventId === undefined || input.eventId === "") {
      return;
    }
    const messageHash = createHash("sha256").update(input.message, "utf8").digest("hex");
    await this.writerDatabase.execute(
      `INSERT INTO command_routing_decisions
         (event_id, message_hash, command_code, route, reason_code)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE routing_decision_id = LAST_INSERT_ID(routing_decision_id)`,
      [input.eventId, messageHash, decision.commandCode ?? null, decision.route, decision.reasonCode]
    );
  }
}

// 정확히 일치하는 등록 명령만 현대화 handler로 보내고 나머지는 레거시에 남긴다.
export class CommandDispatcher {
  constructor(
    private readonly reader: CommandDefinitionReader,
    private readonly options: CommandDispatcherOptions,
    private readonly writer: CommandDecisionWriter | undefined = "record" in reader
      ? reader as CommandDefinitionReader & CommandDecisionWriter
      : undefined
  ) {}

  async resolve(input: CommandDispatchInput): Promise<CommandDispatchDecision> {
    const decision = await this.resolveReadOnly(input);
    await this.recordDecision(input, decision);
    return decision;
  }

  // 공통 AppWiring claim 전에 route만 조회하며 routing decision 쓰기는 수행하지 않습니다.
  async resolveReadOnly(input: CommandDispatchInput): Promise<CommandDispatchDecision> {
    if (!this.options.enabled) {
      return { route: "LEGACY_FALLBACK", reasonCode: "PARTIAL_DISPATCH_DISABLED" };
    }

    const definition = await this.reader.findExact(input.message);
    let decision: CommandDispatchDecision;
    if (definition === undefined) {
      decision = { route: "LEGACY_FALLBACK", reasonCode: "COMMAND_NOT_REGISTERED" };
    } else if (!this.isAuthorized(definition.authScope, input)) {
      decision = this.forDefinition(definition, "REJECT", "AUTH_SCOPE_NOT_SATISFIED");
    } else if (definition.rolloutState === "LEGACY_ONLY") {
      decision = this.forDefinition(definition, "LEGACY_FALLBACK", "ROLLOUT_LEGACY_ONLY");
    } else if (definition.rolloutState === "SHADOW") {
      decision = this.forDefinition(definition, "SHADOW", "ROLLOUT_SHADOW");
    } else if (definition.rolloutState === "CANARY" && !this.isCanary(input.userId)) {
      decision = this.forDefinition(definition, "LEGACY_FALLBACK", "CANARY_USER_NOT_ALLOWED");
    } else {
      decision = this.forDefinition(definition, "MODERN", "MODERN_ROUTE_ALLOWED");
    }

    return decision;
  }

  // 기존 진입점의 기록 호환과 claim 이후 audit participant 이행을 분리합니다.
  async recordDecision(input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void> {
    if (this.writer === undefined) throw new Error("COMMAND_DISPATCH_WRITER_REQUIRED");
    await this.writer.record(input, decision);
  }

  private isAuthorized(scope: AuthScope, input: CommandDispatchInput): boolean {
    if (input.userId === undefined || input.userId === "") {
      return false;
    }
    return scope === "VERIFIED_USER" || input.hasTrustedDisplayName;
  }

  private isCanary(userId: string | undefined): boolean {
    return this.options.allowAllCanaries || (userId !== undefined && this.options.canaryUserIds.has(userId));
  }

  private forDefinition(
    definition: CommandDefinition,
    route: CommandRoute,
    reasonCode: string
  ): CommandDispatchDecision {
    return {
      route,
      reasonCode,
      commandCode: definition.commandCode,
      handlerKey: definition.handlerKey
    };
  }
}

// 쉼표로 구분된 사용자 ID 환경값을 canary 집합으로 변환한다.
export function parseCanaryUserIds(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => item !== ""));
}
