# Wave13 `/서버통계` 보정 출처

- Run ID: `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE13-202609070746`
- Lease: `2581`
- 대상 consumer: `admin-command-5e04d0767d4c2abc`
- 실제 경로: `buildApp().inject` Iris HTTP → token/normalize → 운영 채널 → inbox → partial dispatch → `ServerStatsService` → outbox delivery callback
- 독립 oracle: `Info.js`의 전체 `data.member` key 집합에서 비어 있지 않은 `member.server`만 서버별 집계한다. 회원 자체가 0명이면 `📭 등록된 유저가 없습니다.`를 반환하며, 회원은 있으나 서버가 없으면 전체 0명과 미등록 인원을 표시한다.
- 출력 고정: `📊 서버유저 통계 📊`, `서버 전체인원`, U+200B 500개 뒤 `가능 서버:`, `- 이름: n명`, 선택적 미등록 안내를 원문 byte로 비교한다.
- 환경·재실행: 주입된 `prod`/`dev` 및 환경·event·message·actor·channel·destination fingerprint를 사용한다.
- 보안 차이: 현대 경로는 레거시보다 강한 `stats.server.read` 활성 역할 권한을 요구하며 deny override가 항상 우선한다. 권한 확인과 원본 snapshot 잠금은 같은 transaction이다.
- 원본 보호: `legacy_snapshot_environments`, `legacy_snapshot_sets`, `legacy_source_snapshots`에는 SELECT/lock만 허용하며 세 테이블 DML allowlist negative를 fail-closed로 검증한다.
- 기존 Wave8 서버 통계 영수증은 당시 직접 서비스 호출과 canonical 집계를 기록한 역사 자료로 보존한다. `AUTH_DENIED`를 포함한 Wave13 실제 ingress 보정 영수증 6개가 모두 유효하지 않으면 이 consumer의 현행 DIRECT 근거로 사용할 수 없다.
- 외부 네트워크 0, 실제 방 0, 운영 DB/운영 데이터 0이다.
