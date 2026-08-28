START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('game.inventory.free_support.delete','무료 호이응원패키지 전역 삭제')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'game.inventory.free_support.delete' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('ITEM-FREE-HOI-SUPPORT-01','호이응원패키지(무료)🐹[1]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[1]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-02','호이응원패키지(무료)🐹[2]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[2]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-03','호이응원패키지(무료)🐹[3]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[3]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-04','호이응원패키지(무료)🐹[4]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[4]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-05','호이응원패키지(무료)🐹[5]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[5]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-06','호이응원패키지(무료)🐹[6]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[6]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-07','호이응원패키지(무료)🐹[7]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[7]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-08','호이응원패키지(무료)🐹[8]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[8]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-09','호이응원패키지(무료)🐹[9]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[9]','cleanupRange',TRUE),TRUE,1),
('ITEM-FREE-HOI-SUPPORT-10','호이응원패키지(무료)🐹[10]','PACKAGE_ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','호이응원패키지(무료)🐹[10]','cleanupRange',TRUE),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

CREATE TABLE admin_global_inventory_cleanup_locks(
 lock_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(lock_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_global_inventory_cleanup_locks(lock_key,version)
VALUES('free_hoi_support_package',0)
ON DUPLICATE KEY UPDATE lock_key=VALUES(lock_key);

CREATE TABLE admin_package_delete_runs(
 operation_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operator_id BIGINT UNSIGNED NOT NULL,
 min_variant SMALLINT UNSIGNED NOT NULL,
 max_variant SMALLINT UNSIGNED NOT NULL,
 affected_member_count BIGINT UNSIGNED NOT NULL,
 deleted_stack_count BIGINT UNSIGNED NOT NULL,
 positive_quantity_total BIGINT UNSIGNED NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(operation_id),
 UNIQUE KEY uq_admin_package_delete_request(request_key),
 CONSTRAINT fk_admin_package_delete_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_package_delete_operator FOREIGN KEY(operator_id) REFERENCES admin_operators(id) ON DELETE RESTRICT,
 CONSTRAINT chk_admin_package_delete_result CHECK(JSON_VALID(result_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_package_delete_changes(
 operation_id BIGINT UNSIGNED NOT NULL,
 sequence_no INT UNSIGNED NOT NULL,
 player_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL,
 quantity_before BIGINT UNSIGNED NOT NULL,
 counted_positive_quantity BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(operation_id,sequence_no),
 CONSTRAINT fk_admin_package_delete_change_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_package_delete_change_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
 CONSTRAINT fk_admin_package_delete_change_item FOREIGN KEY(item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_PACKAGE_DELETE','admin_package_delete','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/선물삭제','ADMIN_PACKAGE_DELETE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
