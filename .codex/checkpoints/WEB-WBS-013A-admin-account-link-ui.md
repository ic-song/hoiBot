# WEB-WBS-013A admin account-link UI checkpoint

- Lease: `Lease2653`
- Responsible owner: `/root/web_wbs013a_api`
- Narrow UI implementer: `/root/web_wbs013a_ui`
- Slice: `SL-ACCOUNT-ADMIN-WEB-LINK-READ-01`
- Delta/schema: `SCD-WEB-20260910-11` / `web-admin-account-link-ui-v1`
- Branch/worktree: `feature/web-portal` / `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- Baseline: `512db10fff923f5d731bbc6d0ae4ca9c240c798c`
- Scope: existing administrator member detail consumes `GET /api/v1/admin/players/:playerId/account-links` in a read-only panel with deep-link and refresh restore.
- Security: only `maskedLoginId` and `maskedExternalUserKey` identifier values render; portal/link IDs, selection version, raw identifiers, session details, and mutation controls do not render.
- States: success, empty, player 404, general error with GET retry, session expiry, and permission denial are covered.
- Accessibility/responsive: selected heading focus, keyboard-operable 44px member target, visible focus, 375/768/1024/1440 browser replay with `overflowX=0`.
- Validation: focused 14/14 PASS; typecheck PASS; build PASS; diff-check PASS; browser replay 4/4 PASS.
- Evidence: `개발환경_고도화/migration-control/evidence/web-admin-account-link-ui-20260910/`.
- Status: `GATE_1_6_COMPLETE`. Independent Gate 7 review remains pending; Gate 8 is not claimed.
