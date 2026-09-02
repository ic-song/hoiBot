# 자산 도메인 인스턴스 참조 교정

WBS 721은 보유 가구와 미니펫의 표시명을 definition identity로 오인하지 않도록 참조 규칙을 교정한다.

- 가구는 bag의 `exp`를 기존 canonical `charmValue`와 대조한다. 확률성 `rate`는 definition identity로 사용하지 않는다.
- 미니펫은 기존 package item catalog의 `grade`, `emoji`, `battleExp`, `castleExp`, `raidExp`로 legacy stat signature를 만든다.
- 사용자 지정 미니펫 이름이 canonical 표시명과 달라도 signature가 유일하면 연결할 수 있다.
- signature가 없거나 일치하지 않으면 표시명만으로 병합하지 않고 orphan으로 차단한다.
- 가구 draw weight, 보유 instance, 배치 projection, 미니펫 ownership과 ledger는 변경하지 않는다.

## 결과

- domain instance gap 115,675 occurrences 중 56,450건을 기존 정의에 유일하게 연결했다.
- domain ambiguity는 199 identity에서 0건으로 감소했다.
- 남은 domain orphan은 가구 691 identity/44,934 occurrences, 미니펫 412/14,267, 스킬 1/24다.
- 남은 59,225 occurrences는 definition을 추측할 수 없어 후속 import quarantine 대상으로 유지한다.
- 전체 resolved는 1,395,208건이며 `DATA-MIGRATION-READY=false`를 유지한다.

격리 MariaDB의 migration 429개 baseline을 그대로 사용했고 schema·provider·운영 데이터 변경은 없다. 컨테이너 재시작 후 canonical core와 공개 classification이 동일했다.
