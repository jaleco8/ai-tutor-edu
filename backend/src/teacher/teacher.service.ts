import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

interface TeacherContext {
  schoolCode: string;
  sectionId: string;
  sectionCode: string;
}

@Injectable()
export class TeacherService {
  constructor(private readonly supabase: SupabaseService) {}

  async getSectionSummary(accessToken: string, teacherId: string, area?: string) {
    const client = this.supabase.getClientForUser(accessToken);

    let query = client
      .from('section_skill_summary')
      .select('*')
      .eq('teacher_id', teacherId);

    if (area) {
      query = query.eq('area', area);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data;
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

    if (error) throw error;
    return data;
  }

  async getAssignments(accessToken: string, teacherId: string) {
    const client = this.supabase.getClientForUser(accessToken);
    const serviceClient = this.supabase.getClient();
    const teacher = await this.getTeacherContext(teacherId);

    const { data, error } = await client
      .from('assignments')
      .select('id, skill_id, deadline, target_scope, target_students, is_active, created_at, skills(name, area)')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

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

  async deactivateAssignment(assignmentId: string, teacherId: string) {
    const client = this.supabase.getClient();

    const { error } = await client
      .from('assignments')
      .update({ is_active: false })
      .eq('id', assignmentId)
      .eq('teacher_id', teacherId);

    if (error) throw error;
    return { success: true };
  }

  private async getTeacherContext(teacherId: string): Promise<TeacherContext> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('school_code, section_id, sections(section_code)')
      .eq('id', teacherId)
      .single<{ school_code: string; section_id: string | null; sections: { section_code: string } | null }>();

    if (error || !data?.section_id || !data.sections?.section_code) {
      throw new BadRequestException('Teacher section not configured');
    }

    return {
      schoolCode: data.school_code,
      sectionId: data.section_id,
      sectionCode: data.sections.section_code,
    };
  }
}
