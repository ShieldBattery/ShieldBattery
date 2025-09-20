import { init, parseReplay } from '@shieldbattery/broodrep'
import { readFile } from 'node:fs/promises'
import { isMainThread, parentPort } from 'node:worker_threads'
import { ParseReplayRequest, ParseReplayResult, ReplayWorkerReady } from './messages'

const PARSER_VERSION = 1

if (isMainThread) {
  throw new Error('replay-worker should not be run in the main thread')
}

init()

parentPort!.on('message', (msg: ParseReplayRequest) => {
  Promise.resolve()
    .then(async () => {
      try {
        const buffer = await readFile(msg.path)
        const replay = parseReplay(buffer)
        const sbData = replay.getShieldBatterySection()

        const result: ParseReplayResult = {
          type: 'parseComplete',
          path: msg.path,
          replay: {
            parserVersion: PARSER_VERSION,
            header: replay.header,
            shieldBatteryData: sbData,
            slots: replay.slots(),
            players: replay.players(),
            observers: replay.observers(),
          },
        }
        parentPort!.postMessage(result)
      } catch (err) {
        const result: ParseReplayResult = {
          type: 'parseComplete',
          path: msg.path,
          error: err as Error,
        }
        parentPort!.postMessage(result)
      }
    })
    .catch(err => {
      // Any unexpected errors should restart the worker, so we just throw to make that happen
      throw err
    })
})

const readyMessage: ReplayWorkerReady = { type: 'ready' }
parentPort!.postMessage(readyMessage)
