CREATE TEMPORARY TABLE rollback_406_title_links AS
SELECT player_id, title_id, canonical_instance_id
FROM player_mini_pet_collection_title_sources;

UPDATE player_mini_pet_collection_title_sources
SET canonical_instance_id = NULL;

DELETE instance_row
FROM player_title_instances AS instance_row
JOIN rollback_406_title_links AS link
  ON link.canonical_instance_id = instance_row.id;

DELETE projection_row
FROM player_titles AS projection_row
JOIN rollback_406_title_links AS link
  ON link.player_id = projection_row.player_id
 AND link.title_id = projection_row.title_id
WHERE NOT EXISTS (
  SELECT 1
  FROM player_title_instances AS remaining_instance
  WHERE remaining_instance.player_id = projection_row.player_id
    AND remaining_instance.title_id = projection_row.title_id
    AND remaining_instance.status = 'owned'
);

DROP TEMPORARY TABLE rollback_406_title_links;
DROP TABLE IF EXISTS player_mini_pet_collection_title_sources;
