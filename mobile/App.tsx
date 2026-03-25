import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  chatWithTutor,
  createAssignment,
  downloadBundle,
  evaluateExercise,
  fetchBundleManifest,
  fetchProfile,
  fetchStudentAssignments,
  fetchTeacherAssignments,
  fetchTeacherSummary,
  login,
  refreshSession,
  register,
  submitDiagnostic,
  syncEvents,
  updateProfile,
} from './src/services/api';
import { clearSession, loadSession, saveSession } from './src/services/session';
import {
  getChatTurns,
  getDiagnosticExercises,
  getMastery,
  getOfflineHint,
  getPendingSyncEvents,
  getPracticeExercises,
  getRecentAttempts,
  getSkills,
  initDatabase,
  markSyncEventsSynced,
  queueSyncEvent,
  recordAttempt,
  saveBundle,
  scheduleRetry,
  upsertChatTurn,
} from './src/db/database';
import { appendChatTurn, buildExitTicket, buildRecommendation, evaluateLocalExercise } from './src/utils/learning';
import {
  AssignmentSummary,
  AuthSession,
  ChatTurn,
  ExitTicket,
  LocalExercise,
  LocalMastery,
  LocalSkill,
  TeacherSummaryRow,
  TutorMode,
  UserRole,
} from './src/types';
import { API_URL } from './src/config';

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen =
  | 'loading'
  | 'auth'
  | 'connection-test'
  | 'onboarding'
  | 'diagnostic'
  | 'student-home'
  | 'practice'
  | 'tutor'
  | 'skills'
  | 'teacher-home';

type AuthFormState = {
  mode: 'login' | 'register';
  role: UserRole;
  email: string;
  password: string;
  fullName: string;
  schoolCode: string;
  sectionCode: string;
};

// ─── Static data ─────────────────────────────────────────────────────────────

const initialAuthForm: AuthFormState = {
  mode: 'login',
  role: 'estudiante',
  email: '',
  password: '',
  fullName: '',
  schoolCode: '',
  sectionCode: '',
};

const schoolLevels = [
  { value: 'primaria', label: 'Educación Primaria' },
  { value: 'media', label: 'Educación Media' },
];

const gradeData: Record<string, Array<{ value: string; label: string }>> = {
  primaria: [
    { value: 'primaria_1', label: '1er Grado' },
    { value: 'primaria_2', label: '2do Grado' },
    { value: 'primaria_3', label: '3er Grado' },
    { value: 'primaria_4', label: '4to Grado' },
    { value: 'primaria_5', label: '5to Grado' },
    { value: 'primaria_6', label: '6to Grado' },
  ],
  media: [
    { value: 'media_1', label: '1er Año' },
    { value: 'media_2', label: '2do Año' },
    { value: 'media_3', label: '3er Año' },
    { value: 'media_4', label: '4to Año' },
    { value: 'media_5', label: '5to Año' },
  ],
};

const areaData = [
  { value: 'matematicas', label: 'Matemáticas', icon: '📐' },
  { value: 'ingles', label: 'Inglés', icon: '💬' },
  { value: 'programacion', label: 'Programación', icon: '💻' },
];

function gradeLabel(value: string): string {
  for (const grades of Object.values(gradeData)) {
    const found = grades.find((g) => g.value === value);
    if (found) return found.label;
  }
  return value;
}

function areaLabel(value: string): string {
  return areaData.find((a) => a.value === value)?.label ?? value;
}

function areaIcon(value: string): string {
  return areaData.find((a) => a.value === value)?.icon ?? '📚';
}

function formatIsoDateForInput(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToDeadlineIso(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const localEndOfDay = new Date(`${dateInput}T23:59:59`);
  if (Number.isNaN(localEndOfDay.getTime())) return null;
  return localEndOfDay.toISOString();
}

function formatReadableDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  bloqueada: { label: 'Bloqueada', color: '#9ca3af', bg: '#f3f4f6' },
  disponible: { label: 'Disponible', color: '#3b82f6', bg: '#eff6ff' },
  en_proceso: { label: 'En proceso', color: '#f59e0b', bg: '#fffbeb' },
  dominada: { label: 'Dominada', color: '#10b981', bg: '#ecfdf5' },
};

