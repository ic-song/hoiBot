SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_m440_stack_identity (
  target_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  canonical_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_type_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL,
  expected_occurrence_count INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT INTO tmp_m440_stack_identity VALUES
  ('[🏡가구]로열패키지 확정(/로열오픈)','ITEM-PACKAGE-100','item.package_reward.royal_furniture_package','PACKAGE_ITEM',FALSE,1),
  ('[🐹미니펫]창세패키지 확정(/창세오픈)','ITEM-PACKAGE-GENESIS-CONFIRMED','item.package_reward.genesis_minipet_package','PACKAGE_ITEM',FALSE,1),
  ('[🐹미니펫]창조패키지 확정(/창조오픈)','ITEM-PACKAGE-156','item.package_reward.creation_minipet_package','PACKAGE_ITEM',FALSE,1),
  ('미궁 입장권🕋','ITEM-MAZE-ENTRY-TICKET','item.package_reward.maze_entry_ticket','STACK',TRUE,2),
  ('아니 아이스아메리카노 주세요 ㅡㅡ(/아아 숫자)','ITEM-ICE-AMERICANO-REQUEST','item.package_reward.ice_americano_request','STACK',TRUE,1),
  ('자동탐험권🌄','ITEM-AUTO-EXPLORE-TICKET','item.package_reward.auto_explore_ticket','STACK',TRUE,2),
  ('창조패키지🐹(/창조오픈)','ITEM-PACKAGE-CREATION-LEGACY','item.package_reward.creation_package_legacy','PACKAGE_ITEM',FALSE,1),
  ('탐험확률UP🗻(30%)','ITEM-RWD-032','item.package_reward.explore_boost_30','STACK',TRUE,2),
  ('탐험확률UP🗻(40%)','ITEM-RWD-031','item.package_reward.explore_boost_40','STACK',TRUE,6),
  ('탐험확률UP🗻(50%)','ITEM-RWD-030','item.package_reward.explore_boost_50','STACK',TRUE,12),
  ('펜던트 복원석🔷','ITEM-PENDANT-RESTORATION-STONE','item.package_reward.pendant_restore_stone','STACK',TRUE,6),
  ('황제패키지👑[4](/황제패키지오픈4)','ITEM-PACKAGE-EMPEROR-4','item.package_reward.emperor_package_4','PACKAGE_ITEM',FALSE,1);

INSERT IGNORE INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version)
SELECT canonical_item_code,target_display_name,asset_type_code,TRUE,
       JSON_OBJECT('migration','440_asset_package_data_migration_ready_gap_closure','source','data/packageInfo.json'),active,1
FROM tmp_m440_stack_identity;

CREATE TEMPORARY TABLE tmp_m440_item_guard (
  identity_count INT UNSIGNED NOT NULL,
  occurrence_count INT UNSIGNED NOT NULL,
  definition_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m440_item_guard CHECK(identity_count=12 AND occurrence_count=36 AND definition_count=12)
) ENGINE=InnoDB;

INSERT INTO tmp_m440_item_guard
SELECT
  (SELECT COUNT(*) FROM tmp_m440_stack_identity),
  (SELECT SUM(expected_occurrence_count) FROM tmp_m440_stack_identity),
  (SELECT COUNT(*) FROM tmp_m440_stack_identity identity_row
    JOIN item_definitions definition_row
      ON definition_row.code=identity_row.canonical_item_code
     AND BINARY definition_row.display_name=BINARY identity_row.target_display_name
     AND definition_row.stackable=TRUE);

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT object_key,'ITEM',target_display_name,1,active,
       JSON_OBJECT('definitionCode',canonical_item_code,'assetTypeCode',asset_type_code,
                   'sourceCatalogVersion','ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01')
FROM tmp_m440_stack_identity
ORDER BY object_key
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'ITEM','LEGACY_JSON','data/packageInfo.json',identity_row.target_display_name
FROM tmp_m440_stack_identity identity_row
JOIN object_registry object_row
  ON object_row.object_key=identity_row.object_key
 AND object_row.object_type='ITEM'
 AND BINARY object_row.display_name=BINARY identity_row.target_display_name
 AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))=identity_row.canonical_item_code
ORDER BY identity_row.target_display_name
ON DUPLICATE KEY UPDATE object_id=IF(object_source_bindings.object_id=VALUES(object_id) AND object_source_bindings.object_type=VALUES(object_type),object_source_bindings.object_id,NULL);

INSERT INTO asset_package_typed_target_catalogs
  (catalog_version,source_revision,source_path,source_sha256,package_count,reward_count,stack_row_count,package_row_count,
   resolved_stack_row_count,gap_stack_row_count,publication_status)
SELECT
  'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01',source_revision,source_path,source_sha256,
  package_count,reward_count,stack_row_count,package_row_count,resolved_stack_row_count,gap_stack_row_count,'SHADOW'
