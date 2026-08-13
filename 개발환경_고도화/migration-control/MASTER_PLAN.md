# hoiBot 전체 운영 시스템 이관 마스터 계획

기준일: 2026-08-11  
대상 브랜치: `feature/modernization`  
범위: MessengerBotR/Rhino `main.js`·`Info.js`와 JSON 운영 데이터 전체를 Iris·hoiBot Server·MariaDB로 이전

## 1. 목적

이 계획은 PC 교체, 네트워크 중단, Codex 세션 종료가 발생해도 저장소의 증거만으로 완료 범위와 다음 작업을 판정하기 위한 장기 기준이다.

다음 세 축으로 진행한다.

1. 현행 파악
2. 이관 계획 수립
3. 기능별 단계 진행과 최종 운영 전환

대화 기록이나 작업자의 기억은 완료 근거로 사용하지 않는다.

## 2. 기준 문서와 우선순위

충돌 시 다음 순서를 적용한다.

1. `개발환경_고도화/DECISIONS.md`의 `ACTIVE` 결정
2. 실제 `main.js`, `Info.js`, `data/*.json`과 현재 MariaDB DDL
3. 현재 파일과 Git 증거로 보정된 이 디렉터리의 `CHECKPOINT.md`
4. `progress.json` 및 기능별 증거
5. `개발환경_고도화/MEMORY.md`
6. `COMMAND_INDEX.md`, 기술 참고 문서와 대화 기록

`COMMAND_INDEX.md`는 조사 출발점이며 실제 코드보다 우선하지 않는다.

## 3. 완료 판정 원칙

### 3.1 현재 목표 상태

현재 목표의 상태는 `CHECKPOINT.md` 한 곳에만 기록하고 다음 세 값만 사용한다.

```text
진행 중 → 검증 완료 → 작업 완료
```

- `진행 중`: 일부 작업이 남아 있으며 기록된 다음 행동부터 재개한다.
- `검증 완료`: 요청 산출물과 검증은 통과했지만 커밋·푸시 또는 최종 인계가 남을 수 있다.
- `작업 완료`: 승인 범위, 검증, 필요한 영속화와 인계가 모두 끝났다.

대화 주장만으로 상태를 올리지 않는다. 네트워크가 끊기거나 실행 결과가 불명확하면 마지막으로 증명된 상태와 다음 행동을 파일·Git 증거로 재구성한다.

### 3.2 장기 단계와 기능 게이트

장기 단계와 기능 슬라이스는 별도 상태 문자열을 만들지 않는다. `progress.json`에 완료 여부, 마지막 검증 gate, 증거, 선행 조건만 기록한다.

기능 gate 순서는 다음과 같다.

```text
현행 조사 → DB 설계 → 시험 이관 → 로직 이관 → parity → cutover 준비 → 운영 완료
```

파일이 존재하는 것과 gate 완료는 다르다. 해당 gate의 검증 증거가 없으면 완료 여부는 `false`다.

### 3.3 완료 증거

단계 완료에는 모두 필요하다.

- 입력 artifact와 SHA-256 체크섬
- 실행한 Git commit SHA 또는 명시적인 미커밋 상태
- DB migration 집합과 적용 결과
- 시험·비교 명령과 종료 코드
- 개인정보를 제외한 기계 판독 결과
- 알려진 위험과 미검증 항목
- 다음 단계 또는 롤백 지점

증거가 없으면 구현 파일이 존재해도 로직 이관 gate를 완료로 기록하지 않는다.

## 4. PC·세션 변경 대응 제어면

### 4.1 저장 구조

```text
개발환경_고도화/migration-control/
├─ CHECKPOINT.md
├─ MASTER_PLAN.md
├─ progress.json
├─ inventory/
│  ├─ commands.json
│  ├─ data-stores.json
│  ├─ automatic-flows.json
│  └─ dependencies.json
├─ slices/
│  └─ <slice-id>.json
└─ runs/
   └─ <run-id>.json
```