// ─── App component ────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [authForm, setAuthForm] = useState<AuthFormState>(initialAuthForm);
  const [onboarding, setOnboarding] = useState({
    schoolLevel: 'media',
    gradeLevel: 'media_1',
    selectedAreas: ['matematicas', 'ingles'],
  });
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [mastery, setMastery] = useState<LocalMastery[]>([]);
  const [diagnosticExercises, setDiagnosticExercises] = useState<LocalExercise[]>([]);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Record<string, boolean>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [practiceExercises, setPracticeExercises] = useState<LocalExercise[]>([]);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({});
  const [practiceFeedback, setPracticeFeedback] = useState<Record<string, string>>({});
  const [exitTicket, setExitTicket] = useState<ExitTicket | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [studentAssignments, setStudentAssignments] = useState<AssignmentSummary[]>([]);
  const [teacherSummary, setTeacherSummary] = useState<TeacherSummaryRow[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<AssignmentSummary[]>([]);
  const [assignmentDraft, setAssignmentDraft] = useState({
    skillId: '',
    deadlineDate: formatIsoDateForInput(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()),
  });

  // --- DEBUG: connection test ---
  const [debugLog, setDebugLog] = useState<Array<{ label: string; status: 'pending' | 'ok' | 'error'; detail: string }>>([]);
  const [debugEmail, setDebugEmail] = useState('');
  const [debugPassword, setDebugPassword] = useState('');

  const recommendation = useMemo(() => buildRecommendation(skills, mastery), [skills, mastery]);
  const activeSkill = useMemo(
    () => skills.find((s) => s.id === (selectedSkillId ?? recommendation?.skillId ?? null)) ?? null,
    [recommendation?.skillId, selectedSkillId, skills],
  );
  const teacherSkillOptions = useMemo(
    () => Array.from(new Map(teacherSummary.map((row) => [row.skill_id, row])).values()),
    [teacherSummary],
  );
  const selectedTeacherSkill = useMemo(
    () => teacherSkillOptions.find((row) => row.skill_id === assignmentDraft.skillId) ?? null,
    [assignmentDraft.skillId, teacherSkillOptions],
  );

  useEffect(() => {
    const subscription = NetInfo.addEventListener((state) => {
      setIsConnected(Boolean(state.isConnected));
    });
    NetInfo.fetch().then((state) => setIsConnected(Boolean(state.isConnected)));
    void bootstrap();
    return () => subscription();
  }, []);

  useEffect(() => {
    if (!session) return;
    void hydrateLocalState(session.profile.selectedAreas);

    if (session.profile.role === 'docente') {
      void loadTeacherData(session);
      setScreen('teacher-home');
      return;
    }

    if (!session.profile.onboardingCompleted) {
      setScreen('onboarding');
      return;
    }

    void loadStudentAssignments(session);
    void syncPending(session);
    setScreen('student-home');
  }, [session, isConnected]);

  async function bootstrap() {
    try {
      await initDatabase();
      const stored = await loadSession();

      if (!stored) {
        setScreen('auth');
        return;
      }

      let activeSession = stored;
      if (isConnected) {
        try {
          const refreshed = await refreshSession(stored);
          const profile = await fetchProfile(refreshed.accessToken);
          activeSession = { ...refreshed, profile };
          await saveSession(activeSession);
        } catch {
          const hasLocalProfile = Boolean(stored.profile?.selectedAreas?.length);
          activeSession = stored;
          if (!hasLocalProfile) {
            await clearSession();
            setScreen('auth');
            return;
          }
        }
      }

      setSession(activeSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar la app');
      setScreen('auth');
    }
  }

  async function hydrateLocalState(selectedAreas: string[]) {
    const localSkills = await getSkills(selectedAreas);
    const localMastery = await getMastery();
    setSkills(localSkills);
    setMastery(localMastery);
  }

  async function handleAuthSubmit() {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const nextSession =
        authForm.mode === 'register'
          ? await register({
              email: authForm.email,
              password: authForm.password,
              role: authForm.role,
              schoolCode: authForm.schoolCode,
              sectionCode: authForm.sectionCode,
              fullName: authForm.fullName || undefined,
            })
          : await login({ email: authForm.email, password: authForm.password });

      let profile = nextSession.profile;
      try {
        profile = await fetchProfile(nextSession.accessToken);
      } catch {
        // fallback to data from login/register
      }
      const mergedSession = { ...nextSession, profile };
      await saveSession(mergedSession);
      setSession(mergedSession);
      setAuthForm(initialAuthForm);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo autenticar');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    await clearSession();
    setSession(null);
    setSkills([]);
    setMastery([]);
    setTeacherSummary([]);
    setTeacherAssignments([]);
    setStudentAssignments([]);
    setScreen('auth');
  }

  async function handleOnboardingSubmit(runDiagnosticAfterSave: boolean) {
    if (!session) return;
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await updateProfile(session.accessToken, onboarding);

      for (const area of onboarding.selectedAreas.filter((v) => v !== 'programacion')) {
        const manifest = await fetchBundleManifest(session.accessToken, area, onboarding.gradeLevel);
        const bundle = await downloadBundle(manifest);
        await saveBundle(bundle, manifest.version, manifest.hashSha256);
      }

      const profile = {
        ...session.profile,
        schoolLevel: onboarding.schoolLevel,
        gradeLevel: onboarding.gradeLevel,
        selectedAreas: onboarding.selectedAreas,
        onboardingCompleted: true,
      };

      const nextSession = { ...session, profile };
      await saveSession(nextSession);
      setSession(nextSession);
      await hydrateLocalState(profile.selectedAreas);

      const diagnostics = await getDiagnosticExercises(profile.selectedAreas, onboarding.gradeLevel);
      setDiagnosticExercises(diagnostics.slice(0, 8));
      setDiagnosticAnswers({});
      setScreen(runDiagnosticAfterSave ? 'diagnostic' : 'student-home');

      if (!runDiagnosticAfterSave) {
        await submitDiagnostic(session.accessToken, { skipped: true });
        await queueSyncEvent(cryptoId(), 'diagnostic_skipped', { skippedAt: new Date().toISOString() });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar el onboarding');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDiagnosticSubmit() {
    if (!session) return;
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const bySkill = new Map<string, { correctCount: number; totalAttempts: number }>();
      for (const exercise of diagnosticExercises) {
        const current = bySkill.get(exercise.skill_id) ?? { correctCount: 0, totalAttempts: 0 };
        const understood = diagnosticAnswers[exercise.id] ?? false;
        current.correctCount += understood ? 1 : 0;
        current.totalAttempts += 1;
        bySkill.set(exercise.skill_id, current);
      }

      const results = Array.from(bySkill.entries()).map(([skillId, value]) => ({
        skillId,
        correctCount: value.correctCount,
        totalAttempts: value.totalAttempts,
      }));

      await submitDiagnostic(session.accessToken, { results });
      for (const result of results) {
        await queueSyncEvent(cryptoId(), 'mastery_update', {
          skillId: result.skillId,
          accuracyRate: (result.correctCount / Math.max(result.totalAttempts, 1)) * 100,
          attemptsCount: result.totalAttempts,
          lastPracticedAt: new Date().toISOString(),
        });
      }

      await hydrateLocalState(session.profile.selectedAreas);
      setScreen('student-home');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo registrar el diagnóstico');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadStudentAssignments(currentSession: AuthSession) {
    if (!isConnected) return;
    try {
      const assignments = await fetchStudentAssignments(currentSession.accessToken);
      setStudentAssignments(assignments);
    } catch {
      setStudentAssignments([]);
    }
  }

  async function loadTeacherData(currentSession: AuthSession) {
    if (!isConnected) return;
    try {
      const [summary, assignments] = await Promise.all([
        fetchTeacherSummary(currentSession.accessToken),
        fetchTeacherAssignments(currentSession.accessToken),
      ]);
      setTeacherSummary(summary);
      setTeacherAssignments(assignments);
      if (!assignmentDraft.skillId && summary[0]?.skill_id) {
        setAssignmentDraft((c) => ({ ...c, skillId: summary[0].skill_id }));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar el panel docente');
    }
  }

  async function openPractice(skillId: string) {
    setSelectedSkillId(skillId);
    const exercises = await getPracticeExercises(skillId, 10);
    setPracticeExercises(exercises);
    setPracticeAnswers({});
    setPracticeFeedback({});
    setExitTicket(null);
    setScreen('practice');
  }

  async function handlePracticeSubmit(exercise: LocalExercise) {
    if (!activeSkill || !session) return;
    const answer = practiceAnswers[exercise.id] ?? '';
    if (!answer.trim()) return;

    const startedAt = Date.now();
    const mode: TutorMode = isConnected ? 'online' : 'offline';
    const result =
      isConnected && exercise.type === 'translation'
        ? await evaluateExercise(session.accessToken, { exerciseId: exercise.id, answer, mode })
        : evaluateLocalExercise(exercise, answer);

    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setPracticeFeedback((c) => ({ ...c, [exercise.id]: result.feedback }));

    await recordAttempt({
      id: cryptoId(),
      exerciseId: exercise.id,
      skillId: exercise.skill_id,
      area: activeSkill.area,
      question: exercise.content.question ?? 'Pregunta',
      answer,
      isCorrect: result.isCorrect,
      status: result.status,
      timeSpentSeconds,
    });

    const updatedMastery = await getMastery();
    setMastery(updatedMastery);

    const currentSkillMastery = updatedMastery.find((e) => e.skillId === exercise.skill_id);
    await queueSyncEvent(
      cryptoId(),
      result.status === 'pending_review' ? 'translation_review' : 'practice_summary',
      {
        skillId: exercise.skill_id,
        totalAttempts: currentSkillMastery?.attemptsCount ?? 0,
        correctCount: Math.round(((currentSkillMastery?.accuracyRate ?? 0) / 100) * (currentSkillMastery?.attemptsCount ?? 0)),
        totalTimeSeconds: timeSpentSeconds,
        periodStart: new Date().toISOString().slice(0, 10),
        periodEnd: new Date().toISOString().slice(0, 10),
        lastPracticedAt: new Date().toISOString(),
      },
    );

    await queueSyncEvent(cryptoId(), 'mastery_update', {
      skillId: exercise.skill_id,
      status: currentSkillMastery?.status,
      accuracyRate: currentSkillMastery?.accuracyRate ?? 0,
      attemptsCount: currentSkillMastery?.attemptsCount ?? 0,
      lastPracticedAt: currentSkillMastery?.lastPracticedAt ?? new Date().toISOString(),
    });

    const recentAttempts = await getRecentAttempts(exercise.skill_id, 10);
    if (recentAttempts.length >= 10) {
      const ticket = buildExitTicket(exercise.skill_id, recentAttempts, buildRecommendation(skills, updatedMastery));
      setExitTicket(ticket);
    }
  }

  async function sendTutorMessage() {
    if (!activeSkill || !session || !chatInput.trim()) return;

    const mode: TutorMode = isConnected ? 'online' : 'offline';
    const userTurn: ChatTurn = {
      id: cryptoId(),
      role: 'user',
      message: chatInput,
      mode,
      createdAt: new Date().toISOString(),
    };

    await upsertChatTurn(activeSkill.id, userTurn);
    const localTurns = appendChatTurn(chatTurns, userTurn);
    setChatTurns(localTurns);

    let assistantMessage: string;
    if (isConnected) {
      const response = await chatWithTutor(session.accessToken, {
        skillId: activeSkill.id,
        sessionId: `skill-${activeSkill.id}`,
        message: chatInput,
        mode,
      });
      assistantMessage = response.response;
    } else {
      assistantMessage = await getOfflineHint(activeSkill.id, chatInput);
    }

    const assistantTurn: ChatTurn = {
      id: cryptoId(),
      role: 'assistant',
      message: assistantMessage,
      mode,
      createdAt: new Date().toISOString(),
    };

    await upsertChatTurn(activeSkill.id, assistantTurn);
    setChatTurns((c) => appendChatTurn(c, assistantTurn));
    setChatInput('');
  }

  async function openTutor(skillId: string) {
    setSelectedSkillId(skillId);
    setChatTurns(await getChatTurns(skillId));
    setScreen('tutor');
  }

  async function handleCreateAssignment() {
    if (!session) return;
    if (!assignmentDraft.skillId) {
      setErrorMessage('Selecciona una habilidad para crear la asignación.');
      return;
    }

    const deadlineIso = dateInputToDeadlineIso(assignmentDraft.deadlineDate);
    if (!deadlineIso) {
      setErrorMessage('Fecha límite inválida. Usa formato AAAA-MM-DD.');
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      await createAssignment(session.accessToken, {
        skillId: assignmentDraft.skillId,
        deadline: deadlineIso,
        targetScope: 'all',
      });
      await loadTeacherData(session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo crear la asignación');
    } finally {
      setIsBusy(false);
    }
  }

  async function syncPending(currentSession: AuthSession) {
    if (!isConnected) return;
    const pending = await getPendingSyncEvents();
    if (pending.length === 0) return;

    try {
      await syncEvents(
        currentSession.accessToken,
        pending.map((e) => ({ id: e.id, eventType: e.eventType, payload: e.payload })),
      );
      await markSyncEventsSynced(pending.map((e) => e.id));
    } catch {
      for (const event of pending) {
        await scheduleRetry(event.id, event.retryCount + 1);
      }
    }
  }

  // ─── Screens ───────────────────────────────────────────────────────────────

  function renderConnectionTest() {
    async function runCheck(label: string, fn: () => Promise<string>) {
      setDebugLog((prev) => [...prev, { label, status: 'pending', detail: '...' }]);
      try {
        const detail = await fn();
        setDebugLog((prev) => prev.map((e) => (e.label === label ? { label, status: 'ok', detail } : e)));
      } catch (err) {
        setDebugLog((prev) =>
          prev.map((e) => (e.label === label ? { label, status: 'error', detail: err instanceof Error ? err.message : String(err) } : e)),
        );
      }
    }

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Prueba de conexión</Text>
        <Text style={[styles.caption, { fontFamily: 'monospace' }]}>URL: {API_URL}</Text>

        <Btn label="Ping /health" onPress={() => void runCheck('GET /health', async () => {
          const res = await fetch(`${API_URL}/health`);
          const json = await res.json() as Record<string, unknown>;
          return `${res.status} — ${JSON.stringify(json)}`;
        })} />

        <Text style={styles.sectionLabel}>Login de prueba</Text>
        <Field label="Email" value={debugEmail} onChangeText={setDebugEmail} />
        <Field label="Contraseña" secureTextEntry value={debugPassword} onChangeText={setDebugPassword} />
        <Btn label="Probar login" onPress={() => void runCheck('POST /auth/login', async () => {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: debugEmail, password: debugPassword }),
          });
          const text = await res.text();
          return `${res.status} — ${text.slice(0, 200)}`;
        })} />

        <Btn label="Limpiar log" variant="outline" onPress={() => setDebugLog([])} />

        {debugLog.map((entry, i) => (
          <View
            key={i}
            style={[styles.debugRow, { backgroundColor: entry.status === 'ok' ? '#d1fae5' : entry.status === 'error' ? '#fee2e2' : '#fef3c7' }]}
          >
            <Text style={styles.debugLabel}>{entry.label}</Text>
            <Text style={styles.debugDetail}>{entry.detail}</Text>
          </View>
        ))}

        <Btn label="Volver al login" variant="outline" onPress={() => setScreen('auth')} />
      </View>
    );
  }

  function renderHeader() {
    const connDot = isConnected ? '🟢' : '🔴';
    return (
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>TutorIA Venezuela</Text>
          <Text style={styles.headerSub}>
            {connDot} {isConnected ? 'En línea' : 'Sin conexión'} · {session?.profile.sectionCode ?? '—'}
          </Text>
        </View>
        {session ? (
          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Salir</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderAuth() {
    const isLogin = authForm.mode === 'login';
    return (
      <View style={styles.card}>
        {/* App logo area */}
        <View style={styles.logoBlock}>
          <Text style={styles.logoEmoji}>🎓</Text>
          <Text style={styles.logoTitle}>TutorIA Venezuela</Text>
          <Text style={styles.logoSub}>Aprende sin límites</Text>
        </View>

        {/* Mode tabs */}
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, isLogin && styles.tabActive]}
            onPress={() => setAuthForm((c) => ({ ...c, mode: 'login' }))}
          >
            <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>Ingresar</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, !isLogin && styles.tabActive]}
            onPress={() => setAuthForm((c) => ({ ...c, mode: 'register' }))}
          >
            <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>Registrarse</Text>
          </Pressable>
        </View>

        {!isLogin && (
          <View style={styles.segmentRow}>
            <SegmentBtn
              label="Estudiante"
              active={authForm.role === 'estudiante'}
              onPress={() => setAuthForm((c) => ({ ...c, role: 'estudiante' }))}
            />
            <SegmentBtn
              label="Docente"
              active={authForm.role === 'docente'}
              onPress={() => setAuthForm((c) => ({ ...c, role: 'docente' }))}
            />
          </View>
        )}

        <Field
          label="Correo electrónico"
          value={authForm.email}
          onChangeText={(email) => setAuthForm((c) => ({ ...c, email }))}
          autoComplete="email"
        />
        <Field
          label="Contraseña"
          secureTextEntry
          value={authForm.password}
          onChangeText={(password) => setAuthForm((c) => ({ ...c, password }))}
        />

        {!isLogin && (
          <>
            <Field
              label="Nombre completo (opcional para estudiantes)"
              value={authForm.fullName}
              onChangeText={(fullName) => setAuthForm((c) => ({ ...c, fullName }))}
            />
            <Field
              label="Código de escuela"
              value={authForm.schoolCode}
              onChangeText={(schoolCode) => setAuthForm((c) => ({ ...c, schoolCode }))}
            />
            <Field
              label="Código de sección"
              value={authForm.sectionCode}
              onChangeText={(sectionCode) => setAuthForm((c) => ({ ...c, sectionCode }))}
            />
          </>
        )}

        <Btn label={isLogin ? 'Ingresar' : 'Crear cuenta'} onPress={handleAuthSubmit} />

        <Pressable onPress={() => setScreen('connection-test')}>
          <Text style={[styles.caption, { textAlign: 'center', textDecorationLine: 'underline', marginTop: 4 }]}>
            Verificar conexión con el backend
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderOnboarding() {
    const currentGrades = gradeData[onboarding.schoolLevel] ?? gradeData.media;

    return (
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.onboardingHeader}>
          <Text style={styles.logoEmoji}>📚</Text>
          <Text style={styles.cardTitle}>Configura tu perfil</Text>
          <Text style={styles.caption}>Cuéntanos un poco sobre ti para personalizar tu experiencia</Text>
        </View>

        {/* Step 1 */}
        <View style={styles.stepBlock}>
          <View style={styles.stepBadgeRow}>
            <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
            <Text style={styles.stepTitle}>Nivel escolar</Text>
          </View>
          <View style={styles.pillRow}>
            {schoolLevels.map((level) => (
              <Pill
                key={level.value}
                label={level.label}
                active={onboarding.schoolLevel === level.value}
                onPress={() => {
                  const firstGrade = (gradeData[level.value] ?? gradeData.media)[0].value;
                  setOnboarding((c) => ({ ...c, schoolLevel: level.value, gradeLevel: firstGrade }));
                }}
              />
            ))}
          </View>
        </View>

        {/* Step 2 */}
        <View style={styles.stepBlock}>
          <View style={styles.stepBadgeRow}>
            <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
            <Text style={styles.stepTitle}>
              {onboarding.schoolLevel === 'primaria' ? 'Grado' : 'Año'}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.pillRowScroll}>
              {currentGrades.map((grade) => (
                <Pill
                  key={grade.value}
                  label={grade.label}
                  active={onboarding.gradeLevel === grade.value}
                  onPress={() => setOnboarding((c) => ({ ...c, gradeLevel: grade.value }))}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Step 3 */}
        <View style={styles.stepBlock}>
          <View style={styles.stepBadgeRow}>
            <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View>
            <Text style={styles.stepTitle}>Áreas de estudio</Text>
          </View>
          <Text style={styles.caption}>Selecciona una o más áreas</Text>
          <View style={styles.areaGrid}>
            {areaData.map((area) => {
              const isActive = onboarding.selectedAreas.includes(area.value);
              return (
                <Pressable
                  key={area.value}
                  style={[styles.areaCard, isActive && styles.areaCardActive]}
                  onPress={() =>
                    setOnboarding((c) => ({
                      ...c,
                      selectedAreas: isActive
                        ? c.selectedAreas.filter((v) => v !== area.value)
                        : [...c.selectedAreas, area.value],
                    }))
                  }
                >
                  <Text style={styles.areaIcon}>{area.icon}</Text>
                  <Text style={[styles.areaLabel, isActive && styles.areaLabelActive]}>{area.label}</Text>
                  {isActive && <View style={styles.areaCheck}><Text style={styles.areaCheckText}>✓</Text></View>}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Actions */}
        <Btn label="Guardar y hacer diagnóstico" onPress={() => handleOnboardingSubmit(true)} />
        <Btn label="Guardar y comenzar directo" variant="outline" onPress={() => handleOnboardingSubmit(false)} />
      </View>
    );
  }

  function renderDiagnostic() {
    const answered = Object.keys(diagnosticAnswers).length;
    const total = diagnosticExercises.length;
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Diagnóstico inicial</Text>
        <Text style={styles.caption}>
          Indica si puedes resolver cada enunciado. Sé honesto — esto nos ayuda a empezar en el lugar correcto.
        </Text>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
        </View>
        <Text style={styles.caption}>{answered} de {total} respondidas</Text>

        {diagnosticExercises.map((exercise, idx) => (
          <View key={exercise.id} style={styles.diagCard}>
            <Text style={styles.diagNum}>Ejercicio {idx + 1}</Text>
            <Text style={styles.diagQuestion}>{exercise.content.question ?? 'Pregunta diagnóstica'}</Text>
            <View style={styles.diagBtnRow}>
              <Pressable
                style={[styles.diagBtn, diagnosticAnswers[exercise.id] === true && styles.diagBtnYes]}
                onPress={() => setDiagnosticAnswers((c) => ({ ...c, [exercise.id]: true }))}
              >
                <Text style={[styles.diagBtnText, diagnosticAnswers[exercise.id] === true && { color: '#fff' }]}>
                  ✓ Lo manejo
                </Text>
              </Pressable>
              <Pressable
                style={[styles.diagBtn, diagnosticAnswers[exercise.id] === false && styles.diagBtnNo]}
                onPress={() => setDiagnosticAnswers((c) => ({ ...c, [exercise.id]: false }))}
              >
                <Text style={[styles.diagBtnText, diagnosticAnswers[exercise.id] === false && { color: '#fff' }]}>
                  × Necesito apoyo
                </Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Btn label="Guardar diagnóstico" onPress={handleDiagnosticSubmit} />
      </View>
    );
  }

  function renderStudentHome() {
    const grade = gradeLabel(session?.profile.gradeLevel ?? '');
    const areas = (session?.profile.selectedAreas ?? []).map(areaLabel).join(', ');

    return (
      <View style={{ gap: 16 }}>
        {/* Welcome card */}
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeEmoji}>👋</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.welcomeTitle}>¡Hola!</Text>
            <Text style={styles.welcomeSub}>{grade} · {areas || 'Sin área seleccionada'}</Text>
          </View>
        </View>

        {/* Recommendation */}
        {recommendation ? (
          <View style={styles.recCard}>
            <View style={styles.recHeader}>
              <Text style={styles.recBadge}>Recomendado</Text>
            </View>
            <Text style={styles.recSkill}>{recommendation.skillName}</Text>
            <Text style={styles.recArea}>{areaLabel(recommendation.area ?? '')}</Text>
            <View style={styles.recActions}>
              <Pressable
                style={[styles.recBtn, { backgroundColor: C.primary }]}
                onPress={() => void openPractice(recommendation.skillId)}
              >
                <Text style={styles.recBtnTextWhite}>📝 Practicar</Text>
              </Pressable>
              <Pressable
                style={[styles.recBtn, { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd' }]}
                onPress={() => void openTutor(recommendation.skillId)}
              >
                <Text style={[styles.recBtnText, { color: '#1d4ed8' }]}>💡 Tutor</Text>
              </Pressable>
              <Pressable
                style={[styles.recBtn, { backgroundColor: C.surfaceAlt }]}
                onPress={() => setScreen('skills')}
              >
                <Text style={styles.recBtnText}>🗺 Mapa</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Sin contenido local. Conecta a internet para descargar tu material.</Text>
          </View>
        )}

        {/* Assignments */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Asignaciones activas</Text>
          {studentAssignments.length === 0 ? (
            <Text style={styles.caption}>No tienes asignaciones pendientes.</Text>
          ) : (
            studentAssignments.map((a) => (
              <Pressable key={a.id} style={styles.assignCard} onPress={() => void openPractice(a.skill_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assignTitle}>{a.skills?.name ?? a.skill_id}</Text>
                  <Text style={styles.assignMeta}>
                    {areaLabel(a.skills?.area ?? '')} · vence {new Date(a.deadline).toLocaleDateString('es-VE')}
                  </Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: a.isCompleted ? C.success : C.warning }]} />
              </Pressable>
            ))
          )}
        </View>
      </View>
    );
  }

  function renderPractice() {
    return (
      <View style={{ gap: 16 }}>
        {/* Skill header */}
        <View style={styles.skillHeader}>
          <Pressable onPress={() => setScreen('student-home')}>
            <Text style={styles.backBtn}>← Inicio</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.skillHeaderTitle}>{activeSkill?.name ?? 'Práctica'}</Text>
            <Text style={styles.skillHeaderArea}>{areaIcon(activeSkill?.area ?? '')} {areaLabel(activeSkill?.area ?? '')}</Text>
          </View>
        </View>

        {practiceExercises.map((exercise, idx) => {
          const selected = practiceAnswers[exercise.id];
          const feedback = practiceFeedback[exercise.id];
          const isCorrect = feedback && !feedback.toLowerCase().includes('incorrecto') && !feedback.toLowerCase().includes('error');

          return (
            <View key={exercise.id} style={styles.exerciseCard}>
              <View style={styles.exerciseNumRow}>
                <View style={styles.exerciseNumBadge}><Text style={styles.exerciseNumText}>{idx + 1}</Text></View>
                <Text style={styles.exerciseMeta}>Ejercicio</Text>
              </View>
              <Text style={styles.exerciseQ}>{exercise.content.question ?? 'Ejercicio'}</Text>

              {(exercise.content.options ?? []).map((opt) => {
                const isSelected = selected === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[styles.optionBtn, isSelected && styles.optionBtnSelected]}
                    onPress={() => setPracticeAnswers((c) => ({ ...c, [exercise.id]: opt }))}
                  >
                    <View style={[styles.optionRadio, isSelected && styles.optionRadioActive]} />
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{opt}</Text>
                  </Pressable>
                );
              })}

              {!(exercise.content.options ?? []).length && (
                <Field
                  label="Tu respuesta"
                  value={practiceAnswers[exercise.id] ?? ''}
                  onChangeText={(v) => setPracticeAnswers((c) => ({ ...c, [exercise.id]: v }))}
                />
              )}

              {!feedback && (
                <Pressable style={styles.evalBtn} onPress={() => void handlePracticeSubmit(exercise)}>
                  <Text style={styles.evalBtnText}>Evaluar respuesta</Text>
                </Pressable>
              )}

              {feedback && (
                <View style={[styles.feedbackBanner, { backgroundColor: isCorrect ? '#d1fae5' : '#fee2e2' }]}>
                  <Text style={[styles.feedbackText, { color: isCorrect ? '#065f46' : '#991b1b' }]}>
                    {isCorrect ? '✓ ' : '✗ '}{feedback}
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        {exitTicket && (
          <View style={styles.exitTicketCard}>
            <Text style={styles.exitTitle}>🎯 Sesión completada</Text>
            <Text style={styles.exitAccuracy}>{exitTicket.accuracyRate}%</Text>
            <Text style={styles.exitLabel}>precisión</Text>
            {exitTicket.recommendedSkillId && (
              <Text style={styles.caption}>Próxima habilidad recomendada lista.</Text>
            )}
            <Btn label="Volver al inicio" variant="outline" onPress={() => setScreen('student-home')} />
          </View>
        )}

        {!exitTicket && (
          <Btn label="← Volver al inicio" variant="outline" onPress={() => setScreen('student-home')} />
        )}
      </View>
    );
  }

  function renderTutor() {
    return (
      <View style={{ gap: 0 }}>
        {/* Header */}
        <View style={styles.tutorHeader}>
          <Pressable onPress={() => setScreen('student-home')}>
            <Text style={styles.backBtn}>← Inicio</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.skillHeaderTitle}>Tutor socrático</Text>
            <Text style={styles.skillHeaderArea}>{areaIcon(activeSkill?.area ?? '')} {activeSkill?.name ?? 'Sin habilidad'}</Text>
          </View>
          <View style={[styles.modeBadge, { backgroundColor: isConnected ? '#d1fae5' : '#fef3c7' }]}>
            <Text style={[styles.modeBadgeText, { color: isConnected ? '#065f46' : '#92400e' }]}>
              {isConnected ? 'IA activa' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Chat messages */}
        <View style={styles.chatContainer}>
          {chatTurns.length === 0 && (
            <View style={styles.emptyChatCard}>
              <Text style={styles.emptyChatIcon}>💬</Text>
              <Text style={styles.emptyChatText}>
                Haz una pregunta sobre {activeSkill?.name ?? 'esta habilidad'} y el tutor te guiará a encontrar la respuesta.
              </Text>
            </View>
          )}
          {chatTurns.map((turn) => (
            <View
              key={turn.id}
              style={[styles.bubble, turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              <Text style={[styles.bubbleRole, { color: turn.role === 'user' ? '#1d4ed8' : C.primary }]}>
                {turn.role === 'user' ? 'Tú' : '🤖 Tutor'}
              </Text>
              <Text style={styles.bubbleMsg}>{turn.message}</Text>
            </View>
          ))}
        </View>

        {/* Input */}
        <View style={styles.chatInputRow}>
          <TextInput
            style={styles.chatInput}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Escribe tu pregunta..."
            placeholderTextColor="#9ca3af"
            multiline
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.sendBtn, !chatInput.trim() && { opacity: 0.4 }]}
            onPress={() => void sendTutorMessage()}
            disabled={!chatInput.trim()}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderSkills() {
    return (
      <View style={styles.card}>
        <View style={styles.skillsHeader}>
          <Text style={styles.cardTitle}>Mapa de habilidades</Text>
          <Pressable onPress={() => setScreen('student-home')}>
            <Text style={styles.backBtn}>← Inicio</Text>
          </Pressable>
        </View>

        {mastery.length === 0 ? (
          <Text style={styles.caption}>Sin habilidades cargadas. Descarga contenido con conexión a internet.</Text>
        ) : (
          mastery.map((entry) => {
            const cfg = statusConfig[entry.status] ?? statusConfig.disponible;
            return (
              <Pressable key={entry.skillId} style={styles.skillItem} onPress={() => void openPractice(entry.skillId)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.skillItemName}>{entry.skillName}</Text>
                  <Text style={styles.skillItemArea}>{areaLabel(entry.area)}</Text>
                  {/* Mini progress bar */}
                  <View style={styles.skillProgressBg}>
                    <View style={[styles.skillProgressFill, { width: `${entry.accuracyRate}%` as any, backgroundColor: cfg.color }]} />
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <Text style={[styles.accuracyText, { color: cfg.color }]}>{entry.accuracyRate}%</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    );
  }

  function renderTeacherHome() {
    return (
      <View style={{ gap: 16 }}>
        {/* Summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Panel docente</Text>
          {teacherSummary.length === 0 ? (
            <Text style={styles.caption}>Sin datos de sección disponibles.</Text>
          ) : (
            teacherSummary.map((row) => {
              const domColor = row.pct_mastered >= 70 ? C.success : row.pct_mastered >= 40 ? C.warning : C.error;
              return (
                <View key={row.skill_id} style={styles.teacherRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.teacherSkill}>{row.skill_name}</Text>
                    <Text style={styles.teacherArea}>{areaLabel(row.area)}</Text>
                    <View style={styles.skillProgressBg}>
                      <View style={[styles.skillProgressFill, { width: `${row.pct_mastered}%` as any, backgroundColor: domColor }]} />
                    </View>
                  </View>
                  <View style={styles.teacherStats}>
                    <Text style={[styles.teacherPct, { color: domColor }]}>{row.pct_mastered}%</Text>
                    <Text style={styles.teacherPctLabel}>dominado</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Create assignment */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Nueva asignación</Text>
          <Text style={styles.fieldLabel}>Habilidad</Text>
          {teacherSkillOptions.length === 0 ? (
            <Text style={styles.caption}>No hay habilidades de la sección para asignar todavía.</Text>
          ) : (
            <View style={styles.pillRow}>
              {teacherSkillOptions.map((row) => (
                <Pill
                  key={row.skill_id}
                  label={`${areaIcon(row.area)} ${row.skill_name}`}
                  active={assignmentDraft.skillId === row.skill_id}
                  onPress={() => setAssignmentDraft((c) => ({ ...c, skillId: row.skill_id }))}
                />
              ))}
            </View>
          )}
          {selectedTeacherSkill && (
            <Text style={styles.caption}>
              Seleccionada: {selectedTeacherSkill.skill_name}
            </Text>
          )}
          <Field
            label="Fecha límite (AAAA-MM-DD)"
            value={assignmentDraft.deadlineDate}
            onChangeText={(deadlineDate) => setAssignmentDraft((c) => ({ ...c, deadlineDate }))}
          />
          <Text style={styles.caption}>Se guardará al final del día seleccionado.</Text>
          <Btn label="Asignar a toda la sección" onPress={() => void handleCreateAssignment()} />
        </View>

        {/* Active assignments */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Asignaciones activas</Text>
          {teacherAssignments.length === 0 ? (
            <Text style={styles.caption}>Sin asignaciones activas.</Text>
          ) : (
            teacherAssignments.map((a) => (
              <View key={a.id} style={styles.assignCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assignTitle}>{a.skills?.name ?? a.skill_id}</Text>
                  <Text style={styles.assignMeta}>
                    {a.completionCount ?? 0}/{a.targetedCount ?? 0} completado ({a.completionRate ?? 0}%)
                  </Text>
                  <Text style={styles.assignMeta}>Vence: {formatReadableDate(a.deadline)}</Text>
                </View>
                {/* Completion bar */}
                <View style={[styles.skillProgressBg, { width: 60 }]}>
                  <View style={[styles.skillProgressFill, { width: `${a.completionRate ?? 0}%` as any, backgroundColor: C.primary }]} />
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    );
  }

  // ─── Root render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {renderHeader()}

      {isBusy && (
        <View style={styles.busyBar}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={styles.busyText}>Procesando...</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ {errorMessage}</Text>
          <Pressable onPress={() => setErrorMessage(null)}>
            <Text style={styles.errorBannerClose}>✕</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {screen === 'loading' && (
          <View style={[styles.card, { alignItems: 'center', gap: 16, paddingVertical: 40 }]}>
            <Text style={{ fontSize: 48 }}>🎓</Text>
            <Text style={styles.cardTitle}>TutorIA Venezuela</Text>
            <ActivityIndicator color={C.primary} />
          </View>
        )}
        {screen === 'auth' && renderAuth()}
        {screen === 'connection-test' && renderConnectionTest()}
        {screen === 'onboarding' && renderOnboarding()}
        {screen === 'diagnostic' && renderDiagnostic()}
        {screen === 'student-home' && renderStudentHome()}
        {screen === 'practice' && renderPractice()}
        {screen === 'tutor' && renderTutor()}
        {screen === 'skills' && renderSkills()}
        {screen === 'teacher-home' && renderTeacherHome()}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Reusable components ─────────────────────────────────────────────────────

function Field(props: {
  label: string;
  value: string;
  secureTextEntry?: boolean;
  autoComplete?: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        secureTextEntry={props.secureTextEntry}
        onChangeText={props.onChangeText}
        autoCapitalize="none"
        placeholderTextColor="#9ca3af"
      />
    </View>
  );
}

function Btn(props: { label: string; variant?: 'primary' | 'outline'; onPress: () => void }) {
  const isOutline = props.variant === 'outline';
  return (
    <Pressable
      style={[styles.btn, isOutline ? styles.btnOutline : styles.btnPrimary]}
      onPress={props.onPress}
    >
      <Text style={[styles.btnText, isOutline ? styles.btnTextOutline : styles.btnTextPrimary]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function Pill(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.pill, props.active && styles.pillActive]} onPress={props.onPress}>
      <Text style={[styles.pillText, props.active && styles.pillTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

function SegmentBtn(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segment, props.active && styles.segmentActive]} onPress={props.onPress}>
      <Text style={[styles.segmentText, props.active && styles.segmentTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#f0ece3',
  surface: '#fffdf8',
  surfaceAlt: '#f5f0e8',
  primary: '#1a6b54',
  primaryLight: '#e8f5f0',
  primaryDark: '#144d3c',
  accent: '#2563eb',
  border: '#e2d9cc',
  borderDark: '#c4b9a8',
  text: '#1a2e3b',
  textMid: '#4b5563',
  textLight: '#9ca3af',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
};

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0,
  },
  scroll: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },

  // ── Header ──
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: C.textMid,
    marginTop: 1,
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: C.borderDark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
  },

  // ── Busy / Error banners ──
  busyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.primaryLight,
  },
  busyText: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fee2e2',
    borderBottomWidth: 1,
    borderBottomColor: '#fca5a5',
  },
  errorBannerText: {
    flex: 1,
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '500',
  },
  errorBannerClose: {
    color: '#991b1b',
    fontSize: 16,
    paddingLeft: 12,
    fontWeight: '700',
  },

  // ── Card ──
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#1a2e3b',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.4,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  caption: {
    fontSize: 13,
    color: C.textMid,
    lineHeight: 18,
  },

  // ── Auth ──
  logoBlock: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  logoEmoji: {
    fontSize: 48,
  },
  logoTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.5,
  },
  logoSub: {
    fontSize: 14,
    color: C.textMid,
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
  },
  tabActive: {
    backgroundColor: C.primary,
  },
  tabText: {
    fontWeight: '600',
    color: C.textMid,
    fontSize: 14,
  },
  tabTextActive: {
    color: '#fff',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
  },
  segmentActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  segmentText: {
    fontWeight: '600',
    color: C.textMid,
    fontSize: 13,
  },
  segmentTextActive: {
    color: C.primary,
  },

  // ── Form ──
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: C.text,
  },

  // ── Buttons ──
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: C.primary },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: C.primary,
    backgroundColor: 'transparent',
  },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnTextPrimary: { color: '#fff' },
  btnTextOutline: { color: C.primary },

  // ── Pills ──
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pillRowScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
  pillActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textMid,
  },
  pillTextActive: {
    color: C.primary,
  },

  // ── Onboarding ──
  onboardingHeader: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 4,
  },
  stepBlock: {
    gap: 10,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  stepBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  areaGrid: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  areaCard: {
    flex: 1,
    minWidth: 90,
    alignItems: 'center',
    gap: 6,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
  areaCardActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  areaIcon: { fontSize: 28 },
  areaLabel: { fontSize: 13, fontWeight: '600', color: C.textMid, textAlign: 'center' },
  areaLabelActive: { color: C.primary },
  areaCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaCheckText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // ── Diagnostic ──
  progressBar: {
    height: 6,
    backgroundColor: C.border,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.primary,
    borderRadius: 999,
  },
  diagCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  diagNum: { fontSize: 11, fontWeight: '700', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  diagQuestion: { fontSize: 15, fontWeight: '600', color: C.text, lineHeight: 22 },
  diagBtnRow: { flexDirection: 'row', gap: 8 },
  diagBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
  },
  diagBtnYes: { backgroundColor: C.success, borderColor: C.success },
  diagBtnNo: { backgroundColor: C.error, borderColor: C.error },
  diagBtnText: { fontWeight: '700', color: C.textMid, fontSize: 13 },

  // ── Student home ──
  welcomeCard: {
    backgroundColor: C.primary,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  welcomeEmoji: { fontSize: 36 },
  welcomeTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  welcomeSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  recCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.primary,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  recHeader: { flexDirection: 'row' },
  recBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: C.primary,
    backgroundColor: C.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recSkill: { fontSize: 20, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  recArea: { fontSize: 13, color: C.textMid },
  recActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  recBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  recBtnTextWhite: { color: '#fff', fontWeight: '700', fontSize: 14 },
  recBtnText: { fontWeight: '700', fontSize: 14 },
  emptyCard: {
    backgroundColor: '#fef3c7',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  emptyText: { color: '#92400e', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  assignCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  assignTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  assignMeta: { fontSize: 12, color: C.textMid, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  // ── Skill header (shared) ──
  skillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  backBtn: { color: C.primary, fontWeight: '600', fontSize: 14 },
  skillHeaderTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  skillHeaderArea: { fontSize: 12, color: C.textMid, marginTop: 2 },

  // ── Practice ──
  exerciseCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  exerciseNumRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exerciseNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNumText: { fontSize: 12, fontWeight: '700', color: C.textMid },
  exerciseMeta: { fontSize: 12, color: C.textLight, fontWeight: '500' },
  exerciseQ: { fontSize: 16, fontWeight: '600', color: C.text, lineHeight: 23 },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  optionBtnSelected: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  optionRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: C.border,
  },
  optionRadioActive: {
    borderColor: C.primary,
    backgroundColor: C.primary,
  },
  optionText: { fontSize: 14, color: C.textMid, flex: 1 },
  optionTextSelected: { color: C.primary, fontWeight: '600' },
  evalBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  evalBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  feedbackBanner: {
    borderRadius: 10,
    padding: 12,
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  exitTicketCard: {
    backgroundColor: '#ecfdf5',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#6ee7b7',
  },
  exitTitle: { fontSize: 18, fontWeight: '700', color: '#065f46' },
  exitAccuracy: { fontSize: 52, fontWeight: '700', color: C.success, letterSpacing: -2 },
  exitLabel: { fontSize: 14, color: '#065f46', marginBottom: 8 },

  // ── Tutor ──
  tutorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modeBadgeText: { fontSize: 12, fontWeight: '700' },
  chatContainer: { gap: 10, marginBottom: 12 },
  emptyChatCard: {
    alignItems: 'center',
    gap: 10,
    padding: 32,
    backgroundColor: C.surfaceAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyChatIcon: { fontSize: 36 },
  emptyChatText: { color: C.textMid, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  bubble: {
    padding: 14,
    borderRadius: 16,
    gap: 4,
    maxWidth: '88%',
  },
  bubbleUser: {
    backgroundColor: '#dbeafe',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: C.primaryLight,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleRole: { fontSize: 12, fontWeight: '700' },
  bubbleMsg: { fontSize: 15, color: C.text, lineHeight: 22 },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
  },
  chatInput: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // ── Skills map ──
  skillsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  skillItemName: { fontSize: 14, fontWeight: '700', color: C.text },
  skillItemArea: { fontSize: 12, color: C.textMid, marginTop: 2 },
  skillProgressBg: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 999,
    marginTop: 6,
    overflow: 'hidden',
    flex: 1,
  },
  skillProgressFill: { height: '100%', borderRadius: 999 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  accuracyText: { fontSize: 13, fontWeight: '700' },

  // ── Teacher ──
  teacherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  teacherSkill: { fontSize: 14, fontWeight: '700', color: C.text },
  teacherArea: { fontSize: 12, color: C.textMid, marginTop: 2 },
  teacherStats: { alignItems: 'flex-end', minWidth: 56 },
  teacherPct: { fontSize: 20, fontWeight: '700' },
  teacherPctLabel: { fontSize: 10, color: C.textLight, fontWeight: '600' },

  // ── Debug ──
  debugRow: {
    padding: 10,
    borderRadius: 10,
    gap: 4,
  },
  debugLabel: { fontWeight: '700', color: C.text, fontSize: 13 },
  debugDetail: { color: C.textMid, fontSize: 12 },
});
