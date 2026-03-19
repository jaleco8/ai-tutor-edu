import { ChatTurn, ExitTicket, LocalExercise, LocalHint, LocalMastery, LocalSkill, PracticeResult, SkillStatus } from '../types';

const OFFLINE_HINT_KEYWORDS: Record<string, string[]> = {
  error_frecuente: ['error', 'fallo', 'confundo', 'incorrecto'],
  concepto_clave: ['concepto', 'significa', 'regla', 'idea'],
  pregunta_socratica: ['como', 'por que', 'paso', 'razonamiento'],
  ejemplo_contextual: ['ejemplo', 'escuela', 'aula', 'vida'],
};

export function deriveSkillStatus(accuracyRate: number, attemptsCount: number, prerequisiteMet = true): SkillStatus {
  if (!prerequisiteMet) {
    return 'bloqueada';
  }

  if (attemptsCount === 0) {
    return 'disponible';
  }

  if (accuracyRate >= 80) {
    return 'dominado';
  }

  if (accuracyRate >= 40) {
    return 'en_proceso';
  }

  return 'sin_datos';
}

export function normalizeAccuracy(correctCount: number, attemptsCount: number) {
  if (attemptsCount <= 0) {
    return 0;
  }

  return Number(((correctCount / attemptsCount) * 100).toFixed(2));
}

export function evaluateLocalExercise(exercise: LocalExercise, answer: string): PracticeResult {
  const normalizedAnswer = answer.trim();
  const feedbackCorrect = exercise.content.feedback_correct ?? 'Correcto. Sigue asi.';
  const feedbackIncorrect = exercise.content.feedback_incorrect ?? 'Revisa el razonamiento y vuelve a intentarlo.';

  switch (exercise.type) {
    case 'multiple_choice':
    case 'dialogue':
    case 'word_order': {
      const isCorrect = normalizedAnswer.toLowerCase() === String(exercise.correct_answer).toLowerCase();
      return {
        isCorrect,
        feedback: isCorrect ? feedbackCorrect : feedbackIncorrect,
        status: 'evaluated',
      };
    }
    case 'numeric': {
      const isCorrect = Number(normalizedAnswer) === Number(exercise.correct_answer);
      return {
        isCorrect,
        feedback: isCorrect ? feedbackCorrect : feedbackIncorrect,
        status: 'evaluated',
      };
    }
    case 'order_steps': {
      const expected = Array.isArray(exercise.correct_answer)
        ? exercise.correct_answer.join(' > ')
        : String(exercise.correct_answer);
      const isCorrect = normalizedAnswer === expected;
      return {
        isCorrect,
        feedback: isCorrect ? feedbackCorrect : `Orden esperado: ${expected}`,
        status: 'evaluated',
      };
    }
    case 'translation':
      return {
        isCorrect: null,
        feedback: 'La traduccion queda pendiente para revision online.',
        status: 'pending_review',
      };
    default:
      return {
        isCorrect: normalizedAnswer === String(exercise.correct_answer),
        feedback: feedbackIncorrect,
        status: 'evaluated',
      };
  }
}

export function selectOfflineHint(hints: LocalHint[], message: string) {
  const normalized = message.toLowerCase();

  const ranked = hints
    .map((hint) => {
      const keywords = OFFLINE_HINT_KEYWORDS[hint.hint_type] ?? [];
      const score = keywords.reduce((total, keyword) => (
        normalized.includes(keyword) ? total + 1 : total
      ), 0);
      return { hint, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.hint.content ?? 'Piensa en el dato mas importante del problema antes de responder.';
}

export function buildRecommendation(skills: LocalSkill[], mastery: LocalMastery[]) {
  const masteryMap = new Map(mastery.map((entry) => [entry.skillId, entry]));
  const dominatedThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const inProgress = mastery
    .filter((entry) => entry.status === 'en_proceso')
    .sort((left, right) => left.accuracyRate - right.accuracyRate)[0];

  if (inProgress) {
    return inProgress;
  }

  for (const skill of skills.sort((left, right) => left.sequence_order - right.sequence_order)) {
    const prerequisite = skill.prerequisite_skill_id ? masteryMap.get(skill.prerequisite_skill_id) : undefined;
    const isUnlocked = !skill.prerequisite_skill_id || ['en_proceso', 'dominado'].includes(prerequisite?.status ?? '');
    if (!masteryMap.has(skill.id) && isUnlocked) {
      return {
        skillId: skill.id,
        skillName: skill.name,
        area: skill.area,
        accuracyRate: 0,
        attemptsCount: 0,
        status: 'disponible' as SkillStatus,
        lastPracticedAt: null,
      };
    }
  }

  const reviewCandidate = mastery
    .filter((entry) => entry.status === 'dominado' && entry.lastPracticedAt)
    .sort((left, right) => (
      new Date(left.lastPracticedAt ?? 0).getTime() - new Date(right.lastPracticedAt ?? 0).getTime()
    ))
    .find((entry) => new Date(entry.lastPracticedAt ?? 0).getTime() < dominatedThreshold);

  return reviewCandidate ?? null;
}

export function buildExitTicket(
  skillId: string,
  attempts: Array<{ question: string; isCorrect: boolean | null }>,
  recommendation: LocalMastery | null,
): ExitTicket {
  const validAttempts = attempts.filter((attempt) => attempt.isCorrect !== null);
  const correctCount = validAttempts.filter((attempt) => attempt.isCorrect).length;
  const accuracyRate = normalizeAccuracy(correctCount, validAttempts.length);

  return {
    skillId,
    accuracyRate,
    weakExercises: validAttempts.filter((attempt) => !attempt.isCorrect).slice(0, 3).map((attempt) => attempt.question),
    recommendedSkillId: recommendation?.skillId ?? null,
  };
}

export function appendChatTurn(turns: ChatTurn[], turn: ChatTurn) {
  return [...turns, turn].sort((left, right) => (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  ));
}
