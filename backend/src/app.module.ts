import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './common/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ExercisesModule } from './exercises/exercises.module';
import { TutorModule } from './tutor/tutor.module';
import { TeacherModule } from './teacher/teacher.module';
import { SyncModule } from './sync/sync.module';
import { ContentModule } from './content/content.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,
        limit: 60,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 300,
      },
    ]),
    SupabaseModule,
    HealthModule,
    AuthModule,
    ExercisesModule,
    TutorModule,
    TeacherModule,
    SyncModule,
    ContentModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
