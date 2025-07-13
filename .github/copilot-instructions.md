# ShieldBattery AI Coding Agent Instructions

Welcome to the ShieldBattery codebase! This guide summarizes essential architecture, workflows, and conventions to help AI coding agents be productive and generate high-quality contributions.

## Architecture Overview

- **Major components:**
  - `client/`: React/Redux web client (TypeScript)
  - `server/`: Node.js backend (TypeScript)
  - `app/`: Electron-based desktop app (TypeScript)
  - `common/`: Shared code and types for all TypeScript components
  - `game/`: Game DLL and related logic (Rust)
  - `server-rs/`: Rust-based server, mainly serves GraphQL APIs.
- **Component boundaries:** `client/`, `server/`, and `app/` must not depend on each other; all may depend on `common/`.
- **Data flow:**
  - Web client communicates with the server via HTTP, WebSockets, and GraphQL.
  - Desktop app (Electron) uses the same code as the web client, with some extra things to launch
    and interact with the game (by launching the processing and injecting the DLL from `game/`).
  - Game DLL is written in Rust, communicates with the Electron app over websockets, and the
    server over HTTP.
- **Generated code:**
  - Many files (e.g., `client/gql/`, `server/email/`, `app/vendor/blizzard/`) are generated. Only edit as instructed in their README files.

## Developer Workflows

- **Build & run:**
  - Start server: `pnpm run start-server`
  - Start client dev server: `pnpm run dev`
  - Start Electron app: `pnpm run app`
  - Build game DLL: `.\game\build.bat`
- **Testing:**
  - Unit tests: `pnpm test` (uses [vitest](https://vitest.dev/))
  - Integration tests: See `integration/README.md` and [docs/GETTING_STARTED.md](../docs/GETTING_STARTED.md)
- **Database migrations:**
  - Create migration: `pnpm run migrate:create <name>`
  - Run migrations: `pnpm run migrate:run`
  - Update database schema files for tests: `pnpm run sqlx-prepare`
- **Code generation:**
  - GraphQL: `pnpm run gen-graphql`
  - Emails: `pnpm run gen-emails`
  - Translations: `pnpm run gen-translations`
  - Protobuf: See `app/vendor/blizzard/README.md` and `server/testing/google/README.md`
- **Deployment:** See `deployment/README.md` and [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)

For more, see the main [README.md](../README.md) and per-directory `README.md` files.
