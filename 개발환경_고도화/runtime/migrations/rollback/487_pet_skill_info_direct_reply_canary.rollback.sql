DROP PROCEDURE IF EXISTS rollback_487_pet_skill_info_direct_reply_canary;

DELIMITER //
CREATE PROCEDURE rollback_487_pet_skill_info_direct_reply_canary()
BEGIN
  IF (SELECT COUNT(*) FROM command_registry WHERE command_code='PET_SKILL_INFO')<>1
    OR NOT EXISTS (
      SELECT 1 FROM command_registry
      WHERE command_code='PET_SKILL_INFO'
        AND handler_key='pet_skill_info'
        AND auth_scope='VERIFIED_USER'
        AND enabled=TRUE
        AND version=2
        AND rollout_state='CANARY'
    ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_487_COMMAND_REGISTRY_DRIFT';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='command_routing_decisions'
        AND COLUMN_NAME='event_id'
        AND COLUMN_TYPE='varchar(128)'
        AND IS_NULLABLE='NO'
        AND CHARACTER_SET_NAME='utf8mb4'
        AND COLLATION_NAME='utf8mb4_unicode_ci'
    ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_487_EVENT_ID_SCHEMA_DRIFT';
  END IF;
  IF EXISTS (
      SELECT 1 FROM command_routing_decisions
      WHERE CHAR_LENGTH(event_id)>100
    ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_487_EVENT_ID_TOO_LONG';
  END IF;

  UPDATE command_registry
  SET rollout_state='SHADOW',version=1
  WHERE command_code='PET_SKILL_INFO'
    AND handler_key='pet_skill_info'
    AND auth_scope='VERIFIED_USER'
    AND enabled=TRUE
    AND version=2
    AND rollout_state='CANARY';
  IF ROW_COUNT()<>1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_487_COMMAND_REGISTRY_CONFLICT';
  END IF;

  ALTER TABLE command_routing_decisions
    MODIFY COLUMN event_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
END//
DELIMITER ;

CALL rollback_487_pet_skill_info_direct_reply_canary();
DROP PROCEDURE IF EXISTS rollback_487_pet_skill_info_direct_reply_canary;
