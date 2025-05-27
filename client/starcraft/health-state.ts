import { atom } from 'jotai'

export const starcraftPathValid = atom(false)
export const starcraftVersionValid = atom(false)

export const starcraftHealthy = atom(get => get(starcraftPathValid) && get(starcraftVersionValid))

export interface ShieldBatteryFileStatus {
  init: boolean
  main: boolean
}

export const shieldBatteryFilesState = atom<ShieldBatteryFileStatus>({
  init: false,
  main: false,
})

export const shieldBatteryHealthy = atom(get => {
  const statuses = get(shieldBatteryFilesState)
  return Object.values(statuses).every(status => status)
})
