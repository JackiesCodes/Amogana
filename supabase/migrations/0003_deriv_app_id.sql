-- 0003: Deriv's current API authenticates with a Personal Access Token plus the
-- App ID of the user's registered Deriv app; store the App ID per account.
-- Idempotent: safe to run more than once.

alter table brokers add column if not exists app_id text;
