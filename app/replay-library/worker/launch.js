// Dev-only launcher for the replay DB worker. In dev the app main process runs from TypeScript
// source via @babel/register, but a freshly-spawned worker thread has no such hook, so this plain
// JS entry installs one before requiring the actual (TypeScript) worker module. In production the
// worker is a prebuilt webpack bundle loaded directly, and this file isn't used.
const { isMainThread, workerData } = require('node:worker_threads')
require('../../../babel-register')

global.IS_ELECTRON = true

if (isMainThread) {
  throw new Error('the replay db-worker launcher should not be run in the main thread')
}

require(workerData.entry)
