START TRANSACTION;

DELETE level_row
FROM pendant_upgrade_policy_levels level_row
JOIN pendant_upgrade_policy_versions version_row ON version_row.id=level_row.policy_id
WHERE version_row.policy_code='PENDANT_ENHANCE_LEGACY'
  AND version_row.policy_version=1
  AND version_row.source_hash='36216a87775f725b7e5b8bb0b8f0f148c4648e6bcb7b5fb76259c61869d90a18';

DELETE FROM pendant_upgrade_policy_versions
WHERE policy_code='PENDANT_ENHANCE_LEGACY'
  AND policy_version=1
  AND source_hash='36216a87775f725b7e5b8bb0b8f0f148c4648e6bcb7b5fb76259c61869d90a18';

COMMIT;
