SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_m439_exact_stack_binding (
  target_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  canonical_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_occurrence_count INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT INTO tmp_m439_exact_stack_binding VALUES
  ('강화확률뽑기⚒️(/강화뽑기)','ITEM-RWD-016','item.direct_bag.d4f37b7d57da963d',5),
  ('보물지도🗺️','ITEM-RWD-034','item.direct_bag.4ce96c3980927f12',3),
  ('황제패키지👑[3](/황제패키지오픈3)','ITEM-PACKAGE-204','item.direct_bag.8cd392b5f18fca80',1),
  ('태초야키토리 10세트🥩(/이랏싸이마쎄)','ITEM-PACKAGE-206','item.direct_bag.c4b362ab11e2a7a7',1);

CREATE TEMPORARY TABLE tmp_m439_resolved_occurrence AS
SELECT
  occurrence.global_source_order,
  occurrence.identity_hash,
  exact_binding.canonical_item_code,
  object_row.id AS object_id,
  object_row.object_key
FROM asset_package_typed_target_catalogs catalog
JOIN asset_package_reward_target_occurrences occurrence
  ON occurrence.catalog_id=catalog.id
JOIN tmp_m439_exact_stack_binding exact_binding
  ON BINARY exact_binding.target_display_name=BINARY occurrence.target_display_name
JOIN item_definitions definition_row
  ON definition_row.code=exact_binding.canonical_item_code
 AND BINARY definition_row.display_name=BINARY exact_binding.target_display_name
JOIN object_registry object_row
  ON object_row.object_key=exact_binding.object_key
 AND object_row.object_type='ITEM'
 AND BINARY object_row.display_name=BINARY exact_binding.target_display_name
 AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))=exact_binding.canonical_item_code
JOIN object_source_bindings legacy_binding
  ON legacy_binding.object_id=object_row.id
 AND legacy_binding.object_type='ITEM'
 AND legacy_binding.source_system='LEGACY_JS'
 AND legacy_binding.source_table='member.bag'
 AND BINARY legacy_binding.source_key=BINARY exact_binding.target_display_name
WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
  AND occurrence.target_type='STACK'
  AND occurrence.resolution_status='GAP';

CREATE TEMPORARY TABLE tmp_m439_source_guard (
  resolved_occurrence_count INT UNSIGNED NOT NULL,
  resolved_source_order_count INT UNSIGNED NOT NULL,
  resolved_object_count INT UNSIGNED NOT NULL,
  resolved_definition_count INT UNSIGNED NOT NULL,
  expected_occurrence_count INT UNSIGNED NOT NULL,
  frozen_stack_gap_count INT UNSIGNED NOT NULL,
  frozen_package_gap_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m439_source_guard CHECK (
    resolved_occurrence_count=10
    AND resolved_source_order_count=10
    AND resolved_object_count=4
    AND resolved_definition_count=4
    AND expected_occurrence_count=10
    AND frozen_stack_gap_count=46
    AND frozen_package_gap_count=44
  )
) ENGINE=InnoDB;

INSERT INTO tmp_m439_source_guard
SELECT
  (SELECT COUNT(*) FROM tmp_m439_resolved_occurrence),
  (SELECT COUNT(DISTINCT global_source_order) FROM tmp_m439_resolved_occurrence),
  (SELECT COUNT(DISTINCT object_id) FROM tmp_m439_resolved_occurrence),
  (SELECT COUNT(DISTINCT canonical_item_code) FROM tmp_m439_resolved_occurrence),
  (SELECT SUM(expected_occurrence_count) FROM tmp_m439_exact_stack_binding),
  (SELECT COUNT(*)
     FROM asset_package_reward_target_occurrences occurrence
     JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
      AND occurrence.target_type='STACK' AND occurrence.resolution_status='GAP'),
  (SELECT COUNT(*)
     FROM asset_package_reward_target_occurrences occurrence
     JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
    WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
      AND occurrence.target_type='PACKAGE' AND occurrence.resolution_status='SOURCE_RESOLVED_CANONICAL_GAP');

