# GymFlow Backend Adent Instruction

GymFlow is a NestJS GraphQL monorepo migration from Real estate platform into a  fitness and gym managment platform

## Read First

Before changing code, read the current AI handoff docs:

- `docs/ai/BACKEND_MIGRATION.md`
- `docs/ai/DECISIONS.md`
- `docs/ai/COMPLETED_TASK.md`
- `docs/ai/NEXT_STEPS.md`

Use those files as the source of truth for AI Agent related migration history, accepted decisions, remaining work
and validation status.

## Project Shape

- Backend apps are `petoria-api` and `petoria-batch`.
- Keep the existing NestJS resolver/service/module pattern based on MVC and DI.
- Keep DTOs, enums, schemas under `apps/petoria-api/src/libs`.
- Keep shared modules reusable: auth, member, like, view, comment, follow, board article, socket.

## Domain Rules

- Use GymFlow/program terminology for the main catalog entity.
- Do not reintroduce property or real-estate fields.
- Keep `MemberType.USER`, `MemberType.TRAINER` and `MemberType.ADMIN`.
- Program ownership uses `MemberType.TRAINER`.
- Program enum values are:
  - `ProgramType`: `PT_1ON1`, `GROUP_CLASS`, `ONLINE`
  - `ProgramCategory`: `WEIGHT_LOSS`, `MUSCLE_GAIN`, `YOGA`, `PILATES`, `CROSSFIT`, `CARDIO`, `REHAB`
  - `ProgramLocation`: `SEOUL`, `GYEONGGI`, `INCHEON`, `BUSAN`, `DAEGU`, `DAEJEON`, `GWANGJU`, `ONLINE`, `ETC`

  ## Workflow

1. Analyze before editing.
2. Keep changes small and consistent with existing project patterns.
3. Do not remove working logic unless it is replaced safely.
4. Update `docs/ai/COMPLETED_TASKS.md` after major completed work.
5. Add or update focused tests when behavior changes.

## Validation

Use these checks for backend work:

```bash
npx tsc -p apps/petoria-api/tsconfig.app.json --noEmit
npx tsc -p apps/petoria-batch/tsconfig.app.json --noEmit
npx run build