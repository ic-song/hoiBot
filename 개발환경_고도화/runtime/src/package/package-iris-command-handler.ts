import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import {
  PackageCommandService,
  type PackageBagEntry,
  type PackageHubApplicationPort,
  type PackageUseRequest,
  type PackageUseResult,
} from "./package-command-service.js";
import { createCurrentDomainPackageRuntime } from "./current-domain-package-runtime.js";

interface PlayerIdentityRow {
  player_id: string;
}

interface BagRow {
  package_id: string;
  display_name: string;
  quantity: string;
  max_open_count: number;
}

interface ReplayRow {
  status: string;
}

interface RewardEffectRow {
  display_name: string;
  quantity: string;
}

// PackageProvider를 현재 가방과 지급 효과 원장에 연결하는 애플리케이션 포트
class CurrentPackageHubApplication implements PackageHubApplicationPort {
  private readonly runtime;

  public constructor(private readonly database: DatabaseClient) {
    this.runtime = createCurrentDomainPackageRuntime(database);
  }

  public async listBag(playerId: string): Promise<PackageBagEntry[]> {
    const rows = await this.database.query<BagRow[]>(
      `SELECT package_catalog.package_id,package_catalog.display_name,
              inventory_stacks.quantity,package_catalog.max_open_count
       FROM package_catalog
       JOIN item_definitions ON item_definitions.code = package_catalog.consume_item_id
         AND item_definitions.active = 1
       JOIN inventory_stacks ON inventory_stacks.item_id = item_definitions.id
         AND inventory_stacks.player_id = ? AND inventory_stacks.quantity > 0
       WHERE package_catalog.definition_status = 'READY' AND package_catalog.enabled = 1
       ORDER BY package_catalog.display_name,package_catalog.package_id`,
      [playerId],
    );
    return rows.map((row, index) => ({
      bagNumber: index + 1,
      packageId: row.package_id,
      displayName: row.display_name,
      quantity: Number(row.quantity),
      maxOpenCount: row.max_open_count,
    }));
  }

  public async use(request: PackageUseRequest): Promise<PackageUseResult> {
    const previous = await this.database.query<ReplayRow[]>(
      "SELECT status FROM package_domain_uses WHERE request_key = ?",
      [request.requestKey],
    );
    const catalog = await this.runtime.catalog.findById(request.packageId);
    if (catalog === undefined) throw new Error("PACKAGE_NOT_FOUND");
    const result = await this.runtime.packages.use({
      requestKey: request.requestKey,
      userId: request.playerId,
      packageId: request.packageId,
      openCount: request.openCount,
    });
    const rewards = await this.database.query<RewardEffectRow[]>(
      `SELECT package_item_definitions.item_name AS display_name,
              SUM(package_item_effects.quantity_delta) AS quantity
       FROM package_domain_uses
       JOIN package_item_effects ON package_item_effects.operation_id = package_domain_uses.operation_id
       JOIN package_item_definitions
         ON package_item_definitions.item_id = package_item_effects.package_item_id
       WHERE package_domain_uses.request_key = ? AND package_item_effects.quantity_delta > 0
       GROUP BY package_item_definitions.item_id,package_item_definitions.item_name
       ORDER BY MIN(package_item_effects.sequence_no)`,
      [request.requestKey],
    );
    return {
      replayed: previous[0]?.status === "COMMITTED",
      packageId: result.packageId,
      displayName: catalog.displayName,
      openCount: result.openCount,
      rewards: rewards.map((reward) => ({ displayName: reward.display_name, quantity: Number(reward.quantity) })),
    };
  }
}

// 검증된 Kakao identity를 내부 player로 해석해 패키지 명령을 실행
export class PackageIrisCommandHandler {
  private readonly commands: PackageCommandService;

  public constructor(private readonly database: DatabaseClient) {
    this.commands = new PackageCommandService(new CurrentPackageHubApplication(database));
  }

  public async execute(event: NormalizedIrisEvent): Promise<{ commandCode: string; message: string; replayed: boolean }> {
    if (event.userId === undefined || event.message === undefined) {
      throw new Error("PACKAGE_IRIS_IDENTITY_REQUIRED");
    }
    const players = await this.database.query<PlayerIdentityRow[]>(
      `SELECT external_identities.player_id
       FROM external_identities
       JOIN players ON players.id = external_identities.player_id AND players.status = 'active'
       WHERE external_identities.provider_code = 'kakao'
         AND external_identities.external_user_id = ?
         AND external_identities.status = 'linked'
       LIMIT 1`,
      [event.userId],
    );
    const playerId = players[0]?.player_id;
    if (playerId === undefined) {
      return { commandCode: "PACKAGE_USE", message: "먼저 /가입을 완료해 주세요.", replayed: false };
    }
    return this.commands.execute({
      message: event.message,
      playerId,
      requestKey: `iris:${event.eventId}:package`,
    });
  }
}
