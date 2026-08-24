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

export interface CommandDispatchRepository {
  findExact(message: string): Promise<CommandDefinition | undefined>;
  record(input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void>;
}

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

// MariaDB의 명령 별칭과 배포 상태를 조회하고 라우팅 결정을 멱등 기록한다.
export class MariaCommandDispatchRepository implements CommandDispatchRepository {
  constructor(private readonly database: DatabaseClient) {}

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

  async record(input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void> {
    if (input.eventId === undefined || input.eventId === "") {
      return;
    }
    const messageHash = createHash("sha256").update(input.message, "utf8").digest("hex");
    await this.database.execute(
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
    private readonly repository: CommandDispatchRepository,
    private readonly options: CommandDispatcherOptions
  ) {}

  async resolve(input: CommandDispatchInput): Promise<CommandDispatchDecision> {
    if (!this.options.enabled) {
      return { route: "LEGACY_FALLBACK", reasonCode: "PARTIAL_DISPATCH_DISABLED" };
    }

    const definition = await this.repository.findExact(input.message);
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

    await this.repository.record(input, decision);
    return decision;
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
