import * as SQLite from 'expo-sqlite';
import {
  ChatTurn,
  ContentBundlePayload,
  LocalExercise,
  LocalHint,
  LocalMastery,
  LocalSkill,
  SkillStatus,
  SyncEventType,
} from '../types';
import { deriveSkillStatus, normalizeAccuracy, selectOfflineHint } from '../utils/learning';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('ai-tutor.db');
  }

  return databasePromise;
}

export async function initDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS content_meta (
      area TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      version INTEGER NOT NULL,
      hash_sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (area, grade_level)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY NOT NULL,
      area TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sequence_order INTEGER NOT NULL,
      prerequisite_skill_id TEXT
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      correct_answer_json TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      is_diagnostic INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS skill_hints (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      hint_type TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exercise_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      exercise_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      area TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_correct INTEGER,
      status TEXT NOT NULL,
      time_spent_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_mastery (
      skill_id TEXT PRIMARY KEY NOT NULL,
      skill_name TEXT NOT NULL,
      area TEXT NOT NULL,
      accuracy_rate REAL NOT NULL DEFAULT 0,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disponible',
      last_practiced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export async function saveBundle(bundle: ContentBundlePayload, version: number, hashSha256: string) {
  const db = await getDatabase();
  const skillIds = bundle.skills.map((skill) => skill.id);

  for (const skillId of skillIds) {
    await db.runAsync('DELETE FROM exercises WHERE skill_id = ?', skillId);
    await db.runAsync('DELETE FROM skill_hints WHERE skill_id = ?', skillId);
    await db.runAsync('DELETE FROM skill_mastery WHERE skill_id = ?', skillId);
  }

  await db.runAsync('DELETE FROM skills WHERE area = ? AND grade_level = ?', bundle.area, bundle.gradeLevel);

  for (const skill of bundle.skills) {
    await db.runAsync(
      `
        INSERT OR REPLACE INTO skills (
          id, area, grade_level, name, description, sequence_order, prerequisite_skill_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      skill.id,
      skill.area,
      skill.grade_level,
      skill.name,
      skill.description,
      skill.sequence_order,
      skill.prerequisite_skill_id,
    );

    await db.runAsync(
      `
        INSERT OR IGNORE INTO skill_mastery (
          skill_id, skill_name, area, accuracy_rate, attempts_count, status
        ) VALUES (?, ?, ?, 0, 0, ?)
      `,
      skill.id,
      skill.name,
      skill.area,
      skill.prerequisite_skill_id ? 'bloqueada' : 'disponible',
    );
  }

  for (const exercise of bundle.exercises) {
    await db.runAsync(
      `
        INSERT OR REPLACE INTO exercises (
          id, skill_id, type, content_json, correct_answer_json, difficulty, is_diagnostic
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      exercise.id,
      exercise.skill_id,
      exercise.type,
      JSON.stringify(exercise.content),
      JSON.stringify(exercise.correct_answer),
      exercise.difficulty,
      exercise.is_diagnostic ? 1 : 0,
    );
  }

  for (const hint of bundle.hints) {
    await db.runAsync(
      `
        INSERT OR REPLACE INTO skill_hints (
          id, skill_id, hint_type, content, sequence_order
        ) VALUES (?, ?, ?, ?, ?)
      `,
      hint.id,
      hint.skill_id,
      hint.hint_type,
      hint.content,
      hint.sequence_order,
    );
  }

  await db.runAsync(
    `
      INSERT OR REPLACE INTO content_meta (
        area, grade_level, version, hash_sha256, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    bundle.area,
    bundle.gradeLevel,
    version,
    hashSha256,
    new Date().toISOString(),
  );
}

export async function getSkills(selectedAreas?: string[]) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalSkill>('SELECT * FROM skills ORDER BY area, sequence_order');
  return selectedAreas?.length
    ? rows.filter((row) => selectedAreas.includes(row.area))
    : rows;
}

export async function getDiagnosticExercises(selectedAreas: string[], gradeLevel: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    skill_id: string;
    type: string;
    content_json: string;
    correct_answer_json: string;
    difficulty: number;
    is_diagnostic: number;
  }>(
    'SELECT * FROM exercises WHERE is_diagnostic = 1 ORDER BY difficulty ASC',
  );

  const skills = await getSkills(selectedAreas);
  const skillIds = new Set(skills.filter((skill) => skill.grade_level === gradeLevel).map((skill) => skill.id));

  return rows
    .filter((row) => skillIds.has(row.skill_id))
    .slice(0, 8)
    .map(mapExerciseRow);
}

export async function getPracticeExercises(skillId: string, limit = 10) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    skill_id: string;
    type: string;
    content_json: string;
    correct_answer_json: string;
    difficulty: number;
    is_diagnostic: number;
  }>(
    'SELECT * FROM exercises WHERE skill_id = ? ORDER BY difficulty ASC LIMIT ?',
    skillId,
    limit,
  );

  return rows.map(mapExerciseRow);
}

export async function getHints(skillId: string) {
  const db = await getDatabase();
  return db.getAllAsync<LocalHint>(
    'SELECT * FROM skill_hints WHERE skill_id = ? ORDER BY sequence_order ASC',
    skillId,
  );
}

export async function getOfflineHint(skillId: string, message: string) {
  const hints = await getHints(skillId);
  return selectOfflineHint(hints, message);
}

export async function recordAttempt(input: {
  id: string;
  exerciseId: string;
  skillId: string;
  area: string;
  question: string;
  answer: string;
  isCorrect: boolean | null;
  status: string;
  timeSpentSeconds: number;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT INTO exercise_attempts (
        id, exercise_id, skill_id, area, question, answer, is_correct, status, time_spent_seconds, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.id,
    input.exerciseId,
    input.skillId,
    input.area,
    input.question,
    input.answer,
    input.isCorrect === null ? null : (input.isCorrect ? 1 : 0),
    input.status,
    input.timeSpentSeconds,
    new Date().toISOString(),
  );

  await refreshSkillMastery(input.skillId, input.area);
}

export async function refreshSkillMastery(skillId: string, area: string) {
  const db = await getDatabase();
  const skill = await db.getFirstAsync<{ name: string; prerequisite_skill_id: string | null }>(
    'SELECT name, prerequisite_skill_id FROM skills WHERE id = ?',
    skillId,
  );

  const lastAttempts = await db.getAllAsync<{ is_correct: number | null; created_at: string }>(
    `
      SELECT is_correct, created_at
      FROM exercise_attempts
      WHERE skill_id = ? AND is_correct IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `,
    skillId,
  );

  const correctCount = lastAttempts.filter((attempt) => attempt.is_correct === 1).length;
  const attemptsCount = lastAttempts.length;
  const accuracyRate = normalizeAccuracy(correctCount, attemptsCount);
  let prerequisiteMet = true;

  if (skill?.prerequisite_skill_id) {
    const prerequisite = await db.getFirstAsync<{ status: SkillStatus }>(
      'SELECT status FROM skill_mastery WHERE skill_id = ?',
      skill.prerequisite_skill_id,
    );
    prerequisiteMet = prerequisite?.status === 'en_proceso' || prerequisite?.status === 'dominado';
  }

  const status = deriveSkillStatus(accuracyRate, attemptsCount, prerequisiteMet);
  const lastPracticedAt = lastAttempts[0]?.created_at ?? null;

  await db.runAsync(
    `
      INSERT OR REPLACE INTO skill_mastery (
        skill_id, skill_name, area, accuracy_rate, attempts_count, status, last_practiced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    skillId,
    skill?.name ?? 'Habilidad',
    area,
    accuracyRate,
    attemptsCount,
    status,
    lastPracticedAt,
  );
}

export async function getMastery() {
  const db = await getDatabase();
  return db.getAllAsync<LocalMastery>(
    `
      SELECT
        skill_id AS skillId,
        skill_name AS skillName,
        area,
        accuracy_rate AS accuracyRate,
        attempts_count AS attemptsCount,
        status,
        last_practiced_at AS lastPracticedAt
      FROM skill_mastery
      ORDER BY area, skill_name
    `,
  );
}

export async function getRecentAttempts(skillId: string, limit = 10) {
  const db = await getDatabase();
  return db.getAllAsync<{ question: string; isCorrect: boolean | null }>(
    `
      SELECT question, CASE
        WHEN is_correct IS NULL THEN NULL
        WHEN is_correct = 1 THEN 1
        ELSE 0
      END AS isCorrect
      FROM exercise_attempts
      WHERE skill_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    skillId,
    limit,
  ).then((rows) => rows.map((row) => ({
    question: row.question,
    isCorrect: row.isCorrect === null ? null : Boolean(row.isCorrect),
  })));
}

export async function upsertChatTurn(skillId: string, turn: ChatTurn) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO chat_sessions (
        id, skill_id, role, message, mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    turn.id,
    skillId,
    turn.role,
    turn.message,
    turn.mode,
    turn.createdAt,
  );
}

export async function getChatTurns(skillId: string) {
  const db = await getDatabase();
  return db.getAllAsync<ChatTurn>(
    `
      SELECT
        id,
        role,
        message,
        mode,
        created_at AS createdAt
      FROM chat_sessions
      WHERE skill_id = ?
      ORDER BY created_at ASC
    `,
    skillId,
  );
}

export async function queueSyncEvent(id: string, eventType: SyncEventType, payload: Record<string, unknown>) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO sync_queue (
        id, event_type, payload_json, retry_count, next_retry_at, synced_at, created_at
      ) VALUES (?, ?, ?, COALESCE((SELECT retry_count FROM sync_queue WHERE id = ?), 0), NULL, NULL, ?)
    `,
    id,
    eventType,
    JSON.stringify(payload),
    id,
    new Date().toISOString(),
  );
}

export async function getPendingSyncEvents(limit = 100) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    event_type: SyncEventType;
    payload_json: string;
    retry_count: number;
    next_retry_at: string | null;
    synced_at: string | null;
  }>(
    `
      SELECT id, event_type, payload_json, retry_count, next_retry_at, synced_at
      FROM sync_queue
      WHERE synced_at IS NULL
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?
    `,
    now,
    limit,
  );

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    syncedAt: row.synced_at,
  }));
}

export async function markSyncEventsSynced(ids: string[]) {
  const db = await getDatabase();
  for (const id of ids) {
    await db.runAsync(
      'UPDATE sync_queue SET synced_at = ? WHERE id = ?',
      new Date().toISOString(),
      id,
    );
  }
}

export async function scheduleRetry(id: string, retryCount: number) {
  const db = await getDatabase();
  const minutes = Math.min(2 ** retryCount, 8);
  const nextRetryAt = new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
  await db.runAsync(
    'UPDATE sync_queue SET retry_count = ?, next_retry_at = ? WHERE id = ?',
    retryCount,
    nextRetryAt,
    id,
  );
}

function mapExerciseRow(row: {
  id: string;
  skill_id: string;
  type: string;
  content_json: string;
  correct_answer_json: string;
  difficulty: number;
  is_diagnostic: number;
}): LocalExercise {
  return {
    id: row.id,
    skill_id: row.skill_id,
    type: row.type,
    content: JSON.parse(row.content_json) as LocalExercise['content'],
    correct_answer: JSON.parse(row.correct_answer_json) as LocalExercise['correct_answer'],
    difficulty: row.difficulty,
    is_diagnostic: row.is_diagnostic === 1,
  };
}
