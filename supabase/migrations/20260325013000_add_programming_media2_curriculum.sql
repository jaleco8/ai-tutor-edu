-- Migration 20260325013000: starter programming curriculum for media_2

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  programming_names TEXT[] := ARRAY[
    'Variables y tipos de datos',
    'Condicionales en pseudocodigo',
    'Bucles para repetir patrones',
    'Funciones con parametros',
    'Depuracion paso a paso'
  ];
  programming_desc TEXT[] := ARRAY[
    'Identifica variables, entradas y salidas con ejemplos escolares.',
    'Decide acciones con si-entonces usando condiciones simples.',
    'Reconoce cuando conviene repetir instrucciones con ciclos.',
    'Organiza soluciones en bloques reutilizables con parametros.',
    'Encuentra y corrige errores comunes en algoritmos cortos.'
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
  current_skill UUID;
  previous_skill UUID;
  answer_json JSONB;
  content_json JSONB;
  exercise_type TEXT;
  i INT;
  j INT;
BEGIN
  FOR i IN 1..array_length(programming_names, 1) LOOP
    previous_skill := NULLIF(
      (
        SELECT id::text
        FROM skills
        WHERE area = 'programacion'
          AND grade_level = 'media_2'
          AND sequence_order = i - 1
        LIMIT 1
      ),
      ''
    )::uuid;

    INSERT INTO skills (area, grade_level, name, description, sequence_order, prerequisite_skill_id)
    SELECT
      'programacion',
      'media_2',
      programming_names[i],
      programming_desc[i],
      i,
      previous_skill
    WHERE NOT EXISTS (
      SELECT 1
      FROM skills
      WHERE area = 'programacion'
        AND grade_level = 'media_2'
        AND name = programming_names[i]
    );

    SELECT id INTO current_skill
    FROM skills
    WHERE area = 'programacion'
      AND grade_level = 'media_2'
      AND name = programming_names[i]
    LIMIT 1;

    FOR j IN 1..10 LOOP
      INSERT INTO skill_hints (skill_id, hint_type, content, sequence_order)
      SELECT
        current_skill,
        hint_cycle[j],
        format('Pista %s para %s: explica primero la intencion del algoritmo antes de tocar el codigo.', j, programming_names[i]),
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
        ELSE 'multiple_choice'
      END;

      IF exercise_type = 'multiple_choice' THEN
        answer_json := to_jsonb('B'::text);
      ELSE
        answer_json := to_jsonb(ARRAY[
          'Leer el problema',
          'Identificar entradas y salidas',
          'Escribir la logica',
          'Probar el resultado'
        ]);
      END IF;

      content_json := jsonb_build_object(
        'question',
        format('Programacion %s - ejercicio %s sobre %s.', i, j, programming_names[i]),
        'context',
        'Laboratorio de computacion',
        'options',
        CASE
          WHEN exercise_type = 'multiple_choice'
            THEN to_jsonb(ARRAY[
              'A. Distractor',
              format('B. Decision correcta para %s', programming_names[i]),
              'C. Error comun',
              'D. Respuesta sin relacion'
            ])
          ELSE to_jsonb(ARRAY[
            'Escribir la logica',
            'Leer el problema',
            'Probar el resultado',
            'Identificar entradas y salidas'
          ])
        END,
        'feedback_correct',
        'Correcto. La idea del algoritmo esta bien planteada.',
        'feedback_incorrect',
        'Revisa que cada paso tenga una entrada clara y una salida esperada.'
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
  VALUES (
    'programacion',
    'media_2',
    1,
    encode(digest('programacion-media_2-v1', 'sha256'), 'hex'),
    NULL
  )
  ON CONFLICT (area, grade_level, version) DO NOTHING;
END $$;
