# 자산 마이그레이션 참조 gap crosswalk

WBS 718은 WBS 689가 차단한 5,737개 gap identity를 private exact crosswalk로 대조하고, 공개 증거에는 원문 없이 네 corrective lane만 남긴다.

- `LEGACY_BAG_ITEM`: 3,306 identity, 256,327 occurrences
- `LEGACY_TITLE_OWNERSHIP`: 2,035 identity, 366,849 occurrences
- `DOMAIN_INSTANCE_IDENTITY`: 278 identity, 115,830 occurrences
- `CATALOG_COMPATIBILITY`: 118 identity, 24,098 occurrences

## 동결 원칙

- 같은 표시명만으로 canonical definition을 만들거나 합치지 않는다.
- 사용자 보유 title은 definition seed와 ownership instance를 분리한다.
- bag item은 source-backed definition, instance metadata, 동적 표시명을 구분한 뒤 교정한다.
- furniture와 mini-pet은 grade·visual·source identity를 함께 사용한다.
- package name은 package ID companion 여부를 확인하고 독립 orphan으로 자동 seed하지 않는다.
- badge·pass·package compatibility는 기존 canonical provider와 source binding을 재사용한다.
- private crosswalk는 TEMP 밖으로 내보내지 않고 Git에는 classification 집계와 해시만 저장한다.

후속 구현은 네 개의 독립 슬라이스와 Lease로 분리하며, WBS690 MariaDB dry-run은 네 레인이 모두 닫히고 WBS689 재판정이 TRUE가 될 때까지 대기한다.