FROM asset_package_typed_target_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

INSERT INTO asset_package_source_definitions
  (catalog_id,source_order,source_package_id,display_name,inventory_key,description,enabled,legacy_max_use_once,enforcement_status,identity_hash)
SELECT target_catalog.id,source_definition.source_order,source_definition.source_package_id,source_definition.display_name,
       source_definition.inventory_key,source_definition.description,source_definition.enabled,source_definition.legacy_max_use_once,
       source_definition.enforcement_status,source_definition.identity_hash
FROM asset_package_typed_target_catalogs source_catalog
JOIN asset_package_source_definitions source_definition ON source_definition.catalog_id=source_catalog.id
JOIN asset_package_typed_target_catalogs target_catalog
  ON target_catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
WHERE source_catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
ORDER BY source_definition.source_order
ON DUPLICATE KEY UPDATE source_package_id=VALUES(source_package_id);

INSERT INTO asset_package_reward_target_occurrences
  (catalog_id,global_source_order,source_package_definition_id,reward_order,raw_type,target_type,target_display_name,quantity,
   target_source_package_definition_id,canonical_item_id,canonical_package_id,resolution_status,identity_hash)
SELECT target_catalog.id,source_occurrence.global_source_order,target_source.id,source_occurrence.reward_order,
       source_occurrence.raw_type,source_occurrence.target_type,source_occurrence.target_display_name,source_occurrence.quantity,
       target_nested.id,source_occurrence.canonical_item_id,source_occurrence.canonical_package_id,
       source_occurrence.resolution_status,source_occurrence.identity_hash
FROM asset_package_typed_target_catalogs source_catalog
JOIN asset_package_reward_target_occurrences source_occurrence ON source_occurrence.catalog_id=source_catalog.id
JOIN asset_package_source_definitions source_source ON source_source.id=source_occurrence.source_package_definition_id
LEFT JOIN asset_package_source_definitions source_nested ON source_nested.id=source_occurrence.target_source_package_definition_id
JOIN asset_package_typed_target_catalogs target_catalog
  ON target_catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
JOIN asset_package_source_definitions target_source
  ON target_source.catalog_id=target_catalog.id AND target_source.source_package_id=source_source.source_package_id
LEFT JOIN asset_package_source_definitions target_nested
  ON target_nested.catalog_id=target_catalog.id AND target_nested.source_package_id=source_nested.source_package_id
WHERE source_catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
ORDER BY source_occurrence.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

CREATE TEMPORARY TABLE tmp_m440_package_target AS
SELECT target_definition.source_package_id,target_definition.display_name,target_definition.identity_hash,COUNT(*) expected_occurrence_count
FROM asset_package_typed_target_catalogs catalog
JOIN asset_package_reward_target_occurrences occurrence ON occurrence.catalog_id=catalog.id
JOIN asset_package_source_definitions target_definition ON target_definition.id=occurrence.target_source_package_definition_id
WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
  AND occurrence.target_type='PACKAGE'
GROUP BY target_definition.source_package_id,target_definition.display_name,target_definition.identity_hash;

ALTER TABLE tmp_m440_package_target
  MODIFY source_package_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD PRIMARY KEY(source_package_id);

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT CONCAT('package.source.',source_package_id),'PACKAGE',display_name,1,TRUE,
       JSON_OBJECT('sourcePackageId',source_package_id,'identityHash',identity_hash,
                   'sourceCatalogVersion','ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01')
FROM tmp_m440_package_target
ORDER BY source_package_id
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'PACKAGE','LEGACY_JSON','data/packageInfo.json',target_row.source_package_id
FROM tmp_m440_package_target target_row
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('package.source.',target_row.source_package_id)
 AND object_row.object_type='PACKAGE'
 AND BINARY object_row.display_name=BINARY target_row.display_name
 AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.sourcePackageId'))=target_row.source_package_id
ORDER BY target_row.source_package_id
ON DUPLICATE KEY UPDATE object_id=IF(object_source_bindings.object_id=VALUES(object_id) AND object_source_bindings.object_type=VALUES(object_type),object_source_bindings.object_id,NULL);

-- WBS714에서 검증한 10개 exact binding을 새 버전으로 그대로 승계합니다.
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT old_binding.object_id,'ITEM','RUNTIME_DB','asset_package_reward_target_occurrences',
       CONCAT('ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#',occurrence.global_source_order)
FROM object_source_bindings old_binding
JOIN asset_package_reward_target_occurrences occurrence
  ON occurrence.global_source_order=CAST(SUBSTRING_INDEX(old_binding.source_key,'#',-1) AS UNSIGNED)
JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
WHERE old_binding.object_type='ITEM'
  AND old_binding.source_system='RUNTIME_DB'
  AND old_binding.source_table='asset_package_reward_target_occurrences'
  AND old_binding.source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'
  AND catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
