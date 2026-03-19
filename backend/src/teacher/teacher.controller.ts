import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { Request } from 'express';

@Controller('teacher')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('docente')
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Get('section-summary')
  getSectionSummary(
    @Req() req: Request,
    @Query('area') area?: string,
  ) {
    const teacherId = (req as any).userId as string;
    const accessToken = (req as any).accessToken as string;
    return this.teacherService.getSectionSummary(accessToken, teacherId, area);
  }

  @Post('assignments')
  createAssignment(
    @Req() req: Request,
    @Body() body: {
      skillId: string;
      deadline: string;
      targetScope: 'all' | 'selected';
      targetStudents?: string[];
    },
  ) {
    const teacherId = (req as any).userId as string;
    return this.teacherService.createAssignment(teacherId, body);
  }

  @Get('assignments')
  getAssignments(@Req() req: Request) {
    const teacherId = (req as any).userId as string;
    const accessToken = (req as any).accessToken as string;
    return this.teacherService.getAssignments(accessToken, teacherId);
  }

  @Delete('assignments/:id')
  deactivateAssignment(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const teacherId = (req as any).userId as string;
    return this.teacherService.deactivateAssignment(id, teacherId);
  }
}
