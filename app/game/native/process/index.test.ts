import { beforeEach, expect, test, vi } from 'vitest'
import { ProcessLaunchControl } from '../../process-launch-control'

const native = vi.hoisted(() => ({
  createLaunchOwner: vi.fn(),
  launch: vi.fn(),
  terminateLaunchOwner: vi.fn(),
  waitForExit: vi.fn(),
}))
vi.mock('@shieldbattery/stimpack', () => native)

import { launchProcess } from './index'

beforeEach(() => {
  vi.resetAllMocks()
  native.createLaunchOwner.mockImplementation(() => ({ identity: Symbol() }))
  native.terminateLaunchOwner.mockResolvedValue(undefined)
})

test('cancellation before launch prevents native process creation', async () => {
  const control = new ProcessLaunchControl()
  await control.terminate()
  await expect(launchProcess({} as never, p => control.attach(p))).rejects.toThrow('cancelled')
  expect(native.launch).not.toHaveBeenCalled()
})

test('cancellation reaches the correct native owner before launch resolves', async () => {
  const control = new ProcessLaunchControl()
  let launched!: (process: unknown) => void
  native.launch.mockImplementation(() => new Promise(resolve => (launched = resolve)))
  const launching = launchProcess({} as never, p => control.attach(p))
  const owner = native.createLaunchOwner.mock.results[0].value
  await control.terminate()
  expect(native.terminateLaunchOwner).toHaveBeenCalledExactlyOnceWith(owner)
  expect(native.launch).toHaveBeenCalledWith({}, owner)
  launched({})
  await launching
})

test('termination failure stays retryable and cannot affect another launch', async () => {
  const first = new ProcessLaunchControl()
  const second = new ProcessLaunchControl()
  native.launch.mockResolvedValue({})
  await launchProcess({} as never, p => first.attach(p))
  await launchProcess({} as never, p => second.attach(p))
  const firstOwner = native.createLaunchOwner.mock.results[0].value
  const secondOwner = native.createLaunchOwner.mock.results[1].value
  native.terminateLaunchOwner.mockRejectedValueOnce(new Error('OS termination failed'))
  await expect(first.terminate()).rejects.toThrow('OS termination failed')
  await first.terminate()
  await first.terminate()
  expect(native.terminateLaunchOwner).toHaveBeenCalledTimes(2)
  expect(native.terminateLaunchOwner).not.toHaveBeenCalledWith(secondOwner)
  expect(native.terminateLaunchOwner).toHaveBeenLastCalledWith(firstOwner)
})
