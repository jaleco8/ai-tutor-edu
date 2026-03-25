import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

interface TeacherContext {
  schoolCode: string;
  sectionId: string;
  sectionCode: string;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

@Injectable()
export class TeacherService {
  constructor(private readonly supabase: SupabaseService) {}

  async getSectionSummary(_accessToken: string, teacherId: string, area?: string) {
    const client = this.supabase.getClient();

    let query = client
      .from('section_skill_summary')
      .select('*')
      .eq('teacher_id', teacherId);

    if (area) {
      query = query.eq('area', area);
    }

    const { data, error } = await query;
    if (!error) {
      return data;
    }

    if (!this.isMissingColumnError(error, 'section_skill_summary', 'teacher_id')) {
      this.throwSupabaseError(error, 'Failed to load section summary');
    }

    // Legacy fallback for older deployments where section_skill_summary has no teacher_id.
    const schoolCode = await this.getTeacherSchoolCode(teacherId);
    let legacyQuery = client
      .from('section_skill_summary')
      .select('*')
      .eq('school_code', schoolCode);

    if (area) {
      legacyQuery = legacyQuery.eq('area', area);
    }

    const { data: legacyData, error: legacyError } = await legacyQuery;
    if (legacyError) {
      this.throwSupabaseError(legacyError, 'Failed to load section summary');
    }

    return legacyData;
  }

  async createAssignment(teacherId: string, dto: {
    skillId: string;
    deadline: string;
    targetScope: 'all' | 'selected';
    targetStudents?: string[];
  }) {
    const client = this.supabase.getClient();
    const teacher = await this.getTeacherContext(teacherId);
    const targetStudents = dto.targetScope === 'selected' ? (dto.targetStudents ?? []) : [];

    if (dto.targetScope === 'selected' && targetStudents.length === 0) {
      throw new BadRequestException('Selected assignments require target students');
    }

    // Check max 3 active assignments
    const { count } = await client
      .from('assignments')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .eq('section_id', teacher.sectionId)
      .eq('is_active', true);

    if (count !== null && count >= 3) {
      throw new BadRequestException('Maximum 3 active assignments per section');
    }

    if (targetStudents.length > 0) {
      const { data: roster } = await client
        .from('profiles')
        .select('pseudonym_id')
        .eq('section_id', teacher.sectionId)
        .in('pseudonym_id', targetStudents);

      if ((roster ?? []).length !== targetStudents.length) {
        throw new BadRequestException('One or more target students are outside the teacher section');
      }
    }

    const { data, error } = await client.from('assignments').insert({
      teacher_id: teacherId,
      school_code: teacher.schoolCode,
      section_id: teacher.sectionId,
      skill_id: dto.skillId,
      deadline: dto.deadline,
      target_scope: dto.targetScope,
      target_students: targetStudents,
      target: dto.targetScope === 'all' ? 'all' : JSON.stringify(targetStudents),
      is_active: true,
    }).select().single();

    if (error) {
      this.throwSupabaseError(error, 'Failed to create assignment');
    }
    return data;
  }

  async getAssignments(accessToken: string, teacherId: string) {
    const client = this.supabase.getClientForUser(accessToken);
    const serviceClient = this.supabase.getClient();

    const { data, error } = await client
      .from('assignments')
      .select('id, skill_id, deadline, target_scope, target_students, is_active, created_at, skills(name, area)')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      if (this.isLegacyAssignmentsSchemaError(error)) {
        return this.getAssignmentsLegacy(accessToken, teacherId);
      }
      this.throwSupabaseError(error, 'Failed to load assignments');
    }

    const teacher = await this.getTeacherContext(teacherId);

    const assignmentIds = (data ?? []).map((assignment) => assignment.id);
    const { data: completions } = assignmentIds.length > 0
      ? await serviceClient
        .from('assignment_completions')
        .select('assignment_id')
        .eq('section_id', teacher.sectionId)
        .in('assignment_id', assignmentIds)
      : { data: [] as Array<{ assignment_id: string }> };

