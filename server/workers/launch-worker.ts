const { isMainThread, workerData } = require('node:worker_threads')
require('../../babel-register')

if (isMainThread) {
  throw new Error('launch-worker should not be run in the main thread')
}

require(workerData)