ORDER BY occurrence.global_source_order
ON DUPLICATE KEY UPDATE object_id=IF(object_source_bindings.object_id=VALUES(object_id) AND object_source_bindings.object_type=VALUES(object_type),object_source_bindings.object_id,NULL);

-- 잔여 STACK 36건을 source-backed item identity에 연결합니다.
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'ITEM','RUNTIME_DB','asset_package_reward_target_occurrences',
       CONCAT('ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#',occurrence.global_source_order)
FROM asset_package_typed_target_catalogs catalog
JOIN asset_package_reward_target_occurrences occurrence ON occurrence.catalog_id=catalog.id
JOIN tmp_m440_stack_identity identity_row ON BINARY identity_row.target_display_name=BINARY occurrence.target_display_name
JOIN object_registry object_row ON object_row.object_key=identity_row.object_key AND object_row.object_type='ITEM'
WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
  AND occurrence.target_type='STACK' AND occurrence.resolution_status='GAP'
ORDER BY occurrence.global_source_order
ON DUPLICATE KEY UPDATE object_id=IF(object_source_bindings.object_id=VALUES(object_id) AND object_source_bindings.object_type=VALUES(object_type),object_source_bindings.object_id,NULL);

-- 중첩 PACKAGE 44건은 표시명이 아니라 source package ID identity로 연결합니다.
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'PACKAGE','RUNTIME_DB','asset_package_reward_target_occurrences',
       CONCAT('ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#',occurrence.global_source_order)
FROM asset_package_typed_target_catalogs catalog
JOIN asset_package_reward_target_occurrences occurrence ON occurrence.catalog_id=catalog.id
JOIN asset_package_source_definitions target_definition ON target_definition.id=occurrence.target_source_package_definition_id
JOIN object_registry object_row
  ON object_row.object_key=CONCAT('package.source.',target_definition.source_package_id)
 AND object_row.object_type='PACKAGE'
WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
  AND occurrence.target_type='PACKAGE'
ORDER BY occurrence.global_source_order
ON DUPLICATE KEY UPDATE object_id=IF(object_source_bindings.object_id=VALUES(object_id) AND object_source_bindings.object_type=VALUES(object_type),object_source_bindings.object_id,NULL);

CREATE TEMPORARY TABLE tmp_m440_result_guard (
  package_count INT UNSIGNED NOT NULL,
  occurrence_count INT UNSIGNED NOT NULL,
  stack_overlay_count INT UNSIGNED NOT NULL,
  package_overlay_count INT UNSIGNED NOT NULL,
  stack_object_count INT UNSIGNED NOT NULL,
  package_object_count INT UNSIGNED NOT NULL,
  residual_stack_gap_count INT UNSIGNED NOT NULL,
  residual_package_gap_count INT UNSIGNED NOT NULL,
  conflict_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m440_result_guard CHECK(
    package_count=107 AND occurrence_count=557
    AND stack_overlay_count=46 AND package_overlay_count=44
    AND stack_object_count=16 AND package_object_count=21
    AND residual_stack_gap_count=0 AND residual_package_gap_count=0 AND conflict_count=0
  )
) ENGINE=InnoDB;

INSERT INTO tmp_m440_result_guard
SELECT
  (SELECT COUNT(*) FROM asset_package_source_definitions definition_row JOIN asset_package_typed_target_catalogs catalog ON catalog.id=definition_row.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'),
  (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='PACKAGE' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  (SELECT COUNT(DISTINCT object_id) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  (SELECT COUNT(DISTINCT object_id) FROM object_source_bindings WHERE object_type='PACKAGE' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  46-(SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  44-(SELECT COUNT(*) FROM object_source_bindings WHERE object_type='PACKAGE' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'),
  (SELECT COUNT(*)
     FROM object_source_bindings binding_row
     JOIN object_registry object_row ON object_row.id=binding_row.object_id
     JOIN asset_package_reward_target_occurrences occurrence
       ON occurrence.global_source_order=CAST(SUBSTRING_INDEX(binding_row.source_key,'#',-1) AS UNSIGNED)
     JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
    WHERE binding_row.source_system='RUNTIME_DB'
      AND binding_row.source_table='asset_package_reward_target_occurrences'
      AND binding_row.source_key LIKE 'ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01#%'
      AND catalog.catalog_version='ASSET-FREEZE-v2.438-package-data-migration-ready-gap-closure-01'
      AND BINARY object_row.display_name<>BINARY occurrence.target_display_name);

DROP TEMPORARY TABLE tmp_m440_result_guard;
DROP TEMPORARY TABLE tmp_m440_package_target;
DROP TEMPORARY TABLE tmp_m440_item_guard;
DROP TEMPORARY TABLE tmp_m440_stack_identity;
COMMIT;
