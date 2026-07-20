# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShieldBattery is a modern platform for playing StarCraft: Brood War/Remastered. It's a multi-language project:

| Directory    | Description                      | Stack                                       |
| ------------ | -------------------------------- | ------------------------------------------- |
| `client/`    | React web application            | TypeScript, Redux, Jotai, styled-components |
| `server/`    | Node.js backend server           | Koa.js, PostgreSQL, Redis, WebSockets       |
| `app/`       | Electron desktop application     | TypeScript, native OS integration           |
| `common/`    | Shared TypeScript code           | Types, utilities, IPC definitions           |
| `server-rs/` | Rust GraphQL server              | Axum, async-graphql, SQLx                   |
| `game/`      | Rust DLL injected into StarCraft | Windows API, egui                           |

**Architecture Rule**: `client/`, `server/`, and `app/` must not depend on each other. All can depend on `common/`.

## Quick Reference

| Task                | Pattern                                          | Location                                |
| ------------------- | ------------------------------------------------ | --------------------------------------- |
| Add HTTP endpoint   | `@httpApi` class + `@httpGet`/`@httpPost` method | `server/lib/<feature>/<feature>-api.ts` |
| Add WebSocket route | `@Mount` + `@Api` decorators                     | `server/lib/wsapi/`                     |
| Add Redux state     | `immerKeyedReducer` + actions                    | `client/<feature>/<feature>-reducer.ts` |
| Add local UI state  | Jotai atom                                       | `client/<feature>/<feature>-atoms.ts`   |
| Add shared type     | Interface in `common/`                           | Use typeshare if coming from Rust       |
| Add GraphQL query   | Resolver in server-rs + `pnpm gen-graphql`       | `server-rs/src/`                        |
| Test component      | Create devonly page                              | `client/<feature>/devonly/`             |

### Key File Locations

```
client/redux-hooks.ts                - useAppDispatch, useAppSelector (use instead of base hooks)
client/jotai-store.ts                - Global Jotai store instance
client/dispatch-registry.ts          - Global dispatch for non-React code
client/styles/colors.ts              - Theme CSS custom properties
client/material/                     - UI component library
client/gql/                          - Generated GraphQL types
common/urls.ts                       - urlPath, apiUrl tagged templates (auto-encode URLs)
common/ipc.ts                        - Electron IPC type definitions
server/lib/http/http-api.ts          - @httpApi decorator
server/lib/websockets/api-decorators.ts - WebSocket decorators
```

## Common Development Commands

```bash
pnpm run local-dev             # Run all dev services together (recommended)
pnpm run test                  # Unit tests (Vitest)
pnpm run test:integration      # Integration tests (Playwright)
pnpm run lint --fix            # ESLint + Prettier autofix
pnpm run typecheck             # TypeScript type checking

# Code generation (run after changing relevant source)
pnpm run gen-graphql           # Generate GraphQL types from schema
pnpm run gen-typeshare         # Generate Rust->TypeScript types
pnpm run gen-translations      # Generate translation files

# Database
pnpm run migrate:run           # Run migrations
pnpm run sqlx-prepare          # Update SQLx query metadata for Rust

# Rust game DLL
game\build.bat                 # Debug 32-bit
game\build.bat x86_64          # Debug 64-bit
```

## File Naming Conventions

| Pattern              | Purpose                  |
| -------------------- | ------------------------ |
| `*-reducer.ts`       | Redux reducer            |
| `*-atoms.ts`         | Jotai atoms              |
| `*-api.ts`           | HTTP API class           |
| `*-service.ts`       | Business logic service   |
| `socket-handlers.ts` | WebSocket event handlers |
| `devonly/`           | Development test pages   |

## Key Development Guidelines

### General

