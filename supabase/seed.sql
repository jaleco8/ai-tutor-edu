-- Seed data for Sprint 1 MVP/P0
-- HU-30: media_1 curriculum for Matematicas and Ingles

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO sections (school_code, section_code)
VALUES ('DEV-001', '1A')
ON CONFLICT (school_code, section_code) DO NOTHING;

-- ============================================================
-- Demo users (development only — DO NOT run in production)
--   estudiante@demo.com / demo1234  →  role: estudiante
--   docente@demo.com    / demo1234  →  role: docente
-- ============================================================
DO $$
DECLARE
  v_section_id  UUID;
  v_student_id  UUID := '00000000-0000-0000-0001-000000000001';
  v_teacher_id  UUID := '00000000-0000-0000-0001-000000000002';
BEGIN
  SELECT id INTO v_section_id
  FROM sections
  WHERE school_code = 'DEV-001' AND section_code = '1A';

  -- Demo teacher
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_teacher_id, 'authenticated', 'authenticated',
    'docente@demo.com',
    crypt('demo1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0002-000000000002',
    v_teacher_id,
    jsonb_build_object('sub', v_teacher_id::text, 'email', 'docente@demo.com'),
    'email', 'docente@demo.com',
    now(), now(), now()
  ) ON CONFLICT (provider, provider_id) DO NOTHING;

  INSERT INTO profiles (id, role, school_code, full_name, section_id, is_minor)
  VALUES (v_teacher_id, 'docente', 'DEV-001', 'Docente Demo', v_section_id, false)
  ON CONFLICT (id) DO NOTHING;

  -- Demo student
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_student_id, 'authenticated', 'authenticated',
    'estudiante@demo.com',
    crypt('demo1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0002-000000000001',
    v_student_id,
    jsonb_build_object('sub', v_student_id::text, 'email', 'estudiante@demo.com'),
    'email', 'estudiante@demo.com',
    now(), now(), now()
  ) ON CONFLICT (provider, provider_id) DO NOTHING;

  INSERT INTO profiles (id, role, school_code, full_name, section_id, is_minor)
  VALUES (v_student_id, 'estudiante', 'DEV-001', 'Estudiante Demo', v_section_id, true)
  ON CONFLICT (id) DO NOTHING;
END $$;

DO $$
DECLARE
  math_names TEXT[] := ARRAY[
    'Conjuntos y pertenencia',
    'Enteros y valor absoluto',
    'Fracciones y racionales',
    'Ecuaciones de primer grado',
    'Problemas de proporcionalidad'
  ];
  math_desc TEXT[] := ARRAY[
    'Reconoce conjuntos y relaciones de pertenencia con ejemplos cercanos al aula.',
    'Opera numeros enteros y usa valor absoluto en contextos cotidianos.',
    'Representa y compara fracciones y numeros racionales.',
    'Resuelve ecuaciones lineales de una variable paso a paso.',
    'Aplica razones y proporciones en situaciones del entorno escolar.'
  ];
  english_names TEXT[] := ARRAY[
    'Greetings and introductions',
    'Classroom objects',
    'School routines',
    'Simple present for daily actions',
    'Directions and locations at school'
  ];
  english_desc TEXT[] := ARRAY[
    'Se presenta y saluda usando expresiones basicas en contexto.',
    'Nombra y describe objetos frecuentes del aula.',
    'Habla sobre rutinas escolares con vocabulario funcional.',
    'Usa simple present para acciones habituales del entorno escolar.',
    'Comprende y usa referencias de ubicacion y direcciones simples.'
  ];
  hint_cycle TEXT[] := ARRAY[
    'error_frecuente',
    'concepto_clave',
    'pregunta_socratica',
    'ejemplo_contextual',
    'error_frecuente',
    'concepto_clave',
    'pregunta_socratica',
    'ejemplo_contextual',
    'concepto_clave',
    'pregunta_socratica'
  ];
  current_area TEXT;
  current_name TEXT;
  current_desc TEXT;
  current_skill UUID;
  previous_skill UUID;
  exercise_type TEXT;
  answer_json JSONB;
  content_json JSONB;
  option_list TEXT[];
  i INT;
  j INT;
