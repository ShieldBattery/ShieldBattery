import { describe, expect, it } from 'vitest'
import { ScrSettings } from '../common/settings/local-settings'
import {
  applyLaunchOverrides,
  applyLaunchOverridesToSettings,
  dropLaunchOverriddenSettings,
  startsInSd,
} from './scr-launch-overrides'

describe('app/scr-launch-overrides', () => {
  it('forces HD graphics off when starting in SD', () => {
    const input = { HDPreferences: true, Gamma: 3 }
    expect(applyLaunchOverrides(input, { alwaysStartSd: true })).toEqual({
      HDPreferences: false,
      Gamma: 3,
    })
    expect(input.HDPreferences).toBe(true)
  })

  it('leaves settings alone otherwise', () => {
    const input = { HDPreferences: true, Gamma: 3 }
    const result = applyLaunchOverrides(input, { alwaysStartSd: false })
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it('tells the game the same thing its settings file says', () => {
    const settings = { hdGraphicsOn: true, gamma: 3 } as unknown as ScrSettings
    expect(applyLaunchOverridesToSettings(settings, { alwaysStartSd: true })).toMatchObject({
      hdGraphicsOn: false,
      gamma: 3,
    })
    expect(applyLaunchOverridesToSettings(settings, { alwaysStartSd: false })).toMatchObject({
      hdGraphicsOn: true,
    })
  })

  it('starts in SD when asked to, or when HD is disabled outright', () => {
    expect(startsInSd({ alwaysStartSd: true })).toBe(true)
    expect(startsInSd({ disableHd: true })).toBe(true)
    expect(startsInSd({ alwaysStartSd: false, disableHd: false })).toBe(false)
    expect(startsInSd({})).toBe(false)
  })

  it('drops the forced setting when reading back', () => {
    const settings = { hdGraphicsOn: false, gamma: 3 }
    dropLaunchOverriddenSettings(settings)
    expect(settings).toEqual({ gamma: 3 })
  })
})
