import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { PackageCatalogCommandError } from "./package-catalog-admin-command.js";
import { MariaPackageCatalogAdminRepository } from "./mariadb-package-catalog-admin.js";
import type { PackageCatalogWizardDraft } from "./package-catalog-add-wizard.js";
import type {
  PackageCatalogWizardRepository,
  PackageCatalogWizardResult,
  PackageCatalogWizardSession,
} from "./package-catalog-add-wizard-service.js";

interface WizardSessionRow {
  session_id: string;
  operator_id: string;
  version: bigint | string | number;
  base_catalog_version: bigint | string | number;
  expires_at: Date;
  draft_json: unknown;
}

interface WizardReplayRow { result_json: unknown }

// bigint 보상 수량을 JSON 문자열로 보존합니다.
function stringifyWizardJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? { $bigint: item.toString() } : item);
}

// 저장된 bigint 보상 수량을 원래 타입으로 복원합니다.
function parseWizardJson<T>(value: unknown): T {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return JSON.parse(serialized, (_key, item: unknown) => {
    if (item && typeof item === "object" && "$bigint" in item) return BigInt(String((item as { $bigint: unknown }).$bigint));
    return item;
  }) as T;
}

// DB row를 단계형 패키지 세션으로 변환합니다.
function mapSession(row: WizardSessionRow): PackageCatalogWizardSession {
  return {
    sessionId: row.session_id,
    operatorId: row.operator_id,
    version: BigInt(row.version),
    baseCatalogVersion: BigInt(row.base_catalog_version),
    expiresAt: new Date(row.expires_at),
    draft: parseWizardJson<PackageCatalogWizardDraft>(row.draft_json),
  };
}

// 단계 처리 결과를 멱등 재실행용으로 저장합니다.
async function saveResult(transaction: DatabaseTransaction, requestKey: string, operatorId: string, result: PackageCatalogWizardResult): Promise<void> {
  await transaction.execute(
    "INSERT INTO package_catalog_wizard_results(request_key,operator_id,result_json) VALUES (?,?,?)",
    [requestKey, operatorId, stringifyWizardJson(result)],
  );
}

// MariaDB에 패키지 추가 마법사 상태와 결과를 영속화합니다.
export class MariaDbPackageCatalogAddWizardRepository implements PackageCatalogWizardRepository {
  private readonly catalogRepository: MariaPackageCatalogAdminRepository;

  public constructor(private readonly database: DatabaseClient, private readonly replyDestinationId?: string) {
    this.catalogRepository = new MariaPackageCatalogAdminRepository(database);
  }

  public async findReplay(requestKey: string): Promise<PackageCatalogWizardResult | undefined> {
    const rows = await this.database.query<WizardReplayRow[]>("SELECT result_json FROM package_catalog_wizard_results WHERE request_key=?", [requestKey]);
    return rows[0] ? parseWizardJson<PackageCatalogWizardResult>(rows[0].result_json) : undefined;
  }

  public async readActive(operatorId: string, now: Date): Promise<PackageCatalogWizardSession | undefined> {
    const rows = await this.database.query<WizardSessionRow[]>(
      "SELECT session_id,operator_id,version,base_catalog_version,expires_at,draft_json FROM package_catalog_wizard_sessions WHERE operator_id=? AND flow_code='PACKAGE_CATALOG_ADD_WIZARD' AND status='ACTIVE' AND expires_at>? LIMIT 1",
      [operatorId, now],
    );
    return rows[0] ? mapSession(rows[0]) : undefined;
  }

  public async start(input: { operatorId: string; requestKey: string; now: Date; expiresAt: Date }): Promise<PackageCatalogWizardResult> {
    return this.database.withTransaction(async (transaction) => {
      const heads = await transaction.query<Array<{ version: bigint | string | number }>>(
        "SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG' FOR UPDATE",
      );
      if (!heads[0]) throw new PackageCatalogCommandError("PACKAGE_CATALOG_HEAD_MISSING", "패키지 카탈로그 기준 버전을 확인할 수 없습니다.");
      const draft: PackageCatalogWizardDraft = { step: "NAME", name: "", description: "", rewards: [] };
      const sessionId = randomUUID();
      await transaction.execute(
        `INSERT INTO package_catalog_wizard_sessions
         (session_id,operator_id,flow_code,state_code,draft_json,base_catalog_version,version,status,started_at,expires_at,committed_package_id)
         VALUES (?,?,'PACKAGE_CATALOG_ADD_WIZARD','NAME',?,?,1,'ACTIVE',?,?,NULL)
         ON DUPLICATE KEY UPDATE session_id=VALUES(session_id),state_code='NAME',draft_json=VALUES(draft_json),base_catalog_version=VALUES(base_catalog_version),version=version+1,status='ACTIVE',started_at=VALUES(started_at),expires_at=VALUES(expires_at),committed_package_id=NULL`,
        [sessionId, input.operatorId, stringifyWizardJson(draft), BigInt(heads[0].version).toString(), input.now, input.expiresAt],
      );
      const session = await this.readSessionForUpdate(transaction, input.operatorId);
      const result: PackageCatalogWizardResult = { message: "📦 패키지 추가를 시작합니다.\n\n1단계: 패키지 이름을 입력해주세요.\n\n예:\n이벤트패키지🎁\n\n※ 별도 가방 아이템명은 사용하지 않고 패키지 이름으로 저장됩니다.\n취소하려면 \"취소\" 또는 /패키지추가취소", replayed: false, session };
      await saveResult(transaction, input.requestKey, input.operatorId, result);
      return result;
    });
  }

