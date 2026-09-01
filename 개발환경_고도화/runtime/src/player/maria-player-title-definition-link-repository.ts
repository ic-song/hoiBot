import type { DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { PlayerTitleDefinitionLink, PlayerTitleDefinitionLinkRepository } from "./player-title-definition-link.js";

export class MariaPlayerTitleDefinitionLinkRepository implements PlayerTitleDefinitionLinkRepository {
  // Legacy definition과 WBS645 composite catalog identity를 같은 transaction에서 보장합니다.
  public async ensure(
    transaction: DatabaseTransaction,
    input: { sourceScope: PlayerTitleDefinitionLink["sourceScope"]; stableCode: string; displayName: string },
  ): Promise<PlayerTitleDefinitionLink> {
    await transaction.execute(
      "INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES (?,?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE",
      [input.stableCode, input.displayName, input.sourceScope.toLowerCase()],
    );
    const definition = (await transaction.query<Array<{ id: bigint; display_name: string }>>(
      "SELECT id,display_name FROM title_definitions WHERE code=? FOR UPDATE",
      [input.stableCode],
    ))[0];
    if (!definition || definition.display_name !== input.displayName) {
      throw new ApplicationError("TITLE_CODE_COLLISION", "타이틀 정의 충돌을 확인해 주세요.", 409);
    }
    await transaction.execute(
      `INSERT INTO title_definition_catalog_entries(
         catalog_version_id,legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
         definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,metadata_json
       )
       SELECT version_row.id,?,'RUNTIME_DB','title_definitions',?,?,1,'ACTIVE','PLAYER',?,TRUE,
              JSON_OBJECT('dynamicNamespace',?,'identityContract','source_scope+stable_code+definition_version+lifecycle')
       FROM title_definition_catalog_versions version_row
       WHERE version_row.catalog_code='TITLE_DEFINITION_SCOPE_LEGACY'
         AND version_row.catalog_version=1 AND version_row.publish_state='PUBLISHED'
       ON DUPLICATE KEY UPDATE legacy_title_definition_id=VALUES(legacy_title_definition_id)`,
      [definition.id, input.sourceScope, input.stableCode, input.displayName, input.sourceScope],
    );
    const entry = (await transaction.query<Array<{ id: bigint; legacy_title_definition_id: bigint; display_name: string }>>(
      `SELECT id,legacy_title_definition_id,display_name
         FROM title_definition_catalog_entries
        WHERE BINARY source_scope=BINARY ? AND stable_code=? AND definition_version=1 AND lifecycle_code='ACTIVE'
        LIMIT 1 FOR UPDATE`,
      [input.sourceScope, input.stableCode],
    ))[0];
    if (!entry || entry.legacy_title_definition_id !== definition.id || entry.display_name !== input.displayName) {
      throw new ApplicationError("TITLE_CATALOG_IDENTITY_CONFLICT", "타이틀 카탈로그 연결 충돌을 확인해 주세요.", 409);
    }
    return { titleId: definition.id, catalogEntryId: entry.id, sourceScope: input.sourceScope,
      stableCode: input.stableCode, displayName: input.displayName };
  }
}
