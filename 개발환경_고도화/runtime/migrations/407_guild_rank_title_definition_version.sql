CREATE TEMPORARY TABLE tmp_m407_guild_rank_titles (
  source_row INT NOT NULL,
  stable_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  minimum_rank INT NOT NULL,
  maximum_rank INT NULL,
  PRIMARY KEY (stable_code),
  UNIQUE KEY uq_tmp_m407_source_row (source_row)
);

INSERT INTO tmp_m407_guild_rank_titles
  (source_row, stable_code, display_name, minimum_rank, maximum_rank)
VALUES
  (1, 'GUILD-RANK-001-001', '황제☬', 1, 1),
  (2, 'GUILD-RANK-002-002', '국왕♔', 2, 2),
  (3, 'GUILD-RANK-003-003', '대공♛', 3, 3),
  (4, 'GUILD-RANK-004-004', '공작♕', 4, 4),
  (5, 'GUILD-RANK-005-005', '후작⚝', 5, 5),
  (6, 'GUILD-RANK-006-006', '백작❁', 6, 6),
  (7, 'GUILD-RANK-007-007', '자작⌺', 7, 7),
  (8, 'GUILD-RANK-008-008', '남작⍌', 8, 8),
  (9, 'GUILD-RANK-009-009', '기사⍫', 9, 9),
  (10, 'GUILD-RANK-010-010', '준기사⚔︎', 10, 10),
  (11, 'GUILD-RANK-011-011', '종사⚚', 11, 11),
  (12, 'GUILD-RANK-012-012', '시종✥', 12, 12),
  (13, 'GUILD-RANK-013-013', '영주민❖', 13, 13),
  (14, 'GUILD-RANK-014-014', '시민◈', 14, 14),
  (15, 'GUILD-RANK-015-015', '상인◉', 15, 15),
  (16, 'GUILD-RANK-016-016', '주민◍', 16, 16),
  (17, 'GUILD-RANK-017-017', '일꾼◌', 17, 17),
  (18, 'GUILD-RANK-018-018', '견습생△', 18, 18),
  (19, 'GUILD-RANK-019-019', '떠돌이◇', 19, 19),
  (20, 'GUILD-RANK-020-PLUS', '외곽민◻︎', 20, NULL);

INSERT INTO title_definitions (code, display_name, scope_code, active)
SELECT stable_code, display_name, 'GUILD_RANK', 1
FROM tmp_m407_guild_rank_titles
ON DUPLICATE KEY UPDATE
  code = title_definitions.code;

INSERT INTO guild_rank_title_definitions
  (definition_version, title_code, display_name, minimum_rank, maximum_rank, active)
SELECT 1, stable_code, display_name, minimum_rank, maximum_rank, 1
FROM tmp_m407_guild_rank_titles
ON DUPLICATE KEY UPDATE
  title_code = guild_rank_title_definitions.title_code;

INSERT INTO title_definition_catalog_entries
  (catalog_version_id, legacy_title_definition_id, source_system, source_table,
   source_scope, stable_code, definition_version, lifecycle_code,
   normalized_asset_scope, display_name, active_snapshot, metadata_json)
SELECT
  versions.id,
  definitions.id,
  'RUNTIME_DB',
  'guild_rank_title_definitions',
  'GUILD_RANK',
  frozen.stable_code,
  1,
  'ACTIVE',
  'GUILD_RANK',
  frozen.display_name,
  1,
  JSON_OBJECT(
    'policyCode', 'GUILD_RANK_TITLE',
    'policyVersion', 1,
    'sourceRow', frozen.source_row,
    'minimumRank', frozen.minimum_rank,
    'maximumRank', frozen.maximum_rank,
    'rangeType', IF(frozen.maximum_rank IS NULL, 'OPEN_ENDED', 'SINGLETON'),
    'sourceFunction', 'getGuildMasterRankTitle',
    'sourceHash', 'b717506da8dfcdd725f8255b9c0c58982192ea4c15abe50decbbb98d3a1db5ef'
  )
FROM tmp_m407_guild_rank_titles frozen
JOIN title_definitions definitions
  ON definitions.code = frozen.stable_code
 AND definitions.scope_code = 'GUILD_RANK'
JOIN title_definition_catalog_versions versions
  ON versions.catalog_code = 'TITLE_DEFINITION_SCOPE_LEGACY'
 AND versions.catalog_version = 1
 AND versions.publish_state = 'PUBLISHED'
ON DUPLICATE KEY UPDATE
  stable_code = title_definition_catalog_entries.stable_code;

DROP TEMPORARY TABLE tmp_m407_guild_rank_titles;
