# Wave12 현행 조사

- DIRECT 대상은 `/글자수통계`의 `admin-command-96dcd3753578c56c` 한 건이다.
- 실제 경로는 `buildApp().inject` Iris HTTP → token/normalize → 운영 채널 → inbox → partial dispatch → `CharacterCountStatsService` → outbox callback이다.
- 독립 oracle은 15개 물리 JSON 원문과 펜던트 projection을 UTF-16 code unit 기준으로 계산한다.
- `/맞짱시간체크`는 `checkRank` 전체 장식과 실제 공통/세부 시간 측정 동등성이 아직 고정되지 않아 DIRECT 승격하지 않았다.
- `/상태전체`는 production `sharedTransientCommandStateStore` writer가 없으므로 `LEGACY_ONLY`를 유지한다.
- 외부 네트워크, 실제 방, 운영 DB와 운영 데이터는 사용하지 않았다.
