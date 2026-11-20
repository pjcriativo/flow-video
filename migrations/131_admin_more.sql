-- Admin: suspending accounts and editing plans from the panel.
ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_reason TEXT NOT NULL DEFAULT '';

-- What an admin changed on a plan. Applied over the defaults in src/config/economy.ts at start-up.
CREATE TABLE admin_plan_overrides (
  plan_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  price_usd       REAL NOT NULL,
  monthly_credits INTEGER NOT NULL,
  concurrency     INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
