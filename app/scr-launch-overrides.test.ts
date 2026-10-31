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

  it('turns mouse scaling off while the hardware cursor is on', () => {
    const input = { MouseHardwareCursor: true, MouseScaling: true }
    expect(applyLaunchOverrides(input, { alwaysStartSd: false })).toEqual({
      MouseHardwareCursor: true,
      MouseScaling: false,
    })
    expect(input.MouseScaling).toBe(true)
    expect(
      applyLaunchOverrides(
        { MouseHardwareCursor: false, MouseScaling: true },
        { alwaysStartSd: true },
      ),
    ).toMatchObject({ MouseScaling: true })
  })

  it('tells the game mouse scaling is off while the hardware cursor is on', () => {
    const settings = { hardwareCursorOn: true, mouseScalingOn: true } as unknown as ScrSettings
    expect(applyLaunchOverridesToSettings(settings, { alwaysStartSd: false })).toMatchObject({
      hardwareCursorOn: true,
      mouseScalingOn: false,
    })
    expect(settings.mouseScalingOn).toBe(true)
    const scaled = { hardwareCursorOn: false, mouseScalingOn: true } as unknown as ScrSettings
    expect(applyLaunchOverridesToSettings(scaled, { alwaysStartSd: false })).toMatchObject({
      mouseScalingOn: true,
    })
  })

  it('starts in SD when asked to, or when HD is disabled outright', () => {
    expect(startsInSd({ alwaysStartSd: true })).toBe(true)
    expect(startsInSd({ disableHd: true })).toBe(true)
    expect(startsInSd({ alwaysStartSd: false, disableHd: false })).toBe(false)
    expect(startsInSd({})).toBe(false)
  })

  it('drops the forced setting when reading back', () => {
    const settings = { hdGraphicsOn: false, mouseScalingOn: false, gamma: 3 }
    dropLaunchOverriddenSettings(settings)
    expect(settings).toEqual({ mouseScalingOn: false, gamma: 3 })
  })
})
