import {
  createLaunchOwner,
  launch,
  LaunchArgs,
  StimpackProcess,
  terminateLaunchOwner,
  waitForExit,
} from '@shieldbattery/stimpack'

class Process {
  private owner = createLaunchOwner()
  private nativeProcess?: StimpackProcess

  async launch(args: LaunchArgs): Promise<void> {
    this.nativeProcess = await launch(args, this.owner)
  }

  terminate(): Promise<void> {
    return terminateLaunchOwner(this.owner)
  }

  async waitForExit(): Promise<number> {
    return waitForExit(this.nativeProcess!)
  }
}

export async function launchProcess(args: LaunchArgs, onCreated: (process: Process) => void) {
  // Uses dynamic import to avoid ever pulling this into the Web build
  if (typeof createLaunchOwner !== 'function' || typeof terminateLaunchOwner !== 'function') {
    throw new Error('Native launcher ownership support missing; rebuild the app before launching')
  }
  const process = new Process()
  onCreated(process)
  await process.launch(args)
  return process
}
