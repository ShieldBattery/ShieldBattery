# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShieldBattery is a modern platform for playing StarCraft: Brood War/Remastered. It's a complex multi-language project consisting of:

- **client/**: React web application (TypeScript, Redux, Styled Components)
- **server/**: Node.js backend server (Koa.js, PostgreSQL, Redis, WebSockets)
- **app/**: Electron desktop application (TypeScript, native OS integration)
- **common/**: Shared TypeScript code and types used across components
- **server-rs/**: Rust GraphQL server (Axum, async-graphql, SQLx)
- **game/**: Rust DLL for StarCraft integration, injected into StarCraft (Windows API, egui)

**Architecture Rule**: `client/`, `server/`, and `app/` directories must not depend on each other. All can depend on `common/`.

## Common Development Commands

### Development Servers

```bash
# Run all development services together (recommended)
pnpm run local-dev

# Individual components
pnpm run start-server     # Node.js backend server
pnpm run dev             # Webpack dev server for client
pnpm run app             # Electron desktop app

# Build Rust game DLL
game\build.bat                # Debug 32-bit build
game\built.bat x86_64         # Debug 64-bit build
game\build.bat release        # Release 32-bit build
game\build.bat x86_64 release # Release 64-bit build
```

### Testing

```bash
pnpm run test            # Unit tests (Vitest)
pnpm run test --watch    # Watch mode for tests
pnpm run test-ui         # Test UI with coverage
pnpm run test:integration # Integration tests (Playwright)

# Quality checks
pnpm run lint            # ESLint
pnpm run typecheck       # TypeScript type checking
pnpm run lint --fix      # ESLint autofix (can fix formatting with prettier)
```

### Code Generation

```bash
pnpm run gen-graphql     # Generate GraphQL types from schema
pnpm run gen-emails      # Generate email templates
pnpm run gen-translations # Generate translation files
pnpm run gen-typeshare   # Generate Rust->TypeScript types
```

### Database

```bash
pnpm run migrate:run     # Run database migrations
pnpm run migrate:create  # Create new migration
pnpm run sqlx-prepare    # Update SQLx query metadata for Rust
```

### Building & Distribution

```bash
pnpm run build-app-client      # Build Electron app client code
pnpm run build-web-client      # Build web client code
pnpm run pack                  # Build Electron app (dev distribution)
pnpm run dist                  # Build Electron app (production distribution)
```

## Architecture & Development Patterns

### Multi-Language Structure

- **TypeScript**: Client, server, app, and common code
- **Rust**: Game integration DLL and GraphQL server
- **PostgreSQL**: Primary database with Redis for caching/sessions
- **Electron**: Desktop app wrapper with IPC communication

### Real-time Communication

- WebSocket connections via Nydus library between client and Node.js server
- IPC between Electron main and renderer processes
- Custom networking protocols for game coordination via rally point system

### State Management

- **Client**: Redux for global state/caches, Jotai for state that only concerns individual features
- **React**: Version 19 with modern hooks and concurrent features, using react-compiler.
  useMemo/useCallback/useStableCallback are generally unnecessary now because of react-compiler, but
  you may still see them in the codebase in older code.
- **Styling**: styled-components with CSS-in-JS patterns

### Code Organization

- Component boundaries strictly enforced between major directories
- Shared business logic lives in `common/`
- Generated code marked clearly (don't edit generated files directly)
- Type safety maintained across TypeScript and Rust boundaries via typeshare

### Development Workflow

- Hot reloading for client development via Webpack dev server
- Docker Compose provides PostgreSQL and Redis for local development
- Concurrent servers during development (use `local-dev` command)
- Automatic code generation for GraphQL schemas and type definitions
- Many client folders have `devonly` folders inside of them that contain pages purely for testing
  out components/flows during development. You can feel free to develop your own, just add the page
  to the routes inside that folder. These are linked inside `client/dev.tsx`. You can access that
  page at `/dev` on the local server.

### Build System

- **Client**: Webpack with React Refresh for development
- **Server**: Direct TypeScript compilation
- **Game**: Cargo build system for Rust DLL (targets 32-bit Windows)
- **Desktop**: Electron Builder for packaging and distribution

### Database Patterns

- SQLx for type-safe database queries in Rust server
- Traditional SQL migrations for schema changes
- PostgreSQL 17 features available (use TIMESTAMPTZ over TIMESTAMP)
- Redis for session storage and real-time features, communication between server-rs and server (PUBSUB)

## Key Development Guidelines

### General

- Text-based files should use unix style line endings (LF only)
- NEVER include comments in code that doesn't add any understanding over what the code already says.
  ONLY include comments when code needs further explanation or is particularly tricky. Doc comments
  over methods are helpful if they are not self-explanatory, but you can elide them otherwise.
- DO NOT remove TODO comments unless the TODO has been completed. Leave them unmodified, including
  any thing inside `TODO()` e.g. `TODO(tec27):` or `TODO(#1337):`.
- `NOTE` and `TODO` comments should have context in parentheses, usually either the name
  of the user who had the context when it was written (e.g. `TODO(tec27)`) or a relevant issue
  number (e.g. `NOTE(#1337):`)
- When writing code to replace older code, never leave the older code around. Delete files that
  become unused as the result of refactoring.

### TypeScript

- Use specific types, avoid `any`
- Prefer `const` for immutable variables
- Use type-fest types where appropriate, like ReadonlyDeep for objects that don't need to be modifiable
- Use `useAppDispatch` and `useAppSelector` for Redux (not base hooks)
- Single quotes for strings, backticks for template literals
- Prefer `for..of` to `forEach()
- Our HTTP APIs are defined via a custom decorator-based system, so HTTP methods, route- or
  service-specific middleware, etc. are defined via decorators, e.g. `@httpGet`. Our setup allows
  us to declare return object types, so that we can have type safety on these routes. Request and
  response types are usually put in `common` files to share between client and server.
- Websocket broadcasting is done via a subscription system, usually either for all of the sockets
  from a particular client or from a particular user. See `ClientSocketsManager` and
  `UserSocketsManager`. The server decides which specific paths each client gets subscribed to, and
  in the client code, we register routes by pattern to match against the messages we receive.
- The NodeJS server uses tsyringe to do dependency injection
- When constructing URLs or paths for URLs, use the `urlPath` tagged template to automatically
  encode any variables you place within it. If it's going to our API server, you can use `apiUrl`.
- Don't edit translation files (`global.json`) manually, they are generated from the source code.

### Styling

- Use styled-components exclusively for CSS-in-JS
- Avoid inline styles for normal CSS properties. If you need to change some value based on JS state,
  use styled-components props if it has only a few possible values, or if it has many possible
  values, set CSS custom properties with inline styles and adjust the styled CSS based on those.
- Group CSS properties: layout → display → appearance → misc
- Follow property ordering convention in CSS rules
- Use react-i18next for all user-facing text translations
- Use the motion library or basic CSS transitions for animations
- Use UI component library under `client/material` as basis for most UIs
- The `client/styles` directory has common styling we use everywhere, such as typography and colors.
  We use a theming system based on CSS custom properties, which you can see in `client/styles/colors.ts`

### Rust

- Avoid unsafe code when possible
- Target 32-bit Windows for game DLL (i686-pc-windows-msvc)
- Use SQLx for database interactions with compile-time query validation

### SQL

- Use PostgreSQL 17 syntax and features
- Always use `TIMESTAMPTZ` over `TIMESTAMP`
- Prefer `kind` over `type` for column names (avoid SQL keywords)

### Testing

- Unit tests with Vitest alongside implementation files (.test.ts)
- Integration tests with Playwright in `integration/tests/`
- Mock service dependencies in unit tests when appropriate (e.g. if using the real dependency is too
  complex in tests)
- Use isolated test data in integration tests (separate users/channels)

## Important Notes

- Many directories contain generated code - check README files before editing
- The game DLL must target 32-bit architecture for StarCraft compatibility
- Component isolation is critical - maintain strict boundaries between major directories
- Use existing translation strings when possible for internationalization, provided they are for
  similar context
- You can feel free to add files to the `.claude-scratch/` directory in the root of this repository
  if you need to remember things. This is your personal directory and the files in it are your own.
  For instance if you come up with a plan of action, you could write it down in
  `.claude-scratch/TODOS.md` to remember it for later.
