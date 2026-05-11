---
name: hoibot-save-flow-guard
description: hoiBot 변경이 saveJsonFile/loadJsonFile, 데이터 mutation, DEV/PROD path flow, data snapshots, inventory/point/item mutation, persistence-sensitive command logic에 닿을 때 사용한다.
---

# hoiBot 저장 흐름 보호 스킬

게임 데이터를 변경하거나 persistence에 닿는 작업에서 사용한다.

## 핵심 원칙

- save logic이 바뀌면 `saveJsonFile`과 `loadJsonFile` 사용을 확인한다.
- DEV/PROD path behavior를 보존한다.
- `data/*.json`은 production-like snapshot으로 취급한다.
- 검증 중 original snapshot을 덮어쓰지 않는다.
- mutation test가 필요하면 copy 또는 DEV context를 사용한다.
- mutation-heavy command는 input guard를 신중하게 검토한다.

## 저장 흐름 체크리스트

1. 변경되는 모든 data object를 식별한다.
2. 각 object의 저장 파일을 식별한다.
3. 대응되는 save call이 있는지 확인한다.
4. 관련 없는 file save 또는 mutation이 없는지 확인한다.
5. path를 건드렸다면 DEV/PROD path handling을 확인한다.
6. 변경된 data file 또는 생성 snapshot이 있으면 JSON parsing을 검증한다.

## 참고 문서

- `references/저장_로드_흐름.md`: save/load 검토
- `references/DEV_PROD_경로.md`: path logic 변경 시 확인
- `references/데이터_스냅샷_안전.md`: data file 테스트 전 확인
