-- Migration 007: Aggregated views for teacher dashboard
-- HU-16, HU-26: Section-level metrics only (no individual student data)

CREATE OR REPLACE VIEW section_skill_summary AS
SELECT
  p.school_code,
  s.area,
  s.id AS skill_id,
  s.name AS skill_name,
  s.grade_level,
  COUNT(DISTINCT sm.pseudonym_id) AS total_students,
  COUNT(DISTINCT CASE WHEN sm.status = 'dominado' THEN sm.pseudonym_id END) AS mastered_count,
  COUNT(DISTINCT CASE WHEN sm.status = 'en_proceso' THEN sm.pseudonym_id END) AS in_progress_count,
  COUNT(DISTINCT CASE WHEN sm.status = 'sin_datos' THEN sm.pseudonym_id END) AS not_started_count,
  ROUND(
    COUNT(DISTINCT CASE WHEN sm.status = 'dominado' THEN sm.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT sm.pseudonym_id), 0) * 100, 1
  ) AS pct_mastered,
  ROUND(
    COUNT(DISTINCT CASE WHEN sm.status = 'en_proceso' THEN sm.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT sm.pseudonym_id), 0) * 100, 1
  ) AS pct_in_progress,
  ROUND(
    COUNT(DISTINCT CASE WHEN sm.status = 'sin_datos' THEN sm.pseudonym_id END)::DECIMAL
    / NULLIF(COUNT(DISTINCT sm.pseudonym_id), 0) * 100, 1
  ) AS pct_not_started
FROM skills s
CROSS JOIN profiles p
LEFT JOIN skill_mastery sm ON sm.skill_id = s.id
  AND sm.pseudonym_id IN (
    SELECT pseudonym_id FROM profiles
    WHERE school_code = p.school_code AND role = 'estudiante'
  )
WHERE p.role = 'docente'
GROUP BY p.school_code, s.area, s.id, s.name, s.grade_level;
