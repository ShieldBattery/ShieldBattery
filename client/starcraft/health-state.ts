import { atom } from 'jotai'

export const starcraftPathValid = atom(false)
export const starcraftVersionValid = atom(false)

export const starcraftHealthy = atom(get => get(starcraftPathValid) && get(starcraftVersionValid))

export interface ShieldBatteryFileStatus {
  init: boolean
  main: boolean
  init64: boolean
  main64: boolean
}

export const shieldBatteryFilesState = atom<ShieldBatteryFileStatus>({
  init: false,
  main: false,
  init64: false,
  main64: false,
})

export const shieldBatteryHealthy = atom(get => {
  const statuses = get(shieldBatteryFilesState)
  return Object.values(statuses).every(status => status)
})
