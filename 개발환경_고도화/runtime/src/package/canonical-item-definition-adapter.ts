// 패키지 STACK 정의를 canonical item_definitions와 호환 계층으로 결합합니다.
export const CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT = `
  SELECT compatibility.item_id,
         compatibility.item_type,
         CASE
           WHEN compatibility.item_type = 'STACK'
             THEN COALESCE(canonical.display_name, compatibility.item_name)
           ELSE compatibility.item_name
         END AS item_name,
         CASE
           WHEN compatibility.item_type = 'STACK'
             THEN COALESCE(canonical.stackable, compatibility.stackable)
           ELSE compatibility.stackable
         END AS stackable,
         compatibility.metadata_json,
         CASE
           WHEN compatibility.item_type = 'STACK'
             THEN compatibility.enabled = 1
              AND canonical.id IS NOT NULL
              AND canonical.active = 1
           ELSE compatibility.enabled
         END AS enabled
    FROM package_item_definitions compatibility
    LEFT JOIN item_definitions canonical
      ON canonical.code = compatibility.item_id
`;
