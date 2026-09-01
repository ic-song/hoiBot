# 자산 카탈로그 관리화면

기존 관리자 웹의 오브젝트 카탈로그 화면을 통합 자산 관리화면으로 확장한다. 오브젝트 등록·수정·활성화는 기존 provider 계약을 그대로 사용하고, 새 기능은 읽기 projection으로만 구성한다.

화면에는 stable key, 표시명, 유형, 가용성, 버전, canonical source binding과 도메인별 정의 건수를 표시한다. 패키지는 동결 결과와 migration 439 correction overlay를 분리해 보여 주며, frozen 467, overlay 10, effective 477, STACK GAP 36, PACKAGE GAP 44, conflict 0 계약을 유지한다.

PASS, 펜던트 정책 등 별도 canonical 테이블을 사용하는 영역은 object_registry에 강제 통합하지 않고 도메인 현황으로 조회한다. 신규 스키마와 provider를 만들지 않는다.
