# WEB-WBS-012 current reuse validation

- Schema: `web-admin-reuse-evidence-v1`; delta: `SCD-WEB-20260910-4`.
- Source: `feature/web-portal` at `ba74e66c8aa1f4401e41e7cd67b41866194622c9`.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Focused command `node --import tsx --test test/admin-web-shell.test.ts test/admin-authorization.test.ts test/site-web-app-wiring.test.ts`: 16 passed, 0 failed, 0 skipped.
- Shell registration is in `runtime/src/app.ts` and routes are defined once in `runtime/src/admin/web-shell.ts`: `/admin`, `/admin/`, `/admin/assets/admin.css`, `/admin/assets/admin.js`.
- Existing session/RBAC/read API registrar remains `runtime/src/admin/routes.ts`; authorization remains `runtime/src/admin/auth-service.ts`. Client forbidden endpoint scan (`server-assignment`, `player-assignment`, `/operators`, `/passes`) returned 0 matches in `web-shell-assets.ts`.
- Current HEAD differs from the old shell evidence source in `admin/routes.ts`, `admin/web-shell-assets.ts`, `app.ts`, `admin-web-shell.test.ts`, and adds `site-web-app-wiring.test.ts`; this is parity context only. No files in those source/test paths were changed by this evidence task.
- Historical `admin-web-shell-read/slice.json`: Gate 1~7 shadow complete, focused 6/6, full regression 1159 (1152 pass, 7 skipped), source `7e607975`, Gate 8 false.
- Historical `admin-mvp-integration/slice.json`: Gate 1~7 complete, focused latest 44/44, default full regression 1270 pass, schema/provider changes 0, operational DB false, Gate 8 false.
- No operational DB/data, `feature/prod`, or Gate 8 activity.

## WEB-WBS-015 handoff

Carry the exact shell/session/read route list, focused test output, typecheck/build output, zero forbidden endpoint scan, and historical Gate 7 references into the integration evidence. Re-run browser desktop/mobile, 401/403, expired-session, empty/retry, CSP/no-store and console checks, then cover integration, Shadow, restart/replay/rollback and accessibility. Keep the existing admin shell/API/RBAC providers as the sole primary implementations.
