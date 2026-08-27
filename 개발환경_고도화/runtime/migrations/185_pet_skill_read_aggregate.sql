START TRANSACTION;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/펫스킬확률','PET_SKILL_READ',1),
('/펫스킬정보','PET_SKILL_READ',1),
('/펫스킬정보 [조회값]','PET_SKILL_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
