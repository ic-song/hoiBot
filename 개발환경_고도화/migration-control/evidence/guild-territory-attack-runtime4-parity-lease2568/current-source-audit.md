# WBS756 /영지공격 runtime4 현행 감사

## 경계

- baseline: `a397e2dc6cb810404efc812ab0c4ee33c43b369b`
- 선행 감사: commit `3b3bdb33`, `item25-raid-territory-source-audit-lease2562-2563`
- legacy authority: `main.js:31301-31314`, `31462-31594`, 외부 흐름 `14028-14385`
- `main.js` SHA-256: `91bd1c772aeb0979359ff2af86320850b77a738c1ddee295ae843ca5bcb10495`

## 확정 비교

| 의미 | legacy `/영지공격` | 기존 DB service | WBS756 |
| --- | --- | --- | --- |
| 방어 후보 | 50% → 20% | 20% 한 개 | 50% → 20% |
| 공격 후보 | 40% → 10% | 10% 한 개 | 40% → 10% |
| 후보 선택 | 보유 중 첫 후보 하나 | 단일 후보 | 보유 중 첫 후보 하나 |
| item 비교 | `Math.random() <= rate` | `draw < bps` | `drawBps <= thresholdBps` |
| item 차감 | item roll 성공 뒤 | item roll 전 | item roll 성공 뒤 |
| 방어/공격 순서 | 방어 선판정 후 공격 | 동일 | 동일 |
| cube 비교 | 공격권 차감 뒤 strict `<` | 동일 상대 순서 | 동일, 환불 없음 |
| fallback | item 미발동 뒤 일반 snapshot 전투 | 동일 | 동일 |
| 외부 완료 순서 | 결과/균열/턴 → 응답 → guild/member 저장 → 다음 안내 | transaction 결과→outbox→audit→receipt | 기존 DB 순서 유지 |

## provenance 경계

- `castlePremiumItem` 여섯 행은 90/60/20 공격과 80/50/25 방어의 독립 metadata다.
- runtime4는 `main.js` 인라인 40/10 공격과 50/20 방어다. 여섯 행을 runtime4로 매핑하거나 확률을 덮어쓰지 않았다.
- migration478의 `item_id`는 표준 canonical PK인 `canonical_item_definitions.item_id`를 정확 동명·동형으로 참조한다.
- runtime service는 `canonical_item_definition_imports`의 `RUNTIME_DB/item_definitions/source_identifier` crosswalk로 기존 legacy definition을 찾고, canonical/legacy 표시명이 정확히 같을 때만 기존 inventory stack을 사용한다. 임의 identity 추론이나 legacy `id` 직접 FK는 없다.
- 우선순위·성공 bps·source locator는 candidate 정책 행만 권위다. canonical item `definition_options`에는 도메인 분류만 저장해 정책값을 복제하지 않는다.
- 단일 `GuildTerritoryAttackService.attack` 경계가 provider를 먼저 멱등 ensure한다. SHADOW는 attack을 호출하지 않아 provisioning mutation도 발생하지 않는다.
- migration `353` SHA-256 `04469e6d5eee4c86bab6e6d658925c4d0e2cd302f477f6b97ae5f79ca5f73126` 및 migration `387` SHA-256 `0ffa69a663d7a7a046dbffb12c4971aa126f95b236e3f91a4cd3353267cbfe3c`은 변경하지 않았다.

## 탐색 기록

- index-first: `COMMAND_INDEX.md` `/영지공격` section.
- source keywords: `/영지공격`, `resolveGuildTerritoryAttack`, `getGuildTerritorySpecialItem`, 네 runtime 표시명, `consumeItem`, `persistDraw`, `guild_territory_attack_policy_versions`.
- 확인 파일: `main.js`, migration 212/353/387/401/444, canonical item repository, 기존 guild territory attack service와 unit/Maria/resilience tests.
- 불확실성: `castlePremiumItem` 여섯 행과 runtime4의 identity 등가는 확인되지 않았으며 이 작업에서 추론하지 않는다. Gate8/운영 활성화는 범위 밖이다.
