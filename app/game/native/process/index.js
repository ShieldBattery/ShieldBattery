// Uses dynamic require to avoid ever pulling this into the Web build
const native = require('./win-process.node')

class Process {
  constructor(cProcess) {
    this._cProcess = cProcess
  }

  async injectDll(dllPath, injectFuncName, errorDumpPath) {
    return new Promise((resolve, reject) => {
      this._cProcess.injectDll(dllPath, injectFuncName, errorDumpPath, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  resume() {
    const err = this._cProcess.resume()
    if (err) throw err
  }

  terminate() {
    const err = this._cProcess.terminate()
    if (err) throw err
  }

  async waitForExit() {
    return new Promise((resolve, reject) => {
      this._cProcess.waitForExit((err, code) => {
        if (err) {
          reject(err)
        } else {
          resolve(code)
        }
      })
    })
  }
}

const $launchProcess = (...args) =>
  new Promise((resolve, reject) =>
    native.launchProcess(...args, (err, proc) => {
      if (err) reject(err)
      else resolve(proc)
    }),
  )
// debuggerLaunch is not related to actually debugging the launched process.
// Instead, it is a way to inject DLL earlier than the "normal" method,
// using Windows's debugging APIs.
export async function launchProcess({
  appPath,
  args = [],
  launchSuspended = true,
  currentDir = '',
  environment = [],
  debuggerLaunch = false,
  logCallback = null,
}) {
  const joinedArgs = typeof args === 'string' ? args : args.join(' ')
  const cProcess = await $launchProcess(
    appPath,
    joinedArgs,
    launchSuspended,
    currentDir,
    environment,
    debuggerLaunch,
    logCallback,
  )
  return new Process(cProcess)
}
