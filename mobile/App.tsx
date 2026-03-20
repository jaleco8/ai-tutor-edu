import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { AssignmentSummary, AuthSession, ChatTurn, ExitTicket, LocalExercise, LocalMastery, LocalSkill, TeacherSummaryRow, TutorMode, UserRole } from './src/types';
import { API_URL } from './src/config';

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
  { value: 'primaria', label: 'Educacion Primaria' },
  { value: 'media', label: 'Educacion Media' },
];

const gradeOptions = [
  'media_1',
  'media_2',
  'media_3',
  'media_4',
  'media_5',
];

const areaOptions = ['matematicas', 'ingles', 'programacion'];

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
    deadline: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString(),
  });

  // --- DEBUG: connection test (temporal) ---
  const [debugLog, setDebugLog] = useState<Array<{ label: string; status: 'pending' | 'ok' | 'error'; detail: string }>>([]);
  const [debugEmail, setDebugEmail] = useState('');
  const [debugPassword, setDebugPassword] = useState('');
  // -----------------------------------------

  const recommendation = useMemo(() => buildRecommendation(skills, mastery), [skills, mastery]);
  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === (selectedSkillId ?? recommendation?.skillId ?? null)) ?? null,
    [recommendation?.skillId, selectedSkillId, skills],
  );

  useEffect(() => {
    const subscription = NetInfo.addEventListener((state) => {
      setIsConnected(Boolean(state.isConnected));
    });

    NetInfo.fetch().then((state) => {
      setIsConnected(Boolean(state.isConnected));
    });

    void bootstrap();

    return () => subscription();
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

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
      const nextSession = authForm.mode === 'register'
        ? await register({
          email: authForm.email,
          password: authForm.password,
          role: authForm.role,
          schoolCode: authForm.schoolCode,
          sectionCode: authForm.sectionCode,
          fullName: authForm.fullName || undefined,
        })
        : await login({
          email: authForm.email,
          password: authForm.password,
        });

      let profile = nextSession.profile;
      try {
        profile = await fetchProfile(nextSession.accessToken);
      } catch {
        // /auth/me puede fallar si el perfil aún no es visible vía RLS;
        // usamos los datos que retornó el login/register como fallback.
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
    if (!session) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      await updateProfile(session.accessToken, onboarding);

      for (const area of onboarding.selectedAreas.filter((value) => value !== 'programacion')) {
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
    if (!session) {
      return;
    }

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
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo registrar el diagnostico');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadStudentAssignments(currentSession: AuthSession) {
    if (!isConnected) {
      return;
    }

    try {
      const assignments = await fetchStudentAssignments(currentSession.accessToken);
      setStudentAssignments(assignments);
    } catch {
      setStudentAssignments([]);
    }
  }

  async function loadTeacherData(currentSession: AuthSession) {
    if (!isConnected) {
      return;
    }

    try {
      const [summary, assignments] = await Promise.all([
        fetchTeacherSummary(currentSession.accessToken),
        fetchTeacherAssignments(currentSession.accessToken),
      ]);
      setTeacherSummary(summary);
      setTeacherAssignments(assignments);
      if (!assignmentDraft.skillId && summary[0]?.skill_id) {
        setAssignmentDraft((current) => ({ ...current, skillId: summary[0].skill_id }));
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
    if (!activeSkill || !session) {
      return;
    }

    const answer = practiceAnswers[exercise.id] ?? '';
    if (!answer.trim()) {
      return;
    }

    const startedAt = Date.now();
    const mode: TutorMode = isConnected ? 'online' : 'offline';
    const result = (isConnected && exercise.type === 'translation')
      ? await evaluateExercise(session.accessToken, { exerciseId: exercise.id, answer, mode })
      : evaluateLocalExercise(exercise, answer);

    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    setPracticeFeedback((current) => ({ ...current, [exercise.id]: result.feedback }));

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

    const currentSkillMastery = updatedMastery.find((entry) => entry.skillId === exercise.skill_id);
    await queueSyncEvent(cryptoId(), result.status === 'pending_review' ? 'translation_review' : 'practice_summary', {
      skillId: exercise.skill_id,
      totalAttempts: currentSkillMastery?.attemptsCount ?? 0,
      correctCount: Math.round(((currentSkillMastery?.accuracyRate ?? 0) / 100) * (currentSkillMastery?.attemptsCount ?? 0)),
      totalTimeSeconds: timeSpentSeconds,
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: new Date().toISOString().slice(0, 10),
      lastPracticedAt: new Date().toISOString(),
    });

    await queueSyncEvent(cryptoId(), 'mastery_update', {
      skillId: exercise.skill_id,
      status: currentSkillMastery?.status,
      accuracyRate: currentSkillMastery?.accuracyRate ?? 0,
      attemptsCount: currentSkillMastery?.attemptsCount ?? 0,
      lastPracticedAt: currentSkillMastery?.lastPracticedAt ?? new Date().toISOString(),
    });

    const recentAttempts = await getRecentAttempts(exercise.skill_id, 10);
    if (recentAttempts.length >= 10) {
      const ticket = buildExitTicket(
        exercise.skill_id,
        recentAttempts,
        buildRecommendation(skills, updatedMastery),
      );
      setExitTicket(ticket);
    }
  }

  async function sendTutorMessage() {
    if (!activeSkill || !session || !chatInput.trim()) {
      return;
    }

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
    setChatTurns((current) => appendChatTurn(current, assistantTurn));
    setChatInput('');
  }

  async function openTutor(skillId: string) {
    setSelectedSkillId(skillId);
    setChatTurns(await getChatTurns(skillId));
    setScreen('tutor');
  }

  async function handleCreateAssignment() {
    if (!session || !assignmentDraft.skillId) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      await createAssignment(session.accessToken, {
        skillId: assignmentDraft.skillId,
        deadline: assignmentDraft.deadline,
        targetScope: 'all',
      });
      await loadTeacherData(session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo crear la asignacion');
    } finally {
      setIsBusy(false);
    }
  }

  async function syncPending(currentSession: AuthSession) {
    if (!isConnected) {
      return;
    }

    const pending = await getPendingSyncEvents();
    if (pending.length === 0) {
      return;
    }

    try {
      await syncEvents(
        currentSession.accessToken,
        pending.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          payload: event.payload,
        })),
      );
      await markSyncEventsSynced(pending.map((event) => event.id));
    } catch {
      for (const event of pending) {
        await scheduleRetry(event.id, event.retryCount + 1);
      }
    }
  }

  // --- DEBUG: pantalla temporal para verificar conectividad con el backend ---
  function renderConnectionTest() {
    async function runCheck(label: string, fn: () => Promise<string>) {
      setDebugLog((prev) => [...prev, { label, status: 'pending', detail: '...' }]);
      try {
        const detail = await fn();
        setDebugLog((prev) =>
          prev.map((entry) => entry.label === label ? { label, status: 'ok', detail } : entry),
        );
      } catch (err) {
        setDebugLog((prev) =>
          prev.map((entry) => entry.label === label ? { label, status: 'error', detail: err instanceof Error ? err.message : String(err) } : entry),
        );
      }
    }

    function clearLog() {
      setDebugLog([]);
    }

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Prueba de conexion</Text>
        <Text style={[styles.helperText, { fontFamily: 'monospace' }]}>URL: {API_URL}</Text>

        <Pressable style={styles.primaryButton} onPress={() => void runCheck('GET /health', async () => {
          const res = await fetch(`${API_URL}/health`);
          const json = await res.json() as Record<string, unknown>;
          return `${res.status} — ${JSON.stringify(json)}`;
        })}>
          <Text style={styles.primaryButtonText}>Ping /health</Text>
        </Pressable>

        <Text style={styles.subsectionTitle}>Login de prueba</Text>
        <Field label="Email" value={debugEmail} onChangeText={setDebugEmail} />
        <Field label="Password" secureTextEntry value={debugPassword} onChangeText={setDebugPassword} />
        <Pressable style={styles.primaryButton} onPress={() => void runCheck('POST /auth/login', async () => {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: debugEmail, password: debugPassword }),
          });
          const text = await res.text();
          return `${res.status} — ${text.slice(0, 200)}`;
        })}>
          <Text style={styles.primaryButtonText}>Probar login</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={clearLog}>
          <Text style={styles.secondaryButtonText}>Limpiar log</Text>
        </Pressable>

        {debugLog.map((entry, i) => (
          <View key={i} style={{ padding: 8, backgroundColor: entry.status === 'ok' ? '#d4edda' : entry.status === 'error' ? '#f8d7da' : '#fff3cd', borderRadius: 8 }}>
            <Text style={{ fontWeight: '700', color: '#17324d' }}>{entry.label}</Text>
            <Text style={{ color: '#2f3f4d', fontSize: 12 }}>{entry.detail}</Text>
          </View>
        ))}

        <Pressable style={styles.secondaryButtonWide} onPress={() => setScreen('auth')}>
          <Text style={styles.secondaryButtonText}>Volver al login</Text>
        </Pressable>
      </View>
    );
  }
  // ---------------------------------------------------------------------------

  function renderHeader() {
    return (
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>TutorIA Venezuela</Text>
          <Text style={styles.headerSubtitle}>
            {isConnected ? 'Online' : 'Offline'} · {session?.profile.sectionCode ?? 'sin seccion'}
          </Text>
        </View>
        {session ? (
          <Pressable style={styles.secondaryButton} onPress={handleLogout}>
            <Text style={styles.secondaryButtonText}>Salir</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderAuth() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {authForm.mode === 'login' ? 'Entrar al MVP' : 'Crear cuenta'}
        </Text>
        <View style={styles.row}>
          <ToggleButton
            label="Login"
            active={authForm.mode === 'login'}
            onPress={() => setAuthForm((current) => ({ ...current, mode: 'login' }))}
          />
          <ToggleButton
            label="Registro"
            active={authForm.mode === 'register'}
            onPress={() => setAuthForm((current) => ({ ...current, mode: 'register' }))}
          />
        </View>
        {authForm.mode === 'register' ? (
          <View style={styles.row}>
            <ToggleButton
              label="Estudiante"
              active={authForm.role === 'estudiante'}
              onPress={() => setAuthForm((current) => ({ ...current, role: 'estudiante' }))}
            />
            <ToggleButton
              label="Docente"
              active={authForm.role === 'docente'}
              onPress={() => setAuthForm((current) => ({ ...current, role: 'docente' }))}
            />
          </View>
        ) : null}
        <Field label="Correo" value={authForm.email} onChangeText={(email) => setAuthForm((current) => ({ ...current, email }))} />
        <Field label="Contraseña" secureTextEntry value={authForm.password} onChangeText={(password) => setAuthForm((current) => ({ ...current, password }))} />
        {authForm.mode === 'register' ? (
          <>
            <Field label="Nombre completo (opcional estudiante)" value={authForm.fullName} onChangeText={(fullName) => setAuthForm((current) => ({ ...current, fullName }))} />
            <Field label="Codigo de escuela" value={authForm.schoolCode} onChangeText={(schoolCode) => setAuthForm((current) => ({ ...current, schoolCode }))} />
            <Field label="Codigo de seccion" value={authForm.sectionCode} onChangeText={(sectionCode) => setAuthForm((current) => ({ ...current, sectionCode }))} />
          </>
        ) : null}
        <Pressable style={styles.primaryButton} onPress={handleAuthSubmit}>
          <Text style={styles.primaryButtonText}>
            {authForm.mode === 'login' ? 'Entrar' : 'Registrar'}
          </Text>
        </Pressable>
        <Pressable onPress={() => setScreen('connection-test')}>
          <Text style={[styles.helperText, { textAlign: 'center', textDecorationLine: 'underline' }]}>
            Probar conexion con el backend
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderOnboarding() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Onboarding curricular</Text>
        <Text style={styles.helperText}>1. Nivel escolar</Text>
        <View style={styles.row}>
          {schoolLevels.map((level) => (
            <ToggleButton
              key={level.value}
              label={level.label}
              active={onboarding.schoolLevel === level.value}
              onPress={() => setOnboarding((current) => ({ ...current, schoolLevel: level.value }))}
            />
          ))}
        </View>

        <Text style={styles.helperText}>2. Grado / año</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {gradeOptions.map((gradeLevel) => (
            <ToggleButton
              key={gradeLevel}
              label={gradeLevel}
              active={onboarding.gradeLevel === gradeLevel}
              onPress={() => setOnboarding((current) => ({ ...current, gradeLevel }))}
            />
          ))}
        </ScrollView>

        <Text style={styles.helperText}>3. Areas</Text>
        <View style={styles.rowWrap}>
          {areaOptions.map((area) => {
            const isActive = onboarding.selectedAreas.includes(area);
            return (
              <ToggleButton
                key={area}
                label={area}
                active={isActive}
                onPress={() => setOnboarding((current) => ({
                  ...current,
                  selectedAreas: isActive
                    ? current.selectedAreas.filter((value) => value !== area)
                    : [...current.selectedAreas, area],
                }))}
              />
            );
          })}
        </View>

        <Pressable style={styles.primaryButton} onPress={() => handleOnboardingSubmit(true)}>
          <Text style={styles.primaryButtonText}>Guardar y diagnosticar</Text>
        </Pressable>
        <Pressable style={styles.secondaryButtonWide} onPress={() => handleOnboardingSubmit(false)}>
          <Text style={styles.secondaryButtonText}>Guardar y saltar diagnostico</Text>
        </Pressable>
      </View>
    );
  }

  function renderDiagnostic() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Diagnostico inicial</Text>
        <Text style={styles.helperText}>Marca si cada enunciado te resulta resoluble ahora.</Text>
        {diagnosticExercises.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseCard}>
            <Text style={styles.exerciseTitle}>{exercise.content.question ?? 'Pregunta diagnostica'}</Text>
            <View style={styles.row}>
              <ToggleButton
                label="Lo manejo"
                active={diagnosticAnswers[exercise.id] === true}
                onPress={() => setDiagnosticAnswers((current) => ({ ...current, [exercise.id]: true }))}
              />
              <ToggleButton
                label="Necesito apoyo"
                active={diagnosticAnswers[exercise.id] === false}
                onPress={() => setDiagnosticAnswers((current) => ({ ...current, [exercise.id]: false }))}
              />
            </View>
          </View>
        ))}
        <Pressable style={styles.primaryButton} onPress={handleDiagnosticSubmit}>
          <Text style={styles.primaryButtonText}>Guardar diagnostico</Text>
        </Pressable>
      </View>
    );
  }

  function renderStudentHome() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Inicio del estudiante</Text>
        <Text style={styles.helperText}>
          Recomendacion: {recommendation ? `${recommendation.skillName} (${recommendation.status})` : 'cargar contenido'}
        </Text>
        <View style={styles.rowWrap}>
          <Pressable style={styles.primaryButtonCompact} onPress={() => recommendation?.skillId && void openPractice(recommendation.skillId)}>
            <Text style={styles.primaryButtonText}>Practica</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={() => recommendation?.skillId && void openTutor(recommendation.skillId)}>
            <Text style={styles.primaryButtonText}>Tutor</Text>
          </Pressable>
          <Pressable style={styles.secondaryButtonCompact} onPress={() => setScreen('skills')}>
            <Text style={styles.secondaryButtonText}>Mapa</Text>
          </Pressable>
        </View>
        <Text style={styles.subsectionTitle}>Asignaciones activas</Text>
        {studentAssignments.length === 0 ? <Text style={styles.helperText}>Sin asignaciones activas.</Text> : null}
        {studentAssignments.map((assignment) => (
          <View key={assignment.id} style={styles.assignmentCard}>
            <Text style={styles.assignmentTitle}>{assignment.skills?.name ?? assignment.skill_id}</Text>
            <Text style={styles.helperText}>
              {assignment.skills?.area ?? 'area'} · vence {new Date(assignment.deadline).toLocaleDateString()}
            </Text>
            <Text style={styles.helperText}>
              {assignment.isCompleted ? 'Completada' : 'Pendiente'}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  function renderPractice() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Practica por habilidad</Text>
        <Text style={styles.helperText}>{activeSkill?.name ?? 'Sin habilidad seleccionada'}</Text>
        {practiceExercises.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseCard}>
            <Text style={styles.exerciseTitle}>{exercise.content.question ?? 'Ejercicio'}</Text>
            {(exercise.content.options ?? []).map((option) => (
              <Pressable
                key={option}
                style={styles.optionButton}
                onPress={() => setPracticeAnswers((current) => ({ ...current, [exercise.id]: option }))}
              >
                <Text style={styles.optionText}>{option}</Text>
              </Pressable>
            ))}
            {!(exercise.content.options ?? []).length ? (
              <Field
                label="Respuesta"
                value={practiceAnswers[exercise.id] ?? ''}
                onChangeText={(value) => setPracticeAnswers((current) => ({ ...current, [exercise.id]: value }))}
              />
            ) : null}
            <Pressable style={styles.primaryButtonCompact} onPress={() => void handlePracticeSubmit(exercise)}>
              <Text style={styles.primaryButtonText}>Evaluar</Text>
            </Pressable>
            {practiceFeedback[exercise.id] ? (
              <Text style={styles.feedbackText}>{practiceFeedback[exercise.id]}</Text>
            ) : null}
          </View>
        ))}
        {exitTicket ? (
          <View style={styles.exitTicket}>
            <Text style={styles.sectionTitle}>Ticket de salida</Text>
            <Text style={styles.helperText}>Accuracy: {exitTicket.accuracyRate}%</Text>
            <Text style={styles.helperText}>
              Proximo skill: {exitTicket.recommendedSkillId ?? 'seguir practicando'}
            </Text>
          </View>
        ) : null}
        <Pressable style={styles.secondaryButtonWide} onPress={() => setScreen('student-home')}>
          <Text style={styles.secondaryButtonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  function renderTutor() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tutor socratico</Text>
        <Text style={styles.helperText}>{activeSkill?.name ?? 'Sin habilidad seleccionada'}</Text>
        {chatTurns.map((turn) => (
          <View key={turn.id} style={[styles.chatBubble, turn.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant]}>
            <Text style={styles.chatRole}>{turn.role === 'user' ? 'Tu' : 'Tutor'}</Text>
            <Text style={styles.chatMessage}>{turn.message}</Text>
          </View>
        ))}
        <Field label="Escribe tu duda" value={chatInput} onChangeText={setChatInput} />
        <Pressable style={styles.primaryButton} onPress={() => void sendTutorMessage()}>
          <Text style={styles.primaryButtonText}>Enviar</Text>
        </Pressable>
        <Pressable style={styles.secondaryButtonWide} onPress={() => setScreen('student-home')}>
          <Text style={styles.secondaryButtonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  function renderSkills() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Mapa de habilidades</Text>
        {mastery.map((entry) => (
          <Pressable
            key={entry.skillId}
            style={styles.skillRow}
            onPress={() => void openPractice(entry.skillId)}
          >
            <View>
              <Text style={styles.skillName}>{entry.skillName}</Text>
              <Text style={styles.helperText}>{entry.area}</Text>
            </View>
            <Text style={styles.skillStatus}>{entry.status} · {entry.accuracyRate}%</Text>
          </Pressable>
        ))}
        <Pressable style={styles.secondaryButtonWide} onPress={() => setScreen('student-home')}>
          <Text style={styles.secondaryButtonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  function renderTeacherHome() {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Dashboard docente</Text>
        {teacherSummary.map((row) => (
          <View key={row.skill_id} style={styles.assignmentCard}>
            <Text style={styles.assignmentTitle}>{row.skill_name}</Text>
            <Text style={styles.helperText}>
              {row.area} · dominado {row.pct_mastered}% · en proceso {row.pct_in_progress}%
            </Text>
          </View>
        ))}

        <Text style={styles.subsectionTitle}>Nueva asignacion</Text>
        <Field label="Skill ID" value={assignmentDraft.skillId} onChangeText={(skillId) => setAssignmentDraft((current) => ({ ...current, skillId }))} />
        <Field label="Deadline ISO" value={assignmentDraft.deadline} onChangeText={(deadline) => setAssignmentDraft((current) => ({ ...current, deadline }))} />
        <Pressable style={styles.primaryButton} onPress={() => void handleCreateAssignment()}>
          <Text style={styles.primaryButtonText}>Asignar a toda la seccion</Text>
        </Pressable>

        <Text style={styles.subsectionTitle}>Asignaciones activas</Text>
        {teacherAssignments.map((assignment) => (
          <View key={assignment.id} style={styles.assignmentCard}>
            <Text style={styles.assignmentTitle}>{assignment.skills?.name ?? assignment.skill_id}</Text>
            <Text style={styles.helperText}>
              {assignment.completionRate ?? 0}% completado · {assignment.completionCount ?? 0}/{assignment.targetedCount ?? 0}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {renderHeader()}
      {isBusy ? <ActivityIndicator style={styles.loader} size="large" /> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      <ScrollView contentContainerStyle={styles.container}>
        {screen === 'auth' ? renderAuth() : null}
        {screen === 'connection-test' ? renderConnectionTest() : null}
        {screen === 'onboarding' ? renderOnboarding() : null}
        {screen === 'diagnostic' ? renderDiagnostic() : null}
        {screen === 'student-home' ? renderStudentHome() : null}
        {screen === 'practice' ? renderPractice() : null}
        {screen === 'tutor' ? renderTutor() : null}
        {screen === 'skills' ? renderSkills() : null}
        {screen === 'teacher-home' ? renderTeacherHome() : null}
        {screen === 'loading' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Preparando TutorIA...</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  secureTextEntry?: boolean;
  onChangeText: (value: string) => void;
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
      />
    </View>
  );
}

function ToggleButton(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.toggleButton, props.active ? styles.toggleButtonActive : null]}
      onPress={props.onPress}
    >
      <Text style={[styles.toggleButtonText, props.active ? styles.toggleButtonTextActive : null]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe6',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0,
  },
  container: {
    padding: 16,
    gap: 16,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#d8cbb2',
    backgroundColor: '#fff7ea',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e3d59',
  },
  headerSubtitle: {
    color: '#6b5d4d',
    marginTop: 2,
  },
  loader: {
    marginTop: 12,
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e3d6c3',
    shadowColor: '#7b6954',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#17324d',
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#17324d',
    marginTop: 8,
  },
  helperText: {
    color: '#5b5b52',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowWrap: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#17324d',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0c1ae',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonCompact: {
    backgroundColor: '#1e6f5c',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#1e3d59',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonWide: {
    borderWidth: 1,
    borderColor: '#1e3d59',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonCompact: {
    borderWidth: 1,
    borderColor: '#1e3d59',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1e3d59',
    fontWeight: '700',
  },
  toggleButton: {
    borderWidth: 1,
    borderColor: '#d0c1ae',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  toggleButtonActive: {
    backgroundColor: '#dbeee4',
    borderColor: '#1e6f5c',
  },
  toggleButtonText: {
    color: '#5b5b52',
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: '#1e6f5c',
  },
  exerciseCard: {
    borderWidth: 1,
    borderColor: '#e1d4c2',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: '#fff',
  },
  exerciseTitle: {
    color: '#17324d',
    fontWeight: '600',
    lineHeight: 20,
  },
  optionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d0c1ae',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#faf8f2',
  },
  optionText: {
    color: '#17324d',
  },
  feedbackText: {
    color: '#1e6f5c',
    fontWeight: '600',
  },
  exitTicket: {
    borderWidth: 1,
    borderColor: '#1e6f5c',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#eef7f2',
    gap: 6,
  },
  chatBubble: {
    padding: 12,
    borderRadius: 14,
    gap: 4,
  },
  chatBubbleUser: {
    backgroundColor: '#dbeee4',
  },
  chatBubbleAssistant: {
    backgroundColor: '#eef0f5',
  },
  chatRole: {
    fontWeight: '700',
    color: '#17324d',
  },
  chatMessage: {
    color: '#2f3f4d',
    lineHeight: 20,
  },
  assignmentCard: {
    borderWidth: 1,
    borderColor: '#e1d4c2',
    borderRadius: 14,
    padding: 12,
    gap: 4,
    backgroundColor: '#fff',
  },
  assignmentTitle: {
    fontWeight: '700',
    color: '#17324d',
  },
  skillRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e6dece',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  skillName: {
    fontWeight: '700',
    color: '#17324d',
  },
  skillStatus: {
    color: '#1e6f5c',
    fontWeight: '600',
  },
  errorText: {
    color: '#a11c1c',
    paddingHorizontal: 16,
    marginTop: 12,
  },
});
