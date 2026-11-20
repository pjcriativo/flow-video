-- Admin: settings edited from the panel (margin, exchange rate, budget, API keys) and
-- per-model on/off switches. Secret values are stored encrypted, never in clear text.
CREATE TABLE admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE admin_model_overrides (
  model_id   TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
