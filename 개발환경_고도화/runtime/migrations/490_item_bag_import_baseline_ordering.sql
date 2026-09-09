-- WBS777 forward correction: preserve typed bag baselines and a monotonic per-player item-ledger order.
DROP PROCEDURE IF EXISTS preflight_490_item_bag_import_baseline_ordering;
DELIMITER //
CREATE PROCEDURE preflight_490_item_bag_import_baseline_ordering()
BEGIN
  IF EXISTS(SELECT 1 FROM player_item_bag_import_completeness_projections) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MIGRATION_490_UNUPGRADABLE_V3_ROWS_EXIST';
  END IF;
END//
DELIMITER ;
CALL preflight_490_item_bag_import_baseline_ordering();
DROP PROCEDURE IF EXISTS preflight_490_item_bag_import_baseline_ordering;

ALTER TABLE canonical_item_inventory_ledger_entries
  ADD UNIQUE KEY uq_canonical_item_inventory_ledger_entry_player(item_inventory_ledger_entry_id,player_id);

ALTER TABLE player_item_bag_import_completeness_projections
  ADD COLUMN baseline_ledger_head_sequence BIGINT UNSIGNED NOT NULL AFTER item_ledger_entry_count,
  ADD CONSTRAINT chk_player_item_bag_import_completeness_ledger_head CHECK(baseline_ledger_head_sequence=item_ledger_entry_count);

