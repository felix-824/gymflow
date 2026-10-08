# Backend migration: Nestar → GymFlow

Snapshot: October 8, 2026 (Asia/Seoul). Repository baseline: commit `679d0d5`.
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

## Original project

Nestar is a real estate backend implemented as a Nest CLI monorepo with NestJS 10, code-first GraphQL/Apollo, Mongoose/MongoDB, JWT authentication, local image uploads, and a WebSocket chat gateway. The API serves members, agent-owned properties, and community/engagement features. The batch app runs property and agent ranking jobs.

There is one root package and lockfile. Shared-looking DTOs, enums, helpers, and schemas live inside the API; the batch worker directly imports API source. No standalone shared library or Next.js frontend was found in this workspace.

## New project and goal

**Completed:** the package and applications are branded GymFlow. Runtime domain behavior is still the real estate implementation.

**Confirmed direction:** build a platform combining public gym discovery and management for independent gyms. Initial capabilities are gym search, favorites, trainer profiles, membership plans, memberships, class bookings, and attendance. Gym staff handle offline payments and activate memberships. Users may join multiple gyms.

**Proposed:** implement the domain migration in separately reviewed phases after baseline cleanup. A separate fresh GymFlow database was selected as the future direction; no data migration, database provisioning, or connection change was performed by the naming refactor.

## Naming changes

| Before | Current | Status |
| --- | --- | --- |
| Root package `nestar` | `gymflow` in package and lockfile metadata | Completed |
| `apps/nestar-api` / Nest project `nestar-api` | `apps/gymflow-api` / `gymflow-api` | Completed |
| `apps/nestar-batch` / Nest project `nestar-batch` | `apps/gymflow-batch` / `gymflow-batch` | Completed |
| Absolute app imports and build/test paths | Updated to the renamed app paths | Completed |
| Nestar welcome text and test branding | GymFlow welcome text and test branding | Completed |
| Domain names such as Property, Member, AGENT | Unchanged | Completed |

The commit subject for `679d0d5` says “fix: Modify project name into petoria”. The inspected package/app names and the user's clarified target are GymFlow. Petoria is a naming inconsistency in the historical subject, not an implemented product direction. This documentation does not alter Git history.

## Module inventory and changes

| Current module/area | Current responsibility | Migration state |
| --- | --- | --- |
| AuthModule, MemberModule | JWT/password authentication, users, agents, profiles, administration | Existing behavior retained |
| PropertyModule | Real estate CRUD, discovery, favorites/history entrypoints | Retained; gym domain replacement Proposed |
| LikeModule, ViewModule | Engagement records and property aggregation queries | Retained; gym adaptation Proposed |
| CommentModule, BoardArticleModule, FollowModule | Comments, articles, and member relationships | Retained; future release scope deferred |
| DatabaseModule in each app | MongoDB connection setup | Unchanged |
| SocketModule | Shared WebSocket chat | Unchanged; exclusion from future first release Proposed |
| BatchModule | Ranking rollback, top properties, top agents | Unchanged schedules and calculations |
| Notice and Notification schemas | Persisted type definitions | No corresponding registered feature modules found |

**Completed:** no production module was added, removed, or restructured. Batch-to-API coupling remains. The stale batch test import now refers to the existing `BatchModule`.

**Proposed:** separate shared database/domain code from API-specific GraphQL DTOs; introduce gym, gym-staff, trainer-profile, membership-plan, membership, class-session, booking, attendance, and favorite capabilities. Ownership and trainer identity must be separate, with gym-scoped permissions.

## GraphQL changes

**Completed:** no GraphQL operation names, input fields, output fields, registered enums, or resolver behavior changed in the rename.

Existing operations include `getProperties`, `getProperty`, `createProperty`, `updateProperty`, `getAgentProperties`, `getAgents`, `getFavorites`, `getVisited`, `likeTargetProperty`, `signup`, `login`, and `updateMember`. Their real estate semantics remain.

The API and batch root welcome strings changed to `Welcome to GymFlow API Server!` and `Welcome to GymFlow BATCH Server!`. Endpoint paths and response types were preserved.

**Proposed:** gym/trainer operations require a later contract review and coordinated frontend work. Suggested names in [FRONTEND_MIGRATION.md](FRONTEND_MIGRATION.md) are not available APIs.

## MongoDB collections and schemas

**Completed:** the following explicit collection names, schema fields, indexes, references, and aggregation behavior were preserved:

| Schema | Collection |
| --- | --- |
| Member | `members` |
| Property | `properties` |
| Like | `likes` |
| View | `views` |
| Comment | `comments` |
| BoardArticle | `boardArticles` |
| Follow | `follows` |
| Notice | `notices` |
| Notification | `notifications` |

No collections were renamed, documents transformed, or database-connected checks executed. The current database contents and deployed target are **Not verified**. This documentation intentionally excludes all connection strings and credentials.

## Compatibility notes

- Environment keys, connection values, ports, JWT setup, upload behavior, and dependencies were untouched by the rename.
- Keep `NODE_ENV`, `PORT_API`, `PORT_BATCH`, `MONGO_DEV`, `MONGO_PROD`, and `SECRET_TOKEN` as existing contracts.
- Batch constants, including the existing spelling `BATCH_TOPAGENST`, were preserved.
- External tooling referring to old app paths must adopt the new paths; external deployments were **Not verified**.
- Future domain migration may introduce breaking contracts under the confirmed fresh-start direction. That permission was not used during the naming-only refactor.
- **Blocked:** API typechecking and lint have pre-existing failures. See [COMPLETED_TASKS.md](COMPLETED_TASKS.md).

Related: [Decisions](DECISIONS.md), [Next steps](NEXT_STEPS.md), [Reusable prompts](PROMPTS.md).
