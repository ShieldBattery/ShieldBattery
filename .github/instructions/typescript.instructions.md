---
applyTo: '**/*.ts*'
---

- Prefer using specific types when possible, avoid `any`. Prefer declaring
  variable types if the type inferred from their initialization would be too
  general. Declare function return types if the function is not very simple.
- Prefer using `const` for variable declarations unless they need to be mutated.
- `server/`, `client/`, and `app/` are separate and should not depend on each other. Any of them can
  depend on code in `common/`.
- Use single-quotes for strings or backticks if they need to include variables,
  including in JSX (e.g. `<MyComponent value='foo' other={'bar'} />`)
- Avoid unnecessary casts (`as`)

In `sql` usage that you find in `server/` model files:

- We use PostgreSQL version 17. Queries should match Postgres syntax and can use features available
  in that version.
