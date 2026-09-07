DROP PROCEDURE IF EXISTS rollback_485_pet_skill_info_admin_bag_projection;

DELIMITER //
CREATE PROCEDURE rollback_485_pet_skill_info_admin_bag_projection()
BEGIN
  IF EXISTS(SELECT 1 FROM player_pet_skill_bag_import_completeness_projections)
    OR EXISTS(SELECT 1 FROM player_pet_skill_rank_marker_projections)
    OR EXISTS(SELECT 1 FROM pet_skill_info_admin_channel_authorities) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_485_PROJECTION_ROWS_EXIST';
  END IF;
  DROP TABLE IF EXISTS player_pet_skill_bag_import_completeness_projections;
  DROP TABLE IF EXISTS player_pet_skill_rank_marker_projections;
  DROP TABLE IF EXISTS pet_skill_info_admin_channel_authorities;
END//
DELIMITER ;

CALL rollback_485_pet_skill_info_admin_bag_projection();
DROP PROCEDURE IF EXISTS rollback_485_pet_skill_info_admin_bag_projection;
