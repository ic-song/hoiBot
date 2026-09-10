import type { DatabaseClient } from "../database.js";
import type { BagItemView, BagRepository, BagView } from "./bag.js";
import type { CurrentPlayerBagRepository } from "./current-player-bag-service.js";

interface IdentityRow {
  player_id: bigint;
  display_name: string;
}

interface BagItemRow {
  display_name: string;
  quantity: bigint;
  legacy_bag_order: string | null;
}

// 외부 identity의 인벤토리 stack을 레거시 가방 출력용 읽기 모델로 조회합니다.
export class MariaBagRepository implements BagRepository, CurrentPlayerBagRepository {
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
      `SELECT item.display_name, stack.quantity,
              JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json, '$.legacyBagOrder')) AS legacy_bag_order
         FROM inventory_stacks stack
         JOIN item_definitions item ON item.id = stack.item_id
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

    const items: BagItemView[] = rows.map((row) => ({
      displayName: row.display_name,
      quantity: row.quantity.toString(),
      legacyBagOrder: row.legacy_bag_order === null ? null : Number(row.legacy_bag_order)
    }));
    return {
      playerId: identity.player_id.toString(),
      ownerLabel: identity.display_name,
      advertisement: advertisements[0]?.string_value ?? "",
      items
    };
  }

  // 인증 세션의 현재 player_id에 한정해 활성 사용자의 가방 읽기 모델을 조회합니다.
  async findCurrentPlayerBag(playerId: string): Promise<BagView | null> {
    const players = await this.database.query<IdentityRow[]>(
      `SELECT player.id AS player_id, profile.current_display_name AS display_name
         FROM players player
         JOIN player_profiles profile ON profile.player_id = player.id
        WHERE player.id = ? AND player.status = 'active' AND player.deleted_at IS NULL
        LIMIT 1`,
      [playerId]
    );
    const player = players[0];
    if (player === undefined) return null;

    const rows = await this.database.query<BagItemRow[]>(
      `SELECT item.display_name, stack.quantity,
              JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json, '$.legacyBagOrder')) AS legacy_bag_order
         FROM inventory_stacks stack
         JOIN item_definitions item ON item.id = stack.item_id
        WHERE stack.player_id = ? AND stack.quantity > 0 AND item.active = TRUE`,
      [player.player_id]
    );
    const advertisements = await this.database.query<Array<{ string_value: string }>>(
      `SELECT value.string_value
         FROM configuration_sets config
         JOIN configuration_values value ON value.configuration_set_id = config.id
        WHERE config.status = 'active' AND value.config_key = 'legacy.bag.advertisement'
        ORDER BY config.version DESC LIMIT 1`
    );

    return {
      playerId: player.player_id.toString(),
      ownerLabel: player.display_name,
      advertisement: advertisements[0]?.string_value ?? "",
      items: rows.map((row) => ({
        displayName: row.display_name,
        quantity: row.quantity.toString(),
        legacyBagOrder: row.legacy_bag_order === null ? null : Number(row.legacy_bag_order)
      }))
    };
  }
}
