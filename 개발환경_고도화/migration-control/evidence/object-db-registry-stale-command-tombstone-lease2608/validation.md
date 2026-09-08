# WBS780 stale 명령 레지스트리 동기화 검증

## 범위

- 카탈로그: `SC-20260902-1`
- WBS / Lease: `WBS780` / `2608`
- 브랜치: `codex/registry-stale-command-tombstone-v1-20260908`
- 기준 커밋: `9260ee2185c8123e90b345abd6301034c793e989`
- `main.js`, `Info.js`, 운영 데이터, DB, 네트워크, `feature/prod`, Gate8: 변경 없음

## 소스 재검증

| 레지스트리 행 | 현행 소스 판정 | 동기화 |
| --- | --- | --- |
| `/길드스타터오픈4` | 아이템명·지급 문구만 존재하며 독립 guard 없음 | `삭제유무` 확인 |
| `/길드스타터오픈5` | 아이템명·지급 문구만 존재하며 독립 guard 없음 | `삭제유무` 확인 |
| `/길드영지오픈1` | 아이템명·지급 문구만 존재하며 독립 guard 없음 | `삭제유무` 확인 |
| `/오픈하면어른이됩니다` | 패키지 표시명만 존재하며 독립 guard 없음 | `삭제유무` 확인 |
| `/창세오픈` | 주석만 잔존하고 실행 guard는 `/창조오픈` | `삭제유무` 확인, 후속 명령만 비고 기록 |
| `/펫먹` | `/펫먹이조합`, `/펫먹이박스오픈`의 부분 문자열일 뿐 독립 guard 없음 | `삭제유무` 확인, `/냠냠`을 후속 명령으로만 비고 기록 |
| `/펫탐험시작` | `/펫탐험정산`·타이머 처리 내부 비교 문자열만 잔존 | `삭제유무` 확인 |
| `/호월오픈` | 아이템명·지급 문구만 존재하며 독립 guard 없음 | `삭제유무` 확인 |

`/창세오픈`과 `/펫먹`은 기존 consumer ID를 후속 명령으로 바꾸거나 별칭으로 합치지 않았다. `COMMAND_INDEX.md`의 stale `/창세오픈` 절만 실제 `/창조오픈` guard, 아이템명, 보상값으로 동기화했다.

검색어는 위 8개 명령, `/창조오픈`, `/냠냠`, `registrySourceMismatches`, `COMMAND_REGISTRY.md`, `COMMAND_INDEX.md`였고 `main.js`, `Info.js`, 레지스트리, 인덱스, 매니페스트 생성기와 전환·stable ID·원장 테스트를 함께 확인했다.

## 계약 결과

| 항목 | 결과 |
| --- | --- |
| 활성 오브젝트 레지스트리 행 | `367 → 359` |
| registry-source mismatch | `8 → 0` |
| consumer manifest | `1,133`, 변경 없음 |
| consumer set SHA-256 | `015ed7d96a4579c84d170888151e44a36cf95192760555966ac47df0764ffb3a`, 변경 없음 |
| stable ID registry | `1,107 = ACTIVE 1,101 + TOMBSTONE 6`, 파일·ID 변경 없음 |
| ledger | `1,133`, missing/duplicate/unknown `0/0/0` |
| ledger READ / MUTATION | `504 / 629` |
| ledger verdict | `DIRECT_PASS 33`, `STATIC_ONLY 1,018`, `BLOCKED_DYNAMIC 82` |
| ledger entry set SHA-256 | `775a00e4ef73f19361bab6d3a057984ffb4902a1afadc5167067edea7ce5a882`, 변경 없음 |

재생성한 매니페스트의 정규화 SHA-256은 `dfe3273a722703a7837eaaf27780eb23bfccffc58bceee321964ffc978e6bd02`이다. 실행 증거 원장은 변경된 매니페스트 계약 해시와 mismatch `0`을 반영했지만 consumer·entry 집합은 변하지 않았다.

## 검증

- consumer manifest 재생성: PASS, `1,133`, mismatch `0`
- executable parity ledger 재생성 및 182개 봉인 영수증 재실행: PASS
- 최초 focused 3파일: `35/36`; 유일한 실패는 Wave0의 기존 mismatch 기대값 `8`이었음
- 기대값 수정 후 변경 핵심 assertion 재실행: `3/3 PASS`
- TypeScript typecheck: PASS
- TypeScript build: PASS
- object data validator: PASS, 등록 대상 `119개`
- `node --check main.js`: PASS
- `node --check Info.js`: PASS
- 변경 계약 JSON parse: PASS
- `git diff --check`: PASS
- `main.js`, `Info.js` diff: 없음

전체 `npm test`, MariaDB, Android MessengerBot 실기동은 이 문서·계약 동기화 범위에서 재실행하지 않았다. 운영 데이터, 운영 DB, 실운영방, 외부 reply/network, `feature/prod`, Gate8은 검증·변경 대상이 아니다.
