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

- React 19 with `react-compiler` - `useMemo`/`useCallback` generally unnecessary
- Custom hooks in `client/react/`: `useValueAsRef`, `useStableCallback`, `usePrevious`
- Use `$`-prefixed props for styled-components: `$disabled`, `$focused`
- Theme in `client/styles/colors.ts`, typography in `client/styles/typography.ts`
- Use `motion` library for animations, `react-i18next` for translations
- Development test pages in `devonly/` folders (accessible at `/dev`)

### GraphQL (URQL)

- Fragment colocation with `graphql()` and `useFragment()`
- Generated types in `client/gql/` via `pnpm gen-graphql`
- Custom scalars mapped in `graphql-codegen.ts`

### Network

- HTTP: `fetchJson()` from `client/network/fetch.ts`
- WebSocket: Nydus client with handlers in `socket-handlers.ts`

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

- **DI (tsyringe):** `@singleton()`, `@inject()`, `delay(() => Dep)` for circular deps
- **Sockets:** `ClientSocketsManager`, `UserSocketsManager` with `.subscribe(path)`
- **Database:** `withDbClient()`, `transact()` for transactions
- **Redis:** Session storage, pub/sub between server and server-rs
- **Errors:** `CodedError` with `makeErrorConverterMiddleware()` for HTTP mapping

## Server-RS (Rust GraphQL)

- `#[SimpleObject]` for basic types, `#[ComplexObject]` for custom resolvers
- `#[graphql(guard = "...")]` for authorization
- DataLoader pattern for N+1 prevention
- SQLx with `as "column: Type"` for custom type mapping
- Run `pnpm sqlx-prepare` after changing queries
- `#[typeshare]` generates to `common/typeshare.ts`

## Game DLL (Rust)

Two code paths:
- **Async** (Tokio): `async_thread` entry, networking/app communication
- **Sync** (BW hooks): `patch_game` entry, executes in StarCraft's code

Build: 32-bit default, 64-bit via `game\build.bat x86_64`

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