- Preserve `TODO(context)` and `NOTE(context)` comments unless completing the TODO
- **Comments must stand alone.** Don't write _deictic_ comments — ones whose meaning points at
  context outside the repo's current state: review findings ("Finding A3"), design docs, handoffs,
  tickets, chat threads, project phases, or before/after narrative ("previously...", "the new
  path", "today's behavior"). Those artifacts drift or get deleted, and the next reader wasn't
  there. The test: would this comment still be true and fully comprehensible after every document,
  conversation, and branch around the change is gone? If not, rewrite it to state the invariant,
  hazard, or constraint in the code's own terms. Provenance and review trail belong in commit
  messages, where such references are welcome. (`TODO(context)`/`NOTE(context)` tags are the one
  sanctioned forward pointer.)
- Delete unused code during refactoring
- The GraphQL schema (`schema.graphql`) is generated from server-rs - don't edit manually
- Don't edit translation files (`global.json`) manually - run `pnpm run gen-translations`

### Project-Specific Patterns

- Use `urlPath` or `apiUrl` tagged templates for URL construction (auto-encodes variables)
- Use `ReadonlyDeep` from type-fest for immutable objects
- IDs use Tagged types: `SbUserId`, `SbChannelId`, `SbMapId`
- Events use discriminated unions with `action` field as discriminator
- `Jsonify<T>` for JSON serialization types, `Patch<T>` for partial updates

## Client Architecture

### State Management

**Redux** for global/persistent state (auth, chat, users, games):

- Use `immerKeyedReducer` - maps action types to handler functions
- Action naming: `@feature/actionName` (e.g., `@chat/updateJoin`)
- Access dispatch outside React via `dispatch-registry.ts`

**Jotai** for feature-local/transient state (matchmaking, UI state):

- Access outside React via `jotaiStore.get(atom)` / `jotaiStore.set(atom, value)`

### React & Styling

- React 19 with `react-compiler` - `useMemo`/`useCallback`/`useStableCallback` generally unnecessary
  - The compiler automatically memoizes as needed
  - Don't wrap event handlers or inline functions in these hooks
- Use `$`-prefixed props for styled-components: `$disabled`, `$focused`
- Theme in `client/styles/colors.ts`, typography in `client/styles/typography.ts`
- **Always style text with the typography tokens from `client/styles/typography.ts`** — compose the
  `css` token (e.g. `${bodyMedium}`, `${titleLarge}`) or render the styled component (e.g.
  `<BodyMedium>`). Do **not** hand-roll `font`/`font-size`/`font-weight`/`line-height`/`letter-spacing`
  for text, and never reference made-up font CSS vars like `var(--font-body)` (no such vars exist —
  the global font family comes from the `inter` token applied in `client/styles/global.ts`). For a
  non-standard size/weight, still build on the nearest token and override only the differing property
  (e.g. `${titleMedium}; font-size: 20px;`). Bare one-off font declarations are reserved for genuinely
  exceptional cases (e.g. oversized display numerals), and even those should compose a font-family
  token (`inter`/`sofiaSans`/`sofiaSansCondensed`) rather than a raw `font-family`.
- Use `motion` library for animations, `react-i18next` for translations
- Development test pages in `devonly/` folders (accessible at `/dev`)

### GraphQL (URQL)

- Fragment colocation with `graphql()` and `useFragment()`
- Generated types in `client/gql/` via `pnpm gen-graphql`
- Custom scalars mapped in `graphql-codegen.ts`

### Network

- HTTP: `fetchJson()` from `client/network/fetch.ts`
- WebSocket: Nydus client with handlers in `socket-handlers.ts`

### Async Action Patterns

For async operations in action creators:

```typescript
// Define request/response types (often in common/)
interface CreateWidgetRequest {
  name: string
  options: WidgetOptions
}

// Action creator using abortableThunk for cancelable operations
export function createWidget(request: CreateWidgetRequest, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<WidgetResponse>(apiUrl`widgets`, {
      method: 'POST',
      body: encodeBodyAsParams(request),
      signal: spec.signal,
    })
    dispatch({ type: '@widgets/create', payload: result })

    return result.someData
  })
}

// Caller handles UI states via callbacks
dispatch(
  createWidget(data, {
    onSuccess: someData => {
      setLoading(false)
      setSomeData(someData)
    },
    onError: err => {
      setLoading(false)
      dispatch(openSimpleDialog('Error', 'Failed to create widget'))
    },
  }),
)
```

- Use `abortableThunk` from `client/network/abortable-thunk.ts` for cancelable operations
- Type the response with `fetchJson<ResponseType>()`
- The caller handles success/error UI (loading states, error dialogs) via callbacks

## Server Architecture (Node.js)

### HTTP API Decorators

```typescript
@httpApi('/chat') // Registers at /api/1/chat, implies @singleton()
export class ChatApi {
  constructor(private chatService: ChatService) {} // tsyringe DI

  @httpGet('/channels/:channelId')
  @httpBefore(ensureLoggedIn, checkChannelPermissions)
  async getChannel(ctx: RouterContext): Promise<ChannelResponse> { ... }
}
```

**Decorators:** `@httpApi`, `@httpGet/Post/Put/Delete/Patch`, `@httpBefore`, `@httpBeforeAll`

**Common Middleware:** `ensureLoggedIn`, `checkAllPermissions()`, `throttleMiddleware()`, `handleMultipartFiles()`, `convertXxxErrors`

### WebSocket API

```typescript
@Mount('/lobbies')
export class LobbyApi {
  @Api('/subscribe')
  async subscribe(data, next) { ... }
}
```

### Other Patterns

- **DI (tsyringe):** `@singleton()`, `@inject()` (rarely needed: `delay(() => Dep)` for circular deps)
- **Sockets:** `ClientSocketsManager`, `UserSocketsManager` with `.subscribe(path)`
- **Database:** `withDbClient()`, `transact()` for transactions; use `Dbify<T>` from `server/lib/db/types.ts` for query result types (converts camelCase interfaces to snake_case DB columns)
- **Avoid per-item DB query fan-out:** Don't run a separate query per element of a collection (e.g. `Promise.all(items.map(i => dbQuery(i)))` or a `for` loop that opens a new client each iteration). Each query grabs its own pool connection, so a large/variable collection can exhaust the pool and starve unrelated requests. Prefer a single set-based statement (e.g. a multi-row upsert with `sqlConcat`, or `WHERE id = ANY(...)`); if you must issue them one at a time, share a single connection via `withDbClient`/`transact` and `withClient`.
- **Models organization:** Functions that update a table belong in that table's models file, not the new feature's models
- **Redis:** Session storage, pub/sub between server and server-rs
- **Errors:** `CodedError` with `makeErrorConverterMiddleware()` for HTTP mapping
- **Types:** Colocate types with the code that uses them; don't create separate `types.ts` files unless there are circular dependency issues
- **Standalone functions:** If a class method doesn't use `this`, extract it as a module-level function instead

## Server-RS (Rust GraphQL)

- `#[SimpleObject]` for basic types, `#[ComplexObject]` for custom resolvers
- `#[graphql(guard = "...")]` for authorization
- DataLoader pattern for N+1 prevention
- SQLx with `as "column: Type"` for custom type mapping
- Run `pnpm sqlx-prepare` after changing queries
- `#[typeshare]` generates to `common/typeshare.ts`

## Game Runtime Architecture

During gameplay, two processes work together:

1. **Electron App (`app/`)** - Launches StarCraft, injects the game DLL, manages game lifecycle
2. **Game DLL (`game/`)** - Injected into StarCraft process, handles in-game networking and server communication

The game DLL is the primary actor for in-game operations (result reporting, replay uploads). The Electron app acts as a fallback if the DLL fails or the game exits unexpectedly. They communicate via IPC.

## Game DLL (Rust)

Two code paths:

- **Async** (Tokio): `async_thread` entry, networking/server communication
- **Sync** (BW hooks): `patch_game` entry, executes in StarCraft's code

Build: 32-bit default, 64-bit via `game\build.bat x86_64`

**Always rebuild via `game\build.bat`, never a bare `cargo build`.** The app injects
`game/dist/shieldbattery.dll` (see `app/game/active-game-manager.ts`), and only `build.bat` copies
the freshly compiled DLL from `target/` into `dist/`. A bare `cargo build` updates `target/` but
leaves `dist/` stale, so a launched game silently runs the *old* DLL — a change appears to have no
effect (or to "fail" in a way that doesn't match the source). If a game-launch test contradicts
your code, suspect a stale `dist/` DLL first.

Lint: `cargo clippy --all-targets --workspace -- -D warnings` (code should be warning-free)

**`game/scr-analysis` is a thin wrapper, not the analysis itself.** It exists to keep compile
times fast (samase_scarf's macro-heavy code compiles once, optimized, in its own crate) and only
wraps the `Analysis` methods the game crate actually uses. Before deciding a binary analysis is
"missing," check the pinned samase_scarf rev's `Analysis` API — if it's there, the fix is a
one-line wrapper method in `scr-analysis/src/lib.rs`, not new analysis work.

## Electron App

- Typed IPC in `common/ipc.ts`: `invoke` (request-response), `send/on` (fire-and-forget)
- Types: `IpcInvokeables`, `IpcRendererSendables`, `IpcMainSendables`
- Key files: `app/app.ts`, `app/settings.ts`, `app/game/active-game-manager.ts`

## Testing

- **Unit (Vitest):** Colocated `.test.ts` files, `asMockedFunction()` from `common/testing/mocks.ts`
- **Test utilities:** `FakeClock`, `FakeNydusServer`, `FakeNotificationService`
- **Integration (Playwright):** `integration/tests/`, Page Object pattern in `integration/pages/`

## SQL

- PostgreSQL 17, always `TIMESTAMPTZ` over `TIMESTAMP`
- Prefer `kind` over `type` for column names

## Important Notes

- Check README files before editing - some directories contain generated code
- `.claude-scratch/` directory available for your notes and plans
