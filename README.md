# ShieldBattery

A modern way to play StarCraft: Brood War.

## IRC

The ShieldBattery developers frequent `#shieldbattery-dev` on QuakeNet, feel free to stop in with
questions, comments, or just to hang out!

## Developer setup

See our [getting started](./docs/GETTING_STARTED.md) guide for information on initial developer setup.

## Developer workflow

### Running the server

From the `server` directory:

```
yarn start
```

The server will automatically rebuild the necessary client JavaScript files as they change. If you make
changes to the server files, you'll need to restart the server manually.

### Running the standalone application

The standalone has two development components: a development server that rebuilds and hot-reloads client
JavaScript files, and the Electron application itself (that loads and uses these files). Both must be
running for things to work correctly.

To run the development server, use:

```
yarn run dev
```

To run the app, use:

```
yarn run app
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

In order to actually run the game through the standalone application, you need to ensure a couple of things:
- that you successfully built the C++ code as explained in the [getting started](./docs/GETTING_STARTED.md)
guide.
- that you've built the javascript code used in the native modules, which you can do by navigating to the
`game` directory and typing:

```
yarn run dev
```

Note that this is not the same script that is used in the root folder, regardless of having the same name.
Besides building the javascript code, this will also keep track of any changes in the javascript code inside
the `game/js` folder and automatically rebuild if it detects any changes.

## Project structure

The ShieldBattery project is broken down into four big pieces, located in these folders:

- **app**: the standalone application.
- **client**: all of the client-side code which is used by the standalone application and the website client
- **game**: (mostly) C++ code related to the game. Further consists of:
  - *common*: utility classes that are used throughout C++ code.
  - *forge*: windowed mode and general rendering wrapper for ShieldBattery.
  - *js*: javascript code that interfaces with the native modules.
  - *logger*: logging class for pushing log lines from C++ to JS (so they can be put in the same log file in
  the same format).
  - *node-bw*: native V8/Node bindings for Starcraft, linked into **shieldbattery**.
  - *shieldbattery*: Node-embedded DLL that gets injected into Starcraft by the standalone application and
  links in **forge**, **node-bw**, and **snp**.
  - *snp* - Storm Network Provider linked into **shieldbattery** (generic interface dll that Starcraft uses
  to e.g. send packets and retrieve game lists).
  - *v8-helpers* - V8-related utility functionality for use in our linked Node C++ modules.
- **server**: the server-side code including all the HTTP API handlers and WebSocket API handlers.

There are also some other important folders:

- **assets**: contains source assets for our graphics
- **test**: contains tests for various things (runnable with `yarn test`). Note that the server has its own
tests, which are located inside of the `server/test` directory.
- **tools**: contains third-party tools we use for building and maintaining various parts of the
project, such as generating diffs to patch between game versions

## License

MIT