  public async cancel(input: { operatorId: string; requestKey: string; expectedVersion?: bigint; message: string }): Promise<PackageCatalogWizardResult> {
    return this.database.withTransaction(async (transaction) => {
      const session = await this.readSessionForUpdate(transaction, input.operatorId, false);
      if (input.expectedVersion !== undefined && (!session || session.version !== input.expectedVersion)) this.conflict();
      if (session) await transaction.execute("UPDATE package_catalog_wizard_sessions SET status='CANCELLED',version=version+1 WHERE session_id=?", [session.sessionId]);
      const result: PackageCatalogWizardResult = { message: input.message, replayed: false };
      await saveResult(transaction, input.requestKey, input.operatorId, result);
      return result;
    });
  }

  public async transition(input: { operatorId: string; requestKey: string; expectedVersion: bigint; draft: PackageCatalogWizardDraft; message: string }): Promise<PackageCatalogWizardResult> {
    return this.database.withTransaction(async (transaction) => {
      const current = (await this.readSessionForUpdate(transaction, input.operatorId))!;
      if (current.version !== input.expectedVersion) this.conflict();
      await transaction.execute(
        "UPDATE package_catalog_wizard_sessions SET state_code=?,draft_json=?,version=version+1 WHERE session_id=? AND version=? AND status='ACTIVE'",
        [input.draft.step, stringifyWizardJson(input.draft), current.sessionId, input.expectedVersion.toString()],
      );
      const session: PackageCatalogWizardSession = { ...current, version: current.version + 1n, draft: input.draft };
      const result: PackageCatalogWizardResult = { message: input.message, replayed: false, session };
      await saveResult(transaction, input.requestKey, input.operatorId, result);
      return result;
    });
  }

  public async finalize(input: { operatorId: string; requestKey: string; expectedVersion: bigint; baseCatalogVersion: bigint; draft: PackageCatalogWizardDraft; message: string }): Promise<PackageCatalogWizardResult> {
    const current = await this.readActive(input.operatorId, new Date());
    if (!current || current.version !== input.expectedVersion || current.baseCatalogVersion !== input.baseCatalogVersion) this.conflict();
    const snapshot = await this.catalogRepository.readSnapshot();
    const catalogResult = await this.catalogRepository.mutate({
      requestKey: input.requestKey,
      actorOperatorId: input.operatorId,
      permissionCode: "package.catalog.manage",
      expectedCatalogVersion: input.baseCatalogVersion,
      commandCode: "PACKAGE_CATALOG_ADD",
      replyDestinationId: this.replyDestinationId,
      mutation: {
        action: "ADD",
        displayName: input.draft.name,
        description: input.draft.description,
        displayOrder: snapshot.entries.length + 1,
        rewards: input.draft.rewards.map((reward) => ({ ...reward, assetCode: reward.rewardType === "POINT" ? "ITEM-RWD-011" : reward.assetCode })),
      },
    });
    return this.database.withTransaction(async (transaction) => {
      const replay = await transaction.query<WizardReplayRow[]>("SELECT result_json FROM package_catalog_wizard_results WHERE request_key=? FOR UPDATE", [input.requestKey]);
      if (replay[0]) return { ...parseWizardJson<PackageCatalogWizardResult>(replay[0].result_json), replayed: true };
      await transaction.execute(
        "UPDATE package_catalog_wizard_sessions SET status='COMMITTED',committed_package_id=?,version=version+1 WHERE operator_id=? AND flow_code='PACKAGE_CATALOG_ADD_WIZARD' AND status='ACTIVE' AND version=?",
        [catalogResult.packageId, input.operatorId, input.expectedVersion.toString()],
      );
      const result: PackageCatalogWizardResult = { message: catalogResult.message, replayed: catalogResult.replayed, packageId: catalogResult.packageId, outboxId: catalogResult.outboxId };
      await saveResult(transaction, input.requestKey, input.operatorId, result);
      return result;
    });
  }

  private async readSessionForUpdate(transaction: DatabaseTransaction, operatorId: string, required = true): Promise<PackageCatalogWizardSession | undefined> {
    const rows = await transaction.query<WizardSessionRow[]>(
      "SELECT session_id,operator_id,version,base_catalog_version,expires_at,draft_json FROM package_catalog_wizard_sessions WHERE operator_id=? AND flow_code='PACKAGE_CATALOG_ADD_WIZARD' AND status='ACTIVE' FOR UPDATE",
      [operatorId],
    );
    if (!rows[0] && required) throw new PackageCatalogCommandError("PACKAGE_WIZARD_NOT_ACTIVE", "진행 중인 패키지 추가가 없습니다.");
    return rows[0] ? mapSession(rows[0]) : undefined;
  }

  private conflict(): never {
    throw new PackageCatalogCommandError("PACKAGE_WIZARD_CONFLICT", "패키지 추가 상태가 변경되었습니다. /패키지추가상태로 확인해 주세요.");
  }
}
