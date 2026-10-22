import { access } from 'fs/promises'
import path from 'path'

/**
 * Programs Wine places stand-in files for in every prefix's system32 (Proton's included), and that
 * no Windows install has.
 */
const WINE_PROGRAMS = ['wineboot.exe', 'winecfg.exe']

let wineCheck: Promise<boolean> | undefined

/** Whether the app is running under Wine. Checked once, then cached. */
export function isRunningUnderWine(): Promise<boolean> {
  wineCheck ??= (async () => {
    const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    for (const program of WINE_PROGRAMS) {
      try {
        await access(path.join(system32, program))
        return true
      } catch {
        // Not this one, try the next
      }
    }
    return false
  })()
  return wineCheck
}
