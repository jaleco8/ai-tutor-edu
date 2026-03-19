import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Req } from '@nestjs/common';
import { Request } from 'express';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findBySkill(
    @Query('skill_id') skillId: string,
    @Query('grade') grade: string,
    @Query('limit') limit?: string,
  ) {
    return this.exercisesService.findBySkill(skillId, grade, limit ? parseInt(limit, 10) : 10);
  }

  @UseGuards(JwtAuthGuard)
  @Get('diagnostic')
  getDiagnostic(
    @Query('area') area: string,
    @Query('grade') grade: string,
  ) {
    return this.exercisesService.getDiagnostic(area, grade);
  }

  @UseGuards(JwtAuthGuard)
  @Post('evaluate')
  evaluate(@Body() body: { exerciseId: string; answer: unknown; mode?: 'online' | 'offline' }) {
    return this.exercisesService.evaluate(body.exerciseId, body.answer, body.mode ?? 'online');
  }

  @UseGuards(JwtAuthGuard)
  @Post('diagnostic-result')
  recordDiagnosticResult(
    @Req() req: Request,
    @Body() body: {
      skipped?: boolean;
      results?: Array<{ skillId: string; correctCount: number; totalAttempts: number }>;
    },
  ) {
    const userId = (req as any).userId as string;
    return this.exercisesService.recordDiagnosticResult(userId, body.results ?? [], body.skipped ?? false);
  }
}
