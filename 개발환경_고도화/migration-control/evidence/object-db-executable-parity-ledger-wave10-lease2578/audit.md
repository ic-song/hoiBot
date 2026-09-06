# Wave10 현행 조사

- 대상: `pendant_market_info`, `pendant_info_read`, `pendant_probability_read`
- 경로: Iris HTTP event → inbox/normalize → app outer gates → partial dispatch → `CommandDispatcher` → 실제 펜던트 서비스 transaction/outbox → `processing.replies`
- 외부 sender/network 전 단계에서 종료한다.
- 사용자 보이는 명령: `/펜던트거래정보 [번호]`, `/펜던트정보 [번호]`, `/펜던트확률`
- 저장 흐름은 MariaDB operation/outbox/execution/audit이며 Rhino `main.js`, `Info.js`, `data/*`는 불변이다.
- 미확인 부재는 선언하지 않았다. 관련 app branch와 실제 서비스 SQL을 재검증했다.

## 확인 위험

- 상세 매력·탐험 및 강화 수치가 서비스 상수에 하드코딩되어 카탈로그와 어긋날 수 있다.
- 확률 조회가 기존 `item_definitions.code`에 의존한다. 적용 완료 migration/provider는 수정하지 않았다.
- eventId만 멱등성 키이므로 payload·destination 변경도 저장 결과를 재사용한다.
- 서비스는 재시도 정책 없이 `FOR UPDATE`를 사용한다.
