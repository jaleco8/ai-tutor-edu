-- Migration 001: Profiles table
-- HU-01, HU-25: User profiles with pseudonymous IDs

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pseudonym_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('estudiante', 'docente', 'admin')),
  school_code TEXT NOT NULL,
  full_name TEXT, -- Only stored here, never in logs or events
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for school-level queries
CREATE INDEX idx_profiles_school_code ON profiles(school_code);
CREATE INDEX idx_profiles_role ON profiles(role);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Teachers can read profiles of students in their school
CREATE POLICY profiles_select_school ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'docente'
        AND p.school_code = profiles.school_code
    )
  );

-- Users can update their own profile
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Service role can insert (used during registration)
CREATE POLICY profiles_insert_service ON profiles
  FOR INSERT WITH CHECK (true);
