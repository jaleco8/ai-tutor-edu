-- Migration 003: Skills, exercises, and hints
-- HU-09, HU-10, HU-07: Exercise engine and offline hints

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL CHECK (area IN ('matematicas', 'ingles', 'programacion')),
  grade_level TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sequence_order INT NOT NULL,
  prerequisite_skill_id UUID REFERENCES skills(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skills_area_grade ON skills(area, grade_level);

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'multiple_choice', 'numeric', 'order_steps',
    'dialogue', 'word_order', 'translation'
  )),
  content JSONB NOT NULL, -- question text, options, feedback messages
  correct_answer JSONB NOT NULL,
  difficulty INT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  is_diagnostic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exercises_skill ON exercises(skill_id);
CREATE INDEX idx_exercises_diagnostic ON exercises(is_diagnostic) WHERE is_diagnostic = true;

CREATE TABLE skill_hints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  hint_type TEXT NOT NULL CHECK (hint_type IN (
    'error_frecuente', 'concepto_clave', 'pregunta_socratica', 'ejemplo_contextual'
  )),
  content TEXT NOT NULL,
  sequence_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hints_skill ON skill_hints(skill_id);

-- Enable RLS
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_hints ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read skills, exercises, and hints
CREATE POLICY skills_select_auth ON skills
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY exercises_select_auth ON exercises
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY hints_select_auth ON skill_hints
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only service role can write (admin operations via backend)
CREATE POLICY skills_insert_service ON skills
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY exercises_insert_service ON exercises
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY hints_insert_service ON skill_hints
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
