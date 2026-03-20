import { Injectable, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

interface BundleQuery {
  area: string;
  gradeLevel: string;
}

export interface BundleManifest extends BundleQuery {
  version: number;
  hashSha256: string;
  signedUrl: string;
}

@Injectable()
export class ContentService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  getGrades() {
    return {
      levels: [
        {
          name: 'Educación Primaria',
          grades: Array.from({ length: 6 }, (_, i) => ({
            value: `primaria_${i + 1}`,
            label: `${i + 1}° grado`,
          })),
        },
        {
          name: 'Educación Media',
          grades: Array.from({ length: 5 }, (_, i) => ({
            value: `media_${i + 1}`,
            label: `${i + 1}° año`,
          })),
        },
      ],
    };
  }

  getAreas() {
    return {
      areas: [
        { value: 'matematicas', label: 'Matemáticas', icon: 'calculator' },
        { value: 'ingles', label: 'Inglés', icon: 'globe' },
        { value: 'programacion', label: 'Programación', icon: 'code' },
      ],
    };
  }

  async updateStudentProfile(
    userId: string,
    _accessToken: string,
    gradeLevel: string,
    schoolLevel: string,
    selectedAreas: string[],
  ) {
    // Use service client (admin) — auth is already validated by JwtAuthGuard.
    // Using the user-scoped client here triggers RLS on upsert which can fail
    // with ambiguous policy errors depending on Supabase/PostgREST version.
    const client = this.supabase.getClient();

    const { error } = await client.from('student_profiles').upsert({
      user_id: userId,
      grade_level: gradeLevel,
      school_level: schoolLevel,
      selected_areas: selectedAreas,
    }, { onConflict: 'user_id' });

    if (error) {
      throw new InternalServerErrorException(error.message ?? 'Failed to save student profile');
    }
    return { success: true };
  }

  async getContentBundleManifest(baseUrl: string, area: string, gradeLevel: string): Promise<BundleManifest> {
    const bundlePayload = await this.buildBundlePayload({ area, gradeLevel });
    const serialized = JSON.stringify(bundlePayload);
    const hashSha256 = createHash('sha256').update(serialized).digest('hex');
    const client = this.supabase.getClient();
    const { data: latestVersion } = await client
      .from('content_versions')
      .select('version, hash_sha256')
      .eq('area', area)
      .eq('grade_level', gradeLevel)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ version: number; hash_sha256: string }>();

    const version = latestVersion?.version ?? 1;
    const expires = Date.now() + (15 * 60 * 1000);
    const signature = this.signBundle({ area, gradeLevel, version, expires });
    const query = new URLSearchParams({
      area,
      grade: gradeLevel,
      version: String(version),
      expires: String(expires),
      signature,
    });

    return {
      area,
      gradeLevel,
      version,
      hashSha256: latestVersion?.hash_sha256 ?? hashSha256,
      signedUrl: `${baseUrl}/content/bundle/download?${query.toString()}`,
    };
  }

  async downloadContentBundle(input: {
    area: string;
    gradeLevel: string;
    version: number;
    expires: number;
    signature: string;
  }) {
    this.assertBundleSignature(input);

    const payload = await this.buildBundlePayload({
      area: input.area,
      gradeLevel: input.gradeLevel,
    });
    const serialized = JSON.stringify(payload);
    const hashSha256 = createHash('sha256').update(serialized).digest('hex');
    const archive = new JSZip();

    archive.file('bundle.json', serialized);

    return {
      fileName: `${input.area}-${input.gradeLevel}-v${input.version}.zip`,
      hashSha256,
      buffer: await archive.generateAsync({ type: 'nodebuffer' }),
    };
  }

  async getStudentAssignments(userId: string, accessToken: string) {
    const userClient = this.supabase.getClientForUser(accessToken);
    const serviceClient = this.supabase.getClient();

    const { data: profile } = await serviceClient
      .from('profiles')
      .select('pseudonym_id')
      .eq('id', userId)
      .single<{ pseudonym_id: string }>();

    if (!profile) {
      throw new UnauthorizedException('Profile not found');
    }

    const { data: assignments, error } = await userClient
      .from('assignments')
      .select('id, skill_id, deadline, target_scope, target_students, created_at, is_active, skills(name, area)')
      .eq('is_active', true)
      .order('deadline', { ascending: true });

    if (error) throw error;

    const assignmentIds = (assignments ?? []).map((assignment) => assignment.id);
    const { data: completions } = assignmentIds.length > 0
      ? await serviceClient
        .from('assignment_completions')
        .select('assignment_id, completed_at')
        .eq('pseudonym_id', profile.pseudonym_id)
        .in('assignment_id', assignmentIds)
      : { data: [] as Array<{ assignment_id: string; completed_at: string }> };

    const completionMap = new Map(
      (completions ?? []).map((completion) => [completion.assignment_id, completion.completed_at]),
    );

    return (assignments ?? []).map((assignment) => ({
      ...assignment,
      completedAt: completionMap.get(assignment.id) ?? null,
      isCompleted: completionMap.has(assignment.id),
    }));
  }

  private async buildBundlePayload({ area, gradeLevel }: BundleQuery) {
    const client = this.supabase.getClient();

    const { data: skills } = await client
      .from('skills')
      .select('*')
      .eq('area', area)
      .eq('grade_level', gradeLevel)
      .order('sequence_order');

    const skillIds = (skills ?? []).map((skill) => skill.id);
    const { data: exercises } = skillIds.length > 0
      ? await client.from('exercises').select('*').in('skill_id', skillIds)
      : { data: [] };
    const { data: hints } = skillIds.length > 0
      ? await client.from('skill_hints').select('*').in('skill_id', skillIds)
      : { data: [] };

    return {
      area,
      gradeLevel,
      skills: skills ?? [],
      exercises: exercises ?? [],
      hints: hints ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  private signBundle(input: { area: string; gradeLevel: string; version: number; expires: number }) {
    const secret = this.getBundleSecret();
    return createHmac('sha256', secret)
      .update(`${input.area}:${input.gradeLevel}:${input.version}:${input.expires}`)
      .digest('hex');
  }

  private assertBundleSignature(input: {
    area: string;
    gradeLevel: string;
    version: number;
    expires: number;
    signature: string;
  }) {
    if (!Number.isFinite(input.version) || !Number.isFinite(input.expires)) {
      throw new BadRequestException('Invalid bundle parameters');
    }

    if (Date.now() > input.expires) {
      throw new UnauthorizedException('Bundle URL has expired');
    }

    const expected = this.signBundle(input);
    const left = Buffer.from(expected);
    const right = Buffer.from(input.signature);

    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Invalid bundle signature');
    }
  }

  private getBundleSecret() {
    return this.config.get<string>('CONTENT_BUNDLE_SECRET')
      ?? this.config.getOrThrow<string>('SUPABASE_SERVICE_KEY');
  }
}
