DELIMITER $$
CREATE PROCEDURE rollback_489_legacy_rank_label_side_effect_certificate()
BEGIN
  IF EXISTS(SELECT 1 FROM legacy_rank_label_side_effect_certificates)
    OR EXISTS(SELECT 1 FROM legacy_rank_label_validation_runs) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_489_DATA_PRESENT';
  END IF;
  DROP TABLE IF EXISTS legacy_rank_label_side_effect_certificates;
  DROP TABLE IF EXISTS legacy_rank_label_validation_runs;
END$$
DELIMITER ;
CALL rollback_489_legacy_rank_label_side_effect_certificate();
DROP PROCEDURE rollback_489_legacy_rank_label_side_effect_certificate;
