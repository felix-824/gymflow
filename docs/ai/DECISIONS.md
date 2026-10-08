# GymFlow program migration decisions

Accepted October 8, 2026 (Asia/Seoul), from the user's ER model and explicit implementation approval.

These decisions replace the older proposed gym-ownership/membership architecture. The historical naming refactor remains recorded in COMPLETED_TASKS.md.

| Decision | Accepted behavior |
| --- | --- |
| Architecture | Preserve NestJS modules/services/resolvers, code-first GraphQL, Mongoose, API/batch separation, existing source layout |
| Main entity | Program owned by TRAINER through memberId |
| Roles | USER, TRAINER, ADMIN; USER/TRAINER public signup, admin-controlled subsequent roles/status |
| Program statuses | ACTIVE, PAUSED, DELETE; DELETE terminal |
| Units | Integer KRW/session, minutes/session, participants/session; PT_1ON1 capacity 1 |
| Delivery | ONLINE type and location paired; physical offerings require physical address |
| Counts | memberPrograms counts ACTIVE programs; memberComments counts authored ACTIVE article comments |
| Comments | Article-only via articleId; program reviews deferred |
| ER extensions | Preserve reusable support fields, memberRank/memberLikes and programRank; notification article/group support retained |
| Database/API | Fresh database, breaking program/trainer contracts, no legacy record conversion or compatibility aliases |
| Visibility | ACTIVE programs owned by ACTIVE TRAINER accounts; owner/admin management views include PAUSED |
| Concurrency | Optimistic program version/status checks; nontransactional cross-document counters repaired by batch |
| Ranking | Existing weights preserved using program/trainer terms; 0/20/40 second schedule preserved |
| Ownership | Immutable in program inputs; authenticated trainer establishes memberId |
| Deletion | Soft delete before admin hard removal; clean program engagement/notifications first |
| Testing | Offline unit/schema/module tests, isolated controller smoke tests, and disposable local MongoDB integration; no application database fallback |
| Deferred | Reservations, schedules, reviews, notification delivery, booking capacity enforcement, live cutover, distributed scheduler locking |

Exact enum values and operation mappings are in [BACKEND_MIGRATION.md](BACKEND_MIGRATION.md).
