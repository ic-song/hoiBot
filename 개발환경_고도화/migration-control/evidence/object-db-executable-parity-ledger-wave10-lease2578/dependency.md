# Wave10 의존성

- 기준: `e0db3b30af49d8f57b55d1009dc571cf0307919f`
- source provenance: `91e266f03b170baaa1d5ca80ebbac305796514af`
- 공용 runner: Wave8 격리 child-process harness
- 실제 코드: `app.ts`, `event-processing-service.ts`, `command-dispatcher.ts`, 세 펜던트 서비스
- 시험 DB는 선택적 3330 격리 환경만 허용하며 3306/운영 DB는 사용하지 않는다.
- migration, provider, `main.js`, `Info.js`, `data/*`, `feature/prod`는 변경하지 않는다.
