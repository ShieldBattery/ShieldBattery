# General

- Include comments only for code that needs further explanation or is particularly tricky. Avoid
  comments like `Define foo` before variable declarations.
- Don't remove TODO comments unless the TODO has been completed.
- If you need further context about types or behavior, ask for clarification.

# TypeScript

- Prefer using specific types when possible, avoid `any`. Prefer declaring
  variable types if the type inferred from their initialization would be too
  general. Declare function return types if the function is not very simple.
- Prefer using `const` for variable declarations unless they need to be mutated.
- In client-side code, use react-i18next to translate any text that will be shown to users. Prefer
  re-using existing translation strings if they are relevant.
- Always use `useAppDispatch` and `useAppSelector` rather than `useDispatch` and `useSelector` when
  using Redux
- Use styled-components for styling. Prefer to group CSS rules by layout
  (position/bounds/margin/padding), then display type (e.g. flexbox and associated properties for
  children), then appearance, then miscellaneous properties.
- `server/`, `client/`, and `app/` are separate and should not depend on each other. Any of them can
  depend on code in `common/`.
- Use single-quotes for strings or backticks if they need to include variables,
  including in JSX (e.g. `<MyComponent value='foo' other={'bar'} />`)
- Avoid unnecessary casts (`as`)

# Rust

- Avoid unsafe code when possible

# SQL

- We use PostgreSQL version 17. Queries should match Postgres syntax and can use features available
  in that version.
- Always use `TIMESTAMPTZ` or `TIMETZ` columns over `TIMESTAMP` and `TIME`.
- Prefer `kind` over `type` when naming columns and enums, as `type` can be problematic in the other
  languages we use to access theh database.
