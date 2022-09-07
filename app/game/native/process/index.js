// Uses dynamic require to avoid ever pulling this into the Web build
const native = require('@shieldbattery/stimpack')

class Process {
  constructor(cProcess) {
    this._cProcess = cProcess
  }

  async waitForExit() {
    return native.waitForExit(this._cProcess)
  }
}

export async function launchProcess(args) {
  const process = await native.launch(args)
  return new Process(process)
}
