# 데이터 마이그레이션 자산 참조 검증

WBS 689는 WBS 688의 private staging과 WBS 683·684·717의 canonical object catalog를 읽기 전용으로 대조한다.

- 일반 가방 key는 `ITEM` source binding으로 해석한다.
- 가구·미니펫·펜던트는 stable key 또는 표시명과 등급·visual의 exact 조합으로 해석한다.
- 배지·칭호·펫스킬·패스·패키지는 object type을 고정하고 stable key/source binding을 우선한다.
- 표시명만 같은 복수 후보는 자동 병합하지 않고 `AMBIGUOUS`로 격리한다.
- 원본 경로, 회원명과 자산 표시명은 결과에 쓰지 않고 location/identity SHA-256만 남긴다.
- canonical snapshot과 검증 report는 private 임시 경로에 저장하며 Git에 포함하지 않는다.
- 검증기는 DB와 원본 데이터를 변경하지 않는다.

## 검증 결과

- private staging 753개에서 자산 참조 2,100,820건, 고유 identity 7,613건을 추출했다.
- canonical object 4,648개와 source binding 6,554개를 대조했다.
- 해소 1,337,716건, orphan 569,004건, ambiguous 154,712건, inactive 39,388건이다.
- canonical duplicate와 object-key collision은 모두 0건이다.
- title scope, 일반 item, pass, furniture compatibility 후보가 주요 후속 gap이다.
- `DATA-MIGRATION-READY=false`는 검증 실패가 아니라 실제 gap을 차단한 결과다.
- fresh MariaDB migration 428개, rollback/replay, restart/reconnect, 동일 canonical/report hash를 확인했다.
- focused 6/6, root regression 28/28, modernization regression 1,572 pass/0 fail/8 skip, typecheck와 build가 통과했다.

Gate 1~7은 검증기 구현과 차단 계약에 대해 완료하며, 실제 운영 이관과 Gate 8은 gap 교정 후 별도 승인까지 보류한다.
