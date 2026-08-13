# Missing operational data synthetic fixtures

이 디렉터리는 현재 Git 운영 snapshot에 없는 두 JSON 파일의 구조와 importer를 시험하기 위한 합성 데이터다.

## 대상

- `petHomeActivityData.json`
- `petHomePlacedFurniture.json`

## 격리 규칙

- 실제 `data/` 디렉터리에 복사하거나 운영 snapshot으로 취급하지 않는다.
- 사용자 키, 본문, 실제 식별자와 운영 값을 넣지 않는다.
- source root hash, 운영 건수·잔액·소유권 reconciliation과 최종 import 완료 증거에서 제외한다.
- 합성 fixture를 사용한 run은 `synthetic` 또는 `rehearsal`로 명시하며 운영 완료 run으로 승격하지 않는다.

## 운영 전 필수 초기화

1. 합성 데이터가 들어간 시험용 MariaDB를 폐기한다.
2. 빈 MariaDB를 재생성하고 승인된 migration 집합만 적용한다.
3. Android/Rhino에서 최신 전체 운영 snapshot을 다시 확보한다.
4. 실제 `petHomeActivityData.json`, `petHomePlacedFurniture.json`의 존재와 JSON 구조·checksum을 확인한다.
5. 실제 전체 snapshot으로 import와 reconciliation을 다시 실행한다.
6. 합성 fixture와 합성 run이 운영 DB에 없음을 확인한 뒤에만 cutover를 진행한다.

Android/Rhino 운영 원본은 초기화하거나 덮어쓰지 않는다.
