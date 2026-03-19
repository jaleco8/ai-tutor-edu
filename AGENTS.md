# ai-tutor-edu

Tutor de IA para escuelas públicas — prototipo open source.

## Stack

- **Mobile**: React Native (Expo) — tablets Android económicas
- **Backend**: NestJS (Node.js)
- **Base de datos**: Supabase (PostgreSQL)
- **Deploy**: Render
- **IA**: Gemini Flash (Google) como motor del tutor

## Estructura

```
ai-tutor-edu/
├── backend/     # NestJS API
└── mobile/      # React Native app
```

## Módulos educativos

1. **Matemáticas** — ejercicios procedurales con feedback inmediato
2. **Programación** — retos de código con Gemini como revisor
3. **Inglés** — conversación guiada y vocabulario

## Agentes disponibles

- `architect` — diseño de arquitectura
- `planner` — planificación de features
- `tdd-guide` — guía TDD (tests primero)
- `code-reviewer` — revisión de calidad
- `security-reviewer` — privacidad y seguridad (datos de menores)
- `build-error-resolver` — errores de build RN / NestJS
- `refactor-cleaner` — limpieza de código
- `doc-updater` — mantener documentación actualizada

## Comandos principales

| Comando | Uso |
|---------|-----|
| `/plan` | Planificar una feature o módulo |
| `/tdd` | Implementar con tests primero |
| `/code-review` | Revisar calidad |
| `/build-fix` | Arreglar errores de build |
| `/e2e` | Tests end-to-end |
| `/learn` | Guardar patrones de la sesión |
| `/save-session` | Guardar contexto de sesión |
| `/resume-session` | Retomar sesión guardada |
| `/refactor-clean` | Limpiar código entre milestones |

## Convenciones

- Commits en inglés, issues/docs en español
- TypeScript estricto en backend y mobile
- Tests obligatorios para lógica del tutor
- Sin telemetría ni tracking de estudiantes
