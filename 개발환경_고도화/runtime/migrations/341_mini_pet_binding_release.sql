START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
VALUES('ITEM-MINI-PET-UNBIND-TICKET','미니펫귀속해제권🐰(/귀속해제)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','미니펫귀속해제권🐰(/귀속해제)','sourceCommand','/귀속해제','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=JSON_MERGE_PATCH(metadata_json,VALUES(metadata_json)),active=TRUE,version=version+1;

CREATE TABLE mini_pet_binding_release_policy(
 policy_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 base_bag_limit BIGINT UNSIGNED NOT NULL,
 premium_bag_bonus BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(policy_key),
 CONSTRAINT chk_mini_pet_binding_release_base_limit CHECK(base_bag_limit>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_binding_release_policy(policy_key,base_bag_limit,premium_bag_bonus,active,version)
VALUES('default',10,5,TRUE,1)
ON DUPLICATE KEY UPDATE base_bag_limit=VALUES(base_bag_limit),premium_bag_bonus=VALUES(premium_bag_bonus),active=TRUE,version=version+1;

CREATE TABLE mini_pet_binding_release_operations(
 operation_id BIGINT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
 owned_version_before BIGINT UNSIGNED NOT NULL,
 ticket_item_id BIGINT UNSIGNED NOT NULL,
 bag_sequence BIGINT UNSIGNED NOT NULL,
 bag_count_before BIGINT UNSIGNED NOT NULL,
 bag_count_after BIGINT UNSIGNED NOT NULL,
 bag_limit BIGINT UNSIGNED NOT NULL,
 ticket_before BIGINT UNSIGNED NOT NULL,
 ticket_after BIGINT UNSIGNED NOT NULL,
 pet_snapshot_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 KEY idx_mini_pet_binding_release_player_created(player_id,created_at),
 KEY idx_mini_pet_binding_release_owned(owned_mini_pet_id),
 CONSTRAINT fk_mini_pet_binding_release_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_binding_release_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_binding_release_owned FOREIGN KEY(owned_mini_pet_id) REFERENCES owned_mini_pets(id) ON DELETE RESTRICT,
 CONSTRAINT fk_mini_pet_binding_release_ticket FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_mini_pet_binding_release_snapshot CHECK(JSON_VALID(pet_snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_BINDING_RELEASE','mini_pet_binding_release','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/귀속해제','MINI_PET_BINDING_RELEASE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
