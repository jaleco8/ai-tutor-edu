import * as Crypto from 'expo-crypto';
import JSZip from 'jszip';
import { API_URL } from '../config';
import {
  AssignmentSummary,
  AuthSession,
  ContentBundleManifest,
  ContentBundlePayload,
  TeacherSummaryRow,
  TutorMode,
  UserProfile,
} from '../types';

type RegisterInput = {
  email: string;
  password: string;
  role: 'estudiante' | 'docente';
  schoolCode: string;
  sectionCode: string;
  fullName?: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type RequestOptions = {
  accessToken?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  const payload = await request<AuthSession>('/auth/register', {
    method: 'POST',
    body: input,
  });

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    profile: payload.profile ?? payload,
  } as AuthSession;
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const payload = await request<AuthSession>('/auth/login', {
    method: 'POST',
    body: input,
  });

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    profile: payload.profile ?? payload,
  } as AuthSession;
}

export async function refreshSession(session: AuthSession) {
  const refreshed = await request<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  });

  return {
    ...session,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
  };
}

export async function fetchProfile(accessToken: string) {
  return request<UserProfile>('/auth/me', { accessToken });
}

export async function updateProfile(
  accessToken: string,
  input: { gradeLevel: string; schoolLevel: string; selectedAreas: string[] },
) {
  return request<{ success: boolean }>('/content/profile', {
    accessToken,
    method: 'PATCH',
    body: input,
  });
}

export async function fetchBundleManifest(accessToken: string, area: string, gradeLevel: string) {
  const query = new URLSearchParams({ area, grade: gradeLevel });
  return request<ContentBundleManifest>(`/content/bundle?${query.toString()}`, { accessToken });
}

export async function downloadBundle(manifest: ContentBundleManifest): Promise<ContentBundlePayload> {
  const response = await fetch(manifest.signedUrl);
  if (!response.ok) {
    throw new Error('No se pudo descargar el bundle curricular');
  }

  const archiveBuffer = await response.arrayBuffer();
  const archive = await JSZip.loadAsync(archiveBuffer);
  const bundleFile = archive.file('bundle.json');

  if (!bundleFile) {
    throw new Error('El bundle descargado no contiene bundle.json');
  }

  const bundleText = await bundleFile.async('string');
  const hashSha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, bundleText);

  if (hashSha256 !== manifest.hashSha256) {
    throw new Error('El hash del bundle no coincide con el manifiesto');
  }

  return JSON.parse(bundleText) as ContentBundlePayload;
}

export async function fetchStudentAssignments(accessToken: string) {
  return request<AssignmentSummary[]>('/content/assignments', { accessToken });
}

export async function fetchDiagnosticExercises(accessToken: string, area: string, gradeLevel: string) {
  const query = new URLSearchParams({ area, grade: gradeLevel });
  return request<ContentBundlePayload['exercises']>(`/exercises/diagnostic?${query.toString()}`, { accessToken });
}

export async function submitDiagnostic(
  accessToken: string,
  body: {
    skipped?: boolean;
    results?: Array<{ skillId: string; correctCount: number; totalAttempts: number }>;
  },
) {
  return request('/exercises/diagnostic-result', {
    accessToken,
    method: 'POST',
    body,
  });
}

export async function evaluateExercise(
  accessToken: string,
  body: { exerciseId: string; answer: string; mode: TutorMode },
) {
  return request<{ isCorrect: boolean | null; feedback: string; status: 'evaluated' | 'pending_review' }>('/exercises/evaluate', {
    accessToken,
    method: 'POST',
    body,
  });
}

export async function chatWithTutor(
  accessToken: string,
  body: {
    skillId: string;
    sessionId: string;
    message: string;
    exerciseContext?: string;
    mode: TutorMode;
  },
) {
  return request<{ response: string; mode: TutorMode; sessionId: string }>('/tutor/chat', {
    accessToken,
    method: 'POST',
    body,
  });
}

export async function fetchTeacherSummary(accessToken: string, area?: string) {
  const query = area ? `?${new URLSearchParams({ area }).toString()}` : '';
  return request<TeacherSummaryRow[]>(`/teacher/section-summary${query}`, { accessToken });
}

export async function createAssignment(
  accessToken: string,
  body: {
    skillId: string;
    deadline: string;
    targetScope: 'all' | 'selected';
    targetStudents?: string[];
  },
) {
  return request('/teacher/assignments', {
    accessToken,
    method: 'POST',
    body,
  });
}

export async function fetchTeacherAssignments(accessToken: string) {
  return request<AssignmentSummary[]>('/teacher/assignments', { accessToken });
}

export async function syncEvents(
  accessToken: string,
  events: Array<{ id: string; eventType: string; payload: Record<string, unknown> }>,
) {
  return request<{ processed: number; skipped: number }>('/sync/events', {
    accessToken,
    method: 'POST',
    body: { events },
  });
}
