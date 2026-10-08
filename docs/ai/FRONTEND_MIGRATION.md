# Frontend migration proposal: Nestar → GymFlow

Snapshot: October 8, 2026 (Asia/Seoul).
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

## Evidence and scope

**Not verified:** no Next.js frontend repository, router configuration, page/component files, GraphQL documents, code-generation setup, or client cache configuration is present in this workspace.

**Confirmed direction:** provide a proposed mapping based on backend capabilities. Every route/component name below is illustrative, not a discovered file. Do not infer whether the frontend uses App Router, Pages Router, Apollo Client, or another client.

**Completed:** backend application branding now uses GymFlow; frontend implementation has not been performed. Petoria is not the target product name.

## Proposed page and component mapping

| Nestar capability | Illustrative old route/component (Not verified) | Proposed GymFlow route/component | Contract dependency |
| --- | --- | --- | --- |
| Home/discovery entry | /, PropertyHighlights | /, GymHighlights | Gym discovery contract |
| Property results | /properties, PropertyList, PropertyCard | /gyms, GymList, GymCard | Gym list/filter/pagination contract |
| Property details | /properties/[id], PropertyDetails | /gyms/[id], GymDetails | Gym detail, facilities, hours, trainer data |
| Property filters | PropertySearchFilters | GymSearchFilters | Approved location/facility/amenity fields |
| Agent directory/profile | /agents, /agents/[id], AgentCard | /trainers, /trainers/[id], TrainerCard | Trainer profile contract, separate from ownership |
| Agent property management | /agent/properties, PropertyEditor | /owner/gyms, GymEditor | Gym-scoped owner/staff authorization |
| Favorites | /favorites, FavoritePropertyCard | /favorites, FavoriteGymCard | Gym favorites contract |
| Authentication/profile | /login, /signup, /profile | Same conceptual screens with GymFlow branding | Existing auth retained until an explicit contract change |
| Membership management | No counterpart established | /memberships, MembershipCard | New plans and entitlement contract |
| Classes/bookings | No counterpart established | /gyms/[id]/classes, /bookings | Session availability and booking contract |
| Staff attendance | No counterpart established | /staff/attendance, AttendancePanel | Staff permissions and attendance contract |

These paths are planning examples. Actual route names and source-file mappings must be recorded after inspecting the frontend.

## Step-by-step migration

1. **Proposed — inventory the actual frontend.** Locate its repository; read its instructions and package configuration. Identify router style, public/protected routes, layouts, components, auth storage, GraphQL endpoint configuration, operation documents, generated types, cache policies, uploads, and WebSocket consumers. Produce a verified file inventory before editing.
2. **Proposed — capture a baseline.** Record lint/typecheck/build results and current route/operation coverage. Keep secrets and connection values out of logs and documentation.
3. **Proposed — perform branding-only updates.** Change app title, metadata, navigation branding, and project identifiers. Preserve existing server operation names and variable/response shapes. Do not present real estate data as gym data merely by relabeling it.
4. **Proposed — approve the gym API contract.** Agree on list/detail fields, filters, pagination, public/private profile boundaries, staff permissions, membership validity, and booking states with the backend implementation. New operations below do not yet exist.
5. **Proposed — implement discovery screens.** Replace property-specific fields with real gym fields once available. Implement loading, empty, error, unauthenticated, unpublished, and forbidden states. Keep trainer profiles separate from owner management.
6. **Proposed — migrate GraphQL documents and types together.** Update operation fields, variables, selections, generated types if codegen exists, mocks, and cache keys/policies. Inspect actual response types instead of assuming an operation-name substitution is sufficient.
7. **Proposed — add core management flows.** Add membership plans and staff activation for offline payments, classes, bookings, cancellation, and attendance. UI permission checks supplement backend enforcement. Do not add checkout or payment-success screens without payment integration.
8. **Proposed — handle deferred features.** Inventory existing community/chat navigation. Remove or hide it only in an approved release change; current backend modules remain intact.
9. **Proposed — validate and release together.** Test against the agreed GymFlow backend and isolated test data. Review deployment configuration and client/server version alignment before switching traffic. No deployment was performed in this session.

## GraphQL query and mutation plan

The left-hand names are verified in the current backend. Every right-hand replacement is **Proposed**, not implemented or guaranteed.

| Existing operation | Kind | Proposed operation/direction | Notes |
| --- | --- | --- | --- |
| getProperties | Query | getGyms | Replace property filters and selections after contract approval |
| getProperty | Query | getGym | Map actual gym detail fields |
| createProperty | Mutation | createGym | Review owner provisioning and admin permissions; not an agent-role substitution |
| updateProperty | Mutation | updateGym | Enforce permissions for the target gym |
| getAgentProperties | Query | getManagedGyms | Management follows ownership/staff assignments, not trainer identity |
| getAgents | Query | getTrainers | Trainer profile model is a new domain capability |
| getFavorites | Query | getFavoriteGyms | Depends on corrected favorites behavior and new gym return types |
| likeTargetProperty | Mutation | setGymFavorite | Proposed explicit desired-state API; not wire-compatible with the existing toggle |
| getVisited | Query | Defer gym history contract | History was not selected as an initial core capability |
| getAllPropertiesByAdmin | Query | getAllGymsByAdmin | Retain a distinct platform-admin boundary |
| updatePropertyByAdmin | Mutation | updateGymByAdmin | Requires approved administration contract |
| removePropertyByAdmin | Mutation | removeGymByAdmin | Deletion/archive policy must be designed before frontend use |
| signup, login, updateMember, getMember | Mutation/query | Retain initially; review User/private/public contracts later | No account operation was renamed in the completed refactor |

New membership, class, booking, and attendance operations have no established real estate counterpart. Define their contracts in a future backend slice; do not fabricate generated client types now.

## UI terminology

| Existing term | Proposed GymFlow term | Qualification |
| --- | --- | --- |
| Nestar | GymFlow | Branding only |
| Property/listing | Gym | Requires gym data, not a text-only conversion |
| Agent | Trainer or gym owner | Select by responsibility; never globally replace with one role |
| Property price | Membership plan price | Modelled as a plan, not a direct property field rename |
| Bedrooms/rooms | Remove from gym UI | No assumed direct equivalent |
| Rent/barter/sold | Remove from gym UI | Define gym-specific publication/availability states separately |
| Member account | User/account | Distinguish from purchased gym membership |
| Favorite property | Favorite gym | Requires gym favorites integration |

## Validation and blockers

- **Blocked:** the current backend API typecheck and lint failures are recorded in [COMPLETED_TASKS.md](COMPLETED_TASKS.md).
- **Not verified:** frontend validation commands and frameworks; select them after inspecting its package scripts.
- Test auth flows, list/detail filters, favorites, permission boundaries, membership validity, full classes, booking conflicts, cancellation, duplicate attendance, and timezone display.
- Check that no GraphQL response selections or cache identities still require removed property/agent fields after the actual domain migration.
- Frontend code changes and tests: **Not verified** / not executed in this session.

Related: [Backend contracts](BACKEND_MIGRATION.md), [Decisions](DECISIONS.md), [Next steps](NEXT_STEPS.md).
