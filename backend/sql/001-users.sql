-- Analysts who can sign in to MacroDesk. This is the local provider's table:
-- if KeyStone moves to SSO against the KeyStocks portal, rows here become a
-- cache of who has been seen rather than the source of the password.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  -- null for an account that exists but has no local password, which is what an
  -- SSO-provisioned analyst looks like
  password_hash VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  PRIMARY KEY (id),
  -- sign-in is by email, so the database enforces one account per address
  UNIQUE KEY uniq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
