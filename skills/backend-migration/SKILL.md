---
name: backend-migration
description: Continue the GymFlow backend migration from Nestar property concepts to GymFlow program concepts while preserving the existing NestJS architecture.
---

# GymFlow Backend Migration

Use this skill when changing backend code for the GymFlow program migration.

## Workflow

1. Search for affected property/program references before editing.
2. Preserve the resolver/service/module structure already used by `gymflow-api`.
3. Keep DTOs, enums, and schemas in their existing folders.
4. Keep `MemberType.USER | TRAINER | ADMIN` unchanged.
5. Use program terminology for catalog behavior and database lookups.
6. Update social modules consistently when program counters, likes, views, comments, or notifications are involved.
7. Update batch logic when program ranking or `memberPrograms` affects rank calculations.
8. Update `docs/ai/COMPLETED_TASKS.md` after major completed work.