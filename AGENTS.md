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


## Coding Style and Implementation Consistency

- Follow the original Nestar backend coding style.
- Inspect the corresponding Nestar implementation before making changes.
- Preserve the existing NestJS monorepo architecture.
- Maintain established service, resolver, DTO, and Mongoose patterns.
- Follow existing TypeScript naming and formatting conventions.
- Preserve authentication, authorization, and error-handling patterns.
- Use async/await and try/catch consistently with the original code.
- Avoid redundant try/catch blocks that only rethrow errors.
- Do not introduce unnecessary dependencies or architectural changes.
- Make small, incremental changes.
- Run typecheck after each implementation phase.
- Do not modify unrelated files.

## Git Commit Workflow

- Automatically create Git commits after completing each small, logical change.
- Do not wait for me to remind you to commit.
- Use only `feat:` and `fix:` commit prefixes.
- Keep commit messages short, natural, and descriptive.
- Do not combine unrelated changes into a single commit.
- When modifying multiple pages, components, or folders, create separate commits for independently completed changes.
- For large tasks, divide the implementation into smaller logical steps and commit each completed step.
- Do not create unnecessary commits for whitespace, comments, or meaningless changes.
- Before each commit, review `git diff` and stage only files related to that change.
- Run relevant checks before committing whenever possible.
- Do not commit broken or incomplete functionality.
- Never use `git add .` or `git add -A` without reviewing all changes.
- Never amend, reset, rebase, or force-push existing Git history without my approval.
- Do not push commits to GitHub unless I explicitly request it.
- After completing a task, report the commits you created.