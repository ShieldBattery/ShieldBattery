import { beforeEach, describe, expect, it, vi } from 'vitest'
import { holdHighPerformanceGpu, withHighPerformanceGpu } from './gpu-preference'

const { values } = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock('@shieldbattery/windows-registry', () => ({
  HKCU: 'HKCU',
  REG_SZ: 'REG_SZ',
  WindowsRegistry: class {
    async read(_hive: string, _key: string, name: string) {
      return values.get(name)
    }
    async write(_hive: string, _key: string, name: string, _type: string, value: unknown) {
      values.set(name, value)
    }
  },
}))
vi.mock('../logger', () => ({
  default: { debug: () => {}, warn: () => {} },
}))

const EXE = 'C:\\StarCraft\\x86_64\\StarCraft.exe'

describe('withHighPerformanceGpu', () => {
  it('adds a preference when there is none', () => {
    expect(withHighPerformanceGpu(undefined)).toBe('GpuPreference=2;')
    expect(withHighPerformanceGpu('')).toBe('GpuPreference=2;')
  })

  it('keeps the other settings in the value', () => {
    expect(withHighPerformanceGpu('SwapEffectUpgradeEnable=1;')).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=2;',
    )
    expect(withHighPerformanceGpu('GpuPreference=0;SwapEffectUpgradeEnable=1;')).toBe(
      'GpuPreference=2;SwapEffectUpgradeEnable=1;',
    )
  })

  it('leaves a GPU the user picked alone', () => {
    expect(withHighPerformanceGpu('GpuPreference=1;')).toBeUndefined()
    expect(withHighPerformanceGpu('SwapEffectUpgradeEnable=1;GpuPreference=2;')).toBeUndefined()
  })
})

describe('holdHighPerformanceGpu', () => {
  beforeEach(() => {
    values.clear()
  })

  /** Lets the restore that a release queues (all microtasks against the fake registry) finish. */
  async function settled() {
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('prefers the high-performance GPU while held, then restores the original', async () => {
    values.set(EXE, 'SwapEffectUpgradeEnable=1;')
    const release = await holdHighPerformanceGpu(EXE)
    expect(values.get(EXE)).toBe('SwapEffectUpgradeEnable=1;GpuPreference=2;')

    release()
    await settled()
    expect(values.get(EXE)).toBe('SwapEffectUpgradeEnable=1;')
  })

  it('restores an absent value as an empty one', async () => {
    const release = await holdHighPerformanceGpu(EXE)
    expect(values.get(EXE)).toBe('GpuPreference=2;')

    release()
    await settled()
    expect(values.get(EXE)).toBe('')
  })

  it('keeps the preference until every overlapping hold is released', async () => {
    const first = await holdHighPerformanceGpu(EXE)
    const second = await holdHighPerformanceGpu(EXE.toUpperCase())
    first()
    first()
    await settled()
    expect(values.get(EXE)).toBe('GpuPreference=2;')

    second()
    await settled()
    expect(values.get(EXE)).toBe('')
  })

  it('reads the restored value when held again right after a release', async () => {
    values.set(EXE, 'SwapEffectUpgradeEnable=1;')
    ;(await holdHighPerformanceGpu(EXE))()
    const release = await holdHighPerformanceGpu(EXE)
    release()
    await settled()
    expect(values.get(EXE)).toBe('SwapEffectUpgradeEnable=1;')
  })

  it('keeps a preference changed while the game ran', async () => {
    const release = await holdHighPerformanceGpu(EXE)
    values.set(EXE, 'GpuPreference=1;')
    release()
    await settled()
    expect(values.get(EXE)).toBe('GpuPreference=1;')
  })

  it('leaves a preference the user picked untouched', async () => {
    values.set(EXE, 'GpuPreference=1;')
    const release = await holdHighPerformanceGpu(EXE)
    expect(values.get(EXE)).toBe('GpuPreference=1;')
    release()
    await settled()
    expect(values.get(EXE)).toBe('GpuPreference=1;')
  })
})
