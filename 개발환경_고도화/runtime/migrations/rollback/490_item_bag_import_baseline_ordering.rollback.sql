DROP PROCEDURE IF EXISTS rollback_490_item_bag_import_baseline_ordering;

DELIMITER //
CREATE PROCEDURE rollback_490_item_bag_import_baseline_ordering()
BEGIN
  IF EXISTS(SELECT 1 FROM player_item_bag_import_stack_baselines) OR EXISTS(SELECT 1 FROM player_item_bag_import_ledger_baselines) OR EXISTS(SELECT 1 FROM player_item_bag_import_completeness_projections) OR EXISTS(SELECT 1 FROM canonical_item_inventory_ledger_entries) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_490_SEQUENCE_EVIDENCE_EXISTS';
  END IF;
  DROP TRIGGER IF EXISTS trg_item_inventory_ledger_order_after_insert;
  DROP TABLE IF EXISTS player_item_bag_import_ledger_baselines;
  DROP TABLE IF EXISTS player_item_bag_import_stack_baselines;
  DROP TABLE IF EXISTS canonical_item_inventory_ledger_orderings;
  DROP TABLE IF EXISTS canonical_item_inventory_ledger_heads;
  ALTER TABLE player_item_bag_import_completeness_projections DROP CONSTRAINT chk_player_item_bag_import_completeness_ledger_head;
  ALTER TABLE player_item_bag_import_completeness_projections DROP COLUMN baseline_ledger_head_sequence;
  ALTER TABLE canonical_item_inventory_ledger_entries DROP KEY uq_canonical_item_inventory_ledger_entry_player;
END//
DELIMITER ;

CALL rollback_490_item_bag_import_baseline_ordering();
DROP PROCEDURE IF EXISTS rollback_490_item_bag_import_baseline_ordering;
