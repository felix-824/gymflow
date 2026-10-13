# Trainer Schedule — Backend Phase 1

Implemented October 14, 2026 (Asia/Seoul). This document supersedes older deferred-schedule notes for recurring owner-managed weekly hours only. Availability Engine and reservations remain deferred.

## Contract

- Model: TrainerSchedule; collection: trainerSchedules; one document per trainer/weekday, unique index on memberId + dayOfWeek. Fields: _id, memberId, dayOfWeek, startTime?, endTime?, isAvailable, createdAt, updatedAt.
- Weekdays: MON, TUE, WED, THU, FRI, SAT, SUN. Both responses explicitly return this order.
- getMyTrainerSchedule: [TrainerSchedule!]! has no arguments; returns persisted owner rows, initially [].
- saveMyTrainerSchedule(input: TrainerScheduleInput!): [TrainerSchedule!]! accepts input.days: [TrainerScheduleDayInput!]!, exactly seven unique weekdays. Each entry has dayOfWeek, isAvailable, optional nullable startTime/endTime. Input contains no memberId or record ID.
- Available days require both strict five-character 24-hour HH:mm times and startTime < endTime. Overnight ranges, 24:00, malformed/whitespace-padded times, duplicate/missing weekdays and invalid booleans are rejected before writes.
- Disabled days yield no working interval. Omitted/null times preserve prior valid hours; newly inserted disabled days have absent times (GraphQL returns null). If either time is supplied, both must be valid and increasing, even while disabled. Re-enabling requires explicit valid times. No hard-delete operation is exposed; disable with isAvailable=false.
- Authenticated active TRAINER only, using the existing RolesGuard/current-account verification. Ownership always comes from AuthMember, never client input. USER, ADMIN and guests cannot read/save; there is no public schedule query.
- All times represent Asia/Seoul local weekly working hours. No timezone field or configurable timezone feature is added.

## Save consistency

The entire input is validated before persistence. The collection/unique index is initialized before a transactional bulk upsert. All seven upserts and the returned owner snapshot share one MongoDB transaction. IDs and createdAt survive repeat saves; updatedAt follows Mongoose timestamps. Transactions require a replica set or sharded cluster: standalone MongoDB is unsupported for this operation, with no non-atomic fallback. Unique-key races return a conflict for reload/retry; MongoDB/Mongoose handles retryable transaction conflicts. No application-data migration or index synchronization of existing unrelated collections is performed.

## Scope and tests

No slot generation, reservation/user conflicts, capacity logic, exceptions, holidays, multiple ranges, buffers, public availability or frontend code. Tests use a disconnected schema plus an owned loopback MongoDB replica set and isolated Nest GraphQL application; application connection values are never read. Automatic binary downloads are disabled; the existing cached MongoDB 8.2.6 binary is used.