    const completionCountByAssignment = (completions ?? []).reduce<Map<string, number>>((acc, completion) => {
      acc.set(completion.assignment_id, (acc.get(completion.assignment_id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

    const { count: sectionStudentCount } = await serviceClient
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('section_id', teacher.sectionId)
      .eq('role', 'estudiante');

    return (data ?? []).map((assignment) => {
      const targetedCount = assignment.target_scope === 'all'
        ? sectionStudentCount ?? 0
        : Array.isArray(assignment.target_students) ? assignment.target_students.length : 0;
      const completionCount = completionCountByAssignment.get(assignment.id) ?? 0;

      return {
        ...assignment,
        completionCount,
        targetedCount,
        completionRate: targetedCount > 0
          ? Number(((completionCount / targetedCount) * 100).toFixed(1))
          : 0,
      };
    });
  }

  private async getAssignmentsLegacy(accessToken: string, teacherId: string) {
    const client = this.supabase.getClientForUser(accessToken);
    const serviceClient = this.supabase.getClient();

    const { data, error } = await client
      .from('assignments')
      .select('id, skill_id, deadline, target, is_active, created_at, skills(name, area)')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.throwSupabaseError(error, 'Failed to load assignments');
    }

    const assignmentIds = (data ?? []).map((assignment) => assignment.id);
    const { data: completions } = assignmentIds.length > 0
      ? await serviceClient
        .from('assignment_completions')
        .select('assignment_id')
        .in('assignment_id', assignmentIds)
      : { data: [] as Array<{ assignment_id: string }> };

    const completionCountByAssignment = (completions ?? []).reduce<Map<string, number>>((acc, completion) => {
      acc.set(completion.assignment_id, (acc.get(completion.assignment_id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

    const schoolCode = await this.getTeacherSchoolCode(teacherId);
    const { count: schoolStudentCount } = await serviceClient
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('school_code', schoolCode)
      .eq('role', 'estudiante');

    return (data ?? []).map((assignment) => {
      const targetStudents = this.parseLegacyTargetStudents(assignment.target);
      const targetScope = targetStudents.length > 0 ? 'selected' : 'all';
      const targetedCount = targetScope === 'all' ? (schoolStudentCount ?? 0) : targetStudents.length;
      const completionCount = completionCountByAssignment.get(assignment.id) ?? 0;

      return {
        ...assignment,
        target_scope: targetScope,
        target_students: targetStudents,
        completionCount,
        targetedCount,
        completionRate: targetedCount > 0
          ? Number(((completionCount / targetedCount) * 100).toFixed(1))
          : 0,
      };
    });
  }

  async deactivateAssignment(assignmentId: string, teacherId: string) {
    const client = this.supabase.getClient();

    const { error } = await client
      .from('assignments')
      .update({ is_active: false })
      .eq('id', assignmentId)
      .eq('teacher_id', teacherId);

    if (error) {
      this.throwSupabaseError(error, 'Failed to deactivate assignment');
    }
    return { success: true };
  }

  private async getTeacherContext(teacherId: string): Promise<TeacherContext> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('school_code, section_id')
      .eq('id', teacherId)
      .single<{ school_code: string; section_id: string | null }>();

    if (error || !data?.section_id) {
      throw new BadRequestException('Teacher section not configured');
    }

    const { data: section, error: sectionError } = await client
      .from('sections')
      .select('section_code')
      .eq('id', data.section_id)
      .single<{ section_code: string }>();

    if (sectionError || !section?.section_code) {
      throw new BadRequestException('Teacher section not configured');
    }

    return {
      schoolCode: data.school_code,
      sectionId: data.section_id,
      sectionCode: section.section_code,
    };
  }

  private async getTeacherSchoolCode(teacherId: string): Promise<string> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('school_code')
      .eq('id', teacherId)
      .single<{ school_code: string }>();

    if (error || !data?.school_code) {
      throw new BadRequestException('Teacher school not configured');
    }

    return data.school_code;
  }

  private isMissingColumnError(error: SupabaseErrorLike, table: string, column: string): boolean {
    const code = (error.code ?? '').toUpperCase();
    const message = (error.message ?? '').toLowerCase();
    const missingColumnCode = code === '42703' || code === 'PGRST204' || code === 'PGRST205';

    if (!missingColumnCode) {
      return false;
    }

    return message.includes(table.toLowerCase()) && message.includes(column.toLowerCase());
  }

  private isLegacyAssignmentsSchemaError(error: SupabaseErrorLike): boolean {
    return this.isMissingColumnError(error, 'assignments', 'target_scope')
      || this.isMissingColumnError(error, 'assignments', 'target_students');
  }

  private parseLegacyTargetStudents(target: unknown): string[] {
    if (typeof target !== 'string') {
      return [];
    }

    if (target === 'all') {
      return [];
    }

    try {
      const parsed = JSON.parse(target);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      return [];
    }

    return [];
  }

  private throwSupabaseError(error: SupabaseErrorLike, fallback: string): never {
    throw new BadRequestException(error.message ?? fallback);
  }
}