CREATE TABLE canonical_item_inventory_ledger_heads (
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_ledger_sequence BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(player_id),
  CONSTRAINT fk_canonical_item_inventory_ledger_head_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_item_inventory_ledger_head_sequence CHECK(last_ledger_sequence>=1),
  CONSTRAINT chk_canonical_item_inventory_ledger_head_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_inventory_ledger_head_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canonical_item_inventory_ledger_orderings (
  item_inventory_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ledger_sequence BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(item_inventory_ledger_entry_id),
  UNIQUE KEY uq_canonical_item_inventory_ledger_ordering_player_sequence(player_id,ledger_sequence),
  UNIQUE KEY uq_item_ledger_ordering_entry_player_sequence(item_inventory_ledger_entry_id,player_id,ledger_sequence),
  CONSTRAINT fk_canonical_item_inventory_ledger_ordering_entry_player FOREIGN KEY(item_inventory_ledger_entry_id,player_id) REFERENCES canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_item_inventory_ledger_ordering_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT chk_canonical_item_inventory_ledger_ordering_sequence CHECK(ledger_sequence>=1),
  CONSTRAINT chk_canonical_item_inventory_ledger_ordering_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_canonical_item_inventory_ledger_ordering_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO canonical_item_inventory_ledger_orderings(item_inventory_ledger_entry_id,player_id,ledger_sequence,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
SELECT item_inventory_ledger_entry_id,player_id,ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY item_inventory_ledger_entry_id),'migration-490',DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d %H:%i:%s'),'migration-490',DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d %H:%i:%s')
FROM canonical_item_inventory_ledger_entries;
INSERT INTO canonical_item_inventory_ledger_heads(player_id,last_ledger_sequence,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
SELECT player_id,MAX(ledger_sequence),'migration-490',DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d %H:%i:%s'),'migration-490',DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d %H:%i:%s')
FROM canonical_item_inventory_ledger_orderings GROUP BY player_id;

DELIMITER //
CREATE TRIGGER trg_item_inventory_ledger_order_after_insert
AFTER INSERT ON canonical_item_inventory_ledger_entries
FOR EACH ROW
BEGIN
  DECLARE next_sequence BIGINT UNSIGNED;
  INSERT INTO canonical_item_inventory_ledger_heads(player_id,last_ledger_sequence,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
  VALUES(NEW.player_id,1,NEW.INSERT_USER,NEW.INSERT_TIME,NEW.UPDATE_USER,NEW.UPDATE_TIME)
  ON DUPLICATE KEY UPDATE last_ledger_sequence=last_ledger_sequence+1,UPDATE_USER=VALUES(UPDATE_USER),UPDATE_TIME=VALUES(UPDATE_TIME);
  SELECT last_ledger_sequence INTO next_sequence FROM canonical_item_inventory_ledger_heads WHERE player_id=NEW.player_id;
  INSERT INTO canonical_item_inventory_ledger_orderings(item_inventory_ledger_entry_id,player_id,ledger_sequence,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
  VALUES(NEW.item_inventory_ledger_entry_id,NEW.player_id,next_sequence,NEW.INSERT_USER,NEW.INSERT_TIME,NEW.UPDATE_USER,NEW.UPDATE_TIME);
END//
DELIMITER ;

CREATE TABLE player_item_bag_import_stack_baselines (
  player_item_bag_import_stack_baseline_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_item_bag_import_completeness_projection_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  baseline_quantity BIGINT UNSIGNED NOT NULL,
  stack_entry_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(player_item_bag_import_stack_baseline_id),
  UNIQUE KEY uq_player_item_bag_import_stack_baseline_stack(player_item_bag_import_completeness_projection_id,owned_item_stack_id),
  UNIQUE KEY uq_player_item_bag_import_stack_baseline_item(player_item_bag_import_completeness_projection_id,item_id),
  CONSTRAINT fk_player_item_bag_import_stack_baseline_projection FOREIGN KEY(player_item_bag_import_completeness_projection_id) REFERENCES player_item_bag_import_completeness_projections(player_item_bag_import_completeness_projection_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_stack_baseline_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_stack_baseline_item FOREIGN KEY(item_id) REFERENCES canonical_item_definitions(item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_stack_baseline_stack FOREIGN KEY(owned_item_stack_id) REFERENCES canonical_owned_item_stacks(owned_item_stack_id) ON DELETE RESTRICT,
  CONSTRAINT chk_player_item_bag_import_stack_baseline_fingerprint CHECK(stack_entry_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_item_bag_import_stack_baseline_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_player_item_bag_import_stack_baseline_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_item_bag_import_ledger_baselines (
  player_item_bag_import_ledger_baseline_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_item_bag_import_completeness_projection_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_inventory_ledger_entry_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_inventory_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ledger_sequence BIGINT UNSIGNED NOT NULL,
  item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_item_stack_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  owned_item_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  quantity_delta BIGINT NOT NULL,
  reason_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ledger_entry_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY(player_item_bag_import_ledger_baseline_id),
  UNIQUE KEY uq_player_item_bag_import_ledger_baseline_entry(player_item_bag_import_completeness_projection_id,item_inventory_ledger_entry_id),
  UNIQUE KEY uq_player_item_bag_import_ledger_baseline_sequence(player_item_bag_import_completeness_projection_id,ledger_sequence),
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_projection FOREIGN KEY(player_item_bag_import_completeness_projection_id) REFERENCES player_item_bag_import_completeness_projections(player_item_bag_import_completeness_projection_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_player FOREIGN KEY(player_id) REFERENCES canonical_players(player_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_ordering FOREIGN KEY(item_inventory_ledger_entry_id,player_id,ledger_sequence) REFERENCES canonical_item_inventory_ledger_orderings(item_inventory_ledger_entry_id,player_id,ledger_sequence) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_operation FOREIGN KEY(item_inventory_operation_id) REFERENCES canonical_item_inventory_operations(item_inventory_operation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_item FOREIGN KEY(item_id) REFERENCES canonical_item_definitions(item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_stack FOREIGN KEY(owned_item_stack_id) REFERENCES canonical_owned_item_stacks(owned_item_stack_id) ON DELETE RESTRICT,
  CONSTRAINT fk_player_item_bag_import_ledger_baseline_instance FOREIGN KEY(owned_item_id) REFERENCES canonical_owned_item_instances(owned_item_id) ON DELETE RESTRICT,
  CONSTRAINT chk_player_item_bag_import_ledger_baseline_sequence CHECK(ledger_sequence>=1),
  CONSTRAINT chk_player_item_bag_import_ledger_baseline_target CHECK((owned_item_stack_id IS NULL) <> (owned_item_id IS NULL)),
  CONSTRAINT chk_player_item_bag_import_ledger_baseline_fingerprint CHECK(ledger_entry_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_player_item_bag_import_ledger_baseline_insert_time CHECK(INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_player_item_bag_import_ledger_baseline_update_time CHECK(UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
