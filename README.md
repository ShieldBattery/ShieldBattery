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

## Project structure

TODO(tec27): Fill this out

## License

MIT
