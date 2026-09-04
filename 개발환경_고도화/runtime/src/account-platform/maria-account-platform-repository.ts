import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createInitialPlayer } from "../signup/create-initial-player.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  type ObjectIdentityCandidateGenerator
} from "../identity/object-identity-audit-provider.js";
import type {
  AccountPlatformRepository,
  ActivePlayerSnapshot,
  SwitchActiveGameAccountInput,
  SwitchActiveGameAccountResult,
  VerifyGameAccountInput,
  VerifyGameAccountResult
} from "./account-platform-service.js";

const CUID_ATTEMPTS = 8;
type ScopedVerifyInput = VerifyGameAccountInput & { identityScopeKey: string };
type ScopedSwitchInput = SwitchActiveGameAccountInput & { identityScopeKey: string };
type ScopedContextInput = Pick<ScopedSwitchInput, "platformCode" | "contextType" | "externalContextKey" | "externalUserKey" | "identityScopeKey">;

// PK 충돌만 CUID2 재시도 대상으로 구분합니다.
function isPrimaryKeyDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ER_DUP_ENTRY" && /(?:PRIMARY|primary)/.test(message);
}

// 신규 CHAR(8) PK를 제한된 CUID2 충돌 재시도로 삽입합니다.
async function insertWithCuid(
  transaction: DatabaseTransaction,
  generate: ObjectIdentityCandidateGenerator,
  statement: string,
  values: (candidate: string) => readonly unknown[]
): Promise<string> {
  for (let attempt = 0; attempt < CUID_ATTEMPTS; attempt += 1) {
    const candidate = generate();
    assertObjectIdentityCandidate(candidate);
    try {
      await transaction.execute(statement, values(candidate));
      return candidate;
    } catch (error) {
      if (!isPrimaryKeyDuplicate(error)) throw error;
    }
  }
  throw new Error("ACCOUNT_PLATFORM_CUID_COLLISION_RETRY_EXHAUSTED");
}

// 저장된 멱등 결과를 검증 결과로 복원합니다.
function parseVerifyResult(resultJson: string | VerifyGameAccountResult): VerifyGameAccountResult {
  return typeof resultJson === "string" ? JSON.parse(resultJson) as VerifyGameAccountResult : resultJson;
}

// 저장된 멱등 결과를 계정변경 결과로 복원합니다.
function parseSwitchResult(resultJson: string | SwitchActiveGameAccountResult): SwitchActiveGameAccountResult {
  return typeof resultJson === "string" ? JSON.parse(resultJson) as SwitchActiveGameAccountResult : resultJson;
}

// 플랫폼 context 조합의 공통 필수 문자열을 검증합니다.
function assertLocator(input: { externalUserKey: string; externalContextKey: string; identityScopeKey: string; requestKey?: string }): void {
  for (const value of [input.externalUserKey, input.externalContextKey, input.identityScopeKey, input.requestKey]) {
    if (value !== undefined && (value.trim() === "" || value.length > 191)) throw new ApplicationError("ACCOUNT_PLATFORM_LOCATOR_INVALID", "계정 식별 정보가 올바르지 않습니다.", 422);
  }
}

