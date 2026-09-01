SELECT COUNT(*) AS definition_count
FROM guild_rank_title_definitions
WHERE definition_version = 1
  AND active = 1;

SELECT
  SUM(maximum_rank = minimum_rank) AS singleton_count,
  SUM(maximum_rank IS NULL AND minimum_rank = 20) AS open_ended_count,
  COUNT(DISTINCT title_code) AS identity_count
FROM guild_rank_title_definitions
WHERE definition_version = 1
  AND title_code LIKE 'GUILD-RANK-%';

SELECT COUNT(*) AS catalog_count
FROM title_definition_catalog_entries
WHERE source_scope = 'GUILD_RANK'
  AND normalized_asset_scope = 'GUILD_RANK'
  AND definition_version = 1
  AND lifecycle_code = 'ACTIVE';

SELECT COUNT(*) AS overlap_count
FROM guild_rank_title_definitions left_range
JOIN guild_rank_title_definitions right_range
  ON left_range.definition_version = right_range.definition_version
 AND left_range.title_code < right_range.title_code
 AND left_range.minimum_rank <= COALESCE(right_range.maximum_rank, 2147483647)
 AND right_range.minimum_rank <= COALESCE(left_range.maximum_rank, 2147483647)
WHERE left_range.definition_version = 1
  AND left_range.title_code LIKE 'GUILD-RANK-%'
  AND right_range.title_code LIKE 'GUILD-RANK-%';

SELECT title_code, display_name
FROM guild_rank_title_definitions
WHERE definition_version = 1
  AND 10520 BETWEEN minimum_rank AND COALESCE(maximum_rank, 2147483647);
