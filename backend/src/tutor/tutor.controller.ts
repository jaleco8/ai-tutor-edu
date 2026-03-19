import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('tutor')
export class TutorController {
  constructor(private readonly tutorService: TutorService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('chat')
  chat(
    @Body() body: {
      skillId: string;
      sessionId: string;
      message: string;
      exerciseContext?: string;
      mode?: 'online' | 'offline';
    },
  ) {
    return this.tutorService.chat(
      body.skillId,
      body.sessionId,
      body.message,
      body.mode ?? 'online',
      body.exerciseContext,
    );
  }
}
