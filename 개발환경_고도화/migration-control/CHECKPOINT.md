# 작업 복구 체크포인트

- 작업 키: `hoibot-rdb-migration`
- 작업 이름: hoiBot 전체 운영 시스템 RDB 이관
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 8
- 마지막 갱신: 2026-08-11 16:41 KST
- 대화 식별명: 전체 이관 제어면

허용 상태: `진행 중 → 검증 완료 → 작업 완료`

## 현재 목표

- 1단계 현행 파악에서 JSON/TXT 운영 데이터의 구조·사용처·load/save 흐름을 누락 없이 inventory로 기록한다.

## 사용자 요청과 승인 범위

- 최신 요청: 데이터 이관 준비를 단계별로 기록하며 진행.
- 허용된 변경: 이관 제어면을 갱신하고 `data/*`의 구조·사용처·load/save 흐름을 읽기 전용으로 조사해 inventory artifact를 작성.
- 별도 승인이 필요한 작업: 운영 데이터 apply, 운영 전환, `feature/prod` 반영, 기존 캐릭터 MVP 미커밋 변경 수정·정리.
- 선언된 파일 범위: `개발환경_고도화/migration-control/CHECKPOINT.md`, `개발환경_고도화/migration-control/progress.json`, `개발환경_고도화/migration-control/inventory/data-stores.json`, `개발환경_고도화/migration-control/scripts/build-data-inventory.mjs`.

## 작업 위치

- 저장소: `https://github.com/ic-song/hoiBot.git`
- 작업 트리: `C:/Users/user/Desktop/hoiBot_modernization`
- 브랜치: `feature/modernization`
- 원격 저장소: `origin`
- 업스트림 브랜치: `origin/feature/modernization`
- 마지막 푸시 커밋: `a2f7e1a5e8b7b7a80d04ba803ad5867b8c50d04c`
- 원격 동기화 상태: 로컬 HEAD와 upstream은 같지만 working tree가 dirty다.
- 체크포인트 Git 추적: 예
- 체크포인트 포함 푸시 커밋: `a2f7e1a5e8b7b7a80d04ba803ad5867b8c50d04c`

## 완료된 작업

- 단일 작업 체크포인트와 마스터 계획, 상세 증거 인덱스를 생성했다.
- 현재 상태를 `진행 중 → 검증 완료 → 작업 완료`로 단순화했다.
- 파일·Git 증거가 체크포인트와 다르면 실제 증거를 우선하도록 정했다.
- 저장소 내 다른 체크포인트를 검색했으며 현재 이관 체크포인트 하나만 확인했다.
- 새 resume checker의 파일 범위가 기존 캐릭터 MVP 미커밋 변경과 겹치지 않음을 확인했다.
- resume checker가 체크포인트 형식과 버전, 브랜치·HEAD·upstream, dirty worktree, artifact 추적·푸시 여부를 검사하도록 구현했다.
- JSON 33개 root hash와 MariaDB migration checksum, 동일 snapshot의 완료 import run을 읽기 전용으로 검사하도록 구현했다.
- 최초 제어면 생성 시 로컬 재개 가능, 다른 PC 재개 불가를 올바르게 판정했다.
- fetch 결과 `feature/modernization`은 원격과 동일하고 `origin/feature/prod`는 `288e6bd9626c88f5f3d658c593bfc462e72ca14e`로 전진했음을 확인했다.
- 이관 제어면과 검증 도구 10개 파일을 `a2f7e1a`로 선택 커밋하고 `origin/feature/modernization`에 푸시했다.
- resume checker에서 `safeToResume=true`, `crossPcReady=true`를 확인했다.
- `data/*` 35개 파일을 원본 수정 없이 조사했으며 JSON 33개가 모두 parse 가능함을 확인했다.
- JSON root hash `b7dfec6b7cb82c579f1a834434f6286c57e6364cd759b1fbcedc2a25db3f0014`가 기존 기준과 일치했다.
- `main.js`·`Info.js` 경로 선언과 직접 load/save 증거를 결합해 저장소 후보 47개를 분류했다: authoritative 26, reference 8, reconciliation-only 11, excluded 2.
- 저장소 snapshot에 없는 authoritative Android 파일 `petHomeActivityData.json`, `petHomePlacedFurniture.json`을 별도 미확인 대상으로 기록했다.

## 진행 중인 작업

- 현행 MariaDB migration·importer가 authoritative 저장소 26개의 구조를 얼마나 수용하는지 coverage를 대조한다.

## 변경 파일

- `개발환경_고도화/migration-control/CHECKPOINT.md`
- `개발환경_고도화/migration-control/progress.json`
- `개발환경_고도화/migration-control/inventory/data-stores.json`
- `개발환경_고도화/migration-control/scripts/build-data-inventory.mjs`

기존 캐릭터 MVP와 그 밖의 미커밋 변경은 소유권이 불명확하므로 건드리지 않는다.

## 검증

- 실행 명령: 저장소 체크포인트 열거와 current checkpoint 내용 확인
- 실행 명령: `git status`, HEAD/upstream, remote URL, 체크포인트 추적 여부 확인
- 실행 명령: `node --env-file-if-exists=.env --import tsx scripts/resume-migration.ts`
- 실행 명령: 같은 명령의 `--json` 출력을 JSON 파싱해 `safeToResume` 확인
- 실행 명령: `npm.cmd run typecheck`
- 결과: 충돌하는 다른 체크포인트 없음. TypeScript 검증 통과. 로컬 migration 28개와 DB 적용 migration 28개의 checksum 일치. 제어면 푸시 후 로컬 재개와 다른 PC 재개가 모두 가능. 현재 snapshot 완료 import run 없음.
- 실행 명령: `node 개발환경_고도화/migration-control/scripts/build-data-inventory.mjs`
- 실행 명령: inventory 요약 검증과 `git diff --check -- 개발환경_고도화/migration-control`
- 결과: repository file 35, JSON 33, store 후보 47. invalid JSON 0. root hash 기준값 일치. unknown 분류 0. 저장소에 없는 authoritative 파일 2개 확인. diff check 통과.

## 충돌·막힘·미승인 사항

- dirty worktree 때문에 최신 `feature/prod` 병합은 안전하지 않다.
- 로컬 `feature/prod`는 `382e068dd5ac9e09cdb4b92de6529e5f40394388`로 원격보다 뒤에 있다.
- 현재 JSON root hash와 일치하는 완료된 DB import run은 확인되지 않았다.
- 현재 Git snapshot에 authoritative Android 파일 2개가 없어 실제 구조와 checksum을 아직 확정할 수 없다.
- 운영 DB apply와 cutover는 승인되지 않았다.

## 다음 행동

1. migration DDL과 `import-legacy-json.ts`를 기준으로 authoritative 저장소 26개의 DB 수용 coverage 표를 생성한다.

## 보안

- 비밀 값, 평문 자격 증명, KakaoTalk 원문과 불필요한 개인정보를 기록하지 않는다.
