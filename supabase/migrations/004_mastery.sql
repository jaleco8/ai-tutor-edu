-- Migration 004: Skill mastery tracking
-- HU-05, HU-13: Diagnostic results and mastery model

CREATE TABLE skill_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym_id UUID NOT NULL REFERENCES profiles(pseudonym_id),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sin_datos' CHECK (status IN (
    'sin_datos', 'en_proceso', 'dominado'
  )),
  accuracy_rate DECIMAL(5,2) DEFAULT 0,
  attempts_count INT DEFAULT 0,
  source TEXT CHECK (source IN ('diagnostico', 'practica', 'sync')),
  last_practiced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pseudonym_id, skill_id)
);

CREATE INDEX idx_mastery_pseudonym ON skill_mastery(pseudonym_id);
CREATE INDEX idx_mastery_skill ON skill_mastery(skill_id);

-- Aggregated exercise attempts (synced from mobile, not per-attempt)
CREATE TABLE exercise_attempts_aggregated (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym_id UUID NOT NULL REFERENCES profiles(pseudonym_id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  total_attempts INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  total_time_seconds INT NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attempts_agg_pseudonym ON exercise_attempts_aggregated(pseudonym_id);

-- Enable RLS
ALTER TABLE skill_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_attempts_aggregated ENABLE ROW LEVEL SECURITY;

-- Students can read their own mastery data (via pseudonym_id)
CREATE POLICY mastery_select_own ON skill_mastery
  FOR SELECT USING (
    pseudonym_id = (SELECT pseudonym_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY mastery_insert_service ON skill_mastery
  FOR INSERT WITH CHECK (true);

CREATE POLICY mastery_update_service ON skill_mastery
  FOR UPDATE USING (true);

CREATE POLICY attempts_agg_select_own ON exercise_attempts_aggregated
  FOR SELECT USING (
    pseudonym_id = (SELECT pseudonym_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY attempts_agg_insert_service ON exercise_attempts_aggregated
  FOR INSERT WITH CHECK (true);