INSERT INTO asset_package_typed_target_catalogs
  (catalog_version,source_revision,source_path,source_sha256,package_count,reward_count,stack_row_count,package_row_count,
   resolved_stack_row_count,gap_stack_row_count,publication_status)
SELECT
  'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01',source_revision,source_path,source_sha256,
  package_count,reward_count,stack_row_count,package_row_count,resolved_stack_row_count,gap_stack_row_count,'SHADOW'
FROM asset_package_typed_target_catalogs
WHERE catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

INSERT INTO asset_package_source_definitions
  (catalog_id,source_order,source_package_id,display_name,inventory_key,description,enabled,legacy_max_use_once,enforcement_status,identity_hash)
SELECT
  target_catalog.id,source_definition.source_order,source_definition.source_package_id,source_definition.display_name,
  source_definition.inventory_key,source_definition.description,source_definition.enabled,source_definition.legacy_max_use_once,
  source_definition.enforcement_status,source_definition.identity_hash
FROM asset_package_typed_target_catalogs source_catalog
JOIN asset_package_source_definitions source_definition ON source_definition.catalog_id=source_catalog.id
JOIN asset_package_typed_target_catalogs target_catalog
  ON target_catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
WHERE source_catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
ORDER BY source_definition.source_order
ON DUPLICATE KEY UPDATE source_package_id=VALUES(source_package_id);

INSERT INTO asset_package_reward_target_occurrences
  (catalog_id,global_source_order,source_package_definition_id,reward_order,raw_type,target_type,target_display_name,quantity,
   target_source_package_definition_id,canonical_item_id,canonical_package_id,resolution_status,identity_hash)
SELECT
  target_catalog.id,source_occurrence.global_source_order,target_source.id,source_occurrence.reward_order,
  source_occurrence.raw_type,source_occurrence.target_type,source_occurrence.target_display_name,source_occurrence.quantity,
  target_nested.id,source_occurrence.canonical_item_id,source_occurrence.canonical_package_id,
  source_occurrence.resolution_status,source_occurrence.identity_hash
FROM asset_package_typed_target_catalogs source_catalog
JOIN asset_package_reward_target_occurrences source_occurrence ON source_occurrence.catalog_id=source_catalog.id
JOIN asset_package_source_definitions source_source ON source_source.id=source_occurrence.source_package_definition_id
LEFT JOIN asset_package_source_definitions source_nested ON source_nested.id=source_occurrence.target_source_package_definition_id
JOIN asset_package_typed_target_catalogs target_catalog
  ON target_catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
JOIN asset_package_source_definitions target_source
  ON target_source.catalog_id=target_catalog.id AND target_source.source_package_id=source_source.source_package_id
LEFT JOIN asset_package_source_definitions target_nested
  ON target_nested.catalog_id=target_catalog.id AND target_nested.source_package_id=source_nested.source_package_id
WHERE source_catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'
ORDER BY source_occurrence.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

INSERT INTO object_source_bindings
  (object_id,object_type,source_system,source_table,source_key)
SELECT
  resolved_occurrence.object_id,
  'ITEM',
  'RUNTIME_DB',
  'asset_package_reward_target_occurrences',
  CONCAT('ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#',resolved_occurrence.global_source_order)
FROM tmp_m439_resolved_occurrence resolved_occurrence
ORDER BY resolved_occurrence.global_source_order
ON DUPLICATE KEY UPDATE
  object_id=IF(
    object_source_bindings.object_id=VALUES(object_id)
    AND object_source_bindings.object_type=VALUES(object_type),
    object_source_bindings.object_id,
    NULL
  );

