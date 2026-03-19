import { Module } from '@nestjs/common';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';
import { GeminiService } from './gemini.service';

@Module({
  controllers: [TutorController],
  providers: [TutorService, GeminiService],
})
export class TutorModule {}
