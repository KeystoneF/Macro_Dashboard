-- Analysts who can sign in to MacroDesk. This is the local provider's table:
-- if KeyStone moves to SSO against the KeyStocks portal, rows here become a
-- cache of who has been seen rather than the source of the password.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  -- null for an account that exists but has no local password, which is what an
  -- SSO-provisioned analyst looks like
  password_hash VARCHAR(255),
  -- timestamptz, not timestamp: the bare type drops the offset and reads back
  -- in whatever the server's zone is
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  -- sign-in is by email, so the database enforces one account per address
  CONSTRAINT uniq_users_email UNIQUE (email)
);
