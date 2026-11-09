import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import {
  Announcer,
  ConsoleSkin,
  DisplayMode,
  IngameSkin,
} from '../../../common/settings/blizz-settings'
import { formatScrSetting } from './scr-setting-labels'

const t = ((_key: string, defaultValue: string) => defaultValue) as unknown as TFunction

describe('formatScrSetting', () => {
  test('names known values', () => {
    expect(formatScrSetting('selectedAnnouncer', Announcer.Jini, t)).toBe('Hey Jini')
    expect(formatScrSetting('selectedSkin', IngameSkin.Default, t)).toBe('None')
  })

  test('shows values outside a fixed set as unset', () => {
    expect(formatScrSetting('selectedAnnouncer', '' as Announcer, t)).toBe('Not set')
    expect(formatScrSetting('consoleSkin', '' as ConsoleSkin, t)).toBe('Not set')
    expect(formatScrSetting('selectedSkin', 'gone' as IngameSkin, t)).toBe('Not set')
    expect(formatScrSetting('displayMode', 7 as DisplayMode, t)).toBe('Not set')
  })
})
