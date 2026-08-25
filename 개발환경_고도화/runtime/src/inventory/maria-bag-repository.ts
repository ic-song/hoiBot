import type { DatabaseClient } from "../database.js";
import type { BagItemView, BagRepository, BagView } from "./bag.js";
import { sortLegacyBagItems } from "./legacy-bag-formatter.js";

interface IdentityRow {
  player_id: bigint;
  display_name: string;
}

interface BagItemRow {
  item_id: bigint;
  item_code: string;
  stack_version: bigint;
  catalog_object_id: bigint | null;
  catalog_object_key: string | null;
  display_name: string;
  quantity: bigint;
  legacy_bag_order: string | null;
}

// 외부 identity의 인벤토리 stack을 레거시 가방 출력용 읽기 모델로 조회합니다.
export class MariaBagRepository implements BagRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByExternalIdentity(providerCode: string, externalUserId: string): Promise<BagView | null> {
    const identities = await this.database.query<IdentityRow[]>(
      `SELECT player_id, display_name
         FROM external_identities
        WHERE provider_code = ? AND external_user_id = ? AND status = 'linked' AND player_id IS NOT NULL`,
      [providerCode, externalUserId]
    );
    const identity = identities[0];
    if (identity === undefined) return null;

    const rows = await this.database.query<BagItemRow[]>(
      `SELECT item.id AS item_id, item.code AS item_code, item.display_name, stack.quantity,
              stack.version AS stack_version, registry.id AS catalog_object_id,
              registry.object_key AS catalog_object_key,
              JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json, '$.legacyBagOrder')) AS legacy_bag_order
         FROM inventory_stacks stack
         JOIN item_definitions item ON item.id = stack.item_id
         LEFT JOIN object_source_bindings binding
           ON binding.source_system = 'RUNTIME_DB'
          AND binding.source_table = 'item_definitions'
          AND binding.source_key = item.code
         LEFT JOIN object_registry registry ON registry.id = binding.object_id
        WHERE stack.player_id = ? AND stack.quantity > 0 AND item.active = TRUE`,
      [identity.player_id]
    );
    const advertisements = await this.database.query<Array<{ string_value: string }>>(
      `SELECT value.string_value
         FROM configuration_sets config
         JOIN configuration_values value ON value.configuration_set_id = config.id
        WHERE config.status = 'active' AND value.config_key = 'legacy.bag.advertisement'
        ORDER BY config.version DESC LIMIT 1`
    );

    const items = sortLegacyBagItems(rows.map((row): BagItemView => ({
      definitionId: row.item_id.toString(),
      itemCode: row.item_code,
      stackVersion: row.stack_version.toString(),
      catalogObjectKey: row.catalog_object_key,
      displayName: row.display_name,
      quantity: row.quantity.toString(),
      legacyBagOrder: row.legacy_bag_order === null ? null : Number(row.legacy_bag_order)
    })));
    const snapshotId = await this.database.withTransaction(async (transaction) => {
      await transaction.execute(
        "DELETE FROM bag_selection_snapshots WHERE player_id = ? AND expires_at <= UTC_TIMESTAMP(3)",
        [identity.player_id]
      );
      const snapshot = await transaction.execute(
        "INSERT INTO bag_selection_snapshots (player_id, expires_at) VALUES (?, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE)",
        [identity.player_id]
      );
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        await transaction.execute(
          `INSERT INTO bag_selection_snapshot_entries
            (snapshot_id, display_seq, item_id, item_code, catalog_object_id, stack_version, quantity)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshot.insertId,
            index + 1,
            item.definitionId,
            item.itemCode,
            rows.find((row) => row.item_id.toString() === item.definitionId)?.catalog_object_id ?? null,
            item.stackVersion,
            item.quantity
          ]
        );
      }
      return snapshot.insertId.toString();
    });
    return {
      playerId: identity.player_id.toString(),
      snapshotId,
      ownerLabel: identity.display_name,
      advertisement: advertisements[0]?.string_value ?? "",
      items
    };
  }
}
