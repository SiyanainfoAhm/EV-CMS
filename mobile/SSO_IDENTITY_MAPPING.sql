-- Existing EV-CMS mapping model: one DFCCIL UAT issuer, EV_Users.sso_sub.
-- The connected UAT database already has this column and all three test users.
-- No migration is required for the current UAT login test.
-- For a new database only, review and apply these non-destructive schema changes:
ALTER TABLE public."EV_Users" ADD COLUMN IF NOT EXISTS sso_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_users_sso_sub
  ON public."EV_Users" (lower(trim(sso_sub)))
  WHERE sso_sub IS NOT NULL AND trim(sso_sub) <> '';

-- Map an existing user only after verifying the association:
-- UPDATE public."EV_Users" SET sso_sub = '<verified-virtual-id>' WHERE id = '<existing-user-id>';
-- Roles remain in EV_Users. No users or roles are created or changed here.
