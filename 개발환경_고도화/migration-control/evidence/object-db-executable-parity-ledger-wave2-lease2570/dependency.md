# Wave2 dependency and provenance

- Actual target: `ObjectCatalogCompatibilityResolver` in the committed TypeScript source; no duplicate implementation.
- Reused runner: `NODE_OBJECT_DB_PARITY_V1`; Wave1 fallback query/row behavior remains unchanged.
- Trusted-input commit: `2a32cf0c3d3158f98aedf102ba7bf4811edcf218` (`실행 패리티 2차 증빙 소스를 추가`).
- The validator attests that the commit is an ancestor and contains both Wave fixtures, the shared runner, both invocation targets, and each exact resolver source span.
- Windows long evidence paths are read with `git -c core.longpaths=true show`; hash and ancestry checks remain fail-closed.

