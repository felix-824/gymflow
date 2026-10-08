# Next steps after the program migration

Updated October 8, 2026 (Asia/Seoul). This is a work queue, not an automation.

## Before release

1. Review the source diff, focused tests, and validation evidence in COMPLETED_TASKS.md.
2. Rerun `npm run test:integration`. It starts its own loopback MongoDB 8.2.6 server through mongodb-memory-server, installs indexes, exercises aggregation and concurrent API writes, and stops the server. First execution downloads the binary into ignored `.tmp/mongodb-binaries`; no configured application database is used.
3. Provision a separate GymFlow database and controlled ADMIN bootstrap. Public signup intentionally cannot create ADMIN.
4. Create fresh collections/indexes from the new schemas. Do not point new code at old data or run index synchronization against an existing database.
5. Point API and batch at the same new database only during the separately authorized release. Keep existing environment key contracts and secrets private.
6. Keep one batch scheduler instance until distributed locking is implemented. Counter reconciliation and rank formulas are verified by direct job calls in the disposable tests; 0/20/40 second schedule registration is verified offline. Perform release-specific scheduler observation separately.
7. Inspect the actual frontend; coordinate operation, enum, field, and upload-target changes using FRONTEND_MIGRATION.md.
8. Smoke-test program creation, ownership, pause/resume/delete, discovery, favorites/history, comments, uploads, and current-account authorization.
9. Roll back the application release and its matching database target together if necessary. Do not convert or delete the old real-estate data.

## Follow-on ER features

Implement trainerSchedules, then reservations, then reservation-backed reviews and notification delivery in separately specified slices. Define scheduling timezone, reservation statuses, overlap/capacity enforcement, cancellation, review eligibility, and notification rules before writing those features. Program capacity currently describes an offering; it does not reserve seats.

## Remaining engineering work

- Broader existing lint debt: 208 errors and 5 warnings in untouched files; migration files now pass non-fixing lint. See COMPLETED_TASKS.md.
- Multi-process/distributed concurrency and release-specific startup/scheduler observation; disposable tests cover same-process concurrent requests, not distributed execution.
- Distributed scheduler locking and stronger multi-document consistency if needed.
- A separate review of unrelated existing community/logging behavior.
- Frontend implementation and release validation.

No deployment, live migration, staging, or commit is part of the completed source migration.
