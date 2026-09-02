# 자산 카탈로그 호환성 참조 교정

WBS 722는 WBS 718의 `CATALOG_COMPATIBILITY` lane을 기존 자산 정의와 source binding만으로 닫는다. 새로운 범용 자산 테이블이나 provider는 만들지 않는다.

- package source 정의 107건과 runtime package 정의 60건을 stable package ID 기준으로 투영했다.
- 서로 다른 ID는 표시명이 같아도 병합하지 않아 최종 package definition은 166건이다.
- 기존 `support_pass_definitions`에 동결 목록의 누락 항목 `territory` 1건을 추가해 pass 정의 7건을 맞췄다.
- package ID와 package name은 하나의 composite reference로 읽어 중복 참조를 만들지 않는다.
- exact key가 canonical에 없으면 같은 타입 전체를 ambiguous 후보로 남기지 않고 orphan으로 차단한다.
- 이벤트 상태값이나 일반 문자열은 id/code/key 의미 필드가 아니면 자산 참조로 추출하지 않는다.

## 결과

- canonical object 4,821건, registry object 4,648건, binding 6,728건
- payload 753파일, 참조 2,077,609건, distinct reference 7,611건
- resolved 1,338,758건, orphan 567,645건, ambiguous 131,818건, inactive 39,388건
- 전체 gap identity 5,618건, occurrence 738,851건
- `CATALOG_COMPATIBILITY`: identity 0건, occurrence 0건
- 남은 lane: bag item 3,306건, title ownership 2,035건, domain instance 277건
- `DATA-MIGRATION-READY=false`는 남은 세 lane 때문에 그대로 유지한다.

격리 MariaDB에서 전체 migration 429개를 fresh replay하고 컨테이너 재시작·재접속 후 같은 canonical core SHA-256을 확인했다. private exact crosswalk는 TEMP에만 유지한다.
