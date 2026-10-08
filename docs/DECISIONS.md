# Migration decisions

Snapshot: October 8, 2026 (Asia/Seoul).
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

These decisions distinguish the implemented naming layer from future architecture. A product preference does not imply that its supporting code exists.

## Implemented and preserved boundaries

| ID | Decision | Status | Reason | Risk / alternative |
| --- | --- | --- | --- | --- |
| D01 | Use GymFlow display branding and lowercase gymflow package/app identifiers | Completed | Matches the clarified fitness/gym product | Historical Petoria commit subject remains confusing; document it rather than rewriting history |
| D02 | Limit the first refactor to names, paths, branding, associated tests, and README | Completed | Makes review and regression attribution manageable | Existing defects remain; alternative was a broader, harder-to-review domain refactor |
| D03 | Retain NestJS, code-first GraphQL/Apollo, MongoDB/Mongoose, and current dependency versions | Completed | Reuses the working architecture without combining migration and upgrades | Existing dependency/tooling issues remain; major upgrades are separate work |
| D04 | Retain separate API and batch apps | Completed | Preserves existing runtime responsibilities | App-to-app source coupling remains; alternative is immediate consolidation or service redesign |
| D05 | Preserve GraphQL contracts, collections, schema fields, domain enums, and job behavior | Completed | Avoids breaking existing integrations or modifying data in a rename | The current product still behaves as real estate software |
| D06 | Preserve environment keys, connection values, ports, and secrets | Completed | Branding must not redirect the application to another database | Actual deployed configuration is Not verified; a future explicit database change needs its own plan |
| D07 | Run lint without auto-fixes and both no-emit app typechecks; report existing failures | Completed | Prevents unrelated formatting or dependency edits | Checks are not all green; fixing everything inside the rename would expand scope |
| D08 | Preserve the user's AGENTS.md edits; do not stage or commit assistant work | Completed | Keeps ownership and review under user control | A later commit exists, but was not made by the assistant |
| D09 | Create only six new documentation files for this task | Confirmed direction | Records session state without another source refactor | Documentation must be refreshed as implementation evolves |

## Product direction

| ID | Decision | Status | Reason | Risk / alternative |
| --- | --- | --- | --- | --- |
| D10 | Combine gym discovery with core gym operations | Confirmed direction | User selected both marketplace discovery and management | Larger scope than discovery-only; deliver in phases |
| D11 | Support independent gyms with separate owners/staff; users can join multiple gyms | Confirmed direction | Matches the selected operating model | Cross-gym data isolation becomes essential; alternatives were one business or organization/chain hierarchy |
| D12 | First release includes discovery, favorites, trainer profiles, plans, memberships, classes, bookings, attendance | Confirmed direction | Defines the selected core offering | Avoid expanding into personal training appointments, workout plans, or progress tracking |
| D13 | Use offline payment handling and staff-activated memberships initially | Confirmed direction | User selected offline payments | Manual activation needs accountability; online checkout/webhooks are an alternative for later |
| D14 | Start future GymFlow domain data in a separate fresh database and allow new API contracts | Confirmed direction | User chose a fresh start over account migration or compatibility maintenance | Requires later environment/seed planning; no fresh database was created by this session |

## Proposed architecture, not implemented

| ID | Proposal | Status | Rationale | Risk / alternative |
| --- | --- | --- | --- | --- |
| D15 | Extract shared domain/database code; keep GraphQL DTOs in the API | Proposed | Remove worker imports from API internals | Import churn; alternative is retaining current coupling temporarily |
| D16 | Separate User identity, purchased Membership, and per-gym OWNER/STAFF/TRAINER assignments | Proposed | A gym entitlement is not a login account; ownership is not trainer identity | Requires service-level authorization checks; alternative global role enums cannot express gym-specific permissions well |
| D17 | Separate public profiles from private account data and use minimal JWT claims with current authorization checks | Proposed | Current JWTs copy much of the member record and guards do not reload status | Additional lookups; alternative is a carefully designed invalidation/cache strategy |
| D18 | Use fixed-duration memberships with a snapshot of granted plan terms | Proposed | Later plan edits should not silently change existing entitlements | Renewal/freeze policy remains outside the first implementation slice |
| D19 | Use individual class sessions, transactional capacity changes, and unique reservations | Proposed | Prevent concurrent overbooking and duplicate bookings | Requires a MongoDB replica set and integration tests; infrastructure readiness is Not verified |
| D20 | Check entitlement dates on requests; run repeatable expiry/statistics jobs separately | Proposed | Access must remain correct when a job is delayed | Job locking/idempotency need verification; batch-only expiry enforcement is insufficient |
| D21 | Defer online billing, freezes, waitlists, recurring sessions, personal training, workouts, community, and chat from the future initial release | Proposed | Keeps the selected core release bounded | Existing community/chat modules remain active today; disabling them requires later code changes |
| D22 | Treat frontend routes/components and replacement GraphQL names as illustrative until repository/contract review | Confirmed direction | No frontend source is present; user approved proposed mappings | Invented paths must not be mistaken for actual Next.js files |
| D23 | Keep backend contracts unchanged during frontend branding; coordinate domain contracts before switching operations | Proposed | Prevents a UI rename from breaking requests | Requires sequencing and contract tests; blind global replacements are unsuitable |
| D24 | Store future timestamps in UTC and interpret schedules in each gym's timezone | Proposed | Makes multi-gym scheduling explicit | Timezone and boundary tests are needed; current time handling was not changed |

## Known blockers and evidence limits

- **Blocked:** API typecheck has missing `lookupFavorite` / `lookupVisit` exports and a favorites input mismatch.
- **Blocked:** ESLint cannot load missing `typescript-eslint`.
- **Not verified:** frontend implementation, live API behavior, database contents, deployment configuration, and future transaction infrastructure.
- Previous validation results are historical session evidence, not a fresh test run for this documentation task.

Commit `679d0d5` has the subject “fix: Modify project name into petoria”; code and the clarified product target use GymFlow. Preserve the historical fact without attributing that commit to the assistant.

Related: [Backend state](BACKEND_MIGRATION.md), [Completed work](COMPLETED_TASKS.md), [Next steps](NEXT_STEPS.md).
