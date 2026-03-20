import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { randomUUID } from 'crypto';
import { Session, SupabaseClient } from '@supabase/supabase-js';

interface SectionRecord {
  id: string;
  school_code: string;
  section_code: string;
}

interface ProfileRecord {
  pseudonym_id: string;
  role: 'estudiante' | 'docente' | 'admin';
  school_code: string;
  section_id: string | null;
  is_minor: boolean;
}

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async register(dto: RegisterDto) {
    const serviceClient = this.supabase.getClient();
    const publicClient = this.supabase.getPublicClient();
    const section = await this.resolveSection(serviceClient, dto.schoolCode, dto.sectionCode, dto.role);

    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
    });

    if (authError) {
      throw new ConflictException(authError.message);
    }

    const pseudonymId = randomUUID();
    const isMinor = dto.role === 'estudiante';

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: authData.user.id,
      pseudonym_id: pseudonymId,
      role: dto.role,
      school_code: dto.schoolCode,
      section_id: section.id,
      is_minor: isMinor,
      full_name: dto.fullName ?? null,
    });

    if (profileError) {
      await serviceClient.auth.admin.deleteUser(authData.user.id);
      throw new ConflictException('Failed to create profile');
    }

    const { data: sessionData, error: loginError } = await publicClient.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (loginError) {
      throw new UnauthorizedException(loginError.message);
    }

    return this.buildAuthResponse(serviceClient, authData.user.id, sessionData.session!);
  }

  async login(dto: LoginDto) {
    const publicClient = this.supabase.getPublicClient();
    const serviceClient = this.supabase.getClient();

    const { data, error } = await publicClient.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(serviceClient, data.user.id, data.session!);
  }

  async refresh(refreshToken: string) {
    const publicClient = this.supabase.getPublicClient();

    const { data, error } = await publicClient.auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken: data.session!.access_token,
      refreshToken: data.session!.refresh_token,
    };
  }

  async getProfile(userId: string, accessToken: string) {
    const client = this.supabase.getClientForUser(accessToken);
    const serviceClient = this.supabase.getClient();

    const { data: profile, error } = await client
      .from('profiles')
      .select('pseudonym_id, role, school_code, section_id, is_minor')
      .eq('id', userId)
      .single<ProfileRecord>();

    if (error || !profile) {
      throw new UnauthorizedException('Profile not found');
    }

    let sectionCode: string | null = null;
    if (profile.section_id) {
      const { data: section } = await serviceClient
        .from('sections')
        .select('section_code')
        .eq('id', profile.section_id)
        .single();
      sectionCode = section?.section_code ?? null;
    }

    const { data: studentProfile } = await client
      .from('student_profiles')
      .select('grade_level, school_level, selected_areas')
      .eq('user_id', userId)
      .single();

    return {
      pseudonymId: profile.pseudonym_id,
      role: profile.role,
      schoolCode: profile.school_code,
      sectionCode,
      sectionId: profile.section_id,
      isMinor: profile.is_minor,
      gradeLevel: studentProfile?.grade_level ?? null,
      schoolLevel: studentProfile?.school_level ?? null,
      selectedAreas: studentProfile?.selected_areas ?? [],
      onboardingCompleted: Boolean(studentProfile?.grade_level && studentProfile?.selected_areas?.length),
    };
  }

  private async resolveSection(
    client: SupabaseClient,
    schoolCode: string,
    sectionCode: string,
    role: RegisterDto['role'],
  ): Promise<SectionRecord> {
    const { data: existingSection } = await client
      .from('sections')
      .select('id, school_code, section_code')
      .eq('school_code', schoolCode)
      .eq('section_code', sectionCode)
      .maybeSingle<SectionRecord>();

    if (existingSection) {
      return existingSection;
    }

    if (role !== 'docente') {
      throw new BadRequestException('Section does not exist for the selected school');
    }

    const { data: createdSection, error } = await client
      .from('sections')
      .insert({
        school_code: schoolCode,
        section_code: sectionCode,
      })
      .select('id, school_code, section_code')
      .single<SectionRecord>();

    if (error || !createdSection) {
      throw new ConflictException('Failed to create section');
    }

    return createdSection;
  }

  private async buildAuthResponse(
    client: SupabaseClient,
    userId: string,
    session: Session,
  ) {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('pseudonym_id, role, school_code, section_id, is_minor')
      .eq('id', userId)
      .single<ProfileRecord>();

    if (profileError) {
      console.error('buildAuthResponse: profile query error', profileError);
    }

    let sectionCode: string | null = null;
    if (profile?.section_id) {
      const { data: section } = await client
        .from('sections')
        .select('section_code')
        .eq('id', profile.section_id)
        .single();
      sectionCode = section?.section_code ?? null;
    }

    const { data: studentProfile } = await client
      .from('student_profiles')
      .select('grade_level, school_level, selected_areas')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      pseudonymId: profile?.pseudonym_id ?? null,
      role: profile?.role ?? null,
      schoolCode: profile?.school_code ?? null,
      sectionCode,
      sectionId: profile?.section_id ?? null,
      isMinor: profile?.is_minor ?? null,
      gradeLevel: studentProfile?.grade_level ?? null,
      schoolLevel: studentProfile?.school_level ?? null,
      selectedAreas: studentProfile?.selected_areas ?? [],
      onboardingCompleted: Boolean(studentProfile?.grade_level && studentProfile?.selected_areas?.length),
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }
}
