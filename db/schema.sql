CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'default',
  certificate_path TEXT NOT NULL,
  private_key_path TEXT NOT NULL,
  ca_bundle_path TEXT,
  fingerprint_sha256 TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_port INTEGER NOT NULL UNIQUE,
  mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proxy_rules_enabled ON proxy_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_certificates_active ON certificates(active);
