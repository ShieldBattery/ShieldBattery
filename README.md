# ShieldBattery

The modern way to play StarCraft 1.

ShieldBattery is a custom server and launcher client for StarCraft: Remastered, adding many features
and improvements while utilizing the real game client for gameplay. It is a community-run project
under active development, with new features added all the time!

https://shieldbattery.net

## Discord

The ShieldBattery developers frequent the Discord server at the link below, feel free to stop in with
questions, comments, or just to hang out!

https://discord.gg/S8dfMx94a4

## Localization/Translation

If you'd like to assist with translating our application into other languages, please reach out to us
in our Discord! We use an external application for managing this process which can be found
[here](https://translation.shieldbattery.net). Registering to contribute translations requires
approval.

## Developer setup

See our [getting started](./docs/GETTING_STARTED.md) guide for information on initial developer setup.

## Developer workflow

### Running the server

```
pnpm run start-server
```

The server will automatically rebuild the necessary client JavaScript files as they change. If you make
changes to the server files, you'll need to restart the server manually.

### Running the standalone application

The standalone has two development components: a development server that rebuilds and hot-reloads client
JavaScript files, and the Electron application itself (that loads and uses these files). Both must be
running for things to work correctly.

To run the development server, use:

```
pnpm run dev
```

To run the app, use:

```
pnpm run app
```

This setup will automatically rebuild and reload for any client changes you make. If you make changes to
things in the `app` folder, you'll need to close and restart the app (using the above command) for them to
take effect.

### Running multiple instances of the standalone application

To test the multiplayer aspect of the project, whether that's in the application or in an actual game, you
can start multiple instances of the application with the different sessions by using the `SB_SESSION`
environment variable. By default, the name of the session is simply `session`. So if you want to start an
additional instance of the standalone application, you can set the environment variable `SB_SESSION` to
anything other than the default name in a new console window. Eg., on Windows:

```
set SB_SESSION=session1
```

Note that ShieldBattery supports multiple instance of StarCraft running at the same time, so you can even
start a game with two different accounts if you need to test something in the game.

### Running the game

In order to actually run the game through the standalone application, you need to ensure
that you successfully built the Rust code as explained in the [getting started](./docs/GETTING_STARTED.md)
guide.

### CI validation

JS, game, and server-rs pull-request workflows always report a planning/result check, even when their
expensive jobs are unnecessary. Ordinary Markdown under `docs/` and root `README.md` are excluded from
build-input fingerprints. Markdown elsewhere, executable files, symlinks, licenses, shared CI scripts,
and build configuration remain inputs. Rust workflows also track their shared configuration and
schema/typeshare/database dependencies.

A documentation-only PR can skip expensive jobs when the merged component inputs match its base.
For a documentation follow-up on a code PR, reuse requires the latest matching workflow run to have
succeeded, unchanged source/CI fingerprints, the same fork/PR and base commit, and an accessible
validation receipt. The candidate head tree is checked independently of the receipt. Missing,
failed, cancelled, inaccessible, divergent, or expired evidence runs full checks. Validation expires
24 hours after its original successful completion; later documentation updates do not extend it.
Receipts are generated in a clean result job and retained as workflow artifacts for seven days.

Existing validation job names are preserved. Intentional skips report successful/skipped jobs rather
than leaving required PR workflows pending. A failed planner runs the expensive jobs and fails the
result guard; a cancelled workflow does not start more expensive jobs. Maintainers can require each
workflow's result check as well as their existing checks. The workflow summary explains full runs,
unaffected components, and reused validation.

Use **Re-run all jobs** or **Run workflow** (`workflow_dispatch`) to request fresh checks even when
inputs are unchanged. Re-running only failed jobs does not rerun a successful planner. Receipt expiry
is rechecked before recording a reused result. Push filters suppress pure documentation pushes and
unrelated Rust workflows; PR planning remains unconditional. This does not use `pull_request_target`,
write tokens, dependency caches as success evidence, or an automatic skip on every Markdown commit.

The dependency-free policy tests run in each planning job and can be run locally:

```sh
node --test tools/ci/validation.test.cjs
```

## Project structure

The ShieldBattery project is broken down into several big pieces, located in these folders:

- **app**: the standalone Electron application (main process)
- **client**: all of the client-side code which is used by the standalone application and the website client
- **game**: Rust code related to the game
- **server**: the server-side code including all the HTTP API handlers and WebSocket API handlers
- **server-rs**: a Rust-based GraphQL server used for some APIs

There are also some other important folders:

- **assets**: contains source assets for our graphics
- **common**: code that is shared between `app`, `client`, and `server`
- **integration**: contains end-to-end tests for the client + server together (run with `run-integration-tests.bat`)

## License

ShieldBattery code is generally licensed under [MIT](LICENSE). Some assets and
third-party components have their own license notices, which are available next to those assets in
this repository.
