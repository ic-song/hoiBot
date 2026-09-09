# WBS783 Wave19 시나리오

- 소비자: `runtime-dispatch-79ff58fea52c7457`
- source: `개발환경_고도화/runtime/src/app.ts`
- symbol/guard: `handlerKey=PACKAGE_CATALOG_WIZARD_STATUS`
- 실제 경로: `buildApp` → exact `/패키지추가상태` dispatch → `PackageCatalogAddWizardIrisHandler.execute` → `PackageCatalogAddWizardService.execute` → MariaDB read repository
- `READ_POSITIVE`: 활성 합성 draft를 읽어 상태 메시지를 생성한다.
- `NEGATIVE_GUARD`: `/패키지추가상태 안내`는 exact guard에서 제외되고 마법사 repository를 조회하지 않는다.
- `EXACT_OUTPUT`: 한글·이모지·`다이아상자💎(/다이아상자오픈)`·64-bit 수량 표시를 바이트 동일하게 검증한다.
- `SOURCE_DOMAIN_DML_ZERO`: 패키지 정의·보상·마법사 상태/결과·head 테이블 DML이 0건임을 검증한다.
- `RESTART_CONSISTENCY`: 서로 다른 Node child PID와 module execution ID에서 결과가 동일함을 검증한다.

합성 DB와 주입된 reply callback만 사용했으며 외부 네트워크, 운영 DB/JSON, 실운영방은 사용하지 않았다.
