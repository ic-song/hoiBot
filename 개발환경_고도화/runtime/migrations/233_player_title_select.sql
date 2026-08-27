START TRANSACTION;

ALTER TABLE player_titles
  ADD COLUMN IF NOT EXISTS display_order BIGINT UNSIGNED NULL AFTER equipped;

UPDATE player_titles owned
JOIN (
  SELECT player_id, title_id,
         ROW_NUMBER() OVER (
           PARTITION BY player_id
           ORDER BY acquired_at IS NULL, acquired_at, title_id
         ) AS resolved_order
    FROM player_titles
) ordered
  ON ordered.player_id = owned.player_id AND ordered.title_id = owned.title_id
SET owned.display_order = ordered.resolved_order
WHERE owned.display_order IS NULL;

ALTER TABLE player_titles
  ADD INDEX IF NOT EXISTS idx_player_titles_display_order (player_id, display_order);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PLAYER_TITLE_SELECT','player_title_select','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/타이틀','PLAYER_TITLE_SELECT',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
