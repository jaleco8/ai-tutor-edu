# Backend — NestJS

API del tutor IA.

## Setup

```bash
npm install
npm run start:dev
```

Con el backend corriendo, la documentacion Swagger estara en:

```text
http://localhost:3000/api/docs
```

## Variables de entorno

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
PORT=3000
NODE_ENV=development
SWAGGER_ENABLED=true
```

## Módulos planeados

- `tutor/math` — ejercicios de matemáticas con Gemini
- `tutor/code` — revisión de código con Gemini
- `tutor/english` — inglés conversacional con Gemini
- `progress` — progreso del alumno en Supabase
- `auth` — autenticación de escuelas
