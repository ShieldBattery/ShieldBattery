---
applyTo: '**/*.rs'
---

- Avoid unsafe code when possible

In sqlx query macros (`query!, `query_as!`, etc.):

- We use PostgreSQL version 17. Queries should match Postgres syntax and can use features available
  in that version.
