// The reflect polyfill has to load before anything pulls in tsyringe, which throws at require
// time without it. It lives here rather than in `app.ts`'s import list because import order
// alone can't guarantee it: the compiled output emits requires of sibling modules ahead of
// external packages, so an external side-effect import declared "first" still runs after a
// sibling that loads tsyringe. This module has no sibling imports, so its position as the
// entry's first import actually holds.
import 'core-js/proposals/reflect-metadata'

import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'

// Loads `.env` (with variable expansion) into `process.env`. This module must be the server
// entry's first import so that every other module sees the resulting environment at load time --
// several read `process.env` while initializing. Deployed environments generally have no `.env`
// file and configure the environment directly, which dotenv treats as a quiet no-op.
dotenvExpand.expand(dotenv.config({ quiet: true }))
