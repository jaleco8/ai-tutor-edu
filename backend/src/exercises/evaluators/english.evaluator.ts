import { Injectable } from '@nestjs/common';

interface Exercise {
  type: string;
  correct_answer: unknown;
  content: { feedback_correct?: string; feedback_incorrect?: string };
}

@Injectable()
export class EnglishEvaluator {
  async evaluate(exercise: Exercise, answer: unknown): Promise<{ isCorrect: boolean; feedback: string }> {
    const correct = exercise.correct_answer;

    switch (exercise.type) {
      case 'multiple_choice':
      case 'word_order':
      case 'dialogue':
        return {
          isCorrect: String(answer).toLowerCase().trim() === String(correct).toLowerCase().trim(),
          feedback: String(answer).toLowerCase().trim() === String(correct).toLowerCase().trim()
            ? exercise.content.feedback_correct ?? 'Correct!'
            : exercise.content.feedback_incorrect ?? `The correct answer is: ${correct}`,
        };

      case 'translation': {
        // Deterministic fallback: normalized string comparison
        // TODO: Integrate Gemini for fuzzy translation validation when online
        const normalized = String(answer).toLowerCase().trim();
        const expected = String(correct).toLowerCase().trim();
        const isCorrect = normalized === expected;

        return {
          isCorrect,
          feedback: isCorrect
            ? exercise.content.feedback_correct ?? 'Correct!'
            : exercise.content.feedback_incorrect ?? `Expected: ${correct}`,
        };
      }

      default:
        return {
          isCorrect: String(answer) === String(correct),
          feedback: String(answer) === String(correct) ? 'Correct!' : 'Incorrect.',
        };
    }
  }
}
