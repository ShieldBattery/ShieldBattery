const { isMainThread, workerData } = require('node:worker_threads')

if (isMainThread) {
  throw new Error('launch-worker should not be run in the main thread')
}

// When this file runs as TypeScript source, the worker module it's about to load is TypeScript
// too, so the transpile hook has to be installed first. In the compiled tree everything here is
// plain JavaScript and no hook must load (the register packages aren't shipped there). The
// specifier is assembled at runtime because a statically analyzable require would be compiled
// into an unconditional, hoisted module import, defeating both the condition and the intent.
if (__filename.endsWith('.ts')) {
  const registerPath = '../../babel-register'
  require(registerPath)
}

require(workerData)