BEGIN
  FOR i IN 1..array_length(math_names, 1) LOOP
    previous_skill := NULLIF(
      (
        SELECT id::text
        FROM skills
        WHERE area = 'matematicas'
          AND grade_level = 'media_1'
          AND sequence_order = i - 1
        LIMIT 1
      ),
      ''
    )::uuid;

    INSERT INTO skills (area, grade_level, name, description, sequence_order, prerequisite_skill_id)
    SELECT
      'matematicas',
      'media_1',
      math_names[i],
      math_desc[i],
      i,
      previous_skill
    WHERE NOT EXISTS (
      SELECT 1
      FROM skills
      WHERE area = 'matematicas'
        AND grade_level = 'media_1'
        AND name = math_names[i]
    );

    SELECT id INTO current_skill
    FROM skills
    WHERE area = 'matematicas'
      AND grade_level = 'media_1'
      AND name = math_names[i]
    LIMIT 1;

    FOR j IN 1..10 LOOP
      INSERT INTO skill_hints (skill_id, hint_type, content, sequence_order)
      SELECT
        current_skill,
        hint_cycle[j],
        format('Pista %s para %s: conecta la idea con una situacion del aula antes de calcular.', j, math_names[i]),
        j
      WHERE NOT EXISTS (
        SELECT 1
        FROM skill_hints
        WHERE skill_id = current_skill
          AND sequence_order = j
      );
    END LOOP;

    FOR j IN 1..20 LOOP
      exercise_type := CASE
        WHEN mod(j, 3) = 0 THEN 'order_steps'
        WHEN mod(j, 2) = 0 THEN 'numeric'
        ELSE 'multiple_choice'
      END;

      IF exercise_type = 'multiple_choice' THEN
        option_list := ARRAY['A', 'B', 'C', 'D'];
        answer_json := to_jsonb('B'::text);
      ELSIF exercise_type = 'numeric' THEN
        answer_json := to_jsonb((i * 10) + j);
      ELSE
        answer_json := to_jsonb(ARRAY['Leer el problema', 'Organizar los datos', 'Resolver', 'Verificar']);
      END IF;

      content_json := jsonb_build_object(
        'question',
        format('Matematicas %s - ejercicio %s sobre %s.', i, j, math_names[i]),
        'options',
        CASE
          WHEN exercise_type = 'multiple_choice'
            THEN to_jsonb(ARRAY[
              format('A. Opcion de practica %s', j),
              format('B. Respuesta correcta guiada para %s', math_names[i]),
              format('C. Error frecuente %s', j),
              'D. Distractor contextual'
            ])
          WHEN exercise_type = 'order_steps'
            THEN to_jsonb(ARRAY['Resolver', 'Leer el problema', 'Verificar', 'Organizar los datos'])
          ELSE '[]'::jsonb
        END,
        'feedback_correct',
        'Correcto. Sigue justificando cada paso.',
        'feedback_incorrect',
        'Revisa el dato principal y vuelve al procedimiento.'
      );

      INSERT INTO exercises (skill_id, type, content, correct_answer, difficulty, is_diagnostic)
      SELECT
        current_skill,
        exercise_type,
        content_json,
        answer_json,
        CASE WHEN j <= 7 THEN 1 WHEN j <= 14 THEN 2 ELSE 3 END,
        j <= 5
      WHERE NOT EXISTS (
        SELECT 1
        FROM exercises
        WHERE skill_id = current_skill
          AND content->>'question' = content_json->>'question'
      );
    END LOOP;
  END LOOP;

  FOR i IN 1..array_length(english_names, 1) LOOP
    previous_skill := NULLIF(
      (
        SELECT id::text
        FROM skills
        WHERE area = 'ingles'
          AND grade_level = 'media_1'
          AND sequence_order = i - 1
        LIMIT 1
      ),
      ''
    )::uuid;

    INSERT INTO skills (area, grade_level, name, description, sequence_order, prerequisite_skill_id)
    SELECT
      'ingles',
      'media_1',
      english_names[i],
      english_desc[i],
      i,
      previous_skill
    WHERE NOT EXISTS (
      SELECT 1
      FROM skills
      WHERE area = 'ingles'
        AND grade_level = 'media_1'
        AND name = english_names[i]
    );

    SELECT id INTO current_skill
    FROM skills
    WHERE area = 'ingles'
      AND grade_level = 'media_1'
      AND name = english_names[i]
    LIMIT 1;

    FOR j IN 1..10 LOOP
      INSERT INTO skill_hints (skill_id, hint_type, content, sequence_order)
      SELECT
        current_skill,
        hint_cycle[j],
        format('Hint %s for %s: ask the learner to explain the idea with a school example.', j, english_names[i]),
        j
      WHERE NOT EXISTS (
        SELECT 1
        FROM skill_hints
        WHERE skill_id = current_skill
          AND sequence_order = j
      );
    END LOOP;

    FOR j IN 1..20 LOOP
      exercise_type := CASE
        WHEN mod(j, 4) = 0 THEN 'translation'
        WHEN mod(j, 3) = 0 THEN 'dialogue'
        WHEN mod(j, 2) = 0 THEN 'word_order'
        ELSE 'multiple_choice'
      END;

      IF exercise_type = 'multiple_choice' THEN
        answer_json := to_jsonb('B'::text);
      ELSIF exercise_type = 'word_order' THEN
        answer_json := to_jsonb('My classroom is clean'::text);
      ELSIF exercise_type = 'dialogue' THEN
        answer_json := to_jsonb('Hello, my name is Ana.'::text);
      ELSE
        answer_json := to_jsonb('The library is next to the lab.'::text);
      END IF;

      content_json := jsonb_build_object(
        'question',
        format('English %s - exercise %s about %s.', i, j, english_names[i]),
        'context',
        'School setting',
        'options',
        CASE
          WHEN exercise_type = 'multiple_choice'
            THEN to_jsonb(ARRAY[
              'A. Distractor',
              format('B. Functional answer for %s', english_names[i]),
              'C. Grammar trap',
              'D. Unrelated option'
            ])
          WHEN exercise_type = 'word_order'
            THEN to_jsonb(ARRAY['clean', 'My', 'is', 'classroom'])
          WHEN exercise_type = 'dialogue'
            THEN to_jsonb(ARRAY['Good afternoon', 'I am Ana', 'Nice to meet you'])
          ELSE '[]'::jsonb
        END,
        'feedback_correct',
        'Correct. Use the sentence in a real classroom context.',
        'feedback_incorrect',
        'Check the communicative purpose before answering.'
      );

      INSERT INTO exercises (skill_id, type, content, correct_answer, difficulty, is_diagnostic)
      SELECT
        current_skill,
        exercise_type,
        content_json,
        answer_json,
        CASE WHEN j <= 7 THEN 1 WHEN j <= 14 THEN 2 ELSE 3 END,
        j <= 5
      WHERE NOT EXISTS (
        SELECT 1
        FROM exercises
        WHERE skill_id = current_skill
          AND content->>'question' = content_json->>'question'
      );
    END LOOP;
  END LOOP;

  INSERT INTO content_versions (area, grade_level, version, hash_sha256, bundle_url)
  VALUES
    ('matematicas', 'media_1', 1, encode(digest('matematicas-media_1-v1', 'sha256'), 'hex'), NULL),
    ('ingles', 'media_1', 1, encode(digest('ingles-media_1-v1', 'sha256'), 'hex'), NULL)
  ON CONFLICT (area, grade_level, version) DO NOTHING;
