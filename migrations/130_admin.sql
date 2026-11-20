-- Admin panel: an audit log of everything an admin changes. Times are Unix milliseconds.
CREATE TABLE admin_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_audit_time ON admin_audit_log(created_at);
