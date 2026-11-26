CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY,
  key_hash text UNIQUE NOT NULL,
  ruc text NOT NULL CHECK (ruc ~ '^[0-9]{13}$'),
  expires_at timestamptz NOT NULL,
  max_devices integer NOT NULL CHECK (max_devices BETWEEN 1 AND 1000),
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS license_devices (
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL,
  activated_at timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  PRIMARY KEY (license_id, id)
);
CREATE TABLE IF NOT EXISTS telemetry_reports (
  installation uuid NOT NULL,
  id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL,
  PRIMARY KEY (installation, id)
);
CREATE INDEX IF NOT EXISTS telemetry_reports_received_at ON telemetry_reports(received_at);
