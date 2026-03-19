-- Migration 20260319120000: sections, privacy hardening, and admin policies
-- HU-25, HU-26, HU-29

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_code TEXT NOT NULL,
  section_code TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_code, section_code)
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id),
  ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_sections_school_section ON sections(school_code, section_code);
CREATE INDEX IF NOT EXISTS idx_profiles_section_id ON profiles(section_id);

CREATE TABLE IF NOT EXISTS teacher_student_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  student_pseudonym_id UUID NOT NULL REFERENCES profiles(pseudonym_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, student_pseudonym_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_aliases_teacher ON teacher_student_aliases(teacher_id);

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_student_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_school ON profiles;
DROP POLICY IF EXISTS student_profiles_select_teacher ON student_profiles;

CREATE POLICY sections_select_own ON sections
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.section_id = sections.id
    )
  );

CREATE POLICY sections_select_admin ON sections
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY teacher_aliases_select_own ON teacher_student_aliases
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY teacher_aliases_insert_own ON teacher_student_aliases
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY teacher_aliases_update_own ON teacher_student_aliases
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY profiles_select_admin ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles AS admin_profiles
      WHERE admin_profiles.id = auth.uid()
        AND admin_profiles.role = 'admin'
    )
  );

CREATE POLICY student_profiles_select_teacher_same_section ON student_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles AS teacher_profiles
      JOIN profiles AS student_profiles_owner ON student_profiles_owner.id = student_profiles.user_id
      WHERE teacher_profiles.id = auth.uid()
        AND teacher_profiles.role = 'docente'
        AND teacher_profiles.section_id IS NOT NULL
        AND teacher_profiles.section_id = student_profiles_owner.section_id
    )
  );

CREATE POLICY student_profiles_select_admin ON student_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY mastery_select_admin ON skill_mastery
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY attempts_agg_select_admin ON exercise_attempts_aggregated
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY assignments_select_admin ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY content_versions_select_admin ON content_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY sync_events_select_admin ON sync_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY access_log_select_admin ON access_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );
