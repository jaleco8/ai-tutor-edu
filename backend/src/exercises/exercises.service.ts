import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { MathEvaluator } from './evaluators/math.evaluator';
import { EnglishEvaluator } from './evaluators/english.evaluator';
import { GeminiService } from '../tutor/gemini.service';
import { deriveSkillStatus, normalizeAccuracy } from '../common/learning.utils';
import { randomUUID } from 'crypto';

type ExerciseEvaluation = {
  isCorrect: boolean | null;
  feedback: string;
  status: 'evaluated' | 'pending_review';
};

@Injectable()
export class ExercisesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly mathEvaluator: MathEvaluator,
    private readonly englishEvaluator: EnglishEvaluator,
    private readonly gemini: GeminiService,
  ) {}

  async findBySkill(skillId: string, gradeLevel: string, limit = 10) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('exercises')
      .select('*, skills!inner(grade_level)')
      .eq('skill_id', skillId)
      .eq('skills.grade_level', gradeLevel)
      .limit(limit);

    if (error) throw error;
    return data;
  }

  async getDiagnostic(area: string, gradeLevel: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('exercises')
      .select('*, skills!inner(area, grade_level)')
      .eq('is_diagnostic', true)
      .eq('skills.area', area)
      .eq('skills.grade_level', gradeLevel)
      .limit(8);

    if (error) throw error;
    return data;
  }

  async evaluate(exerciseId: string, answer: unknown, mode: 'online' | 'offline') {
    const client = this.supabase.getClient();

    const { data: exercise, error } = await client
      .from('exercises')
      .select('*, skills!inner(area)')
      .eq('id', exerciseId)
      .single();

    if (error || !exercise) {
      throw new Error('Exercise not found');
    }

    const area = exercise.skills.area;
    let result: ExerciseEvaluation;

    if (area === 'matematicas') {
      const mathResult = this.mathEvaluator.evaluate(exercise, answer);
      result = { ...mathResult, status: 'evaluated' };
    } else if (area === 'ingles') {
      result = await this.evaluateEnglishExercise(exercise, answer, mode);
    } else {
      const fallbackResult = this.mathEvaluator.evaluate(exercise, answer);
      result = { ...fallbackResult, status: 'evaluated' };
    }

    return {
      exerciseId,
      ...result,
    };
  }

  async recordDiagnosticResult(
    userId: string,
    results: Array<{ skillId: string; correctCount: number; totalAttempts: number }>,
    skipped: boolean,
  ) {
    const client = this.supabase.getClient();
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('pseudonym_id')
      .eq('id', userId)
      .single<{ pseudonym_id: string }>();

    if (profileError || !profile) {
      throw new Error('Profile not found');
    }

    if (skipped || results.length === 0) {
      await client.from('sync_events').upsert({
        id: randomUUID(),
        pseudonym_id: profile.pseudonym_id,
        event_type: 'diagnostic_skipped',
        payload: { skippedAt: new Date().toISOString() },
      });

      return {
        skipped: true,
        updatedSkills: [],
      };
    }

    const upserts = results.map((result) => {
      const accuracyRate = normalizeAccuracy(result.correctCount, result.totalAttempts);
      return {
        pseudonym_id: profile.pseudonym_id,
        skill_id: result.skillId,
        status: deriveSkillStatus(accuracyRate, result.totalAttempts),
        accuracy_rate: accuracyRate,
        attempts_count: result.totalAttempts,
        source: 'diagnostico',
        last_practiced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await client
      .from('skill_mastery')
      .upsert(upserts, { onConflict: 'pseudonym_id,skill_id' });

    if (error) throw error;

    return {
      skipped: false,
      updatedSkills: upserts,
    };
  }

  private async evaluateEnglishExercise(
    exercise: {
      type: string;
      correct_answer: unknown;
      content: { question?: string; feedback_correct?: string; feedback_incorrect?: string };
    },
    answer: unknown,
    mode: 'online' | 'offline',
  ): Promise<ExerciseEvaluation> {
    if (exercise.type !== 'translation') {
      const deterministic = await this.englishEvaluator.evaluate(exercise, answer);
      return { ...deterministic, status: 'evaluated' };
    }

    if (mode === 'offline') {
      return {
        isCorrect: null,
        feedback: 'Pendiente de revision cuando vuelva la conexion.',
        status: 'pending_review',
      };
    }

    const expected = String(exercise.correct_answer);
    const candidate = String(answer);
    const validationPrompt = [
      'Evalua si la traduccion del estudiante es semanticamente equivalente.',
      'Responde solo con JSON valido.',
      `Texto esperado: ${expected}`,
      `Respuesta del estudiante: ${candidate}`,
      'Formato: {"isCorrect": boolean, "feedback": "mensaje breve en ingles sencillo"}',
    ].join('\n');

    try {
      const raw = await this.gemini.chat('You are an English exercise validator.', validationPrompt);
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { isCorrect?: boolean; feedback?: string };

      return {
        isCorrect: parsed.isCorrect ?? false,
        feedback: parsed.feedback ?? 'Check the meaning and try again.',
        status: 'evaluated',
      };
    } catch {
      const fallback = await this.englishEvaluator.evaluate(exercise, answer);
      return { ...fallback, status: 'evaluated' };
    }
  }
}
