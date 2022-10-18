import { launch, LaunchArgs, StimpackProcess, waitForExit } from '@shieldbattery/stimpack'

class Process {
  constructor(private nativeProcess: StimpackProcess) {}

  async waitForExit(): Promise<number> {
    return waitForExit(this.nativeProcess)
  }
}

export async function launchProcess(args: LaunchArgs) {
  // Uses dynamic import to avoid ever pulling this into the Web build
  const process = await launch(args)
  return new Process(process)
}
