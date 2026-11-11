import { beforeEach, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({ launch: vi.fn(), waitForExit: vi.fn() }))
vi.mock('@shieldbattery/stimpack', () => native)

import { launchProcess } from './index'

beforeEach(() => vi.resetAllMocks())

test('uses the published one-argument launcher and waits on its returned process', async () => {
  const handle = { identity: Symbol() }
  const args = {} as never
  native.launch.mockResolvedValue(handle)
  native.waitForExit.mockResolvedValue(0)
  const process = await launchProcess(args)
  expect(native.launch).toHaveBeenCalledExactlyOnceWith(args)
  await expect(process.waitForExit()).resolves.toBe(0)
  expect(native.waitForExit).toHaveBeenCalledExactlyOnceWith(handle)
})

test('reports injection failure without requiring ownership exports', async () => {
  native.launch.mockRejectedValue(new Error('Injection failed'))
  await expect(launchProcess({} as never)).rejects.toThrow('Injection failed')
  expect(native.waitForExit).not.toHaveBeenCalled()
})
