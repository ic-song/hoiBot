# Wave10 의존성

- 기준: `e0db3b30af49d8f57b55d1009dc571cf0307919f`
- source provenance: `91e266f03b170baaa1d5ca80ebbac305796514af`
- corrected provenance: `bcaedf23af156cb4d26f3983d2e7eca15ed573e2`
- actual HTTP provenance: `4e3d5588dd16230e4b8800e33c2a097c5582436c`
- timeout correction provenance: `925b96a6e92e330b657a2e892c4c0f2c627768f0`
- operational negative-guard provenance: `0989c1b2132ad35682eac73925be96fcc4297964`
- Wave10 전용 runner: 실제 `buildApp().inject`와 주입된 in-memory DB/callback stub. Wave8 공용 harness는 변경하지 않았다.
- 실제 코드: `app.ts`, `event-processing-service.ts`, `command-dispatcher.ts`, 세 펜던트 서비스
- 시험 DB는 선택적 3330 격리 환경만 허용하며 3306/운영 DB는 사용하지 않는다.
- migration, provider, `main.js`, `Info.js`, `data/*`, `feature/prod`는 변경하지 않는다.
