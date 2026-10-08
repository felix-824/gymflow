# GymFlow handoff prompts

Updated October 8, 2026 (Asia/Seoul).

## Resume implementation

Read AGENTS.md, SKILLS.md, and docs/ai/{BACKEND_MIGRATION,DECISIONS,COMPLETED_TASKS,NEXT_STEPS}. Inspect Git status and actual code first. Use the trainer-owned program ER model and USER/TRAINER/ADMIN roles. Preserve unrelated edits and current NestJS architecture. Do not assume the older gym-membership proposal remains current.

## Verify against a disposable database

Run `npm run test:integration`, which creates and stops its own loopback MongoDB server with a unique test database. Never fall back to MONGO_DEV/MONGO_PROD or another configured database. Verify program indexes, lifecycle concurrency, public-owner visibility, saved-list pagination/totals, unique likes/views, comment counters, hard-delete cleanup, and repeated batch reconciliation. Run batch methods directly rather than enabling scheduler jobs. Report actual results and limitations without exposing connection strings.

## Plan the next ER slice

Plan only the named trainerSchedules/reservations/reviews/notification feature. Read the existing program contracts first. Define unresolved business rules and acceptance criteria. Preserve program ownership, terminal deletion, and the distinction between catalog capacity and reservation enforcement.

## Review before release

Review source changes and validation evidence without staging or committing. Confirm breaking GraphQL contracts, fresh-database provisioning, controlled ADMIN bootstrap, frontend coordination, and a single batch scheduler instance. Do not modify existing connections, migrate data, or deploy during a review.