`CHECKPOINT.md`가 현재 상태와 정확한 다음 행동의 유일한 진입점이다. `progress.json`은 상세 증거 인덱스이며 현재 상태를 중복 선언하지 않는다. `inventory/`, `slices/`, `runs/`는 해당 단계에서 생성한다. 토큰, 비밀번호, 실제 KakaoTalk 원문과 개인정보는 저장하지 않는다.

### 4.2 체크포인트 갱신 시점

다음 시점에만 `CHECKPOINT.md`를 갱신한다.

- 새 목표를 시작할 때
- 의미 있는 결정 또는 milestone이 끝났을 때
- 장시간·파괴적·외부 의존·실패 가능 작업 직전
- 사용자 입력을 기다리기 직전
- 검증 직후
- 기록 상태가 바뀐 최종 응답 직전

사소한 읽기나 개별 명령마다 갱신하지 않는다. 새 체크포인트 파일을 계속 만들지 않고 현재 파일 하나를 교체 갱신한다.

### 4.3 재개 전 필수 점검

새 PC·새 세션은 코드 수정 전에 다음을 확인한다.

1. `CHECKPOINT.md`의 현재 목표·상태·다음 행동
2. 현재 저장소와 worktree 절대 경로
3. 현재 브랜치, HEAD, upstream, dirty 파일
4. 체크포인트가 주장하는 변경 파일의 실제 존재와 내용
5. 기록된 검증 명령이 현재 환경에도 적용 가능한지
6. `feature/prod`와 `feature/modernization` 차이
7. Node.js·npm·Docker·MariaDB 버전
8. migration 파일 체크섬과 DB 적용 버전
9. 선택한 JSON snapshot의 파일 수와 root hash
10. 해당 root hash의 완료된 import run 존재 여부

체크포인트와 실제 파일·Git이 다르면 실제 증거를 우선한다. 관련 없는 dirty 파일은 보존하고 불확실한 변경을 되돌리거나 덮어쓰지 않는다. 사실을 확인한 뒤 체크포인트를 보정한다.

### 4.4 중단 안전성

- DB 변경은 transaction과 idempotency key를 사용한다.
- 스키마 migration은 재실행 안전성을 검증한다.
- 데이터 import는 source root hash로 중복 적용을 차단한다.
- 실행 시작 기록과 완료 기록을 분리한다.
- `running` 상태로 끊긴 run은 완료로 승격하지 않는다.
- 외부 응답 전송과 DB commit 경계를 outbox로 분리한다.
- 재시도는 동일 operation ID로 수행하고 중복 지급·차감 여부를 검사한다.

## 5. 전체 단계

## Phase 0. 제어면 구축

목표는 어디까지 완료됐는지 자동 판정할 기반을 만드는 것이다.

작업:

- 마스터 계획과 `progress.json` 생성
- 단일 `CHECKPOINT.md` 생성과 복구 규칙 적용
- 환경·Git·DB·snapshot preflight 설계
- 기능 슬라이스 증거 스키마와 validator 연결
- run 기록과 마지막 성공 게이트 규칙 정의
- 상태 요약과 다음 작업을 출력하는 단일 명령 설계

현재 명령:

```powershell
cd 개발환경_고도화/runtime
node --env-file-if-exists=.env --import tsx scripts/resume-migration.ts
```

완료 조건:

- 서로 다른 PC 또는 빈 세션에서 저장소만 읽고 현재 상태를 동일하게 판정한다.
- 완료 증거가 없는 항목을 완료로 오인하지 않는다.
- 네트워크 중단 run을 안전하게 미완료로 표시한다.

## Phase 1. 현행 전체 파악

목표는 이전 대상의 누락 없는 inventory를 만드는 것이다.

### 1.1 명령 조사

- `main.js`, `Info.js`의 정확한 명령 guard와 alias 수집
- 관리자·마스터·운영방 전용 경로 분류
- 출력 전용, 데이터 변경, 자동 처리, 복합 명령 분류
- broad prefix guard와 내부 재호출 경로 표시
- 관련 helper, 출력 formatter, 오류 경로 연결

### 1.2 데이터 조사

