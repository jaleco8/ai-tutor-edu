import { Injectable } from '@nestjs/common';

interface Exercise {
  type: string;
  correct_answer: unknown;
  content: { feedback_correct?: string; feedback_incorrect?: string };
}

@Injectable()
export class MathEvaluator {
  evaluate(exercise: Exercise, answer: unknown): { isCorrect: boolean; feedback: string } {
    const correct = exercise.correct_answer;
    let isCorrect = false;

    switch (exercise.type) {
      case 'multiple_choice':
        isCorrect = String(answer) === String(correct);
        break;

      case 'numeric':
        isCorrect = Number(answer) === Number(correct);
        break;

      case 'order_steps':
        isCorrect =
          Array.isArray(answer) &&
          Array.isArray(correct) &&
          answer.length === correct.length &&
          answer.every((val, idx) => String(val) === String(correct[idx]));
        break;

      default:
        isCorrect = String(answer) === String(correct);
    }

    return {
      isCorrect,
      feedback: isCorrect
        ? exercise.content.feedback_correct ?? 'Correcto!'
        : exercise.content.feedback_incorrect ?? 'Incorrecto. Intenta de nuevo.',
    };
  }
}
