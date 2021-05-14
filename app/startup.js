// This file is the first one that executes (after, potentially, a babel-register calling file). It
// should avoid pulling in much until things have been configured and we're sure the app should
// even run (e.g. check if another instance is already running)

import 'core-js/proposals/reflect-metadata'
import { app } from 'electron'
import isDev from 'electron-is-dev'
import path from 'path'
import ensureSingleInstance from './single-instance'
import { getUserDataPath } from './user-data-path'

// Set a proper app name, since our build setup makes the one in our package.json innaccurate
app.name = path.basename(getUserDataPath())

// Ensure that it's only possible to open a single instance of the application in non-dev mode. If
// someone tries to open two instances, we just focus the main window
if (!isDev) {
  ensureSingleInstance()
} else {
  require('./app')
}
