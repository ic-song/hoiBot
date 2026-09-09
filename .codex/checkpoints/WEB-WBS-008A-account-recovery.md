# WEB-WBS-008A 계정 탈퇴·복구 UI

- mode: `WEB_PORTAL / T1_EXCLUSIVE_ACCOUNT_RECOVERY_UI`
- catalog: `SC-20260902-1`
- delta: `SCD-WEB-20260909-2`
- evidence schema: `web-account-recovery-v1`
- execution: `웹포털-SL-ACCOUNT-USER-WEB-DELETION-RECOVERY-CONSUMER-01-20260909213952`
- lease: `슬라이스_선점!2632`
- branch: `feature/web-portal`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- baseline: `feature/prod@4331cb75`; account API baseline `WBS746@6fa79f61`
- owner: `/root/web_portal`

## Scope

- Add standalone `/account/delete` and `/recover-account` pages with dedicated static assets.
- Consume the existing current-session, deletion-request, and recovery APIs without changing their transaction or persistence behavior.
- Explain the 30-day grace period, revoke-all-sessions result, and credential-based recovery flow.
- Keep raw account/player IDs and passwords out of rendered content and browser storage.
- Keep `app.ts`, package files, DB, migrations, providers, `feature/prod`, and Gate 8 unchanged.

## Contract evidence

- `POST /api/v1/account-deletion-requests` requires an authenticated session, current CSRF token, and `{ confirmed: true }`.
- The existing service records a 30-day grace period and revokes every active session for the account.
- `DELETE /api/v1/account-deletion-requests/current` re-verifies login ID and password and restores the account when the request remains recoverable.
- This slice owns presentation and API consumption only; it does not add a second account-deletion provider or schema.

## Validation and review

- The assets, registrar, and focused test bundles parse successfully; three route/header/accessibility/API-contract tests pass.
- A synthetic browser flow passed `GET current session -> POST deletion 201 with CSRF -> sessions revoked -> DELETE recovery 200 with credentials`.
- The UI masks the login ID, clears it after deletion, never renders request/account/player IDs, clears the password field, and uses `textContent` for dynamic values.
- Independent review found no P0/P1 in the new UI files. The reported maxlength, error association, storage wording, and non-401 session-error handling P2 items were corrected.
- Shared provider P1 remains: the public recovery route has no account/network rate limit, and `recoverDeletion` does not serialize with cleanup or verify `scheduled_delete_at` and update counts. `슬라이스_보고수신!5643` records the High-review provider request. Gate 7 remains FALSE.

## Next actions

1. Re-run static and focused validation after review corrections.
2. Commit and push the exclusive UI files.
3. Add automated browser/API failure-path coverage before Gate 7.
4. Apply the shared provider correction under a separate High-review W claim after WBS746 integration.
5. Register the routes only after the shared WBS795 R claims close and the WBS746 baseline is integrated once.

Gate 8, operating DB/data, and `feature/prod` remain out of scope.
