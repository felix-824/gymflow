# GymFlow Backend Agent Instructions

GymFlow is a NestJS GraphQL monorepo migrating the Nestar real-estate catalog to trainer-owned fitness programs.

## Read First

Before changing code, read:
- `docs/ai/BACKEND_MIGRATION.md`
- `docs/ai/DECISIONS.md`
- `docs/ai/COMPLETED_TASKS.md`
- `docs/ai/NEXT_STEPS.md`

These files record migration history, accepted decisions, remaining work, and validation evidence.

## Project Shape

- Applications: `gymflow-api` and `gymflow-batch`.
- Preserve the NestJS resolver/service/module structure and dependency injection.
- DTOs and enums: `apps/gymflow-api/src/libs`.
- Mongoose schemas: `apps/gymflow-api/src/schemas`.
- Preserve reusable auth, member, like, view, comment, follow, board-article, and socket modules.
- Batch imports API schemas/types; shared-library extraction is outside this migration.

## Domain Rules

- Main catalog entity: Program; owner: authenticated TRAINER in `memberId`.
- Roles: `USER | TRAINER | ADMIN`. Public signup allows USER/TRAINER only.
- ProgramType: `PT_1ON1 | GROUP_CLASS | ONLINE`.
- ProgramCategory: `WEIGHT_LOSS | MUSCLE_GAIN | YOGA | PILATES | CROSSFIT | CARDIO | REHAB`.
- ProgramLocation: `SEOUL | GYEONGGI | INCHEON | BUSAN | DAEGU | DAEJEON | GWANGJU | ONLINE | ETC`.
- ProgramStatus: `ACTIVE | PAUSED | DELETE`; DELETE is terminal.
- Price: integer KRW/session; duration: minutes/session; capacity: participants/session, exactly one for PT_1ON1.
- ONLINE type requires ONLINE location; in-person programs require a physical location and address.
- `memberPrograms` counts ACTIVE programs.
- Comments target articles; reviews, reservations, and trainer schedules are follow-on features.
- Do not reintroduce real-estate fields.

## Workflow

1. Analyze before editing and preserve unrelated user changes.
2. Keep changes small and consistent with existing patterns.
3. Replace working behavior safely.
4. Update `docs/ai/COMPLETED_TASKS.md` after major work.
5. Add focused behavior and permission tests.
6. Do not use existing application databases for tests. Do not change connection values or deploy without a release instruction.

## Validation

```powershell
node node_modules/typescript/bin/tsc -p apps/gymflow-api/tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/gymflow-batch/tsconfig.app.json --noEmit --incremental false
npm run build -- gymflow-api
npm run build -- gymflow-batch
npm test -- --runInBand
node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "apps/**/*.ts" --no-fix
```

The npm lint script uses auto-fixing; use the explicit non-fixing command for reviews.
