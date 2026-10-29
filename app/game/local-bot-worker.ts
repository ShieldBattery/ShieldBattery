import { ChildProcess, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

// The utility process owns the bot's OS handle. On Windows its Chromium job also terminates
// descendants if the supervisor or main process crashes, without looking up a reused PID.
let bot: ChildProcess | undefined
let stopping = false
process.parentPort.on('message', event => {
  const request = event.data as {
    type: 'start' | 'stop'
    executable: string
    args: string[]
    cwd: string
    instance: string
    logPath: string
  }
  if (request.type === 'stop') {
    stop()
    return
  }
  if (bot || stopping || request.type !== 'start') return
  const output = createWriteStream(request.logPath, { flags: 'a' })
  let loggedBytes = 0
  const record = (chunk: Buffer) => {
    if (loggedBytes < 8 * 1024 * 1024) {
      loggedBytes += chunk.length
      output.write(chunk)
    }
  }
  output.on('error', error => {
    process.parentPort.postMessage({ type: 'error', error: error.message })
    stop()
  })
  const env: NodeJS.ProcessEnv = { ...process.env, SB_BWAPI_INSTANCE: request.instance }
  delete env.ELECTRON_RUN_AS_NODE
  bot = spawn(request.executable, request.args, {
    cwd: request.cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  bot.stdout!.on('data', record)
  bot.stderr!.on('data', record)
  bot.on('spawn', () => {
    if (stopping) bot?.kill()
    else process.parentPort.postMessage({ type: 'started' })
  })
  bot.on('error', error => {
    process.parentPort.postMessage({ type: 'error', error: error.message })
    output.end(() => process.exit(1))
  })
  bot.on('close', code => {
    process.parentPort.postMessage({ type: 'exit', code })
    output.end(() => process.exit(0))
  })
})

function stop() {
  stopping = true
  if (bot) bot.kill()
  else process.exit(0)
}
