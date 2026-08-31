START TRANSACTION;

INSERT INTO admin_permissions(code,display_name)
VALUES('pet_explore.event.control','펫탐험·길드레이드 이벤트 제어')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet_explore.event.control' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_EXPLORE_EVENT_CONTROL','pet_explore_event_control','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/펫탐험이벤트활성화','PET_EXPLORE_EVENT_CONTROL',TRUE),
  ('/펫탐험이벤트비활성화','PET_EXPLORE_EVENT_CONTROL',TRUE),
  ('/레이드이벤트활성화','PET_EXPLORE_EVENT_CONTROL',TRUE),
  ('/레이드이벤트비활성화','PET_EXPLORE_EVENT_CONTROL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