END $$;

-- ============================================================
-- Teacher panel demo data (section summary + active assignment)
-- ============================================================
DO $$
DECLARE
  v_teacher_id UUID := '00000000-0000-0000-0001-000000000002';
  v_student_id UUID := '00000000-0000-0000-0001-000000000001';
  v_section_id UUID;
  v_student_pseudonym UUID;
  v_math_skill_1 UUID;
  v_math_skill_2 UUID;
  v_english_skill_1 UUID;
  v_assignment_id UUID;
  v_has_section_id BOOLEAN;
  v_has_target_scope BOOLEAN;
  v_has_target_students BOOLEAN;
BEGIN
  SELECT id INTO v_section_id
  FROM sections
  WHERE school_code = 'DEV-001' AND section_code = '1A'
  LIMIT 1;

  SELECT pseudonym_id INTO v_student_pseudonym
  FROM profiles
  WHERE id = v_student_id
  LIMIT 1;

  -- Ensure student onboarding context exists (required by section_skill_summary in phase2).
  INSERT INTO student_profiles (user_id, school_level, grade_level, selected_areas)
  VALUES (v_student_id, 'media', 'media_1', ARRAY['matematicas', 'ingles'])
  ON CONFLICT (user_id) DO UPDATE
    SET school_level = EXCLUDED.school_level,
        grade_level = EXCLUDED.grade_level,
        selected_areas = EXCLUDED.selected_areas,
        updated_at = now();

  SELECT id INTO v_math_skill_1
  FROM skills
  WHERE area = 'matematicas' AND grade_level = 'media_1' AND sequence_order = 1
  LIMIT 1;

  SELECT id INTO v_math_skill_2
  FROM skills
  WHERE area = 'matematicas' AND grade_level = 'media_1' AND sequence_order = 2
  LIMIT 1;

  SELECT id INTO v_english_skill_1
  FROM skills
  WHERE area = 'ingles' AND grade_level = 'media_1' AND sequence_order = 1
  LIMIT 1;

  -- Seed mastery mix so teacher summary has meaningful percentages.
  IF v_student_pseudonym IS NOT NULL AND v_math_skill_1 IS NOT NULL THEN
    INSERT INTO skill_mastery (
      pseudonym_id, skill_id, status, accuracy_rate, attempts_count, source, last_practiced_at
    )
    VALUES (
      v_student_pseudonym, v_math_skill_1, 'dominado', 92.0, 14, 'sync', now() - interval '1 day'
    )
    ON CONFLICT (pseudonym_id, skill_id) DO UPDATE
      SET status = EXCLUDED.status,
          accuracy_rate = EXCLUDED.accuracy_rate,
          attempts_count = EXCLUDED.attempts_count,
          source = EXCLUDED.source,
          last_practiced_at = EXCLUDED.last_practiced_at,
          updated_at = now();
  END IF;

  IF v_student_pseudonym IS NOT NULL AND v_math_skill_2 IS NOT NULL THEN
    INSERT INTO skill_mastery (
      pseudonym_id, skill_id, status, accuracy_rate, attempts_count, source, last_practiced_at
    )
    VALUES (
      v_student_pseudonym, v_math_skill_2, 'en_proceso', 54.0, 11, 'sync', now() - interval '2 days'
    )
    ON CONFLICT (pseudonym_id, skill_id) DO UPDATE
      SET status = EXCLUDED.status,
          accuracy_rate = EXCLUDED.accuracy_rate,
          attempts_count = EXCLUDED.attempts_count,
          source = EXCLUDED.source,
          last_practiced_at = EXCLUDED.last_practiced_at,
          updated_at = now();
  END IF;

  IF v_student_pseudonym IS NOT NULL AND v_english_skill_1 IS NOT NULL THEN
    INSERT INTO skill_mastery (
      pseudonym_id, skill_id, status, accuracy_rate, attempts_count, source, last_practiced_at
    )
    VALUES (
      v_student_pseudonym, v_english_skill_1, 'sin_datos', 0, 0, 'sync', null
    )
    ON CONFLICT (pseudonym_id, skill_id) DO UPDATE
      SET status = EXCLUDED.status,
          accuracy_rate = EXCLUDED.accuracy_rate,
          attempts_count = EXCLUDED.attempts_count,
          source = EXCLUDED.source,
          last_practiced_at = EXCLUDED.last_practiced_at,
          updated_at = now();
  END IF;

  -- Insert one active assignment, supporting both legacy and phase2 schemas.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = 'section_id'
  ) INTO v_has_section_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = 'target_scope'
  ) INTO v_has_target_scope;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = 'target_students'
  ) INTO v_has_target_students;

  IF v_math_skill_1 IS NOT NULL THEN
    IF v_has_section_id AND v_has_target_scope AND v_has_target_students THEN
      INSERT INTO assignments (
        teacher_id, school_code, section_id, skill_id, deadline, target, target_scope, target_students, is_active
      )
      SELECT
        v_teacher_id,
        'DEV-001',
        v_section_id,
        v_math_skill_1,
        now() + interval '5 days',
        'all',
        'all',
        '[]'::jsonb,
        true
      WHERE NOT EXISTS (
        SELECT 1
        FROM assignments
        WHERE teacher_id = v_teacher_id
          AND skill_id = v_math_skill_1
          AND is_active = true
      );
    ELSE
      INSERT INTO assignments (teacher_id, school_code, skill_id, deadline, target, is_active)
      SELECT
        v_teacher_id,
        'DEV-001',
        v_math_skill_1,
        now() + interval '5 days',
        'all',
        true
      WHERE NOT EXISTS (
        SELECT 1
        FROM assignments
        WHERE teacher_id = v_teacher_id
          AND skill_id = v_math_skill_1
          AND is_active = true
      );
    END IF;
  END IF;

  -- Mark completion for demo progress bars.
  SELECT id INTO v_assignment_id
  FROM assignments
  WHERE teacher_id = v_teacher_id
    AND skill_id = v_math_skill_1
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_assignment_id IS NOT NULL AND v_student_pseudonym IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'assignment_completions' AND column_name = 'section_id'
    ) THEN
      INSERT INTO assignment_completions (assignment_id, pseudonym_id, section_id, completed_at)
      VALUES (v_assignment_id, v_student_pseudonym, v_section_id, now() - interval '6 hours')
      ON CONFLICT (assignment_id, pseudonym_id) DO UPDATE
        SET section_id = EXCLUDED.section_id,
            completed_at = EXCLUDED.completed_at;
    ELSE
      INSERT INTO assignment_completions (assignment_id, pseudonym_id, completed_at)
      VALUES (v_assignment_id, v_student_pseudonym, now() - interval '6 hours')
      ON CONFLICT (assignment_id, pseudonym_id) DO UPDATE
        SET completed_at = EXCLUDED.completed_at;
    END IF;
  END IF;
END $$;
