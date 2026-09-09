# WEB-WBS-008 이용자 웹 셸

- mode: `WEB_PORTAL / T1_EXCLUSIVE_SHELL_IMPLEMENT`
- catalog: `SC-20260902-1`
- deltas: `SCD-WEB-20260909-1` (WEB008), `SCD-WEB-20260909-3` (WEB010 current-profile read)
- execution: `웹포털-SL-COMMON-USER-WEB-SHELL-SESSION-01-20260909210307`
- lease: `슬라이스_선점!2629`
- branch: `feature/web-portal`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- baseline: `feature/prod@4331cb75`; account/web reuse baseline `WBS746@6fa79f61`
- owner: `/root/web_portal`

## Current scope

- Add the standalone Fastify user shell registrar and static HTML/CSS/JavaScript assets.
- Add isolated route, security-header, accessibility, and API-contract tests.
- Consume only `/api/v1/player-profiles/current` for the authenticated user's profile; do not accept an arbitrary player selector or expose a mutation.
- Keep `/signup`, `/admin`, user-auth providers, DB, migration, and mutation logic unchanged.
- Do not edit `개발환경_고도화/runtime/src/app.ts`, `package.json`, or `package-lock.json` while WBS795 owns their active resources.

## Completed evidence

- Planning, feature definition, current-modernization comparison, architecture, WBS, and file ownership are frozen in the website planning spreadsheet.
- WBS601, WBS679, and WBS681 are ancestors of WBS746, so they must not be merged separately.
- `feature/prod@4331cb75` and `WBS746@6fa79f61` diverge at `0f1e761a`.
- The one-time WBS746 baseline merge overlaps `AGENTS.md` and `COMMAND_INDEX.md`; only `COMMAND_INDEX.md` is expected to require manual conflict resolution.
- New `site-web` files do not overlap WBS795 or WBS742 file claims.
- Independent security review found no P0. CSRF rotation, expired-session cleanup, focus contrast, response-header typing, and actual backend error-code mismatches were corrected before commit.
- esbuild parsed the assets, route registrar, and test bundle successfully; five focused Fastify/security/accessibility/API-contract/client-behavior tests pass.
- A local browser flow completed `POST session -> GET profile (CSRF rotation) -> GET current session -> DELETE session 204`. The UI masked the login ID, omitted raw account/player identifiers, rendered the synthetic profile, and returned to `/login` after logout.
- A dependency-free client harness verifies current-profile-only routing, CSRF refresh after profile read, logout with the refreshed token, and sensitive DOM cleanup when profile lookup returns 401.
- `git diff --check` passes for every file owned by this Lease.

## Next actions

1. Wait for the WBS795 `app.ts` and package resource claim to close or narrow.
2. Merge WBS746 once into `feature/web-portal`, resolve `COMMAND_INDEX.md`, and reproduce account/signup/admin tests.
3. Register `registerUserShellRoutes(app)` exactly once in `app.ts`.
4. Run typecheck, focused tests, build, and browser checks at 375/768/1024/1440.
5. Complete the post-integration independent review and record Gate evidence.

Gate 8, operating DB/data, and `feature/prod` remain out of scope.
