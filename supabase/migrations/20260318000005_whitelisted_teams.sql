-- =============================================================================
-- Migration: Whitelisted teams + team applications
-- Gates points campaigns to approved teams only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- whitelisted_teams — approved teams that can create points campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whitelisted_teams (
  wallet        TEXT PRIMARY KEY,
  protocol_name TEXT NOT NULL,
  website       TEXT,
  contact_email TEXT NOT NULL,
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- ---------------------------------------------------------------------------
-- team_applications — inbound applications from teams wanting points access
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet        TEXT NOT NULL,
  protocol_name TEXT NOT NULL,
  website       TEXT,
  contact_email TEXT NOT NULL,
  pool_size_usd TEXT,
  description   TEXT,
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected'))
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE team_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE whitelisted_teams ENABLE ROW LEVEL SECURITY;

-- Public can read their own application status
CREATE POLICY "wallet sees own application"
  ON team_applications FOR SELECT
  USING (wallet = current_setting('app.current_wallet', true));

-- Whitelisted teams: public read own status
CREATE POLICY "wallet sees own whitelist status"
  ON whitelisted_teams FOR SELECT
  USING (wallet = current_setting('app.current_wallet', true));