- 모든 JSON/TXT 파일의 루트 구조와 사용자 키 연결
- 명령별 read/write field와 load/save 경로 추적
- DEV/PROD path와 공통 참조 데이터 구분
- 여러 파일을 함께 변경하는 원자성 요구 표시
- 운영 snapshot에 없지만 Android runtime에 존재하는 파일 별도 확인

### 1.3 자동·예약·운영 흐름 조사

- 일일 초기화, 보상, 랭킹, 이벤트, 정리 worker
- 내부 명령 재호출과 타이머
- 관리자 수정·복구·백업 명령
- 오류 로그·통화 로그·감사·모니터링

완료 조건:

- 모든 명령과 자동 흐름이 정확히 하나 이상의 기능 슬라이스에 배정된다.
- 모든 운영 데이터 파일이 authoritative, reference, reconciliation-only, excluded 중 하나로 분류된다.
- 미확인 항목은 삭제하지 않고 `unknown`으로 남긴다.

## Phase 2. 이관 계획과 WBS 확정

목표는 의존성과 위험을 기준으로 기능 순서를 확정하는 것이다.

각 슬라이스에 기록할 내용:

- 명령과 alias
- 레거시 helper와 저장 흐름
- 입력 JSON과 대상 테이블
- 선행 슬라이스
- 읽기/변경/복합 분류
- transaction·idempotency·ledger 요구
- 시험 fixture와 parity 방법
- cutover·rollback 방법
- 예상 위험과 미확인 사항

우선순위 원칙:

1. identity·회원·공통코드·설정
2. 프로필·조회 projection
3. 재화·인벤토리·아이템 catalog
4. 펫·칭호·스킬·미니펫
5. 홈·소셜·게시판
6. 길드·영지
7. 상점·패키지·패스·자유시장
8. 전투·랭킹·탑·탐험·이벤트
9. 관리자·자동 처리·운영 도구
10. 전체 회귀와 전환

실제 의존성 조사 결과에 따라 순서를 조정하되 변경 이유를 기록한다.

완료 조건:

- 전체 명령·데이터가 WBS에 포함된다.
- 순환 의존성과 여러 파일 mutation의 transaction 경계가 해소된다.
- 각 슬라이스에 명확한 시작 조건과 완료 조건이 있다.

## Phase 3. 설계·임시데이터·로직·검증

운영 데이터는 이 단계에서 이관하지 않는다. 먼저 전체 기능의 관계형 DB 설계를 확정하고 개인정보 없는 임시데이터를 적재한 뒤, 기능 슬라이스별 로직 이관과 parity 검증을 반복한다.

### Gate A. 명령·현행 조사

- 정확한 guard, alias, 권한, 방 조건 확인
- helper, 출력, 오류, 자동 호출 확인
- JSON read/write와 save 순서 확인
- 정상·경계·실패 fixture 정의

### Gate B. DB 설계

- aggregate와 transaction boundary 정의
- PK·UK·FK·index·자료형·삭제 정책 정의
- ledger·audit·outbox·idempotency 적용 여부 정의
- 모든 레거시 field를 column, child row, anomaly, explicit exclusion 중 하나로 매핑

### Gate C. 임시데이터 적재

- 개인정보와 운영 원문이 없는 합성 fixture를 기능별 정상·경계·실패 사례로 구성
- 동일 migration 집합으로 disposable DB 생성
- 합성 fixture dry-run 후 적재
- 선언된 replay 정책과 반복 적재 멱등성 검증
- 합성 기준 건수, 합계, 잔액, 소유권, FK, orphan, anomaly reconciliation
- 실제 운영 snapshot은 읽기·적재하지 않음

### Gate D. 명령 로직 이관

- `Adapter -> Application Service -> Domain Policy -> Repository -> MariaDB` 준수
- transport에서 직접 SQL 또는 게임 규칙 처리 금지
- mutation은 transaction·원장·감사·멱등성 적용
- 레거시 fallback은 parity 통과 전까지 유지

### Gate E. 기존 결과 비교

조회 명령:

- 문자, 줄바꿈, emoji, 정렬, 숫자 포맷, `allsee`, null·빈 값까지 exact 비교

변경 명령:

- 허용·거부 입력
- 응답 문자열
- 변경 전후 잔액·소유권·진행 상태
- ledger·audit·outbox
- 중복 이벤트·동시 실행·재시작 결과 비교

