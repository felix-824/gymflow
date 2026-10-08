# Backend migration: Nestar to GymFlow programs

Updated October 8, 2026 (Asia/Seoul). This approved program model supersedes the older independent-gym/membership proposal.

## Current implementation

GymFlow retains NestJS 10, code-first GraphQL/Apollo, Mongoose, the API/batch applications, and reusable auth/member/like/view/comment/follow/board-article/socket modules. No shared-library extraction or runtime dependency upgrade is part of this migration. The pinned development-only mongodb-memory-server dependency provides disposable integration tests.

The catalog is now Program: feature files under `components/program`, DTOs under `libs/dto/program`, enums under `libs/enums/program.enum.ts`, and schema under `schemas/Program.model.ts`. The model token is Program and collection is `programs`. Batch imports these API definitions.

## Program contract

Required fields: programType, programCategory, programLocation, programName, programPrice, programDuration, programCapacity, programImages.
Optional fields: programAddress (required for in-person offerings), programDesc.
Server-owned fields: _id, memberId, programStatus, programViews, programLikes, programRank, deletedAt, createdAt, updatedAt.

- Types: PT_1ON1, GROUP_CLASS, ONLINE.
- Categories: WEIGHT_LOSS, MUSCLE_GAIN, YOGA, PILATES, CROSSFIT, CARDIO, REHAB.
- Locations: SEOUL, GYEONGGI, INCHEON, BUSAN, DAEGU, DAEJEON, GWANGJU, ONLINE, ETC.
- Statuses: ACTIVE, PAUSED, DELETE.
- Price is integer KRW/session (zero permitted); duration is positive minutes/session; capacity is positive participants/session. PT_1ON1 capacity is one.
- ONLINE type/location must be paired. In-person offerings need a physical address.
- Required values cannot be cleared with null on update. Optional address/description may be cleared when otherwise valid.
- Creation starts ACTIVE. ACTIVE and PAUSED may transition to each other or DELETE. DELETE is terminal.
- Public offerings require both an ACTIVE program and an ACTIVE TRAINER owner.
- Owners cannot transfer programs or set counters. Admin operations are separate.
- programRank and retained member support fields are documented extensions to the ER.

Real-estate square/beds/rooms/rent/barter/construction/sold fields are removed. Programs have no generic comment counter.

## API changes

| Previous | Current |
| --- | --- |
| createProperty / updateProperty | createProgram / updateProgram |
| getProperty(propertyId) / getProperties | getProgram(programId) / getPrograms |
| getAgentProperties | getTrainerPrograms |
| getAgents / AgentsInquiry | getTrainers / TrainersInquiry |
| likeTargetProperty(propertyId) | likeTargetProgram(programId) |
| getAllPropertiesByAdmin | getAllProgramsByAdmin |
| updatePropertyByAdmin / removePropertyByAdmin | updateProgramByAdmin / removeProgramByAdmin |
| getFavorites / getVisited returning Properties | Same names returning Programs |
| memberProperties / AGENT | memberPrograms / TRAINER |

Program lists preserve `list` and `metaCounter`. Search supports memberId, locationList, typeList, categoryList, pricesRange, periodsRange (creation timestamps), and literal name text. Sorts: createdAt, updatedAt, programLikes, programViews, programRank, programPrice, programDuration, programCapacity. Trainer queries always force authenticated ownership. Shared pagination is `libs/dto/common/inquiry.ts`.

## Shared behavior and authorization

- Public signup permits USER/TRAINER. ADMIN cannot be self-assigned.
- MemberSelfUpdate excludes identity, role, and status. Password changes are hashed.
- JWTs contain identity rather than profile data. Verification reloads an active account and its current role.
- PROGRAM replaces PROPERTY in likes/views/notifications. Group participates in like/view identity and unique indexes.
- Favorites/history filter visibility before pagination and totals; member/article engagement remains available.
- Comments use articleId and update active article-comment counts and the author's memberComments.
- Notifications retain compatible article/group support, replace propertyId with programId, and add optional reservationId. No delivery service is implemented.
- Upload targets are member/article/program, validated before directory creation. Resolvers await upload promises and propagate stream failures. Single program uploads were verified through actual multipart GraphQL requests. Existing files are preserved.

## Batch and consistency

Minute schedules remain at seconds 0, 20, and 40. Jobs use BATCH_ROLLBACK, BATCH_TOP_PROGRAMS, BATCH_TOP_TRAINERS.

- Reconcile memberPrograms from ACTIVE program records, including zero counts.
- Reconcile programLikes/programViews from engagement records.
- Program rank = likes * 2 + views.
- Trainer rank = active programs * 5 + articles * 3 + member likes * 2 + member views.
- Clear ineligible ranks; calculate without requiring prior rank zero.
- Program lifecycle writes use previous status and version to detect concurrent edits.

Cross-document updates remain nontransactional. Program engagement counts, active-program counts, and rankings are caches with periodic reconciliation, not an instantaneous multi-document consistency guarantee. Comment/member/article counter updates retain the existing nontransactional pattern; their recovery after partial storage failures is not handled by these ranking jobs. Batch deployments should run a single scheduler instance; distributed job locking is not implemented.

Hard removal requires a soft-deleted program. Child engagement/notification cleanup precedes parent removal so cleanup failures can be retried. No second owner-count decrement occurs.

## Release boundary

Use a separate fresh database and coordinate API/client updates. No conversion of real-estate records, old collection cleanup, database provisioning, environment-value edits, or deployment was performed. Preserve existing environment key contracts. See [NEXT_STEPS.md](NEXT_STEPS.md) for cutover prerequisites and [COMPLETED_TASKS.md](COMPLETED_TASKS.md) for validation evidence.

Reservations, reviews, trainerSchedules, booking enforcement, and notification delivery are deferred. Program capacity is catalog metadata only.
