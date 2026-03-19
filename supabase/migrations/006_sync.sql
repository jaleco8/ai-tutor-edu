-- Migration 006: Sync events and content versioning
-- HU-21, HU-20: Sync queue and content bundles

CREATE TABLE sync_events (
  id UUID PRIMARY KEY, -- Client-generated UUID for idempotency
  pseudonym_id UUID NOT NULL REFERENCES profiles(pseudonym_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_events_pseudonym ON sync_events(pseudonym_id);
CREATE INDEX idx_sync_events_type ON sync_events(event_type);

CREATE TABLE content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  version INT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  bundle_url TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(area, grade_level, version)
);

-- Enable RLS
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;

-- Sync events: service role inserts, users can't read others' events
CREATE POLICY sync_events_insert_service ON sync_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY sync_events_select_own ON sync_events
  FOR SELECT USING (
    pseudonym_id = (SELECT pseudonym_id FROM profiles WHERE id = auth.uid())
  );

-- Content versions: all authenticated users can read
CREATE POLICY content_versions_select_auth ON content_versions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY content_versions_insert_service ON content_versions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
