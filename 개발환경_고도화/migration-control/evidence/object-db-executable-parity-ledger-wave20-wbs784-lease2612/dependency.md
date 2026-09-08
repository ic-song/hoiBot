# WBS784 / Lease2612 의존성 및 provenance

- 실행 ID: `패키지가져오기DB-SL-PACKAGE-IMPORT-MUTATION-PARITY-01-20260909004005`
- consumer: `sql-repository-b1d650b73c2ddff0`
- 실제 메서드: `MariaCanonicalPackageRewardRepository.importDefinition`
- evidence commit: `8263cac1c70ac0fef210df3f31545bc094607787`
- 기준 commit: `78f3740e1eff758cf5bd36ce4b098e92985a58cf`
- source 전체 SHA-256: `d67175877028c27fbae2f84185ee6e316fa104477fb799f3b96532dd1ae40fd5`
- manifest span: `7848..8601`, SHA-256 `7a89387dd6499a0fc01ac0b186301ef23e3fffe8ec5dbd391b2d3aa4ee2828e0`

## 최소 스키마 폐쇄

| 파일 | 정규화 SHA-256 |
| --- | --- |
| `443_object_identity_audit_provider.sql` | `d57d19f15e9c684d7c360c8bd47358937d118cfda0485ead5c1bc61fce058be8` |
| `444_canonical_item_inventory.sql` | `0f09374fd40b49e1c5235f702d33b23bb892beb829d82fc0d6a6a526da267a51` |
| `451_canonical_package_reward.sql` | `e4bb589847627487591207d41965273818b6b29eeda37cc4443677de39040cc6` |

적용 순서는 `443 → 444 → 451`입니다. 451의 외부 FK는 444의 `canonical_item_definitions(item_id)`이고, FK 검사는 비활성화하지 않았습니다. 이 실행은 해당 consumer의 identity/item/package transaction을 위한 targeted proof입니다. 전체 최신 schema fresh-apply 증거를 대체하지 않으며, 전체 schema 근거는 WBS782 Lease2610의 `object-db-shadow-gate5-v4-wbs782-lease2610/validation.md`를 인용합니다. 그 기준 commit `7f38cf28488e5ce313b94f1509a4e6d48c018ea5`는 현재 evidence commit의 ancestor입니다.

추가 결박 SHA-256: `database.ts=456e115704a867570413057926551c54102498c550a435769d2e32421382a54a`, `object-identity-audit-provider.ts=00772c77c93f5453e56b9b813fc2fe412fb50a12ba68793cab463d1e865d6b8b`, `maria-database-error-policy.ts=9a6bb0195e169a6831e35841ef1cce33139299182ad57e659914404bc35b4b82`, manifest=`dfe3273a722703a7837eaaf27780eb23bfccffc58bceee321964ffc978e6bd02`.
