-- Migration 20260325001000: fix recursive RLS policies on profiles
-- Removes self-referential SELECT policies that can trigger
-- "infinite recursion detected in policy for relation \"profiles\""

DROP POLICY IF EXISTS profiles_select_school ON profiles;
DROP POLICY IF EXISTS profiles_select_admin ON profiles;

-- Keep direct, non-recursive access patterns only.
-- (profiles_select_own and profiles_update_own remain in place)
