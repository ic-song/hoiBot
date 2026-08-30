# 관리자 확률·수치 읽기 모델

## 범위

- WBS: 637
- DB 매핑: 1915
- Lease: 2418
- 실행 ID: `개발자-SL-COMMON-ADMIN-BALANCE-READ-MODEL-01-20260831T0910`
- 기준선: `497457451803943be852b0f75173fe97127678d1`

## 승인된 읽기 소스

1. 홈뱃지: 현재 `shadow` 상태인 `home_badge_definition_versions`와 그 버전의 `home_badge_definitions.criteria_json`
2. 가구: 현재 활성 `home_furniture_draw_catalog_versions`와 그 버전의 `home_furniture_draw_grade_bands`
3. 펜던트: `PendantPolicyCatalogReadProvider`가 반환하는 현재 published 정책

세 소스 모두 이미 버전과 출처 해시를 가진 canonical provider입니다. 읽기 모델은 새 schema나 복제 테이블을 만들지 않고 해당 버전 값을 projection에 그대로 보존합니다.

## Projection 계약

각 수치 항목은 다음 필드를 항상 제공합니다.

- `domain`, `key`, `group`, `sumGroup`
- `label`, `value`, `unit`
- `min`, `max`, `step`
- `version`, `editable`, `source`

정수와 소수는 JavaScript `number`로 변환하지 않고 문자열로 전달합니다. 가구 확률은 catalog의 `weight_scaled / rate_scale`을 정확한 십진 문자열로 변환하며 같은 `sumGroup`으로 합계 제약을 표시합니다. 가구 등급별 항목 수는 파생 정보이므로 `editable=false`입니다.

## 실패 경계

- 홈뱃지 조건이 승인되지 않은 키 또는 안전한 0 이상 정수가 아니면 읽기를 중단합니다.
- 가구 등급 확률 합계가 catalog `rate_scale`과 다르면 읽기를 중단합니다.
- 펜던트 published 정책이 없거나 30단계가 아니면 기존 provider가 읽기를 중단합니다.

## 제외 범위

- schema와 migration
- 변경·롤백 provider 및 변경 UI
- WBS638, WBS639
- wallet RNG, luck pouch, `main.js`, 회원 `lightningRate`
- 운영 DB, `feature/prod`, Gate8
