import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { MathEvaluator } from './evaluators/math.evaluator';
import { EnglishEvaluator } from './evaluators/english.evaluator';
import { GeminiService } from '../tutor/gemini.service';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesService, MathEvaluator, EnglishEvaluator, GeminiService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