// 기존 operation·audit·outbox 계약에도 계정 변경 결과를 함께 남깁니다.
async function recordOperationEvidence(
  transaction: DatabaseTransaction,
  input: { legacyUserAccountId: bigint; playerId: bigint; requestKey: string; actionCode: string; messageType: string; destinationId: string; result: object }
): Promise<void> {
  const operation = await transaction.execute(
    `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,result_json,created_at,completed_at)
     VALUES (?, ?, ?, 'user_account', ?, 'account_platform', 'completed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [randomUUID(), input.actionCode, input.requestKey, input.legacyUserAccountId, JSON.stringify(input.result)]
  );
  await transaction.execute(
    `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
     VALUES (?,'user_account',?,'player',?,?,'success','계정·플랫폼 연결 변경',?,UTC_TIMESTAMP(3))`,
    [operation.insertId, input.legacyUserAccountId, input.playerId, input.actionCode, JSON.stringify(input.result)]
  );
  await transaction.execute(
    `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
     VALUES (?,'internal',?,?,?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [operation.insertId, input.destinationId, input.messageType, JSON.stringify(input.result)]
  );
}

// 신규 player 생성과 기존 player 보존 연결을 제공하는 MariaDB repository입니다.
export class MariaAccountPlatformRepository implements AccountPlatformRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly now: () => Date = () => new Date(),
    private readonly createPlayer: typeof createInitialPlayer = createInitialPlayer
  ) {}

  // 포털, 게임계정, identity, membership, active selection을 한 transaction으로 연결합니다.
  async linkVerifiedGameAccount(input: ScopedVerifyInput): Promise<VerifyGameAccountResult> {
    assertLocator(input);
    return this.database.withTransaction(async (transaction) => {
      const replay = (await transaction.query<Array<{ result_json: string | VerifyGameAccountResult }>>(
        "SELECT result_json FROM account_platform_operation_receipts WHERE operation_kind='VERIFY_GAME_ACCOUNT' AND request_key=? FOR UPDATE",
        [input.requestKey]
      ))[0];
      if (replay !== undefined) return { ...parseVerifyResult(replay.result_json), replayed: true };

      const account = (await transaction.query<Array<{ id: bigint; status: string }>>(
        "SELECT id,status FROM user_accounts WHERE id=? FOR UPDATE", [input.legacyUserAccountId]
      ))[0];
      if (account === undefined || !["pending_kakao_link", "active"].includes(account.status)) {
        throw new ApplicationError("PORTAL_ACCOUNT_UNAVAILABLE", "연결 가능한 포털계정을 찾을 수 없습니다.", 409);
      }
      const audit = createObjectAuditValues(input.actor, this.now());
      let portal = (await transaction.query<Array<{ portal_account_id: string }>>(
        "SELECT portal_account_id FROM canonical_portal_accounts WHERE legacy_user_account_id=? FOR UPDATE", [account.id]
      ))[0];
      if (portal === undefined) {
        const portalAccountId = await insertWithCuid(transaction, this.generate,
          "INSERT INTO canonical_portal_accounts(portal_account_id,legacy_user_account_id,portal_account_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'ACTIVE',?,?,?,?)",
          (candidate) => [candidate, account.id, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
        portal = { portal_account_id: portalAccountId };
      }

      let playerId: bigint;
      let createdPlayer = false;
      if (input.purpose === "NEW_GAME_ACCOUNT") {
        const duplicateName = (await transaction.query<Array<{ player_id: bigint }>>(
          "SELECT player_id FROM player_profiles WHERE current_display_name=? LIMIT 1 FOR UPDATE", [input.expectedDisplayName]
        ))[0];
        if (duplicateName !== undefined) throw new ApplicationError("GAME_ACCOUNT_NAME_TAKEN", "이미 존재하는 게임계정 이름입니다.", 409);
        playerId = await this.createPlayer(transaction, input.expectedDisplayName, input.externalContextKey);
        createdPlayer = true;
      } else {
        const legacy = (await transaction.query<Array<{ player_id: bigint; status: string; current_display_name: string }>>(
          `SELECT player.id AS player_id,player.status,profile.current_display_name FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id WHERE player.id=? FOR UPDATE`, [input.targetPlayerId]
        ))[0];
        if (legacy === undefined || legacy.status !== "active") throw new ApplicationError("LEGACY_PLAYER_UNAVAILABLE", "연결 가능한 기존 게임계정을 찾을 수 없습니다.", 409);
        if (legacy.current_display_name !== input.expectedDisplayName) throw new ApplicationError("LEGACY_PLAYER_NAME_MISMATCH", "기존 게임계정 닉네임이 일치하지 않습니다.", 409);
        playerId = legacy.player_id;
      }

      const owned = (await transaction.query<Array<{ portal_game_account_link_id: string; portal_account_id: string; player_role: "REPRESENTATIVE" | "SUB" }>>(
        "SELECT portal_game_account_link_id,portal_account_id,player_role FROM portal_game_account_links WHERE player_id=? AND link_status='ACTIVE' FOR UPDATE", [playerId]
      ))[0];
      if (owned !== undefined && owned.portal_account_id !== portal.portal_account_id) {
        throw new ApplicationError("GAME_ACCOUNT_OWNED_BY_OTHER_PORTAL", "이미 다른 포털계정에 연결된 게임계정입니다.", 409);
      }
      const roleRow = (await transaction.query<Array<{ link_count: bigint; max_sequence: bigint }>>(
        "SELECT COUNT(*) AS link_count,COALESCE(MAX(registration_sequence),0) AS max_sequence FROM portal_game_account_links WHERE portal_account_id=? AND link_status='ACTIVE' FOR UPDATE",
        [portal.portal_account_id]
      ))[0] ?? { link_count: 0n, max_sequence: 0n };
      const playerRole = owned?.player_role ?? (roleRow.link_count === 0n ? "REPRESENTATIVE" : "SUB");
      const linkId = owned?.portal_game_account_link_id ?? await insertWithCuid(transaction, this.generate,
        "INSERT INTO portal_game_account_links(portal_game_account_link_id,portal_account_id,player_id,player_role,registration_sequence,link_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?)",
        (candidate) => [candidate, portal!.portal_account_id, playerId, playerRole, Number(roleRow.max_sequence) + 1, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);

      const context = await this.ensureContext(transaction, input, audit);
      const identity = await this.ensureIdentity(transaction, input, portal.portal_account_id, audit);
      const membershipId = await this.ensureMembership(transaction, identity, context, audit);
      await this.recordNickname(transaction, membershipId, input.observedDisplayName, "INITIAL_VERIFICATION", audit);
      await this.setActiveSelection(transaction, membershipId, linkId, playerId, audit);
      if (playerRole === "REPRESENTATIVE") {
        await transaction.execute("UPDATE user_accounts SET player_id=COALESCE(player_id,?),status='active',pending_expires_at=NULL,activated_at=COALESCE(activated_at,UTC_TIMESTAMP(3)),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [playerId, account.id]);
      }
      const result: VerifyGameAccountResult = {
        portalAccountId: portal.portal_account_id, playerId: playerId.toString(), playerRole,
        platformIdentityId: identity, platformContextMembershipId: membershipId, createdPlayer, replayed: false
      };
      await insertWithCuid(transaction, this.generate,
        "INSERT INTO account_platform_operation_receipts(account_platform_operation_id,request_key,operation_kind,portal_account_id,platform_context_membership_id,operation_status,result_json,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'VERIFY_GAME_ACCOUNT',?,?,'COMPLETED',?,?,?,?,?)",
        (candidate) => [candidate, input.requestKey, portal!.portal_account_id, membershipId, JSON.stringify(result), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      await recordOperationEvidence(transaction, {
        legacyUserAccountId: account.id, playerId, requestKey: input.requestKey,
        actionCode: "account.platform.verify_game_account", messageType: "account.platform.verification.completed",
        destinationId: membershipId, result
      });
      return result;
    });
  }

  // 동일 포털의 활성 게임계정으로 현재 membership selection만 교체합니다.
  async switchActiveGameAccount(input: ScopedSwitchInput): Promise<SwitchActiveGameAccountResult> {
    assertLocator(input);
    return this.database.withTransaction(async (transaction) => {
      const replay = (await transaction.query<Array<{ result_json: string | SwitchActiveGameAccountResult }>>(
        "SELECT result_json FROM account_platform_operation_receipts WHERE operation_kind='SWITCH_ACTIVE_PLAYER' AND request_key=? FOR UPDATE", [input.requestKey]
      ))[0];
      if (replay !== undefined) return { ...parseSwitchResult(replay.result_json), replayed: true };
      const membership = await this.lockMembership(transaction, input);
      const target = (await transaction.query<Array<{ portal_game_account_link_id: string; player_id: bigint }>>(
        `SELECT link.portal_game_account_link_id,link.player_id FROM portal_game_account_links link
         JOIN player_profiles profile ON profile.player_id=link.player_id JOIN players player ON player.id=link.player_id
         WHERE link.portal_account_id=? AND link.link_status='ACTIVE' AND player.status='active'
           AND (profile.current_display_name=? OR CAST(link.player_id AS CHAR)=?) FOR UPDATE`,
        [membership.portal_account_id, input.gameAccountSelector, input.gameAccountSelector]
      ))[0];
      if (target === undefined) throw new ApplicationError("GAME_ACCOUNT_NOT_AVAILABLE", "이 포털계정에서 사용할 수 있는 게임계정이 아닙니다.", 409);
      const selection = (await transaction.query<Array<{ active_player_selection_id: string; selection_version: bigint }>>(
        "SELECT active_player_selection_id,selection_version FROM account_platform_active_player_selections WHERE platform_context_membership_id=? FOR UPDATE",
        [membership.platform_context_membership_id]
      ))[0];
      if (input.expectedSelectionVersion !== undefined && Number(selection?.selection_version ?? 0n) !== input.expectedSelectionVersion) {
        throw new ApplicationError("ACTIVE_PLAYER_SELECTION_CONFLICT", "활성 게임계정이 먼저 변경됐습니다. 다시 시도해 주세요.", 409);
      }
      const audit = createObjectAuditValues(input.actor, this.now());
      let version = 1;
      if (selection === undefined) {
        await this.setActiveSelection(transaction, membership.platform_context_membership_id, target.portal_game_account_link_id, target.player_id, audit);
      } else {
        version = Number(selection.selection_version) + 1;
        await transaction.execute(
          "UPDATE account_platform_active_player_selections SET portal_game_account_link_id=?,active_player_id=?,selection_status='ACTIVE',selection_version=?,UPDATE_USER=?,UPDATE_TIME=? WHERE active_player_selection_id=?",
          [target.portal_game_account_link_id, target.player_id, version, audit.UPDATE_USER, audit.UPDATE_TIME, selection.active_player_selection_id]
        );
      }
      const result: SwitchActiveGameAccountResult = { portalAccountId: membership.portal_account_id, playerId: target.player_id.toString(), platformContextMembershipId: membership.platform_context_membership_id, selectionVersion: version, replayed: false };
      await insertWithCuid(transaction, this.generate,
        "INSERT INTO account_platform_operation_receipts(account_platform_operation_id,request_key,operation_kind,portal_account_id,platform_context_membership_id,operation_status,result_json,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'SWITCH_ACTIVE_PLAYER',?,?,'COMPLETED',?,?,?,?,?)",
        (candidate) => [candidate, input.requestKey, membership.portal_account_id, membership.platform_context_membership_id, JSON.stringify(result), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      await recordOperationEvidence(transaction, {
        legacyUserAccountId: membership.legacy_user_account_id, playerId: target.player_id, requestKey: input.requestKey,
        actionCode: "account.platform.switch_active_player", messageType: "account.platform.active_player.changed",
        destinationId: membership.platform_context_membership_id, result
      });
      return result;
    });
  }

  // stable identity 연결을 바꾸지 않고 nickname 관측 이력만 추가합니다.
  async observeNickname(input: ScopedContextInput & { observedDisplayName: string; actor: string }): Promise<void> {
    assertLocator(input);
    await this.database.withTransaction(async (transaction) => {
      const membership = await this.lockMembership(transaction, input);
      const audit = createObjectAuditValues(input.actor, this.now());
      await this.recordNickname(transaction, membership.platform_context_membership_id, input.observedDisplayName, "EVENT_OBSERVATION", audit);
    });
  }

  // 명령 시작 시 사용할 활성 player와 selection version을 읽습니다.
  async resolveActivePlayer(input: ScopedContextInput): Promise<ActivePlayerSnapshot | null> {
    assertLocator(input);
    const rows = await this.database.query<Array<{ portal_account_id: string; active_player_id: bigint; platform_context_membership_id: string; selection_version: bigint }>>(
      `SELECT identity_row.portal_account_id,selection.active_player_id,membership.platform_context_membership_id,selection.selection_version
       FROM account_platform_identities identity_row
       JOIN canonical_portal_accounts portal ON portal.portal_account_id=identity_row.portal_account_id AND portal.portal_account_status='ACTIVE'
       JOIN account_platform_context_memberships membership ON membership.platform_identity_id=identity_row.platform_identity_id AND membership.membership_status='ACTIVE'
       JOIN account_platform_contexts context_row ON context_row.platform_context_id=membership.platform_context_id AND context_row.context_status='ACTIVE'
       JOIN account_platform_active_player_selections selection ON selection.platform_context_membership_id=membership.platform_context_membership_id AND selection.selection_status='ACTIVE'
       JOIN portal_game_account_links link ON link.portal_game_account_link_id=selection.portal_game_account_link_id AND link.portal_account_id=portal.portal_account_id AND link.player_id=selection.active_player_id AND link.link_status='ACTIVE'
       JOIN players player ON player.id=selection.active_player_id AND player.status='active'
       WHERE identity_row.platform_code=? AND identity_row.identity_scope_key=? AND identity_row.external_user_key=? AND identity_row.identity_status='ACTIVE'
         AND context_row.context_type=? AND context_row.external_context_key=?`,
      [input.platformCode, input.identityScopeKey, input.externalUserKey, input.contextType, input.externalContextKey]
    );
    const row = rows[0];
    return row === undefined ? null : { portalAccountId: row.portal_account_id, playerId: row.active_player_id.toString(), platformContextMembershipId: row.platform_context_membership_id, selectionVersion: Number(row.selection_version) };
  }

  // platform context를 잠그거나 생성합니다.
  private async ensureContext(transaction: DatabaseTransaction, input: ScopedVerifyInput, audit: ReturnType<typeof createObjectAuditValues>): Promise<string> {
    const row = (await transaction.query<Array<{ platform_context_id: string }>>(
      "SELECT platform_context_id FROM account_platform_contexts WHERE platform_code=? AND context_type=? AND external_context_key=? FOR UPDATE",
      [input.platformCode, input.contextType, input.externalContextKey]
    ))[0];
    if (row !== undefined) return row.platform_context_id;
    return insertWithCuid(transaction, this.generate,
      "INSERT INTO account_platform_contexts(platform_context_id,platform_code,context_type,external_context_key,context_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,'ACTIVE',?,?,?,?)",
      (candidate) => [candidate, input.platformCode, input.contextType, input.externalContextKey, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  // stable platform identity가 다른 portal에 귀속되지 않았는지 확인하고 생성합니다.
  private async ensureIdentity(transaction: DatabaseTransaction, input: ScopedVerifyInput, portalAccountId: string, audit: ReturnType<typeof createObjectAuditValues>): Promise<string> {
    const row = (await transaction.query<Array<{ platform_identity_id: string; portal_account_id: string }>>(
      "SELECT platform_identity_id,portal_account_id FROM account_platform_identities WHERE platform_code=? AND identity_scope_key=? AND external_user_key=? FOR UPDATE",
      [input.platformCode, input.identityScopeKey, input.externalUserKey]
    ))[0];
    if (row !== undefined) {
      if (row.portal_account_id !== portalAccountId) throw new ApplicationError("PLATFORM_IDENTITY_OWNED_BY_OTHER_PORTAL", "이미 다른 포털계정에 연결된 플랫폼 사용자입니다.", 409);
      return row.platform_identity_id;
    }
    return insertWithCuid(transaction, this.generate,
      "INSERT INTO account_platform_identities(platform_identity_id,portal_account_id,platform_code,identity_scope_key,external_user_key,identity_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?)",
      (candidate) => [candidate, portalAccountId, input.platformCode, input.identityScopeKey, input.externalUserKey, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  // identity와 context의 단일 membership을 잠그거나 생성합니다.
  private async ensureMembership(transaction: DatabaseTransaction, identityId: string, contextId: string, audit: ReturnType<typeof createObjectAuditValues>): Promise<string> {
    const row = (await transaction.query<Array<{ platform_context_membership_id: string }>>(
      "SELECT platform_context_membership_id FROM account_platform_context_memberships WHERE platform_identity_id=? AND platform_context_id=? FOR UPDATE", [identityId, contextId]
    ))[0];
    if (row !== undefined) return row.platform_context_membership_id;
    return insertWithCuid(transaction, this.generate,
      "INSERT INTO account_platform_context_memberships(platform_context_membership_id,platform_identity_id,platform_context_id,membership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'ACTIVE',?,?,?,?)",
      (candidate) => [candidate, identityId, contextId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  // 현재 identity와 context 조합의 활성 membership을 portal 소유권과 함께 잠급니다.
  private async lockMembership(transaction: DatabaseTransaction, input: ScopedContextInput): Promise<{ platform_context_membership_id: string; portal_account_id: string; legacy_user_account_id: bigint }> {
    const row = (await transaction.query<Array<{ platform_context_membership_id: string; portal_account_id: string; legacy_user_account_id: bigint }>>(
      `SELECT membership.platform_context_membership_id,identity_row.portal_account_id,portal.legacy_user_account_id FROM account_platform_identities identity_row
       JOIN canonical_portal_accounts portal ON portal.portal_account_id=identity_row.portal_account_id AND portal.portal_account_status='ACTIVE'
       JOIN account_platform_context_memberships membership ON membership.platform_identity_id=identity_row.platform_identity_id AND membership.membership_status='ACTIVE'
       JOIN account_platform_contexts context_row ON context_row.platform_context_id=membership.platform_context_id AND context_row.context_status='ACTIVE'
       WHERE identity_row.platform_code=? AND identity_row.identity_scope_key=? AND identity_row.external_user_key=? AND identity_row.identity_status='ACTIVE'
         AND context_row.context_type=? AND context_row.external_context_key=? FOR UPDATE`,
      [input.platformCode, input.identityScopeKey, input.externalUserKey, input.contextType, input.externalContextKey]
    ))[0];
    if (row === undefined) throw new ApplicationError("PLATFORM_CONTEXT_AUTH_REQUIRED", "이 방·서버에서 먼저 계정 인증을 완료해 주세요.", 409);
    return row;
  }

  // nickname 관측값을 권한 key와 분리된 이력으로 저장합니다.
  private async recordNickname(transaction: DatabaseTransaction, membershipId: string, nickname: string, source: string, audit: ReturnType<typeof createObjectAuditValues>): Promise<void> {
    await insertWithCuid(transaction, this.generate,
      "INSERT INTO account_platform_nickname_observations(platform_nickname_observation_id,platform_context_membership_id,observed_nickname,observation_source,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)",
      (candidate) => [candidate, membershipId, nickname, source, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }

  // membership당 하나뿐인 활성 player selection을 생성하거나 교체합니다.
  private async setActiveSelection(transaction: DatabaseTransaction, membershipId: string, linkId: string, playerId: bigint, audit: ReturnType<typeof createObjectAuditValues>): Promise<void> {
    const row = (await transaction.query<Array<{ active_player_selection_id: string }>>(
      "SELECT active_player_selection_id FROM account_platform_active_player_selections WHERE platform_context_membership_id=? FOR UPDATE", [membershipId]
    ))[0];
    if (row === undefined) {
      await insertWithCuid(transaction, this.generate,
        "INSERT INTO account_platform_active_player_selections(active_player_selection_id,platform_context_membership_id,portal_game_account_link_id,active_player_id,selection_status,selection_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,'ACTIVE',1,?,?,?,?)",
        (candidate) => [candidate, membershipId, linkId, playerId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      return;
    }
    await transaction.execute("UPDATE account_platform_active_player_selections SET portal_game_account_link_id=?,active_player_id=?,selection_status='ACTIVE',selection_version=selection_version+1,UPDATE_USER=?,UPDATE_TIME=? WHERE active_player_selection_id=?", [linkId, playerId, audit.UPDATE_USER, audit.UPDATE_TIME, row.active_player_selection_id]);
  }
}
