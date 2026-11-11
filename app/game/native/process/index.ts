import { launch, LaunchArgs, StimpackProcess, waitForExit } from '@shieldbattery/stimpack'

class Process {
  constructor(private nativeProcess: StimpackProcess) {}

  waitForExit(): Promise<number> {
    return waitForExit(this.nativeProcess)
  }
}

export async function launchProcess(args: LaunchArgs) {
  return new Process(await launch(args))
}