CREATE TEMPORARY TABLE tmp_m439_result_guard (
  old_package_count INT UNSIGNED NOT NULL,
  old_occurrence_count INT UNSIGNED NOT NULL,
  old_resolved_stack_count INT UNSIGNED NOT NULL,
  old_gap_stack_count INT UNSIGNED NOT NULL,
  new_package_count INT UNSIGNED NOT NULL,
  new_occurrence_count INT UNSIGNED NOT NULL,
  new_resolved_stack_count INT UNSIGNED NOT NULL,
  new_gap_stack_count INT UNSIGNED NOT NULL,
  overlay_count INT UNSIGNED NOT NULL,
  overlay_object_count INT UNSIGNED NOT NULL,
  effective_resolved_stack_count INT UNSIGNED NOT NULL,
  residual_stack_gap_count INT UNSIGNED NOT NULL,
  residual_package_gap_count INT UNSIGNED NOT NULL,
  conflict_count INT UNSIGNED NOT NULL,
  CONSTRAINT chk_m439_result_guard CHECK (
    old_package_count=107 AND old_occurrence_count=557 AND old_resolved_stack_count=467 AND old_gap_stack_count=46
    AND new_package_count=107 AND new_occurrence_count=557 AND new_resolved_stack_count=467 AND new_gap_stack_count=46
    AND overlay_count=10 AND overlay_object_count=4 AND effective_resolved_stack_count=477
    AND residual_stack_gap_count=36 AND residual_package_gap_count=44 AND conflict_count=0
  )
) ENGINE=InnoDB;

INSERT INTO tmp_m439_result_guard
SELECT
  (SELECT COUNT(*) FROM asset_package_source_definitions definition_row JOIN asset_package_typed_target_catalogs catalog ON catalog.id=definition_row.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01' AND occurrence.target_type='STACK' AND occurrence.resolution_status='RESOLVED'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-typed-target-01' AND occurrence.target_type='STACK' AND occurrence.resolution_status='GAP'),
  (SELECT COUNT(*) FROM asset_package_source_definitions definition_row JOIN asset_package_typed_target_catalogs catalog ON catalog.id=definition_row.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01' AND occurrence.target_type='STACK' AND occurrence.resolution_status='RESOLVED'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01' AND occurrence.target_type='STACK' AND occurrence.resolution_status='GAP'),
  (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'),
  (SELECT COUNT(DISTINCT object_id) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'),
  467 + (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'),
  46 - (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system='RUNTIME_DB' AND source_table='asset_package_reward_target_occurrences' AND source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'),
  (SELECT COUNT(*) FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01' AND occurrence.target_type='PACKAGE' AND occurrence.resolution_status='SOURCE_RESOLVED_CANONICAL_GAP'),
  (SELECT COUNT(*)
     FROM object_source_bindings overlay
     JOIN object_registry object_row ON object_row.id=overlay.object_id
     JOIN asset_package_reward_target_occurrences occurrence
       ON occurrence.global_source_order=CAST(SUBSTRING_INDEX(overlay.source_key,'#',-1) AS UNSIGNED)
     JOIN asset_package_typed_target_catalogs catalog ON catalog.id=occurrence.catalog_id
    WHERE overlay.object_type='ITEM' AND overlay.source_system='RUNTIME_DB'
      AND overlay.source_table='asset_package_reward_target_occurrences'
      AND overlay.source_key LIKE 'ASSET-FREEZE-v2.438-package-canonical-gap-correction-01#%'
      AND catalog.catalog_version='ASSET-FREEZE-v2.438-package-canonical-gap-correction-01'
      AND (BINARY object_row.display_name<>BINARY occurrence.target_display_name
        OR JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode')) IS NULL));

DROP TEMPORARY TABLE tmp_m439_result_guard;
DROP TEMPORARY TABLE tmp_m439_source_guard;
DROP TEMPORARY TABLE tmp_m439_resolved_occurrence;
DROP TEMPORARY TABLE tmp_m439_exact_stack_binding;
COMMIT;
