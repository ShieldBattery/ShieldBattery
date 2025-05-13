---
applyTo: '**/*.sql'
---

- We use PostgreSQL version 17. Queries should match Postgres syntax and can use features available
  in that version.
- Always use `TIMESTAMPTZ` or `TIMETZ` columns over `TIMESTAMP` and `TIME`.
- Prefer `kind` over `type` when naming columns and enums, as `type` can be problematic in the other
  languages we use to access the database.
