import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { deriveSkillStatus, normalizeAccuracy } from '../common/learning.utils';

interface SyncEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class SyncService {
  constructor(private readonly supabase: SupabaseService) {}

  async processBatch(pseudonymId: string, sectionId: string | null, events: SyncEvent[]) {
    const client = this.supabase.getClient();
    const { data: existingEvents } = await client
      .from('sync_events')
      .select('id')
      .in('id', events.map((event) => event.id));

    const existingIds = new Set((existingEvents ?? []).map((event) => event.id));
    const newEvents = events.filter((event) => !existingIds.has(event.id));

    const rows = newEvents.map((event) => ({
      id: event.id,
      pseudonym_id: pseudonymId,
      event_type: event.eventType,
      payload: event.payload,
    }));

    if (rows.length > 0) {
      const { error } = await client
        .from('sync_events')
        .upsert(rows, { onConflict: 'id' });

      if (error) throw error;
    }

    for (const event of newEvents) {
      await this.applyEvent(client, pseudonymId, sectionId, event);
    }

    return {
      processed: newEvents.length,
      skipped: existingIds.size,
    };
  }

  private async applyEvent(
    client: ReturnType<SupabaseService['getClient']>,
    pseudonymId: string,
    sectionId: string | null,
    event: SyncEvent,
  ) {
    switch (event.eventType) {
      case 'practice_summary':
      case 'translation_review':
        await this.upsertPracticeSummary(client, pseudonymId, event.payload);
        break;
      case 'mastery_update':
        await this.upsertMastery(client, pseudonymId, event.payload);
        break;
      case 'assignment_completed':
        await this.recordAssignmentCompletion(client, pseudonymId, sectionId, event.payload);
        break;
      case 'usage_minutes':
      case 'diagnostic_skipped':
      default:
        break;
    }
  }

  private async upsertPracticeSummary(
    client: ReturnType<SupabaseService['getClient']>,
    pseudonymId: string,
    payload: Record<string, unknown>,
  ) {
    const skillId = String(payload.skillId ?? '');
    const totalAttempts = Number(payload.totalAttempts ?? 0);
    const correctCount = Number(payload.correctCount ?? 0);
    const totalTimeSeconds = Number(payload.totalTimeSeconds ?? 0);
    const periodStart = String(payload.periodStart ?? new Date().toISOString().slice(0, 10));
    const periodEnd = String(payload.periodEnd ?? periodStart);
    const accuracyRate = normalizeAccuracy(correctCount, totalAttempts);
    const lastPracticedAt = String(payload.lastPracticedAt ?? new Date().toISOString());

    if (!skillId) {
      return;
    }

    await client
      .from('exercise_attempts_aggregated')
      .upsert({
        pseudonym_id: pseudonymId,
        skill_id: skillId,
        total_attempts: totalAttempts,
        correct_count: correctCount,
        total_time_seconds: totalTimeSeconds,
        period_start: periodStart,
        period_end: periodEnd,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'pseudonym_id,skill_id,period_start,period_end',
      });

    await client
      .from('skill_mastery')
      .upsert({
        pseudonym_id: pseudonymId,
        skill_id: skillId,
        status: deriveSkillStatus(accuracyRate, totalAttempts),
        accuracy_rate: accuracyRate,
        attempts_count: totalAttempts,
        source: 'sync',
        last_practiced_at: lastPracticedAt,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'pseudonym_id,skill_id',
      });
  }

  private async upsertMastery(
    client: ReturnType<SupabaseService['getClient']>,
    pseudonymId: string,
    payload: Record<string, unknown>,
  ) {
    const skillId = String(payload.skillId ?? '');
    if (!skillId) {
      return;
    }

    const accuracyRate = Number(payload.accuracyRate ?? 0);
    const attemptsCount = Number(payload.attemptsCount ?? 0);

    await client
      .from('skill_mastery')
      .upsert({
        pseudonym_id: pseudonymId,
        skill_id: skillId,
        status: String(payload.status ?? deriveSkillStatus(accuracyRate, attemptsCount)),
        accuracy_rate: accuracyRate,
        attempts_count: attemptsCount,
        source: 'sync',
        last_practiced_at: String(payload.lastPracticedAt ?? new Date().toISOString()),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'pseudonym_id,skill_id',
      });
  }

  private async recordAssignmentCompletion(
    client: ReturnType<SupabaseService['getClient']>,
    pseudonymId: string,
    sectionId: string | null,
    payload: Record<string, unknown>,
  ) {
    const assignmentId = String(payload.assignmentId ?? '');

    if (!assignmentId) {
      return;
    }

    await client
      .from('assignment_completions')
      .upsert({
        assignment_id: assignmentId,
        pseudonym_id: pseudonymId,
        section_id: sectionId,
        completed_at: String(payload.completedAt ?? new Date().toISOString()),
      }, {
        onConflict: 'assignment_id,pseudonym_id',
      });
  }
}
