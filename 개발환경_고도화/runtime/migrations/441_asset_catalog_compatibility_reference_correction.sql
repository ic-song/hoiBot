SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO support_pass_definitions(pass_code,display_name,active)
VALUES('territory','영지패스',TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE;

COMMIT;
