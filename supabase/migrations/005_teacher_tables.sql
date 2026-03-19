-- Migration 005: Teacher assignments and access logging
-- HU-18, HU-26: Assignments and privacy controls

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id),
  school_code TEXT NOT NULL,
  skill_id UUID NOT NULL REFERENCES skills(id),
  deadline TIMESTAMPTZ NOT NULL,
  target TEXT NOT NULL DEFAULT 'all', -- 'all' or JSON array of pseudonym_ids
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_teacher ON assignments(teacher_id);
CREATE INDEX idx_assignments_school ON assignments(school_code);

CREATE TABLE assignment_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  pseudonym_id UUID NOT NULL REFERENCES profiles(pseudonym_id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, pseudonym_id)
);

-- Access log for privacy tracking (HU-26)
CREATE TABLE access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id),
  accessed_pseudonym_id UUID REFERENCES profiles(pseudonym_id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_log_teacher ON access_log(teacher_id);

-- Enable RLS
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

-- Teachers can CRUD their own assignments
CREATE POLICY assignments_select_teacher ON assignments
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY assignments_insert_teacher ON assignments
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY assignments_update_teacher ON assignments
  FOR UPDATE USING (teacher_id = auth.uid());

-- Students can read assignments for their school
CREATE POLICY assignments_select_student ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'estudiante'
        AND school_code = assignments.school_code
    )
  );

-- Completions: service role inserts, teacher reads
CREATE POLICY completions_insert_service ON assignment_completions
  FOR INSERT WITH CHECK (true);

CREATE POLICY completions_select_teacher ON assignment_completions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM assignments
      WHERE assignments.id = assignment_completions.assignment_id
        AND assignments.teacher_id = auth.uid()
    )
  );

-- Access log: only the teacher can read their own access log
CREATE POLICY access_log_insert_service ON access_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY access_log_select_own ON access_log
  FOR SELECT USING (teacher_id = auth.uid());
