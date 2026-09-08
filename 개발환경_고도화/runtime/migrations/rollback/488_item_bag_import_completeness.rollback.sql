DROP PROCEDURE IF EXISTS rollback_488_item_bag_import_completeness;

DELIMITER //
CREATE PROCEDURE rollback_488_item_bag_import_completeness()
BEGIN
  IF EXISTS(SELECT 1 FROM player_item_bag_import_completeness_projections) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_488_PROJECTION_ROWS_EXIST';
  END IF;
  DROP TABLE IF EXISTS player_item_bag_import_completeness_projections;
END//
DELIMITER ;

CALL rollback_488_item_bag_import_completeness();
DROP PROCEDURE IF EXISTS rollback_488_item_bag_import_completeness;
