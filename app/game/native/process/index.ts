import type { LaunchArgs, StimpackProcess } from '@shieldbattery/stimpack'

class Process {
  constructor(
    private nativeProcess: StimpackProcess,
    private waitForExitFn: (process: StimpackProcess) => Promise<number>,
  ) {}

  async waitForExit() {
    return this.waitForExitFn(this.nativeProcess)
  }
}

export async function launchProcess(args: LaunchArgs) {
  // Uses dynamic import to avoid ever pulling this into the Web build
  const native = await import('@shieldbattery/stimpack')
  const process = await native.launch(args)
  return new Process(process, native.waitForExit)
}
