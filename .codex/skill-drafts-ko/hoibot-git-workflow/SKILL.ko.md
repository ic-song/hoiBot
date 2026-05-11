---
name: hoibot-git-workflow
description: hoiBot 브랜치 선택, origin/main 최신화, 한글 커밋 메시지, 작업 브랜치 push, feature/prod 운영 반영, merge/cherry-pick 판단에 사용한다.
---

# hoiBot Git 작업 스킬

hoiBot 저장소의 git 브랜치, 커밋, push, 운영 반영 작업에 사용한다.

## 핵심 원칙

- 브랜치 전환, 커밋, push, merge 전에는 현재 브랜치와 작업 트리를 확인한다.
- 커밋 메시지는 한글로 알아보기 쉽게 요약한다.
- `main`에는 직접 push하지 않는다.
- `main`에는 직접 merge하지 않는다.
- `feature/prod`는 운영 브랜치다.
- 문서, workflow, branch strategy, tools 변경은 `feature/workflow`에서 작업한다.
- 버그 수정은 요청된 bugfix 브랜치에서 작업한다. `feature/bugFix`와 `feature/bugfix`가 둘 다 있으면 사용자가 요청한 정확한 casing을 확인한다.
- 특정 브랜치에서 작업하기 전에는 `origin/main`을 먼저 반영한다.

## 브랜치 작업 시작 흐름

1. `git status --short --branch`를 실행한다.
2. 대상 브랜치로 이동한다.
3. 가능하면 대상 브랜치를 fast-forward only로 pull한다.
4. `origin/main`을 fetch한다.
5. 편집 전에 `origin/main`을 대상 브랜치에 반영한다.
6. 충돌이 있으면 작업 변경 전에 먼저 해결한다.

## 운영 반영

사용자가 "prod까지 올려줘" 또는 "운영반영해줘"라고 말하면:

1. 현재 작업 브랜치에 커밋한다.
2. 현재 작업 브랜치를 push한다.
3. `feature/prod`로 이동한다.
4. `feature/prod`를 pull한다.
5. 검증된 작업만 `feature/prod`에 반영한다.
6. `feature/prod`를 push한다.

## merge / cherry-pick 판단

작업 브랜치에 관련 커밋만 있고 깨끗하면 일반 merge를 사용할 수 있다.

다음 경우에는 cherry-pick을 우선한다.

- 작업 브랜치가 upstream보다 많이 앞서 있음
- unrelated historical commits가 있음
- 일부 커밋만 운영에 올려야 함
- 브랜치 전체 merge가 불필요한 위험을 만들 수 있음

## 참고 문서

- `references/브랜치_정책.md`: 브랜치 역할
- `references/운영_반영.md`: 운영 반영 전 확인
