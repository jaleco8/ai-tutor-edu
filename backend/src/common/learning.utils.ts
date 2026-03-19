export type SkillStatus = 'sin_datos' | 'en_proceso' | 'dominado';

export interface HintRecord {
  hint_type: string;
  content: string;
}

const KEYWORD_HINT_WEIGHTS: Record<string, string[]> = {
  error_frecuente: ['error', 'fallo', 'equivoco', 'incorrecto', 'confundi'],
  concepto_clave: ['concepto', 'idea', 'significa', 'definicion', 'regla'],
  pregunta_socratica: ['como', 'por que', 'paso', 'explica', 'razonamiento'],
  ejemplo_contextual: ['ejemplo', 'contexto', 'aula', 'escuela', 'vida'],
};

export function normalizeAccuracy(correctCount: number, totalAttempts: number): number {
  if (totalAttempts <= 0) return 0;
  return Number(((correctCount / totalAttempts) * 100).toFixed(2));
}

export function deriveSkillStatus(accuracyRate: number, attemptsCount: number): SkillStatus {
  if (attemptsCount <= 0) {
    return 'sin_datos';
  }

  if (accuracyRate >= 80) {
    return 'dominado';
  }

  if (accuracyRate >= 40) {
    return 'en_proceso';
  }

  return 'sin_datos';
}

export function selectOfflineHint(hints: HintRecord[], message: string): string {
  if (hints.length === 0) {
    return 'Piensa en el primer paso que te pide el ejercicio y explica por que lo elegiste.';
  }

  const normalizedMessage = message.toLowerCase();

  const ranked = hints
    .map((hint) => {
      const keywords = KEYWORD_HINT_WEIGHTS[hint.hint_type] ?? [];
      const score = keywords.reduce((total, keyword) => (
        normalizedMessage.includes(keyword) ? total + 1 : total
      ), 0);

      return { hint, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.hint.content ?? hints[0].content;
}
