import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { Request } from 'express';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly supabase: SupabaseService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('events')
  async processEvents(
    @Req() req: Request,
    @Body() body: {
      events: Array<{
        id: string;
        eventType: string;
        payload: Record<string, unknown>;
      }>;
    },
  ) {
    const userId = (req as any).userId as string;
    if (body.events.length > 100) {
      throw new Error('Batch size exceeds 100 events');
    }

    // Get pseudonym_id for the authenticated user
    const client = this.supabase.getClient();
    const { data: profile } = await client
      .from('profiles')
      .select('pseudonym_id, section_id')
      .eq('id', userId)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    return this.syncService.processBatch(profile.pseudonym_id, profile.section_id, body.events);
  }
}
