SELECT
  COUNT(*) AS definitions,
  COUNT(DISTINCT catalog.stable_code) AS catalog_identities,
  SUM(ranges.maximum_rank IS NULL AND ranges.minimum_rank = 20) AS open_ended_ranges,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(catalog.metadata_json, '$.sourceHash')) =
      'b717506da8dfcdd725f8255b9c0c58982192ea4c15abe50decbbb98d3a1db5ef') AS source_hash_matches
FROM guild_rank_title_definitions ranges
JOIN title_definition_catalog_entries catalog
  ON catalog.stable_code = ranges.title_code
 AND catalog.definition_version = ranges.definition_version
 AND catalog.source_scope = 'GUILD_RANK'
WHERE ranges.definition_version = 1
  AND ranges.active = 1;

SELECT COUNT(*) AS overlaps
FROM guild_rank_title_definitions left_range
JOIN guild_rank_title_definitions right_range
  ON left_range.definition_version = right_range.definition_version
 AND left_range.title_code < right_range.title_code
 AND left_range.minimum_rank <= COALESCE(right_range.maximum_rank, 2147483647)
 AND right_range.minimum_rank <= COALESCE(left_range.maximum_rank, 2147483647)
WHERE left_range.definition_version = 1
  AND left_range.title_code LIKE 'GUILD-RANK-%'
  AND right_range.title_code LIKE 'GUILD-RANK-%';
