-- Migration 20260319123000: section-aware assignments, aggregated sync, and teacher dashboard
-- HU-16, HU-18, HU-20, HU-21, HU-26

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id),
  ADD COLUMN IF NOT EXISTS target_scope TEXT NOT NULL DEFAULT 'all' CHECK (target_scope IN ('all', 'selected')),
  ADD COLUMN IF NOT EXISTS target_students JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE assignments
SET section_id = profiles.section_id
FROM profiles
WHERE profiles.id = assignments.teacher_id
  AND assignments.section_id IS NULL;

ALTER TABLE assignments
  ALTER COLUMN section_id SET NOT NULL;

ALTER TABLE assignment_completions
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id);

UPDATE assignment_completions
SET section_id = assignments.section_id
FROM assignments
WHERE assignments.id = assignment_completions.assignment_id
  AND assignment_completions.section_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_section_id ON assignments(section_id);
CREATE INDEX IF NOT EXISTS idx_assignment_completions_section_id ON assignment_completions(section_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_agg_period
  ON exercise_attempts_aggregated(pseudonym_id, skill_id, period_start, period_end);

ALTER TABLE sync_events
  DROP CONSTRAINT IF EXISTS sync_events_event_type_check;

ALTER TABLE sync_events
  ADD CONSTRAINT sync_events_event_type_check CHECK (
    event_type IN (
      'practice_summary',
      'mastery_update',
      'assignment_completed',
      'usage_minutes',
      'diagnostic_skipped',
      'translation_review'
    )
  );

DROP POLICY IF EXISTS assignments_insert_teacher ON assignments;
DROP POLICY IF EXISTS assignments_update_teacher ON assignments;
DROP POLICY IF EXISTS assignments_select_student ON assignments;

CREATE POLICY assignments_insert_teacher ON assignments
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
    AND section_id = (
      SELECT section_id
      FROM profiles
      WHERE id = auth.uid()
    )
  );

CREATE POLICY assignments_update_teacher ON assignments
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY assignments_select_student ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'estudiante'
        AND profiles.section_id = assignments.section_id
        AND (
          assignments.target_scope = 'all'
          OR assignments.target_students @> to_jsonb(ARRAY[profiles.pseudonym_id::text])
        )
    )
  );

DROP VIEW IF EXISTS section_skill_summary;

CREATE VIEW section_skill_summary
WITH (security_invoker = on) AS
WITH teacher_sections AS (
  SELECT
    p.id AS teacher_id,
    p.section_id,
    p.school_code
  FROM profiles p
  WHERE p.role = 'docente'
    AND p.section_id IS NOT NULL
),
section_students AS (
  SELECT
    p.section_id,
    p.school_code,
    p.pseudonym_id,
    sp.grade_level
  FROM profiles p
  JOIN student_profiles sp ON sp.user_id = p.id
  WHERE p.role = 'estudiante'
    AND p.section_id IS NOT NULL
)
SELECT
  ts.teacher_id,
  ts.section_id,
  sections.section_code,
  ts.school_code,
  skills.area,
  skills.id AS skill_id,
  skills.name AS skill_name,
  skills.grade_level,
  COUNT(DISTINCT section_students.pseudonym_id) AS total_students,
  COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'dominado' THEN section_students.pseudonym_id END) AS mastered_count,
  COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'en_proceso' THEN section_students.pseudonym_id END) AS in_progress_count,
  COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'sin_datos' THEN section_students.pseudonym_id END) AS not_started_count,
  ROUND(
    COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'dominado' THEN section_students.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT section_students.pseudonym_id), 0) * 100,
    1
  ) AS pct_mastered,
  ROUND(
    COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'en_proceso' THEN section_students.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT section_students.pseudonym_id), 0) * 100,
    1
  ) AS pct_in_progress,
  ROUND(
    COUNT(DISTINCT CASE WHEN COALESCE(skill_mastery.status, 'sin_datos') = 'sin_datos' THEN section_students.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT section_students.pseudonym_id), 0) * 100,
    1
  ) AS pct_not_started
FROM teacher_sections ts
JOIN sections ON sections.id = ts.section_id
JOIN section_students ON section_students.section_id = ts.section_id
JOIN skills ON skills.grade_level = section_students.grade_level
LEFT JOIN skill_mastery ON skill_mastery.pseudonym_id = section_students.pseudonym_id
  AND skill_mastery.skill_id = skills.id
GROUP BY
  ts.teacher_id,
  ts.section_id,
  sections.section_code,
  ts.school_code,
  skills.area,
  skills.id,
  skills.name,
  skills.grade_level;
