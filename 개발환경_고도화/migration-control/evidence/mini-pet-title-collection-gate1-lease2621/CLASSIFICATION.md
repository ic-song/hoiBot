# MINI_PET_TITLE_COLLECTION Gate 1 분류

- 작업: WBS793 / Lease2621
- 기준 커밋: `d99832c56972c7ff81fbe7a075fc65869a7192bf`
- 상태: `GATE1_CLASSIFIED`
- 범위: manifest의 `MINI-PET-TITLE-COLLECTION` 15개 중 기존 `DIRECT_PASS`인 `mini-pet.listOwned` 1개를 제외한 14개
- 금지 범위: 공용 ledger 변경, receipt 승격, 운영 DB/3306/운영 데이터/실방/network, feature/prod

## 고정 consumer

| consumer ID | 역할 | 접근 | 권한/소유자 |
|---|---|---|---|
| `legacy-52a2111d587077dc` | 컬렉션 등록 확정 | READ_WRITE | self / collection confirm root |
| `legacy-65bdcd5c86aaa184` | 타이틀 판매 | READ_WRITE | self / sale root |
| `legacy-6a42c658dfc99e35` | 컬렉션 순위+legacy 정규화 | READ_WRITE | public read / 별도 maintenance repair |
| `legacy-7e211a21f6194155` | 대기 등록 취소 | READ | self session / DB transaction 없음 |
| `legacy-ae36b9a9e188508d` | 컬렉션 조회+legacy 정규화 | READ_WRITE | self read / 별도 maintenance repair |
| `legacy-bd75d0cfdb9f6dcb` | 보유 타이틀 목록 | READ | self / read-only |
| `legacy-c085f3fbcbe62bb3` | 타이틀 선택 | READ_WRITE | self / select root |
| `legacy-cb9358f157d74d5e` | 관리자 타이틀 추가 | READ_WRITE | master-only silent deny / grant root |
| `legacy-ed6659b495a1d419` | 관리자 타이틀 제거 | READ_WRITE | master-only silent deny / remove root |
| `sql-repository-099449f24cdb2763` | `mini-pet.grant` | READ_WRITE | repository root 또는 composite participant |
| `sql-repository-649707c7a4a4b178` | `mini-pet.registerDefinition` | READ_WRITE | 별도 catalog replay root 계획 |
| `sql-repository-81ba01f732909dc7` | `mini-pet.updateDefinition` | READ_WRITE | 별도 catalog replay root 계획 |
| `sql-repository-c5361160b1d4362b` | `mini-pet.release` | READ_WRITE | repository root 또는 composite participant |
| `sql-repository-fd6a78de68e8f580` | `mini-pet.select` | READ_WRITE | repository root |

`legacy-a63d581be22c019d`(`/컬렉션등록`)은 `MINI-PET` 소유 consumer라 14개에는 포함하지 않았다. 다만 컬렉션 확정의 입력 준비 단계이므로 composite graph의 외부 선행 consumer로 고정했다.

## 결정

- `/미니펫타이틀추가`, `/미니펫타이틀제거`는 실제 guard와 동일하게 `isMaster(sender)`만 허용하며 거부 시 응답하지 않는다.
- player 소유권 mutation만 `canonical_mini_pet_title_operations`가 replay receipt를 소유한다. 관리자 교차 사용자 작업은 participant에 `OWNER`, `RECIPIENT`를 기록한다.
- 전역 definition register/update는 `player_id NOT NULL`인 소유권 receipt를 사용할 수 없다. `canonical_package_definition_replays` 패턴의 별도 `canonical_mini_pet_title_definition_replays`를 신규 additive migration으로 만드는 계획만 고정했으며, 구현 완료로 간주하지 않는다.
- canonical 컬렉션 조회/공개 순위는 순수 READ다. legacy sanitize 저장은 ingress에서 제거하고 별도 non-player maintenance/import receipt가 승인된 뒤 독립 실행한다.
- 판매는 title release와 point credit을 한 root transaction으로 묶는다.
- 컬렉션 확정은 mini-pet 소비, 자동강화 비용, progress, item 보상, title grant를 한 root transaction으로 묶는다.
- composite participant인 title repository 메서드는 내부에서 새 root transaction을 열 수 없다.
- 완료 replay는 이전 결과를 반환하고 domain DML은 0건이어야 하며 payload drift는 fail-close한다.
- 외부 reply/network는 commit 이후에만 수행한다.

## Gate 2 차단 조건

- P0: 없음.
- P1: legacy 9개 canonical runtime port 미연결.
- P1: ownership repository mutation 3개가 canonical operation/participant receipt를 기록하지 않음.
- P1: 전역 catalog mutation 2개용 non-player definition replay schema가 없음.
- P1: public rank/status의 legacy normalization을 분리할 non-player maintenance receipt가 없음.
- P1: 판매와 컬렉션 확정이 현재 여러 JSON 저장에 걸쳐 있어 원자적이지 않음.
- P1: 관리자 add/remove의 master-only silent-deny 및 OWNER/RECIPIENT 증거가 runtime에 없음.

따라서 Gate 2는 identity resolution, runtime ports, receipt/replay owner, 두 composite root를 구현하기 전까지 fail-close 상태다.

## 검증

- `node --import tsx --test test/mini-pet-title-collection-gate1-classification.test.ts`
- 입력 파일 SHA-256, frozen source span SHA-256, exact 14개 집합, DIRECT_PASS 제외, 권한 guard, receipt DDL, transaction graph, fail-close port 목록을 결정적으로 검사한다.
