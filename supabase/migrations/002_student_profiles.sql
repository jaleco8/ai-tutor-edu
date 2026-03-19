-- Migration 002: Student profiles for onboarding
-- HU-04: Grade and area selection

CREATE TABLE student_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  school_level TEXT CHECK (school_level IN ('primaria', 'media')),
  grade_level TEXT NOT NULL,
  selected_areas TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

-- Students can read/update their own profile
CREATE POLICY student_profiles_select_own ON student_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY student_profiles_update_own ON student_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY student_profiles_insert_own ON student_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Teachers can read student profiles in their school
CREATE POLICY student_profiles_select_teacher ON student_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'docente'
        AND p.school_code = (
          SELECT school_code FROM profiles WHERE id = student_profiles.user_id
        )
    )
  );
