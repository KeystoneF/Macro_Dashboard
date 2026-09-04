-- Signing out clears the cookie, which only stops one browser from sending the
-- token. The token stayed valid for the rest of its twelve hours wherever else
-- it had reached. Bumping this on sign-out is what ends it.
--
-- Zero is what a token issued before this column existed carries, so sessions
-- open across the deploy keep working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
