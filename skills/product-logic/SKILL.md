---
name: product-logic
description: Review GymFlow program API consistency across GraphQL operations, DTOs, schemas, enums, filters, and remaining legacy terminology.
---

# GymFlow Program API Review

Use this skill for review-only passes or pre-edit analysis of the program API.

## Review Checklist

- Confirm GraphQL operation names use program terminology:
  - `createProgram`
  - `getProgram`
  - and where it is related
- Confirm shared operations such as `getFavorites` and `getVisited` return program data.
- Confirm DTOs, schemas, and enums agree on program fields and nullability.
- Confirm filters use program type, category, location, price and etc.
- Report real findings with paths and behavior impact.