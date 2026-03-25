# Panel docente (demo)

## Objetivo

La pantalla `Panel docente` debe permitir que una persona docente:

1. Vea el estado agregado de su seccion por habilidad (sin datos individuales de estudiantes).
2. Cree una asignacion nueva para su seccion.
3. Vea asignaciones activas y su progreso agregado.

## Flujo esperado

### 1) Resumen de seccion

- Fuente: `GET /teacher/section-summary`
- Tabla/vista usada: `section_skill_summary`
- Muestra por habilidad:
  - porcentaje dominado
  - en progreso
  - sin datos

Privacidad: solo datos agregados (no nombres ni identificadores de estudiantes).

### 2) Nueva asignacion

- Fuente: `POST /teacher/assignments`
- Seleccion de habilidad por nombre (no UUID visible en UI).
- Fecha limite en formato `AAAA-MM-DD` en UI.
- El cliente convierte internamente a ISO al enviar.

### 3) Asignaciones activas

- Fuente: `GET /teacher/assignments`
- Muestra:
  - habilidad
  - estudiantes completados / objetivo
  - porcentaje de completion
  - fecha de vencimiento legible

## Dependencias de datos para que no salga vacio

Para que el panel tenga contenido en demo, deben existir:

1. Perfil docente con `section_id`.
2. Al menos un perfil estudiante en la misma seccion.
3. Registro en `student_profiles` para ese estudiante (grado y areas).
4. Habilidades para el grado (`skills`).
5. Registros de `skill_mastery` (opcional, pero recomendado para ver porcentajes utiles).
6. Al menos una `assignment` activa para mostrar la lista.

## Seed de demo

`supabase/seed.sql` ahora incluye:

- usuario docente demo
- usuario estudiante demo
- `student_profiles` del estudiante
- `skill_mastery` inicial
- una asignacion activa
- una completion para el progreso

Credenciales demo:

- `docente@demo.com / demo1234`
- `estudiante@demo.com / demo1234`

## Causas comunes de error en esta pantalla

1. Migraciones no aplicadas en el entorno (esquema viejo).
2. Seed no corrido (no hay `student_profiles`/`skill_mastery`/asignaciones).
3. Backend desplegado sin los ultimos cambios de compatibilidad.

## Checklist rapido para demo

1. Aplicar migraciones pendientes.
2. Correr seed.
3. Desplegar backend actual.
4. Iniciar sesion con docente demo.
5. Verificar:
   - resumen con habilidades
   - creacion de asignacion
   - progreso en asignaciones activas
