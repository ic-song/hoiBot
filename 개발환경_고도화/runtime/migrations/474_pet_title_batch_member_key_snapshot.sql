-- WBS743 provider recovery: replay-safe PET_TITLE batch member display snapshot.

-- Existing ADMIN_SYNC receipts may only be upgraded when an actual display value can be recovered.
-- A synthetic player_id/source_identifier fallback would turn an internal identifier into a user-visible nickname.
SELECT (
  SELECT migration_preflight_guard
  FROM (
    SELECT 1 AS migration_preflight_guard
    UNION ALL
    SELECT 2
    WHERE EXISTS (
      SELECT 1
      FROM canonical_pet_title_batch_operation_targets target_row
      JOIN canonical_pet_title_batch_operations batch_row ON batch_row.pet_title_batch_operation_id=target_row.pet_title_batch_operation_id
      JOIN canonical_players canonical_player ON canonical_player.player_id=target_row.player_id
      LEFT JOIN player_profiles profile ON profile.player_id=CASE
        WHEN canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$'
        THEN CAST(canonical_player.source_identifier AS UNSIGNED) ELSE NULL END
      WHERE batch_row.operation_type='ADMIN_SYNC'
        AND COALESCE(
          CASE WHEN CHAR_LENGTH(profile.current_display_name) BETWEEN 1 AND 255 THEN profile.current_display_name END,
          (SELECT MAX(identity_row.display_name)
             FROM canonical_player_identity_crosswalks crosswalk
             JOIN external_identities identity_row
               ON identity_row.provider_code=crosswalk.provider_code
              AND identity_row.external_user_id=crosswalk.external_user_id
              AND identity_row.status='linked'
              AND CHAR_LENGTH(identity_row.display_name) BETWEEN 1 AND 255
            WHERE crosswalk.player_id=target_row.player_id AND crosswalk.crosswalk_status='LINKED')
        ) IS NULL
    )
  ) AS migration_preflight
) AS migration_preflight_guard;

ALTER TABLE canonical_pet_title_batch_operation_targets
  ADD COLUMN IF NOT EXISTS member_key_before VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER player_id;

ALTER TABLE canonical_pet_title_batch_operations
  ADD COLUMN IF NOT EXISTS result_contract_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER operation_type;

UPDATE canonical_pet_title_batch_operations
SET result_contract_version='LEGACY',
    UPDATE_USER='migration_474',
    UPDATE_TIME=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s')
WHERE result_contract_version IS NULL;

ALTER TABLE canonical_pet_title_batch_operations
  MODIFY COLUMN result_contract_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_474_00_contract CHECK (
    (result_contract_version='LEGACY' AND operation_type IN ('ADMIN_SYNC','ADMIN_RESET'))
    OR (result_contract_version='MEMBER_KEY_V1' AND operation_type='ADMIN_SYNC')
    OR (result_contract_version='RESET_V1' AND operation_type='ADMIN_RESET'));

UPDATE canonical_pet_title_batch_operation_targets target_row
JOIN canonical_pet_title_batch_operations batch_row ON batch_row.pet_title_batch_operation_id=target_row.pet_title_batch_operation_id
JOIN canonical_players canonical_player ON canonical_player.player_id=target_row.player_id
LEFT JOIN player_profiles profile ON profile.player_id=CASE
  WHEN canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$'
  THEN CAST(canonical_player.source_identifier AS UNSIGNED) ELSE NULL END
SET target_row.member_key_before=COALESCE(
  CASE WHEN CHAR_LENGTH(profile.current_display_name) BETWEEN 1 AND 255 THEN profile.current_display_name END,
  (SELECT MAX(identity_row.display_name)
     FROM canonical_player_identity_crosswalks crosswalk
     JOIN external_identities identity_row
       ON identity_row.provider_code=crosswalk.provider_code
      AND identity_row.external_user_id=crosswalk.external_user_id
      AND identity_row.status='linked'
      AND CHAR_LENGTH(identity_row.display_name) BETWEEN 1 AND 255
    WHERE crosswalk.player_id=target_row.player_id AND crosswalk.crosswalk_status='LINKED'),
  target_row.member_key_before),
    target_row.UPDATE_USER='migration_474',
    target_row.UPDATE_TIME=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s')
WHERE target_row.member_key_before IS NULL AND batch_row.operation_type='ADMIN_SYNC';

ALTER TABLE canonical_pet_title_batch_operation_targets
  MODIFY COLUMN member_key_before VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD CONSTRAINT IF NOT EXISTS chk_odbt_474_01_member_key CHECK (member_key_before IS NULL OR CHAR_LENGTH(member_key_before) BETWEEN 1 AND 255);
