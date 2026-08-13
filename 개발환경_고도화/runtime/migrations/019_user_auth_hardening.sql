ALTER TABLE user_accounts
  ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN locked_until DATETIME(3) NULL AFTER failed_login_count,
  ADD KEY idx_user_accounts_login_lock (locked_until);
