ALTER TABLE home_feeds
  ADD COLUMN owner_sequence BIGINT UNSIGNED NULL AFTER feed_key;

UPDATE home_feeds target
JOIN (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY home_player_id
           ORDER BY display_order DESC, id ASC
         ) AS owner_sequence
  FROM home_feeds
) ranked ON ranked.id=target.id
SET target.owner_sequence=ranked.owner_sequence;

ALTER TABLE home_feeds
  MODIFY owner_sequence BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_home_feed_owner_sequence(home_player_id,owner_sequence),
  ADD KEY idx_home_feed_owner_sequence(home_player_id,deleted_at,owner_sequence,id);

CREATE TABLE home_feed_mutation_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feed_id BIGINT UNSIGNED NULL,
  requested_display_no BIGINT UNSIGNED NULL,
  active_count_before INT UNSIGNED NOT NULL,
  active_count_after INT UNSIGNED NOT NULL,
  delivered_count INT UNSIGNED NOT NULL DEFAULT 0,
  trimmed_count INT UNSIGNED NOT NULL DEFAULT 0,
  counter_after BIGINT UNSIGNED NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  KEY idx_home_feed_mutation_player(player_id,created_at),
  KEY idx_home_feed_mutation_feed(feed_id),
  CONSTRAINT fk_home_feed_mutation_operation FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_mutation_player FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_feed_mutation_feed FOREIGN KEY(feed_id) REFERENCES home_feeds(id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_feed_mutation_snapshot CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
('HOME_FEED_CREATE','home_feed_mutate','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_FEED_DELETE','home_feed_mutate','VERIFIED_USER','SHADOW',TRUE,1),
('HOME_FEED_CLEAR','home_feed_mutate','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/피드','HOME_FEED_CREATE',TRUE),
('/피드삭제','HOME_FEED_DELETE',TRUE),
('/피드전체삭제','HOME_FEED_CLEAR',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
