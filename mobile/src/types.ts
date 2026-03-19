export type UserRole = 'estudiante' | 'docente';
export type TutorMode = 'online' | 'offline';
export type SkillStatus = 'bloqueada' | 'disponible' | 'sin_datos' | 'en_proceso' | 'dominado';
export type SyncEventType =
  | 'practice_summary'
  | 'mastery_update'
  | 'assignment_completed'
  | 'usage_minutes'
  | 'diagnostic_skipped'
  | 'translation_review';

export interface UserProfile {
  pseudonymId: string | null;
  role: UserRole | null;
  schoolCode: string | null;
  sectionCode: string | null;
  sectionId: string | null;
  isMinor: boolean | null;
  gradeLevel: string | null;
  schoolLevel: string | null;
  selectedAreas: string[];
  onboardingCompleted: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  profile: UserProfile;
}

export interface ContentBundleManifest {
  area: string;
  gradeLevel: string;
  version: number;
  hashSha256: string;
  signedUrl: string;
}

export interface ContentBundlePayload {
  area: string;
  gradeLevel: string;
  skills: LocalSkill[];
  exercises: LocalExercise[];
  hints: LocalHint[];
  generatedAt: string;
}

export interface LocalSkill {
  id: string;
  area: string;
  grade_level: string;
  name: string;
  description: string | null;
  sequence_order: number;
  prerequisite_skill_id: string | null;
}

export interface LocalExercise {
  id: string;
  skill_id: string;
  type: string;
  content: {
    question?: string;
    options?: string[];
    feedback_correct?: string;
    feedback_incorrect?: string;
    context?: string;
  };
  correct_answer: string | number | string[];
  difficulty: number;
  is_diagnostic: boolean;
}

export interface LocalHint {
  id: string;
  skill_id: string;
  hint_type: string;
  content: string;
  sequence_order: number;
}

export interface LocalMastery {
  skillId: string;
  skillName: string;
  area: string;
  accuracyRate: number;
  attemptsCount: number;
  status: SkillStatus;
  lastPracticedAt: string | null;
}

export interface PracticeResult {
  isCorrect: boolean | null;
  feedback: string;
  status: 'evaluated' | 'pending_review';
}

export interface ExitTicket {
  skillId: string;
  accuracyRate: number;
  weakExercises: string[];
  recommendedSkillId: string | null;
}

export interface AssignmentSummary {
  id: string;
  skill_id: string;
  deadline: string;
  target_scope?: 'all' | 'selected';
  target_students?: string[];
  skills?: { name: string; area: string } | null;
  completedAt?: string | null;
  isCompleted?: boolean;
  completionCount?: number;
  targetedCount?: number;
  completionRate?: number;
}

export interface TeacherSummaryRow {
  teacher_id: string;
  section_id: string;
  section_code: string;
  school_code: string;
  area: string;
  skill_id: string;
  skill_name: string;
  grade_level: string;
  total_students: number;
  mastered_count: number;
  in_progress_count: number;
  not_started_count: number;
  pct_mastered: number;
  pct_in_progress: number;
  pct_not_started: number;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  message: string;
  createdAt: string;
  mode: TutorMode;
}

export interface SyncQueueItem {
  id: string;
  eventType: SyncEventType;
  payload: Record<string, unknown>;
  retryCount: number;
  nextRetryAt: string | null;
  syncedAt: string | null;
}
