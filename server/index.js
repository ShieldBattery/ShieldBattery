// Development bootstrap: runs the server from TypeScript source through babel-register.
// Production runs the compiled tree instead: `node --enable-source-maps server-dist/server/app.js`
// (see `tsdown.server.config.ts`). Environment loading lives in `./env`, which the app imports
// first, so both bootstraps share it.
process.env.BABEL_ENV = 'node'
require('../babel-register')
require('./app')
