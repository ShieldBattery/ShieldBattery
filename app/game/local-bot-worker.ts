import { ChildProcess, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

// A separate process retains the child's OS handle after an Electron crash. Parent IPC closure
// therefore kills the exact bot process, without looking up a potentially reused numeric PID.
let bot: ChildProcess | undefined
let stopping = false
process.on('disconnect', stop)
process.on('message', message => {
  const request = message as {
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
    if (process.connected) process.send?.({ type: 'error', error: error.message })
    stop()
  })
  bot = spawn(request.executable, request.args, {
    cwd: request.cwd,
    env: { ...process.env, SB_BWAPI_INSTANCE: request.instance },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  bot.stdout!.on('data', record)
  bot.stderr!.on('data', record)
  bot.on('spawn', () => {
    if (stopping) bot?.kill()
    else process.send?.({ type: 'started' })
  })
  bot.on('error', error => {
    if (process.connected) process.send?.({ type: 'error', error: error.message })
    output.end(() => process.exit(1))
  })
  bot.on('close', code => {
    if (process.connected) process.send?.({ type: 'exit', code })
    output.end(() => process.exit(0))
  })
})

function stop() {
  stopping = true
  if (bot) bot.kill()
  else process.exit(0)
}
