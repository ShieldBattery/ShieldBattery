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

MIT
