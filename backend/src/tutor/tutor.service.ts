import { Injectable } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { SupabaseService } from '../common/supabase.service';
import { ConfigService } from '@nestjs/config';
import { selectOfflineHint } from '../common/learning.utils';

const SOCRATIC_PROMPT = `Eres un tutor educativo para estudiantes de escuelas públicas en Venezuela.

REGLAS ESTRICTAS:
1. NUNCA des la respuesta directa. Guía al estudiante con preguntas socráticas.
2. Haz preguntas que lleven al estudiante a descubrir la respuesta por sí mismo.
3. Si el estudiante comete un error, identifica el error conceptual y haz una pregunta que lo ayude a corregirlo.
4. Usa un lenguaje claro, amigable y apropiado para la edad.
5. Responde siempre en español.
6. Mantén las respuestas cortas y enfocadas (máximo 2-3 oraciones por turno).
7. Celebra los avances del estudiante con refuerzo positivo.
8. Si el estudiante se frustra, ofrece una pista más directa pero sin revelar la respuesta.`;

@Injectable()
export class TutorService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async chat(
    skillId: string,
    sessionId: string,
    message: string,
    mode: 'online' | 'offline',
    exerciseContext?: string,
  ) {
    const client = this.supabase.getClient();

    const { data: skill } = await client
      .from('skills')
      .select('name, area, grade_level')
      .eq('id', skillId)
      .single();

    const { data: hints } = await client
      .from('skill_hints')
      .select('hint_type, content')
      .eq('skill_id', skillId)
      .order('sequence_order');

    if (mode === 'offline') {
      return {
        mode,
        sessionId,
        response: selectOfflineHint(hints ?? [], message),
      };
    }

    const promptBase = this.config.get<string>('TUTOR_SYSTEM_PROMPT') ?? SOCRATIC_PROMPT;
    const ragContext = (hints ?? [])
      .slice(0, 3)
      .map((hint) => `- ${hint.hint_type}: ${hint.content}`)
      .join('\n');

    const contextualPrompt = `${promptBase}

CONTEXTO CURRICULAR:
- Área: ${skill?.area ?? 'general'}
- Habilidad: ${skill?.name ?? 'general'}
- Grado: ${skill?.grade_level ?? 'general'}
${exerciseContext ? `\nEJERCICIO ACTUAL:\n${exerciseContext}` : ''}
${ragContext ? `\nPISTAS LOCALES DISPONIBLES:\n${ragContext}` : ''}`;

    const response = await this.gemini.chat(contextualPrompt, message);

    return { mode, sessionId, response };
  }
}
