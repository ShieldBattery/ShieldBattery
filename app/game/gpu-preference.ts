import { HKCU, REG_SZ, WindowsRegistry } from '@shieldbattery/windows-registry'
import { getErrorStack } from '../../common/errors'
import log from '../logger'

/**
 * Where Windows' per-app graphics preference (Settings > Display > Graphics) lives. Each value is
 * named by an exe's full path and holds `;`-terminated `Name=Value` pairs, e.g.
 * `SwapEffectUpgradeEnable=1;GpuPreference=2;`. DXGI reads it inside the process when it
 * enumerates adapters, and puts the preferred GPU first for apps that use the default adapter.
 */
const USER_GPU_PREFERENCES_KEY = 'Software\\Microsoft\\DirectX\\UserGpuPreferences'
const GPU_PREFERENCE = 'GpuPreference'
/** `GpuPreference` values that mean the user picked a GPU themselves (power saving, high perf). */
const CHOSEN_GPU_PREFERENCES = ['1', '2']
const HIGH_PERFORMANCE = '2'

/**
 * Returns `value` with its GPU preference set to high performance, keeping any other settings it
 * holds. Returns undefined if the user has already chosen a GPU for the app, which is left alone.
 */
export function withHighPerformanceGpu(value: string | undefined): string | undefined {
  const pairs = (value ?? '').split(';').filter(p => p.trim() !== '')
  const index = pairs.findIndex(p => p.split('=')[0].trim() === GPU_PREFERENCE)
  if (index !== -1 && CHOSEN_GPU_PREFERENCES.includes(pairs[index].split('=')[1]?.trim())) {
    return undefined
  }

  const preference = `${GPU_PREFERENCE}=${HIGH_PERFORMANCE}`
  if (index === -1) {
    pairs.push(preference)
  } else {
    pairs[index] = preference
  }
  return pairs.join(';') + ';'
}

interface GpuPreferenceHold {
  count: number
  /** The path the value was written under, which the restore writes back to. */
  appPath: string
  /**
   * Resolves to what the value was before we changed it and what we changed it to, or undefined
   * if it was left alone.
   */
  applied: Promise<{ original: string | undefined; written: string } | undefined>
}

const holds = new Map<string, GpuPreferenceHold>()
/**
 * Registry operations run one at a time, so a hold taken while an earlier one is being restored
 * reads the restored value rather than the one about to be replaced.
 */
let registryQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const result = registryQueue.then(op)
  registryQueue = result.catch(() => {})
  return result
}

async function readPreference(
  registry: WindowsRegistry,
  appPath: string,
): Promise<string | undefined> {
  const value = await registry.read(HKCU, USER_GPU_PREFERENCES_KEY, appPath)
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('Got unexpected type for GPU preference: ' + JSON.stringify(value))
  }
  return value
}

async function applyHighPerformanceGpu(appPath: string) {
  try {
    const registry = new WindowsRegistry()
    const original = await readPreference(registry, appPath)
    const written = withHighPerformanceGpu(original)
    if (written === undefined) {
      log.debug(`Leaving the user's GPU preference for StarCraft alone: "${original}"`)
      return undefined
    }
    log.debug(`Preferring the high-performance GPU for StarCraft (was "${original ?? ''}")`)
    await registry.write(HKCU, USER_GPU_PREFERENCES_KEY, appPath, REG_SZ, written)
    return { original, written }
  } catch (err) {
    log.warn(`Failed to set StarCraft's GPU preference: ${getErrorStack(err)}`)
    return undefined
  }
}

async function restoreGpuPreference(
  appPath: string,
  change: { original: string | undefined; written: string },
) {
  try {
    const registry = new WindowsRegistry()
    const current = await readPreference(registry, appPath)
    if (current !== change.written) {
      // Changed while the game ran (e.g. in Windows' settings), so the newer choice stands.
      return
    }
    log.debug('Restoring the GPU preference for StarCraft')
    // The registry module can't delete values, and an empty one means no preference to DXGI.
    await registry.write(HKCU, USER_GPU_PREFERENCES_KEY, appPath, REG_SZ, change.original ?? '')
  } catch (err) {
    log.warn(`Failed to restore StarCraft's GPU preference: ${getErrorStack(err)}`)
  }
}

/**
 * Makes `appPath` prefer the high-performance GPU until every returned release function has been
 * called, unless the user has picked a GPU for it themselves. This is best effort: failures are
 * logged and the launch carries on with whatever Windows picks.
 *
 * The preference has to stay in place for as long as the game runs, since DXGI reads it whenever
 * the game creates its renderer rather than when the process starts.
 *
 * @returns a promise that resolves once the preference is in place, to a function that releases
 *   this hold
 */
export async function holdHighPerformanceGpu(appPath: string): Promise<() => void> {
  const key = appPath.toLowerCase()
  let hold = holds.get(key)
  if (hold) {
    hold.count += 1
  } else {
    hold = { count: 1, appPath, applied: enqueue(() => applyHighPerformanceGpu(appPath)) }
    holds.set(key, hold)
  }
  const thisHold = hold
  await thisHold.applied

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    thisHold.count -= 1
    if (thisHold.count === 0) {
      holds.delete(key)
      thisHold.applied
        .then(change => change && enqueue(() => restoreGpuPreference(thisHold.appPath, change)))
        .catch(() => {})
    }
  }
}