### Gate F. 슬라이스 확정

- 임시데이터 적재와 parity가 모두 통과한 증거가 있어야 parity gate의 `completed`를 `true`로 기록한다.
- rollback·freeze·smoke 계획이 모두 검증돼야 cutover 준비 gate의 `completed`를 `true`로 기록한다.
- 하나라도 실패하면 해당 gate를 수정해 다시 반복

## Phase 4. 전체 통합 검증

작업:

- 전체 명령 fixture 회귀
- 기능 간 transaction·동시성·중복 이벤트 검증
- Iris 수신·identity·명령·DB·outbox·reply end-to-end 검증
- 서버 재시작과 MariaDB 재시작 검증
- backup·restore 후 동일 reconciliation 검증
- Ubuntu Docker 환경 재현

완료 조건:

- `main.js`와 `Info.js`의 모든 대상 흐름이 새 서비스에 대응한다.
- 미분류 명령·helper·save flow가 0건이다.
- 전체 데이터 reconciliation과 복원 검증이 통과한다.

## Phase 5. 운영 데이터 최종 이관

### 5.1 전환 전

1. maintenance window와 책임자 확정
2. Rhino 쓰기 동결
3. Android 운영 데이터 전체 백업
4. 최종 snapshot 파일 목록과 checksum 생성
5. 같은 artifact로 disposable rehearsal 재실행
6. MariaDB backup과 rollback 지점 생성

### 5.2 최종 import

1. 승인된 migration 집합 적용
2. 최종 snapshot import
3. import run 완료 확인
4. 건수·잔액·아이템 소유권·관계·anomaly reconciliation
5. 읽기 전용 smoke
6. mutation smoke
7. Iris 단독 명령 routing 활성화
8. Rhino 중단 유지

### 5.3 롤백 경계

- mutation 활성화 전: Rhino·JSON으로 복귀 가능
- mutation 활성화 후: 이전 서버 image 또는 MariaDB backup/PITR만 사용
- mutation 활성화 후 오래된 JSON으로 역전환 금지

완료 조건:

- 실운영방 smoke와 주요 변경 명령 검증 통과
- outbox와 중복 방지 정상
- 재시작과 backup/restore 정상
- 운영 MariaDB가 단일 기준 데이터가 됨
- 최종 run과 검증 결과가 Git에 비밀정보 없이 기록됨

## 6. 최초 기준선에서 확인된 상태

- `feature/modernization`에 MariaDB migration `001`~`027`과 importer, 일부 도메인 서비스가 존재한다.
- 저장소 JSON 33개 dry-run 결과는 회원 610명, anomaly 1건, root hash `b7dfec6b7cb82c579f1a834434f6286c57e6364cd759b1fbcedc2a25db3f0014`다.
- 개발 DB 연결과 transaction rollback probe는 통과했다.
- 위 root hash와 일치하는 완료된 import run은 현재 연결된 DB에서 확인되지 않았다.
- `/내정보` repository·service·formatter는 합성 DB에서 25개 전체 출력 줄과 U+200B 686개의 문자 단위 contract를 통과했다. 실운영 snapshot과 운영방 smoke는 최종 단계에 남아 있다.
- 현재 `feature/modernization` worktree에는 별도 캐릭터 MVP 작업을 포함한 미커밋 변경이 있으므로 기준 브랜치 병합과 커밋 범위를 분리해야 한다.
- 운영 cutover는 수행되지 않았다.

## 7. 바로 다음 작업

1. active 미확인 17개와 source-only 후보 16개를 실제 guard 기준으로 수동 분류
2. 삭제 체크 literal 75개가 실행 분기인지 안내문 잔존인지 재검증
3. 첫 변경 슬라이스 `/서버이동`의 legacy 권한·mutation·save flow와 MariaDB transaction·audit·outbox parity 완료
4. 조회 슬라이스는 사용자·펫·홈·길드 순으로 묶고 변경 슬라이스는 재화·인벤토리·거래 순으로 반복
5. 자동 처리와 관리자 경로를 별도 inventory에 추가
