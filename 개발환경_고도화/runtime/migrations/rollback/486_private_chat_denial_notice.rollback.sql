DROP PROCEDURE IF EXISTS rollback_486_private_chat_denial_notice;

DELIMITER //
CREATE PROCEDURE rollback_486_private_chat_denial_notice()
BEGIN
  IF EXISTS(SELECT 1 FROM private_chat_denial_attempts)
    OR EXISTS(SELECT 1 FROM private_chat_denial_notification_channels)
    OR EXISTS(SELECT 1 FROM private_chat_denial_counters) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_486_PRIVATE_CHAT_DENIAL_ROWS_EXIST';
  END IF;
  DROP TABLE IF EXISTS private_chat_denial_attempts;
  DROP TABLE IF EXISTS private_chat_denial_notification_channels;
  DROP TABLE IF EXISTS private_chat_denial_counters;
END//
DELIMITER ;

CALL rollback_486_private_chat_denial_notice();
DROP PROCEDURE IF EXISTS rollback_486_private_chat_denial_notice;
