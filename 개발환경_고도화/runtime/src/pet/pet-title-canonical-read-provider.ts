import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { assertObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import type { PetTitleListRow } from "./pet-title-lifecycle-service.js";

interface CanonicalPetTitleRow {
  owned_pet_title_id: string;
  title_name: string;
  acquisition_sequence: bigint | string;
  acquired_time: Date | string;
  acquisition_price: bigint | string | null;
  base_sale_price: bigint | string;
  selected_flag: boolean | bigint | number | string;
}

function selected(value: CanonicalPetTitleRow["selected_flag"]): boolean {
  return value === true || value === 1 || value === 1n || value === "1";
}

// WBS743 PET-TITLE read slice: definition values are always joined at read time,
// while the per-occurrence acquisition price remains attached to the owned instance.
export class PetTitleCanonicalReadProvider {
  async listOwned(database: AppWiringReadParticipant, playerId: string): Promise<PetTitleListRow[]> {
    assertObjectIdentityCandidate(playerId);
    const rows = await database.query<CanonicalPetTitleRow[]>(
      `SELECT owned.owned_pet_title_id,definition_row.title_name,owned.acquisition_sequence,
              owned.acquired_time,owned.acquisition_price,definition_row.base_sale_price,
              CASE WHEN selection_row.owned_pet_title_id IS NULL THEN 0 ELSE 1 END AS selected_flag
         FROM canonical_owned_pet_title_instances owned
         JOIN canonical_pet_title_definitions definition_row ON definition_row.pet_title_id=owned.pet_title_id
         LEFT JOIN canonical_pet_title_selections selection_row
           ON selection_row.player_id=owned.player_id
          AND selection_row.owned_pet_title_id=owned.owned_pet_title_id
        WHERE owned.player_id=? AND owned.ownership_status='owned'
        ORDER BY owned.acquisition_sequence,owned.owned_pet_title_id`,
      [playerId],
    );
    return rows.map((row) => ({
      instanceId: row.owned_pet_title_id,
      displayName: row.title_name,
      priceDigits: String(row.acquisition_price ?? row.base_sale_price),
      acquiredAt: row.acquired_time,
      equipped: selected(row.selected_flag),
    }));
  }
}
