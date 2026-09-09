import type {
  PackageBagEntry,
  PackageHubApplicationPort,
  PackageUseRequest,
  PackageUseResult,
} from "./package-command-service.js";

export interface PackageHubDatabase {
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<T[]>;
}

export interface AtomicPackageUsePort {
  use(request: PackageUseRequest): Promise<PackageUseResult>;
}

interface PackageBagRow {
  package_id: string;
  display_name: string;
  quantity: string;
  max_open_count: number;
}

// 현재 가방 잔액과 검증된 패키지 카탈로그를 결합하는 MariaDB 애플리케이션 어댑터
export class MariaPackageHubApplication implements PackageHubApplicationPort {
  public constructor(
    private readonly database: PackageHubDatabase,
    private readonly packageUse: AtomicPackageUsePort,
  ) {}

  public async listBag(playerId: string): Promise<PackageBagEntry[]> {
    const rows = await this.database.query<PackageBagRow>(
      `SELECT
         package_catalog.package_id,
         package_catalog.display_name,
         inventory_stacks.quantity,
         package_catalog.max_open_count
       FROM package_catalog
       JOIN package_item_definitions
         ON package_item_definitions.item_id = package_catalog.consume_item_id
        AND package_item_definitions.item_type = 'STACK'
        AND package_item_definitions.enabled = 1
       JOIN item_definitions
         ON item_definitions.code = package_catalog.consume_item_id
        AND item_definitions.active = 1
       JOIN inventory_stacks
         ON inventory_stacks.item_id = item_definitions.id
        AND inventory_stacks.player_id = ?
        AND inventory_stacks.quantity > 0
       WHERE package_catalog.status = 'READY'
         AND package_catalog.enabled = 1
       ORDER BY package_catalog.display_name, package_catalog.package_id`,
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

  public use(request: PackageUseRequest): Promise<PackageUseResult> {
    return this.packageUse.use(request);
  }
}
