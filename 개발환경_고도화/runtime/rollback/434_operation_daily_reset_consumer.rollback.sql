START TRANSACTION;

DELETE FROM command_aliases WHERE command_text='/리셋' AND command_code='OPERATION_DAILY_RESET';
DELETE FROM command_registry WHERE command_code='OPERATION_DAILY_RESET';
DELETE FROM admin_role_permissions WHERE permission_code='operation.daily_reset';
DELETE FROM admin_permissions WHERE code='operation.daily_reset';

COMMIT;
